import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { BanListItem, MODERATION_REPOSITORY, ModerationRepositoryPort } from '../../ports'
import { requireServerPermission } from '../../services/require-permission'
import { ListBansQuery } from './moderation.queries'

@QueryHandler(ListBansQuery)
export class ListBansHandler implements IQueryHandler<ListBansQuery> {
    constructor(
        @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, serverId, page, limit }: ListBansQuery): Promise<{ items: BanListItem[]; total: number }> {
        await requireServerPermission(this.checker, serverId, userId, 'BAN_MEMBERS')
        return this.moderation.bans(serverId, page, limit)
    }
}

export const MODERATION_QUERY_HANDLERS = [ListBansHandler]
