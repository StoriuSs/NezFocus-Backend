import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { ChannelView, memberView, SERVER_REPOSITORY, ServerRepositoryPort, ServerView } from '../../../domain'
import { ICON_STORAGE, IconStoragePort, ROOM_PEOPLE, RoomPeoplePort, RoomPerson } from '../../ports'
import { ListMyServersQuery } from './server.queries'

/** A channel in the list: a voice room comes with its people (D-205), a text channel with none (null). */
export type ServerListChannel = ChannelView & { voiceStates: RoomPerson[] | null }

export type ServerListItem = Omit<ServerView, 'channels'> & {
    iconUrl: string | null
    memberCount: number
    channels: ServerListChannel[]
}

/**
 * Every server the person is in, as they see it: the channels they may see,
 * with what they may do in each, worked out here so the client only reads
 * bits (D-115, D-145); and who is in each voice room among them, for all
 * their servers at once (D-205).
 *
 * Reads the database rather than the permission cache: the list needs names
 * and positions the cache does not keep, and gets the freshest answer for it.
 */
@QueryHandler(ListMyServersQuery)
export class ListMyServersHandler implements IQueryHandler<ListMyServersQuery> {
    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(ICON_STORAGE) private readonly storage: IconStoragePort,
        @Inject(ROOM_PEOPLE) private readonly roomPeople: RoomPeoplePort
    ) {}

    async execute({ userId, serverId }: ListMyServersQuery): Promise<ServerListItem[]> {
        const now = new Date()
        const memberships = await this.servers.listForMember(userId, serverId)
        const views = memberships.map(({ server, member }) => memberView(server, member, now))
        // Only rooms the view kept: a private room they cannot see is not asked about.
        const rooms = views.flatMap((view) => view.channels.filter(({ type }) => type === 'voice').map(({ id }) => id))
        const people = rooms.length > 0 ? await this.roomPeople.peopleOf(rooms) : new Map<string, RoomPerson[]>()
        return Promise.all(
            memberships.map(async ({ server, memberCount }, index) => ({
                ...views[index],
                channels: views[index].channels.map((channel) => ({
                    ...channel,
                    voiceStates: channel.type === 'voice' ? (people.get(channel.id) ?? []) : null
                })),
                iconUrl: server.iconKey ? await this.storage.getReadUrl(server.iconKey) : null,
                memberCount
            }))
        )
    }
}

export const SERVER_QUERY_HANDLERS = [ListMyServersHandler]
