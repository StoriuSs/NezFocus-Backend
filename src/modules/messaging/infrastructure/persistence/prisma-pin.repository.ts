import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MessageRecord, PinDecision, PinFacts, PinnedMessage, PinRepositoryPort } from '../../domain'
import { MESSAGE, toRecordOf, toRecords } from './message.selections'
import { pinsLock } from './messaging-locks'

/** Pins of channels: at most 50 rows a channel, read through the key's channel prefix and sorted by pinnedAt. */
@Injectable()
export class PrismaPinRepository implements PinRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async pin(
        channelId: string,
        messageId: string,
        userId: string,
        decide: (facts: PinFacts) => PinDecision
    ): Promise<{ decision: PinDecision; notice: MessageRecord | null }> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pinsLock(channelId)}, 0))`
            // The channel row first, in the mode the system message's foreign
            // key takes anyway: a channel being deleted (which locks its row,
            // then each message) is waited for here, before this holds a
            // message the delete needs. Taken after the message, the two would
            // wait for each other (deadlock).
            await tx.$queryRaw`SELECT 1 FROM "Channel" WHERE "id" = ${channelId} FOR KEY SHARE`
            // Held against a delete (which updates this row and drops its pin):
            // a pin never lands on a message deleted meanwhile.
            const [message] = await tx.$queryRaw<{ type: string; deletedAt: Date | null }[]>`
                SELECT "type", "deletedAt" FROM "Message"
                WHERE "id" = ${messageId} AND "channelId" = ${channelId}
                FOR SHARE
            `
            const [pinned, pinCount] = await Promise.all([
                tx.pin.findUnique({
                    where: { channelId_messageId: { channelId, messageId } },
                    select: { messageId: true }
                }),
                tx.pin.count({ where: { channelId } })
            ])
            const decision = decide({
                messageId,
                live: message !== undefined && message.deletedAt === null,
                system: message?.type === 'system',
                pinned: pinned !== null,
                pinCount
            })
            if (decision === 'already') return { decision, notice: null }

            await tx.pin.create({ data: { channelId, messageId, pinnedById: userId } })
            // "<who> pinned a message" (REQ-MSG-08): who and which in systemData (D-168).
            const notice = await tx.message.create({
                data: {
                    channelId,
                    type: 'system',
                    systemEvent: 'message_pinned',
                    systemData: { userId, messageId },
                    content: ''
                },
                select: MESSAGE
            })
            return { decision, notice: await toRecordOf(tx, notice) }
        })
    }

    async unpin(channelId: string, messageId: string): Promise<boolean> {
        const { count } = await this.prisma.pin.deleteMany({ where: { channelId, messageId } })
        return count > 0
    }

    async list(channelId: string): Promise<PinnedMessage[]> {
        const rows = await this.prisma.pin.findMany({
            // A delete drops the pin with it; the filter only closes the moment between.
            where: { channelId, message: { deletedAt: null } },
            orderBy: [{ pinnedAt: 'desc' }, { messageId: 'desc' }],
            select: { pinnedAt: true, message: { select: MESSAGE } }
        })
        const records = await toRecords(
            this.prisma,
            rows.map((row) => row.message)
        )
        return rows.map((row, index) => ({ message: records[index]!, pinnedAt: row.pinnedAt }))
    }
}
