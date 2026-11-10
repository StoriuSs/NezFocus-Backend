/*
 * Request and response bodies for /servers and what hangs off it (channels,
 * invites, roles, members, bans), one class per file. The wire is snake_case;
 * the global pipe converts it, so properties are camelCase. Property JSDoc is
 * published in the API docs by the Swagger plugin. Each class is named here,
 * so a constant in a DTO file is never exported by accident.
 */

// Requests
export { BanListQueryDto } from './ban-list.query.dto'
export { CategoryNameRequestDto } from './category-name.request.dto'
export { CreateChannelRequestDto } from './create-channel.request.dto'
export { CreateInviteRequestDto } from './create-invite.request.dto'
export { CreateRoleRequestDto } from './create-role.request.dto'
export { CreateServerRequestDto } from './create-server.request.dto'
export { GrantRoleRequestDto } from './grant-role.request.dto'
export { InviteCodeParamsDto } from './invite-code.params.dto'
export { InvitePreviewQueryDto } from './invite-preview.query.dto'
export { MemberListQueryDto } from './member-list.query.dto'
export { ModerationReasonRequestDto } from './moderation-reason.request.dto'
export { MoveInLayoutRequestDto } from './move-in-layout.request.dto'
export { ReorderRolesRequestDto } from './reorder-roles.request.dto'
export { ServerCategoryParamsDto } from './server-category.params.dto'
export { ServerChannelParamsDto } from './server-channel.params.dto'
export { ServerIdParamsDto } from './server-id.params.dto'
export { ServerMemberParamsDto } from './server-member.params.dto'
export { ServerRoleMemberParamsDto } from './server-role-member.params.dto'
export { ServerRoleParamsDto } from './server-role.params.dto'
export { TimeoutMemberRequestDto } from './timeout-member.request.dto'
export { UpdateChannelRequestDto } from './update-channel.request.dto'
export { UpdateRoleRequestDto } from './update-role.request.dto'
export { UpdateServerRequestDto } from './update-server.request.dto'

// Responses
export { AcceptInviteResponseDto } from './accept-invite.response.dto'
export { BanPageResponseDto } from './ban-page.response.dto'
export { BanPersonResponseDto } from './ban-person.response.dto'
export { BanResponseDto } from './ban.response.dto'
export { CreatedInServerResponseDto } from './created-in-server.response.dto'
export { CreatedRoleResponseDto } from './created-role.response.dto'
export { InviteCreatorResponseDto } from './invite-creator.response.dto'
export { InviteListItemResponseDto } from './invite-list-item.response.dto'
export { InviteListResponseDto } from './invite-list.response.dto'
export { InvitePreviewResponseDto } from './invite-preview.response.dto'
export { InviteResponseDto } from './invite.response.dto'
export { InviteServerResponseDto } from './invite-server.response.dto'
export { InviteTargetResponseDto } from './invite-target.response.dto'
export { MemberPageResponseDto } from './member-page.response.dto'
export { MemberResponseDto } from './member.response.dto'
export { PageMetaResponseDto } from './page-meta.response.dto'
export { RoleListResponseDto } from './role-list.response.dto'
export { RoleResponseDto } from './role.response.dto'
export { ServerCategoryResponseDto } from './server-category.response.dto'
export { ServerChannelResponseDto } from './server-channel.response.dto'
export { ServerIconResponseDto } from './server-icon.response.dto'
export { ServerListResponseDto } from './server-list.response.dto'
export { ServerResponseDto } from './server.response.dto'
export { ServerRoleResponseDto } from './server-role.response.dto'
