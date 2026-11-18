import { RoomPerson } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { RoomOccupant, VoiceStateRepositoryPort } from '../../domain'

/**
 * Someone in a voice room as every viewer of it sees them (D-205): who,
 * since when, and their icons. Servers' type, as servers shows these lists
 * in GET /servers (ROOM_PEOPLE): one shape for both, held by the compiler.
 */
export type RoomPersonView = RoomPerson

/** What reading the rooms' people needs. */
export interface PeopleSources {
    states: VoiceStateRepositoryPort
    users: UserDirectoryPort
}

/** The people of each of these rooms, in the order they joined; a room nobody is in has an empty list. */
export async function roomPeople(
    { states, users }: PeopleSources,
    channelIds: string[]
): Promise<Map<string, RoomPersonView[]>> {
    const rooms = [...new Set(channelIds)]
    return peopleOf(users, rooms, await states.occupantsOf(rooms))
}

/** These rooms' occupants as every viewer sees them, room by room; a room nobody is in has an empty list. */
export async function peopleOf(
    users: UserDirectoryPort,
    channelIds: string[],
    occupants: RoomOccupant[]
): Promise<Map<string, RoomPersonView[]>> {
    const people = new Map(channelIds.map((channelId): [string, RoomPersonView[]] => [channelId, []]))
    const views = await Promise.all(
        occupants.map(async ({ person, channelId, joinedAt, micOn, cameraOn, screenSharing, modMuted }) => ({
            channelId,
            view: {
                user: {
                    id: person.id,
                    username: person.username,
                    displayName: person.displayName,
                    avatarUrl: await users.avatarUrl(person.avatarKey)
                },
                joinedAt,
                micOn,
                cameraOn,
                screenSharing,
                modMuted
            }
        }))
    )
    for (const { channelId, view } of views) people.get(channelId)?.push(view)
    return people
}
