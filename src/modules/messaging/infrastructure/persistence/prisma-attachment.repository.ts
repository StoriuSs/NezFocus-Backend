import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { AttachmentRecord, AttachmentRepositoryPort, CheckedFile, KeptFiles, NewAttachment } from '../../domain'

const ATTACHMENT = {
    id: true,
    uploaderId: true,
    messageId: true,
    position: true,
    filename: true,
    size: true,
    contentType: true,
    storageKey: true,
    thumbnailKey: true,
    width: true,
    height: true,
    completedAt: true,
    createdAt: true,
    message: { select: { channelId: true } }
} satisfies Prisma.AttachmentSelect

type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof ATTACHMENT }>

const toRecord = ({ message, ...row }: AttachmentRow): AttachmentRecord => ({
    ...row,
    channelId: message?.channelId ?? null
})

/** Uploaded files. A message's own are taken with it (PrismaMessageRepository.create). */
@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async create(file: NewAttachment): Promise<AttachmentRecord> {
        return toRecord(await this.prisma.attachment.create({ data: file, select: ATTACHMENT }))
    }

    async find(id: string): Promise<AttachmentRecord | null> {
        const row = await this.prisma.attachment.findUnique({ where: { id }, select: ATTACHMENT })
        return row && toRecord(row)
    }

    async findMany(ids: string[]): Promise<AttachmentRecord[]> {
        if (!ids.length) return []
        const rows = await this.prisma.attachment.findMany({ where: { id: { in: ids } }, select: ATTACHMENT })
        return rows.map(toRecord)
    }

    async complete(id: string, checked: CheckedFile, at: Date): Promise<boolean> {
        const { count } = await this.prisma.attachment.updateMany({
            where: { id, completedAt: null },
            data: { ...checked, completedAt: at }
        })
        return count === 1
    }

    async delete(id: string): Promise<void> {
        // Only one not checked: a second /complete that lost the race never deletes the file the first kept.
        await this.prisma.attachment.deleteMany({ where: { id, completedAt: null, messageId: null, position: null } })
    }

    async forCleanUp(uploadedBefore: Date, limit: number): Promise<KeptFiles[]> {
        // Both kinds hold no message: the partial index on createdAt WHERE messageId IS NULL finds them.
        // No lock: two runs at once read the same rows, queue the same keys (one job each) and delete them once.
        return this.prisma.attachment.findMany({
            where: { messageId: null, OR: [{ position: { not: null } }, { createdAt: { lt: uploadedBefore } }] },
            select: { id: true, storageKey: true, thumbnailKey: true },
            orderBy: { createdAt: 'asc' },
            take: limit
        })
    }

    async purge(ids: string[]): Promise<void> {
        if (ids.length === 0) return
        // Such a file can no longer be sent (too old, or let go by a deleted message): messageId is checked anyway.
        await this.prisma.attachment.deleteMany({ where: { id: { in: ids }, messageId: null } })
    }
}
