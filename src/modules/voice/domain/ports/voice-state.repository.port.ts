import { VoiceConnection, VoiceState, VoiceWrite } from '../voice-state.rules'

/** A person in a room as others may see them (D-182): no name or picture once deleted, or waiting to be. */
export interface VoicePerson {
    id: string
    username: string | null
    displayName: string | null
    /** The storage key of their picture; the application turns it into an address. */
    avatarKey: string | null
}

/** A row with its person, for the lists of the rooms (D-205). */
export interface RoomOccupant extends VoiceState {
    person: VoicePerson
}

/**
 * VoiceState Repository Port: who is in which voice room (D-210). Every
 * change to a person's row is read and written under a lock of that person,
 * so a webhook, the reconciliation and the person's own request cannot
 * decide on the same row at once.
 */
export interface VoiceStateRepositoryPort {
    /** The person's row, if they are in a room. */
    find(userId: string): Promise<VoiceState | null>

    /**
     * Writes what `decide` makes of the person's row, read under their lock.
     * Null when it wrote nothing: `decide` gave null, or the room's channel
     * or the account is gone (a webhook about a room just deleted).
     */
    change(
        userId: string,
        decide: (current: VoiceState | null) => VoiceWrite | null
    ): Promise<{ before: VoiceState | null; after: VoiceState | null } | null>

    /** Every row's connection: the rooms the reconciliation reads. */
    connections(): Promise<VoiceConnection[]>

    /** The people in these rooms, in the order they joined each. */
    occupantsOf(channelIds: string[]): Promise<RoomOccupant[]>

    /**
     * Reads the people of one room under the room's lock and hands them to
     * `tell`, letting go once it is done: the lists of a room are told in
     * the order they were read (D-205).
     */
    tellOccupants(channelId: string, tell: (occupants: RoomOccupant[]) => Promise<void>): Promise<void>
}

export const VOICE_STATE_REPOSITORY = Symbol('VoiceStateRepositoryPort')
