import { Permission } from '@/modules/permissions'
import {
    AttachmentNotFoundError,
    AttachmentRepositoryPort,
    ATTACHMENTS_PER_MESSAGE,
    canAttach,
    CannotAttachError,
    MessageRuleError
} from '../../domain'
import { OpenChannel } from './channel-access'

/**
 * Pass only files the sender may send in this message (REQ-MSG-04): at most
 * 10, each once; ATTACH_FILES in the channel (REQ-ROLE-03); each their own,
 * checked, never sent, uploaded under 24 hours ago (`canAttach`). Those that
 * are not are named (AttachmentNotFoundError), so the client uploads them
 * again. A message with no file passes.
 */
export async function requireSendableFiles(
    attachments: AttachmentRepositoryPort,
    channel: OpenChannel,
    userId: string,
    attachmentIds: string[],
    now: Date
): Promise<void> {
    if (!attachmentIds.length) return
    if (attachmentIds.length > ATTACHMENTS_PER_MESSAGE || new Set(attachmentIds).size !== attachmentIds.length)
        throw new MessageRuleError('attachments')
    if ((channel.permissions & Permission.ATTACH_FILES) === 0n) throw new CannotAttachError()
    const found = new Map((await attachments.findMany(attachmentIds)).map((file) => [file.id, file]))
    const missing = attachmentIds.filter((id) => {
        const file = found.get(id)
        return !file || !canAttach(file, userId, now)
    })
    if (missing.length) throw new AttachmentNotFoundError(missing)
}
