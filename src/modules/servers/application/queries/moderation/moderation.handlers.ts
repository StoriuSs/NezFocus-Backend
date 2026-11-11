import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { BanListItem, BanPerson, MODERATION_REPOSITORY, ModerationRepositoryPort } from '../../../domain'
import { requireServerPermission } from '../../services/require-permission'
import { ListBansQuery } from './moderation.queries'

@QueryHandler(ListBansQuery)
export class ListBansHandler implements IQueryHandler<ListBansQuery> {
    constructor(
        @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort
    ) {}

    async execute({ userId, serverId, page, limit }: ListBansQuery): Promise<{ items: BanListItem[]; total: number }> {
        await requireServerPermission(this.checker, serverId, userId, 'BAN_MEMBERS')
        const { items, total } = await this.moderation.bans(serverId, page, limit)
        // The repository gives the stored picture keys; the client needs addresses.
        const pictured = async (person: BanPerson): Promise<BanPerson> => ({
            ...person,
            avatarUrl: await this.directory.avatarUrl(person.avatarUrl)
        })
        return {
            items: await Promise.all(
                items.map(async (item) => ({
                    ...item,
                    user: await pictured(item.user),
                    bannedBy: item.bannedBy && (await pictured(item.bannedBy))
                }))
            ),
            total
        }
    }
}

export const MODERATION_QUERY_HANDLERS = [ListBansHandler]
