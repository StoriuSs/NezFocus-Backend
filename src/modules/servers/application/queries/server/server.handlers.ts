import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { memberView, SERVER_REPOSITORY, ServerRepositoryPort, ServerView } from '../../../domain'
import { ICON_STORAGE, IconStoragePort } from '../../ports'
import { ListMyServersQuery } from './server.queries'

export type ServerListItem = ServerView & { iconUrl: string | null }

/**
 * Every server the person is in, as they see it: the channels they may see,
 * with what they may do in each, worked out here so the client only reads
 * bits (D-115, D-145).
 *
 * Reads the database rather than the permission cache: the list needs names
 * and positions the cache does not keep, and gets the freshest answer for it.
 */
@QueryHandler(ListMyServersQuery)
export class ListMyServersHandler implements IQueryHandler<ListMyServersQuery> {
    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(ICON_STORAGE) private readonly storage: IconStoragePort
    ) {}

    async execute({ userId, serverId }: ListMyServersQuery): Promise<ServerListItem[]> {
        const now = new Date()
        const memberships = await this.servers.listForMember(userId, serverId)
        return Promise.all(
            memberships.map(async ({ server, member }) => ({
                ...memberView(server, member, now),
                iconUrl: server.iconKey ? await this.storage.getReadUrl(server.iconKey) : null
            }))
        )
    }
}

export const SERVER_QUERY_HANDLERS = [ListMyServersHandler]
