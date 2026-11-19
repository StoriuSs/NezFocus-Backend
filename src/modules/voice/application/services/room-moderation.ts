import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import {
    channelPermissions,
    outranksMember,
    Permission,
    PERMISSION_CHECKER,
    PermissionCheckerPort,
    ServerAccess
} from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    CannotModerateRoomError,
    modMuteWrite,
    VOICE_STATE_REPOSITORY,
    VoiceHierarchyError,
    VoiceParticipantNotFoundError,
    VoiceRoomNotFoundError,
    VoiceState,
    VoiceStateRepositoryPort,
    VoiceTimedOutError,
    voiceRoomOf
} from '../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../ports'
import { putOut } from './leave-room'
import { mutedSources, RoomSources, standingIn, timedOut, voiceChannelOf } from './room-access'
import { changeEvents } from './voice-changes'

/** What a moderator's command reads before it acts. */
export interface ModerationSources extends RoomSources {
    states: VoiceStateRepositoryPort
}

/** The one a moderator acts on: their row in the room, and what they are in the server. */
export interface ModerationTarget {
    serverId: string
    state: VoiceState
    target: ServerAccess
}

/**
 * Who a moderator's mute, unmute or "put out" in room `channelId` acts on,
 * once `actorId` may (REQ-VC-04, D-207, D-212): a room they cannot view is
 * NOT_FOUND; timed out MEMBER_TIMED_OUT; without the permission in that room
 * FORBIDDEN (step 5 of appendix B takes both away with CONNECT); someone not
 * in the room NOT_FOUND; someone ranked level or above, themselves included,
 * ROLE_HIERARCHY_VIOLATION. The moderator need not be in the room.
 *
 * Reads the permission cache, as joining does (D-146).
 */
export async function moderationTarget(
    { channels, checker, states }: ModerationSources,
    actorId: string,
    channelId: string,
    targetId: string,
    permission: 'MUTE_MEMBERS' | 'MOVE_MEMBERS',
    now: Date
): Promise<ModerationTarget> {
    const serverId = await channels.serverIdOf(channelId)
    if (!serverId) throw new VoiceRoomNotFoundError(channelId)
    const actor = await checker.access(serverId, actorId)
    const channel = actor && voiceChannelOf(actor, channelId)
    if (!actor || !channel) throw new VoiceRoomNotFoundError(channelId)

    const permissions = channelPermissions(actor.server, actor.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new VoiceRoomNotFoundError(channelId)
    if ((permissions & Permission[permission]) === 0n) {
        if (timedOut(actor, now)) throw new VoiceTimedOutError(actor.member.timeoutUntil as Date)
        throw new CannotModerateRoomError(permission)
    }

    const state = await states.find(targetId)
    const target = state?.channelId === channelId ? await checker.access(serverId, targetId) : null
    if (!state || !target) throw new VoiceParticipantNotFoundError(channelId, targetId)
    if (!outranksMember(actor.server, actor.member, target.member)) throw new VoiceHierarchyError()
    return { serverId, state, target }
}

/**
 * What a moderator's mute, unmute and "put out" share (REQ-VC-04, D-207),
 * as servers' Moderate: the checks of moderationTarget, then the change.
 */
export abstract class RoomModeration {
    constructor(
        @Inject(CHANNEL_DIRECTORY) protected readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) protected readonly checker: PermissionCheckerPort,
        @Inject(MEDIA_ROOMS) protected readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) protected readonly states: VoiceStateRepositoryPort,
        @Inject(EVENT_PUBLISHER) protected readonly publisher: EventPublisherPort,
        protected readonly events: EventBus
    ) {}

    /**
     * Mutes or unmutes (D-207), in the person's media turn, from their row
     * and permissions read once it is held, so a recheck after a change of
     * roles cannot undo it, nor it the recheck (D-212). LiveKit first, so one
     * it cannot reach changes nothing (SERVICE_UNAVAILABLE); then the row;
     * then the room's list and the person's own tabs (`voice.muted`), never
     * who did it. Muted already, or not: nothing to do. Gone from the room
     * meanwhile: NOT_FOUND.
     */
    protected async setMuted(actorId: string, channelId: string, targetId: string, muted: boolean): Promise<void> {
        const now = new Date()
        const { serverId } = await moderationTarget(
            { channels: this.channels, checker: this.checker, states: this.states },
            actorId,
            channelId,
            targetId,
            'MUTE_MEMBERS',
            now
        )
        await this.states.inMediaTurn(targetId, async () => {
            const current = await this.states.find(targetId)
            const target = current?.channelId === channelId ? await this.checker.access(serverId, targetId) : null
            if (!current || !target) throw new VoiceParticipantNotFoundError(channelId, targetId)
            if (current.modMuted === muted) return
            // Someone who lost CONNECT a moment ago is on the way out (RecheckMemberRoomHandler): they may send nothing.
            const standing = standingIn(target, channelId, now)
            const sources = standing.kind === 'in' ? mutedSources(standing.sources, muted) : []
            await this.media.setSources(voiceRoomOf(channelId), targetId, sources)

            const result = await this.states.change(targetId, (row) => modMuteWrite(row, channelId, muted))
            if (!result) return
            for (const event of changeEvents(result)) this.events.publish(event)
            this.publisher.toUser(targetId, 'voice.muted', { channelId, muted })
        })
    }

    /** Puts the person out (REQ-VC-04), told `moderator`; NOT_FOUND when they left meanwhile. */
    protected async disconnect(actorId: string, channelId: string, targetId: string): Promise<void> {
        const { state } = await moderationTarget(
            { channels: this.channels, checker: this.checker, states: this.states },
            actorId,
            channelId,
            targetId,
            'MOVE_MEMBERS',
            new Date()
        )
        const sources = { media: this.media, states: this.states, events: this.events, publisher: this.publisher }
        if (!(await putOut(sources, state, 'moderator'))) throw new VoiceParticipantNotFoundError(channelId, targetId)
    }
}
