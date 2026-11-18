import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import {
    channelOfRoom,
    joinWrite,
    leaveWrite,
    reconcilePlan,
    VOICE_STATE_REPOSITORY,
    VoiceConnection,
    VoiceStateRepositoryPort,
    voiceRoomOf
} from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { changeEvents } from '../../services/voice-changes'
import { ReconcileVoiceRoomsCommand } from './reconcile.commands'

/** What one run changed: rows added and removed, connections put out. */
export interface Reconciled {
    joined: number
    dropped: number
    evicted: number
}

/**
 * LiveKit does not promise to deliver every webhook (D-210), so its lists
 * are read again: every room with a row, and every voice room LiveKit has
 * (a lost participant_joined in a room with no row would be missed
 * otherwise). reconcilePlan decides; each change goes through the same
 * write and the same events as the webhook it stands for, under the
 * person's lock, so one that came meanwhile is not undone. LiveKit
 * unreachable: nothing changes, the next run tries again.
 */
@CommandHandler(ReconcileVoiceRoomsCommand)
export class ReconcileVoiceRoomsHandler implements ICommandHandler<ReconcileVoiceRoomsCommand> {
    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ now }: ReconcileVoiceRoomsCommand): Promise<Reconciled> {
        // Rows first, then LiveKit: a row is only judged against a list read after it.
        const rows = await this.states.connections()
        const rooms = (await this.media.listRooms()).map(channelOfRoom)
        const channelIds = new Set([...rows.map((row) => row.channelId), ...rooms.filter((id) => id !== null)])
        const live: VoiceConnection[] = []
        for (const channelId of channelIds) {
            for (const participant of await this.media.listParticipants(voiceRoomOf(channelId))) {
                live.push({
                    userId: participant.identity,
                    channelId,
                    participantSid: participant.sid,
                    joinedAt: participant.joinedAt
                })
            }
        }

        const plan = reconcilePlan(rows, live, now)
        for (const row of plan.drop) {
            this.publish(await this.states.change(row.userId, (current) => leaveWrite(current, row.participantSid)))
        }
        for (const connection of plan.join) {
            this.publish(await this.states.change(connection.userId, (current) => joinWrite(current, connection)))
        }
        for (const { channelId, userId } of plan.evict) {
            await this.media.removeParticipant(voiceRoomOf(channelId), userId)
        }
        return { joined: plan.join.length, dropped: plan.drop.length, evicted: plan.evict.length }
    }

    private publish(result: Awaited<ReturnType<VoiceStateRepositoryPort['change']>>): void {
        for (const event of changeEvents(result)) this.events.publish(event)
    }
}

export const RECONCILE_COMMAND_HANDLERS = [ReconcileVoiceRoomsHandler]
