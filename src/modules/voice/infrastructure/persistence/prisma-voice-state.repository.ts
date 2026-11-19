import { Injectable } from '@nestjs/common'
import { shownPerson } from '@/shared/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import { RoomOccupant, ScreenAlreadySharedError, VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../domain'
import { voiceMediaLock, voiceRoomLock, voiceStateLock } from './voice-locks'

const STATE = {
    userId: true,
    channelId: true,
    participantSid: true,
    joinedAt: true,
    micOn: true,
    cameraOn: true,
    screenSharing: true,
    modMuted: true
} as const

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/**
 * How long a media turn may hold its transaction: a call to LiveKit (at
 * most 5 seconds, the adapter's limit) and a row change, with room to spare.
 */
const MEDIA_TURN_MS = 15_000

/** The client of PrismaService, or of a transaction it runs. */
type Db = PrismaService | Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

async function readOccupants(db: Db, channelIds: string[]): Promise<RoomOccupant[]> {
    const rows = await db.voiceState.findMany({
        where: { channelId: { in: channelIds } },
        orderBy: [{ channelId: 'asc' }, { joinedAt: 'asc' }, { userId: 'asc' }],
        select: { ...STATE, user: { select: SHOWN_PERSON } }
    })
    return rows.map(({ user, ...state }) => {
        const { id, username, displayName, avatarUrl } = shownPerson(user)
        return { ...state, person: { id, username, displayName, avatarKey: avatarUrl } }
    })
}

/** Thrown inside the transaction to roll it back when the room's channel is gone. */
class RoomGone extends Error {}

/** VoiceState rows: one per person in a room (D-210), changed under that person's lock. */
@Injectable()
export class PrismaVoiceStateRepository implements VoiceStateRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    find(userId: string): Promise<VoiceState | null> {
        return this.prisma.voiceState.findUnique({ where: { userId }, select: STATE })
    }

    change(
        userId: string,
        decide: (current: VoiceState | null) => VoiceWrite | null
    ): Promise<{ before: VoiceState | null; after: VoiceState | null } | null> {
        return this.changeOnce(userId, decide, false)
    }

    private async changeOnce(
        userId: string,
        decide: (current: VoiceState | null) => VoiceWrite | null,
        retried: boolean
    ): Promise<{ before: VoiceState | null; after: VoiceState | null } | null> {
        // The room of the row as read under the lock: a refused screen is looked up there.
        const read: { room: string | null } = { room: null }
        try {
            return await this.prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${voiceStateLock(userId)}, 0))`
                const before = await tx.voiceState.findUnique({ where: { userId }, select: STATE })
                read.room = before?.channelId ?? null
                const write = decide(before)
                if (!write) return null

                // A channel deleted meanwhile takes its rows without this lock
                // (the cascade): one gone since it was read changes nothing.
                if (write.kind === 'remove') {
                    const { count } = await tx.voiceState.deleteMany({ where: { userId } })
                    return count > 0 ? { before, after: null } : null
                }
                if (write.kind === 'flags') {
                    const { count } = await tx.voiceState.updateMany({ where: { userId }, data: write.flags })
                    if (count === 0) return null
                    return { before, after: await tx.voiceState.findUnique({ where: { userId }, select: STATE }) }
                }
                const { channelId, participantSid, joinedAt } = write.connection
                // The channel first, in the mode the row's foreign key takes
                // anyway: a channel being deleted (which locks its row, then
                // its VoiceState rows) is waited for here, and one gone is told
                // apart from any other failure.
                const [channel] = await tx.$queryRaw<{ id: string }[]>`
                    SELECT "id" FROM "Channel" WHERE "id" = ${channelId} FOR KEY SHARE
                `
                if (!channel) throw new RoomGone()
                // A new connection: every icon off until its tab reports them (D-206), a moderator's mute gone with the old one (D-207).
                const fresh = {
                    channelId,
                    participantSid,
                    joinedAt,
                    micOn: false,
                    cameraOn: false,
                    screenSharing: false,
                    modMuted: false
                }
                const after = await tx.voiceState.upsert({
                    where: { userId },
                    create: { userId, ...fresh },
                    update: fresh,
                    select: STATE
                })
                return { before, after }
            })
        } catch (error) {
            // The room's channel was deleted, or the account is gone: a
            // webhook about either changes nothing.
            if (error instanceof RoomGone || prismaCode(error) === 'P2003') return null
            // The only unique index a change can meet: a second screen in the room (D-101).
            const { room } = read
            if (prismaCode(error) !== 'P2002' || !room) throw error
            const sharer = await this.prisma.voiceState.findFirst({
                where: { channelId: room, screenSharing: true, userId: { not: userId } },
                select: { userId: true }
            })
            if (sharer) throw new ScreenAlreadySharedError(room, sharer.userId)
            // They stopped meanwhile: the screen is free, tried once more.
            if (!retried) return this.changeOnce(userId, decide, true)
            throw error
        }
    }

    async inMediaTurn<T>(userId: string, work: () => Promise<T>): Promise<T> {
        return this.prisma.$transaction(
            async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${voiceMediaLock(userId)}, 0))`
                // The work runs on other connections: this one only holds the lock.
                return work()
            },
            { timeout: MEDIA_TURN_MS, maxWait: MEDIA_TURN_MS }
        )
    }

    connections(): Promise<VoiceState[]> {
        return this.prisma.voiceState.findMany({ select: STATE })
    }

    async occupantsOf(channelIds: string[]): Promise<RoomOccupant[]> {
        if (channelIds.length === 0) return []
        return readOccupants(this.prisma, channelIds)
    }

    async tellOccupants(channelId: string, tell: (occupants: RoomOccupant[]) => Promise<void>): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${voiceRoomLock(channelId)}, 0))`
            // Read once the lock is taken (read committed): it sees every
            // change the list told before it saw, so it is never older.
            await tell(await readOccupants(tx, [channelId]))
        })
    }
}
