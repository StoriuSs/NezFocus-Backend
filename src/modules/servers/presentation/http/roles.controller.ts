import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { toWire } from '@/modules/permissions'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { createPaginatedResponse, validateAndTransform } from '@/shared/utils'
import {
    CreateRoleCommand,
    DeleteRoleCommand,
    GrantRoleCommand,
    ListMembersQuery,
    ListRolesQuery,
    ReorderRolesCommand,
    RevokeRoleCommand,
    UpdateRoleCommand
} from '../../application'
import { MemberListItem, RoleListItem } from '../../domain'
import {
    CreatedRoleResponseDto,
    CreateRoleRequestDto,
    GrantRoleRequestDto,
    MemberListQueryDto,
    MemberPageResponseDto,
    ReorderRolesRequestDto,
    RoleListResponseDto,
    ServerIdParamsDto,
    ServerRoleMemberParamsDto,
    ServerRoleParamsDto,
    UpdateRoleRequestDto
} from './dto'

const MEMBERS_PER_PAGE = 50

/**
 * Roles of a server and who holds them (REQ-ROLE-01, ROLE-02, S-SET-02), and
 * its members (D-152). Changes answer with no body: the client refetches the
 * roles, which a change may have just taken away from them (taking the role
 * that gave them MANAGE_ROLES off themselves).
 */
@ApiTags('servers')
@ApiBearerAuth('bearer')
@Controller({ path: 'servers/:serverId', version: '1' })
export class RolesController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** Every role, highest first, @everyone last, with how many hold each (MANAGE_ROLES). */
    @Get('roles')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(RoleListResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto
    ): Promise<ServiceResponse<RoleListResponseDto>> {
        const roles: RoleListItem[] = await this.queryBus.execute(new ListRolesQuery(user.id, serverId))
        return createResponse(
            MESSAGES.SERVER.ROLES_LISTED,
            validateAndTransform(RoleListResponseDto, {
                roles: roles.map((role) => ({ ...role, permissions: toWire(role.permissions) }))
            })
        )
    }

    /** A role with no permissions, right below the creator's highest (D-87). */
    @Post('roles')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(CreatedRoleResponseDto, HttpStatus.CREATED)
    @Idempotent()
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: CreateRoleRequestDto
    ): Promise<ServiceResponse<CreatedRoleResponseDto>> {
        const created: { roleId: string } = await this.commandBus.execute(
            new CreateRoleCommand(user.id, serverId, dto.name)
        )
        return createResponse(MESSAGES.SERVER.ROLE_CREATED, validateAndTransform(CreatedRoleResponseDto, created))
    }

    /** One drop on the Roles page. Declared before roles/:roleId, which would take "order" for an id. */
    @Patch('roles/order')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async reorder(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: ReorderRolesRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new ReorderRolesCommand(user.id, serverId, dto.seenOrder, dto.order))
        return createResponse(MESSAGES.SERVER.ROLES_REORDERED, null)
    }

    @Patch('roles/:roleId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async update(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, roleId }: ServerRoleParamsDto,
        @Body() dto: UpdateRoleRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(
            new UpdateRoleCommand(user.id, serverId, roleId, {
                name: dto.name,
                // BigInt, not fromWire: a bit that is no permission is refused (unknown_bits), not dropped.
                permissions: dto.permissions === undefined ? undefined : BigInt(dto.permissions),
                mentionable: dto.mentionable
            })
        )
        return createResponse(MESSAGES.SERVER.ROLE_UPDATED, null)
    }

    @Delete('roles/:roleId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async delete(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, roleId }: ServerRoleParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DeleteRoleCommand(user.id, serverId, roleId))
        return createResponse(MESSAGES.SERVER.ROLE_DELETED, null)
    }

    /** Give the role to everyone listed, or to no one (D-153). Those who have it already stay as they are. */
    @Put('roles/:roleId/members')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async grant(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, roleId }: ServerRoleParamsDto,
        @Body() dto: GrantRoleRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new GrantRoleCommand(user.id, serverId, roleId, dto.userIds))
        return createResponse(MESSAGES.SERVER.ROLE_GRANTED, null)
    }

    @Delete('members/:userId/roles/:roleId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async revoke(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, roleId, userId }: ServerRoleMemberParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RevokeRoleCommand(user.id, serverId, roleId, userId))
        return createResponse(MESSAGES.SERVER.ROLE_REVOKED, null)
    }

    /** One page of the members, by name (D-89, D-90, D-152). Anyone in the server. */
    @Get('members')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(MemberPageResponseDto)
    async members(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Query() query: MemberListQueryDto
    ): Promise<ServiceResponse<MemberPageResponseDto>> {
        const page = query.page ?? 1
        const limit = query.limit ?? MEMBERS_PER_PAGE
        const q = query.q?.trim() || null
        const { items, total }: { items: MemberListItem[]; total: number } = await this.queryBus.execute(
            new ListMembersQuery(user.id, serverId, {
                q,
                roleId: query.roleId ?? null,
                transferableFrom: query.transferable ? user.id : null,
                sort: query.sort ?? 'name',
                order: query.order ?? 'asc',
                page,
                limit
            })
        )
        return createResponse(
            MESSAGES.SERVER.MEMBERS_LISTED,
            validateAndTransform(MemberPageResponseDto, createPaginatedResponse(items, page, limit, total))
        )
    }
}
