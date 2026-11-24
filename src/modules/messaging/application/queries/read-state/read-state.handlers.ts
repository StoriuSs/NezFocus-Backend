import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { READ_STATE_REPOSITORY, ReadScope, ReadStateRepositoryPort, readFloor } from '../../../domain'
import { DM_ACCESS, DmAccessPort } from '../../ports'
import { ReadStateView, viewableChannels } from '../../services/read-states'
import { ListReadStatesQuery } from './read-state.queries'

/**
 * Every channel the person may view (text, and voice rooms' chat), in each
 * server they are in, with how far they have read it (REQ-MSG-09, D-170, D-173). One statement for
 * all of them, with every role the person holds: role ids are unique across
 * servers and a message only mentions roles of its own server. A server left
 * between listing and checking is skipped. Then each DM shown in their
 * list (D-244), from when it began, with no server.
 */
@QueryHandler(ListReadStatesQuery)
export class ListReadStatesHandler implements IQueryHandler<ListReadStatesQuery> {
    constructor(
        @Inject(READ_STATE_REPOSITORY) private readonly readStates: ReadStateRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(DM_ACCESS) private readonly dms: DmAccessPort
    ) {}

    async execute({ userId }: ListReadStatesQuery): Promise<ReadStateView[]> {
        const now = new Date()
        const serverOf = new Map<string, string | null>()
        const channels: ReadScope[] = []
        const roleIds: string[] = []
        // One server at a time: the permission cache answers most, and a cold one is a query each.
        for (const { serverId, joinedAt } of await this.membership.membershipsOf(userId)) {
            const access = await this.permissions.access(serverId, userId)
            if (!access) continue
            roleIds.push(...access.member.roleIds)
            for (const channelId of viewableChannels(access.server, access.member, now)) {
                serverOf.set(channelId, serverId)
                channels.push({ channelId, floorId: readFloor(joinedAt) })
            }
        }
        for (const dm of await this.dms.shownOf(userId)) {
            serverOf.set(dm.channelId, null)
            channels.push({ channelId: dm.channelId, floorId: readFloor(dm.createdAt) })
        }
        const states = await this.readStates.states(userId, roleIds, channels)
        return states.map((state) => ({ serverId: serverOf.get(state.channelId) ?? null, ...state }))
    }
}

export const READ_STATE_QUERY_HANDLERS = [ListReadStatesHandler]
