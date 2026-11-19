import { PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, RoomPerson } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { RoomOccupant, VoiceStateRepositoryPort } from '../../domain'
import { serversOf } from './room-access'

/**
 * Someone in a voice room as every viewer of it sees them (D-205): who,
 * their roles there, since when, and their icons. Servers' type, as servers
 * shows these lists in GET /servers (ROOM_PEOPLE): one shape for both, held
 * by the compiler.
 */
export type RoomPersonView = RoomPerson

/** What reading the rooms' people needs: the rows, names and pictures, and each one's place in the server. */
export interface PeopleSources {
    states: VoiceStateRepositoryPort
    users: UserDirectoryPort
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
}

/** The people of each of these rooms, in the order they joined; a room nobody is in has an empty list. */
export async function roomPeople(sources: PeopleSources, channelIds: string[]): Promise<Map<string, RoomPersonView[]>> {
    const rooms = [...new Set(channelIds)]
    const occupants = await sources.states.occupantsOf(rooms)
    const servers = await serversOf(sources.channels, [...new Set(occupants.map((occupant) => occupant.channelId))])
    return peopleOf(sources, servers, rooms, occupants)
}

/**
 * These rooms' occupants as every viewer sees them, room by room; a room
 * nobody is in has an empty list. Each carries their roles in the room's
 * server (`servers`: the server of each room, read beforehand) and whether
 * they own it (D-205), from the permission cache, so a moderator's menu
 * offers only what their rank allows (D-208); none for one no longer a
 * member, on their way out.
 */
export async function peopleOf(
    { users, checker }: Pick<PeopleSources, 'users' | 'checker'>,
    servers: Map<string, string>,
    channelIds: string[],
    occupants: RoomOccupant[]
): Promise<Map<string, RoomPersonView[]>> {
    const people = new Map(channelIds.map((channelId): [string, RoomPersonView[]] => [channelId, []]))
    const views = await Promise.all(
        occupants.map(async ({ person, userId, channelId, joinedAt, micOn, cameraOn, screenSharing, modMuted }) => {
            const serverId = servers.get(channelId)
            const access = serverId ? await checker.access(serverId, userId) : null
            const view: RoomPersonView = {
                user: {
                    id: person.id,
                    username: person.username,
                    displayName: person.displayName,
                    avatarUrl: await users.avatarUrl(person.avatarKey)
                },
                roleIds: access?.member.roleIds ?? [],
                isOwner: access?.server.ownerId === userId,
                joinedAt,
                micOn,
                cameraOn,
                screenSharing,
                modMuted
            }
            return { channelId, view }
        })
    )
    for (const { channelId, view } of views) people.get(channelId)?.push(view)
    return people
}
