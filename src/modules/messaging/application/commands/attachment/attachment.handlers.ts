import { randomUUID } from 'crypto'
import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { ConcurrencyLimiter, ConcurrencyLimitError } from '@/shared/utils/concurrency-limiter.util'
import {
    ATTACHMENT_MAX_BYTES,
    ATTACHMENT_NAME_MAX,
    ATTACHMENT_REPOSITORY,
    AttachmentNameError,
    AttachmentNotFoundError,
    AttachmentRecord,
    AttachmentRepositoryPort,
    attachmentKey,
    AttachmentTooLargeError,
    AttachmentTypeError,
    CannotAttachError,
    FileCheckBusyError,
    characterCount,
    CLEAN_UP_AFTER_MS,
    contentCheckFor,
    contentTypeOf,
    FileType,
    findZipDirectory,
    hasSignature,
    HEAD_BYTES,
    isOfficeZip,
    PlainTextCheck,
    TEXT_CHUNK_BYTES,
    uploadKeyOf,
    normaliseFileName,
    typeByName,
    UPLOAD_FORM_TTL_SECONDS,
    ZIP_DIRECTORY_MAX_BYTES,
    ZIP_TAIL_BYTES,
    zipEntryNames
} from '../../../domain'
import {
    ATTACHMENT_STORAGE,
    AttachmentStoragePort,
    FILE_CLEANUP,
    FileCleanupPort,
    Thumbnail,
    UploadForm
} from '../../ports'
import { attachmentView, AttachmentView } from '../../services/attachment-views'
import { openChannel, requireSending } from '../../services/channel-access'
import { CleanUpAttachmentsCommand, CompleteUploadCommand, RequestUploadCommand } from './attachment.commands'

/** A form to upload one file, and the upload it is for. */
export interface UploadTicket {
    attachmentId: string
    upload: UploadForm
    expiresAt: Date
}

/** How long after its form expires the upload key is deleted: whatever was posted there is gone by then. */
const UPLOAD_KEY_GRACE_MS = 60 * 1000

/**
 * Only someone who may send files in the channel now gets a form (REQ-ROLE-03:
 * a timeout or a channel for managers says so first, as when sending), for a
 * file of a type sent (D-92, D-177) up to 25 MB; the storage refuses a bigger
 * one (D-165). The form writes only to an upload key, which is deleted a
 * minute after the form expires: the file checked and sent is a copy the form
 * cannot reach. The file belongs to no channel yet: sending it checks the
 * channel it goes to.
 */
@CommandHandler(RequestUploadCommand)
export class RequestUploadHandler implements ICommandHandler<RequestUploadCommand> {
    private readonly logger = new Logger(RequestUploadHandler.name)

    constructor(
        @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepositoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
        @Inject(FILE_CLEANUP) private readonly cleanup: FileCleanupPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort
    ) {}

    async execute({ userId, channelId, filename, size }: RequestUploadCommand): Promise<UploadTicket> {
        const now = new Date()
        const channel = await openChannel(this.channels, this.permissions, channelId, userId, now)
        requireSending(channel, now)
        if ((channel.permissions & Permission.ATTACH_FILES) === 0n) throw new CannotAttachError()

        const name = normaliseFileName(filename)
        if (!name || characterCount(name) > ATTACHMENT_NAME_MAX) throw new AttachmentNameError()
        if (!typeByName(name)) throw new AttachmentTypeError(name)
        if (size > ATTACHMENT_MAX_BYTES) throw new AttachmentTooLargeError()

        const storageKey = attachmentKey(randomUUID())
        const uploadKey = uploadKeyOf(storageKey)
        // The form first: if the storage cannot give one, no upload is left waiting for the clean-up.
        const upload = await this.storage.uploadForm(uploadKey, ATTACHMENT_MAX_BYTES, UPLOAD_FORM_TTL_SECONDS)
        const file = await this.attachments.create({ uploaderId: userId, filename: name, size, storageKey })
        await this.cleanup
            .deleteFileLater(uploadKey, UPLOAD_FORM_TTL_SECONDS * 1000 + UPLOAD_KEY_GRACE_MS)
            .catch((error: Error) =>
                // The upload still works; what reaches that key stays until it is checked (then deleted).
                this.logger.warn(`Upload key ${uploadKey} not scheduled for deletion: ${error?.message}`)
            )
        return { attachmentId: file.id, upload, expiresAt: new Date(now.getTime() + UPLOAD_FORM_TTL_SECONDS * 1000) }
    }
}

/**
 * Files checked at once; more wait a little, then are told to try again.
 * A check may read a 25 MB file (an image, whole; text a megabyte at a time).
 */
const checking = new ConcurrencyLimiter({ concurrency: 4, maxQueued: 20, maxWaitMs: 15_000 })

/** What a check found: not what its name says (false), or a file to keep, with its thumbnail if it shows as an image. */
type Checked = false | { thumbnail: Thumbnail | null }

/**
 * Copies what reached the upload key to the file's own key, then checks the
 * copy is what its name says (D-93): the signature at its start; for docx,
 * xlsx and pptx the names in the zip; for text, every byte; an image is
 * decoded, and its thumbnail and size kept (C-10 keeps its place by them).
 * An image that does not decode (too many pixels, broken) is kept as a file
 * with no preview (owner, 14/11/2026); one of another image type is refused.
 * A file refused is deleted, and the answer says so before the message is
 * sent. Nothing uploaded yet is not found: the client uploads again.
 *
 * Only the uploader completes; once checked, completing again answers the
 * same. The upload key is deleted once done (and a minute after the form
 * expires in any case, RequestUploadHandler).
 */
@CommandHandler(CompleteUploadCommand)
export class CompleteUploadHandler implements ICommandHandler<CompleteUploadCommand> {
    private readonly logger = new Logger(CompleteUploadHandler.name)

    constructor(
        @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepositoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort
    ) {}

    async execute({ userId, attachmentId }: CompleteUploadCommand): Promise<AttachmentView> {
        const file = await this.attachments.find(attachmentId)
        if (!file || file.uploaderId !== userId) throw new AttachmentNotFoundError([attachmentId])
        if (file.completedAt) return this.view(file)
        try {
            return await checking.run(() => this.complete(file))
        } catch (error) {
            if (error instanceof ConcurrencyLimitError) throw new FileCheckBusyError()
            throw error
        }
    }

    private async complete(file: AttachmentRecord): Promise<AttachmentView> {
        const uploadKey = uploadKeyOf(file.storageKey)
        // What the form can still write to is never what is checked.
        if (!(await this.storage.copy(uploadKey, file.storageKey))) throw new AttachmentNotFoundError([file.id])
        const size = (await this.storage.sizeOf(file.storageKey)) ?? 0
        const type = typeByName(file.filename)!
        if (size > ATTACHMENT_MAX_BYTES) return this.refuse(file, new AttachmentTooLargeError())

        const checked = size > 0 ? await this.check(file, type, size) : false
        if (!checked) return this.refuse(file, new AttachmentTypeError(file.filename))

        const { thumbnail } = checked
        const completed = await this.attachments.complete(
            file.id,
            {
                size,
                contentType: contentTypeOf(type),
                thumbnailKey: thumbnail?.key ?? null,
                width: thumbnail?.width ?? null,
                height: thumbnail?.height ?? null
            },
            new Date()
        )
        // Completed twice at once: the other's thumbnail is the one kept.
        if (!completed && thumbnail) await this.storage.delete(thumbnail.key).catch(() => undefined)
        await this.forget(uploadKey)
        const kept = await this.attachments.find(file.id)
        if (!kept?.completedAt) throw new AttachmentNotFoundError([file.id])
        return this.view(kept)
    }

    private async check(file: AttachmentRecord, type: FileType, size: number): Promise<Checked> {
        const key = file.storageKey
        const how = contentCheckFor(type)
        const kept = { thumbnail: null }
        if (how === 'text') {
            // A megabyte at a time: a 25 MB text is never held whole.
            const text = new PlainTextCheck()
            for (let at = 0; at < size; at += TEXT_CHUNK_BYTES) {
                if (!text.push(await this.storage.read(key, at, Math.min(size, at + TEXT_CHUNK_BYTES) - 1)))
                    return false
            }
            return text.end() && kept
        }

        const head = await this.storage.read(key, 0, HEAD_BYTES - 1)
        if (!hasSignature(type, head)) return false
        if (how === 'signature') return kept
        if (how === 'image') {
            const thumbnail = await this.storage.thumbnail(file.id, await this.storage.read(key, 0, size - 1), type)
            return thumbnail === 'other-type' ? false : { thumbnail }
        }

        // An Office file: a zip whose directory names its parts.
        const tailStart = Math.max(0, size - ZIP_TAIL_BYTES)
        const tail = await this.storage.read(key, tailStart, size - 1)
        const place = findZipDirectory(tail, size)
        if (!place || place.size > ZIP_DIRECTORY_MAX_BYTES) return false
        const directory =
            place.offset >= tailStart
                ? tail.subarray(place.offset - tailStart, place.offset - tailStart + place.size)
                : await this.storage.read(key, place.offset, place.offset + place.size - 1)
        return isOfficeZip(type, zipEntryNames(directory)) && kept
    }

    /** The file is not sent: gone from the storage and the list, and the answer says why. */
    private async refuse(file: AttachmentRecord, error: Error): Promise<never> {
        await this.storage.delete(file.storageKey).catch((failure: Error) => {
            // Its row goes all the same; the bucket keeps a file nothing points at (logged to be found).
            this.logger.warn(`Refused upload ${file.storageKey} not deleted: ${failure?.message}`)
        })
        await this.forget(uploadKeyOf(file.storageKey))
        await this.attachments.delete(file.id)
        throw error
    }

    /** The upload key once checked: its job a minute after the form expires deletes it anyway. */
    private forget(uploadKey: string): Promise<void> {
        return this.storage.delete(uploadKey).catch(() => undefined)
    }

    private view(file: AttachmentRecord): Promise<AttachmentView> {
        return attachmentView(this.storage, {
            id: file.id,
            filename: file.filename,
            size: file.size,
            contentType: file.contentType!,
            storageKey: file.storageKey,
            thumbnailKey: file.thumbnailKey,
            width: file.width,
            height: file.height
        })
    }
}

/** How many files one round of the clean-up removes; the rest wait for the next round. */
const CLEAN_UP_BATCH = 500

/**
 * Every hour (src/maintenance): the files no message holds go, those never
 * sent once 25 hours old (an hour past the last moment one can be sent) and
 * those of deleted messages, their rows first, their stored files then
 * through the file-cleanup queue, retried there.
 */
@CommandHandler(CleanUpAttachmentsCommand)
export class CleanUpAttachmentsHandler implements ICommandHandler<CleanUpAttachmentsCommand> {
    constructor(
        @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepositoryPort,
        @Inject(FILE_CLEANUP) private readonly cleanup: FileCleanupPort
    ) {}

    async execute({ now }: CleanUpAttachmentsCommand): Promise<void> {
        const before = new Date(now.getTime() - CLEAN_UP_AFTER_MS)
        for (;;) {
            const taken = await this.attachments.takeForCleanUp(before, CLEAN_UP_BATCH)
            for (const { storageKey, thumbnailKey } of taken) {
                await this.cleanup.deleteFileLater(storageKey)
                if (thumbnailKey) await this.cleanup.deleteFileLater(thumbnailKey)
            }
            if (taken.length < CLEAN_UP_BATCH) return
        }
    }
}

export const ATTACHMENT_COMMAND_HANDLERS = [RequestUploadHandler, CompleteUploadHandler, CleanUpAttachmentsHandler]
