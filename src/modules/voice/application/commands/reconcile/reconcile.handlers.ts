import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    channelOfRoom,
    joinWrite,
    leaveWrite,
    LiveScreen,
    reconcilePlan,
    ScreenAlreadySharedError,
    screenFixes,
    shareWrite,
    VOICE_STATE_REPOSITORY,
    VoiceConnection,
    VoiceState,
    VoiceStateRepositoryPort,
    voiceRoomOf
} from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { serversOf } from '../../services/room-access'
import { clearGoneRooms, standingOf } from '../../services/room-recheck'
import { changeEvents } from '../../services/voice-changes'
import { ReconcileVoiceRoomsCommand } from './reconcile.commands'

/** What one run changed: rows added and removed, connections put out, screens turned off and on. */
export interface Reconciled {
    joined: number
    dropped: number
    evicted: number
    unshared: number
    shared: number
}

/**
 * LiveKit does not promise to deliver every webhook (D-210), so its lists
 * are read again: every room with a row, and every voice room LiveKit has
 * (a lost participant_joined in a room with no row would be missed
 * otherwise). A room whose channel is gone (deleted, or in a deleted
 * server) is emptied first, and anyone in a room they may no longer be in
 * (timed out, not a member, CONNECT lost) put out, each told why (D-212);
 * their rows then have no connection, and are dropped as such. This is the
 * retry of every putting out that could not reach LiveKit.
 * reconcilePlan decides; each change goes through the same
 * write and the same events as the webhook it stands for, under the
 * person's lock, so one that came meanwhile is not undone. LiveKit
 * unreachable: nothing changes, the next run tries again.
 *
 * Screens are set right too (D-101, screenFixes): a row still sharing a
 * screen its connection no longer sends (a lost track_unpublished) is
 * turned off, or the room's Share button would stay off for everyone; the
 * one screen sent in a room nobody is marked sharing in (a lost
 * track_published) is turned on. Two screens sent: who came first is the
 * webhooks' call, and the run leaves them.
 */
@CommandHandler(ReconcileVoiceRoomsCommand)
export class ReconcileVoiceRoomsHandler implements ICommandHandler<ReconcileVoiceRoomsCommand> {
    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        private readonly events: EventBus
    ) {}

    async execute({ now }: ReconcileVoiceRoomsCommand): Promise<Reconciled> {
        // Rows first, then LiveKit: a row is only judged against a list read after it.
        const rows = await this.states.connections()
        const rooms = (await this.media.listRooms()).map(channelOfRoom).filter((id) => id !== null)
        const channelIds = [...new Set([...rows.map((row) => row.channelId), ...rooms])]
        const servers = await serversOf(this.channels, channelIds)
        await clearGoneRooms(
            { media: this.media, publisher: this.publisher },
            channelIds.filter((channelId) => !servers.has(channelId))
        )

        const live: VoiceConnection[] = []
        const screens: LiveScreen[] = []
        // Who this run put out of a room they may no longer be in: their row goes as put out, not as lost.
        const putOut = new Set<string>()
        for (const [channelId, serverId] of servers) {
            const room = voiceRoomOf(channelId)
            for (const participant of await this.media.listParticipants(room)) {
                // Someone who may no longer be here (a kick or a lost CONNECT
                // LiveKit was not reached for, a token used after a ban) goes now.
                const standing = await standingOf(this.checker, serverId, channelId, participant.identity, now)
                if (standing.kind === 'out') {
                    putOut.add(`${channelId}:${participant.identity}`)
                    if (await this.media.removeParticipant(room, participant.identity)) {
                        this.publisher.toUser(participant.identity, 'voice.disconnected', {
                            channelId,
                            reason: standing.reason
                        })
                    }
                    continue
                }
                live.push({
                    userId: participant.identity,
                    channelId,
                    participantSid: participant.sid,
                    joinedAt: participant.joinedAt,
                    sessionId: participant.sessionId
                })
                screens.push({ channelId, participantSid: participant.sid, sharing: participant.sharing })
            }
        }

        const plan = reconcilePlan(rows, live, now)
        for (const row of plan.drop) {
            // Gone from LiveKit with no participant_left taken: a lost connection too (D-215), unless this
            // run put them out (their room gone, or they may no longer be in it).
            const lost = servers.has(row.channelId) && !putOut.has(`${row.channelId}:${row.userId}`)
            this.publish(
                await this.states.change(row.userId, (current) => leaveWrite(current, row.participantSid)),
                lost
            )
        }
        for (const connection of plan.join) {
            this.publish(await this.states.change(connection.userId, (current) => joinWrite(current, connection)))
        }
        for (const { channelId, userId } of plan.evict) {
            await this.media.removeParticipant(voiceRoomOf(channelId), userId)
        }
        const { off, on } = screenFixes(rows, screens)
        for (const row of off) await this.setScreen(row, false)
        for (const row of on) await this.setScreen(row, true)
        return {
            joined: plan.join.length,
            dropped: plan.drop.length,
            evicted: plan.evict.length,
            unshared: off.length,
            shared: on.length
        }
    }

    /** One screen set right, as its webhook would; someone else marked meanwhile was first. */
    private async setScreen(row: VoiceState, sharing: boolean): Promise<void> {
        try {
            this.publish(
                await this.states.change(row.userId, (current) => shareWrite(current, row.participantSid, sharing))
            )
        } catch (error) {
            if (!(error instanceof ScreenAlreadySharedError)) throw error
        }
    }

    private publish(result: Awaited<ReturnType<VoiceStateRepositoryPort['change']>>, lost = false): void {
        for (const event of changeEvents(result, lost)) this.events.publish(event)
    }
}

export const RECONCILE_COMMAND_HANDLERS = [ReconcileVoiceRoomsHandler]
