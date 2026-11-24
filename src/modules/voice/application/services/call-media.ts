import { Inject, Injectable } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { USER_DIRECTORY, type UserDirectoryPort } from '@/modules/users'
import { callOfRoom, callRoomOf, VOICE_STATE_REPOSITORY, type VoiceStateRepositoryPort } from '../../domain'
import { CallConnection, CallMediaPort, MEDIA_ROOMS, type MediaRoomsPort, MediaSource } from '../ports'
import { leaveRoom } from './leave-room'
import { mediaNameOf } from './media-name'

/** What each of a call's two may send (D-242): their voice, and their camera, on or off at any time. No screen. */
const CALL_SOURCES: MediaSource[] = ['microphone', 'camera']

/**
 * CallMediaPort, answered by this module for social (D-239): the rooms of
 * one-to-one calls on the same LiveKit as the voice rooms, through
 * MEDIA_ROOMS. The one rule of voice's own here: one media connection per
 * account (D-210), so a call's token takes its person out of their voice
 * room first, as a token for another room would.
 */
@Injectable()
export class CallMedia implements CallMediaPort {
    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async joinToken(callId: string, userId: string, sessionId: string): Promise<{ token: string; url: string }> {
        const current = await this.states.find(userId)
        if (current) await leaveRoom({ media: this.media, states: this.states, events: this.events }, current)
        return this.media.issueJoinToken({
            room: callRoomOf(callId),
            identity: userId,
            name: await mediaNameOf(this.users, userId),
            sources: CALL_SOURCES,
            sessionId
        })
    }

    async participants(callId: string): Promise<CallConnection[]> {
        const participants = await this.media.listParticipants(callRoomOf(callId))
        return participants.map(({ identity, sid, joinedAt, sessionId }) => ({
            userId: identity,
            participantSid: sid,
            joinedAt,
            sessionId
        }))
    }

    async rooms(): Promise<string[]> {
        return (await this.media.listRooms()).map(callOfRoom).filter((callId) => callId !== null)
    }

    removeConnection(callId: string, userId: string, participantSid: string): Promise<boolean> {
        return this.media.removeConnection(callRoomOf(callId), userId, participantSid)
    }

    close(callId: string): Promise<void> {
        return this.media.closeRoom(callRoomOf(callId))
    }
}
