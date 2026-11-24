import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { MESSAGES } from '@/shared/constants'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, createResponse, ServiceResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import {
    AcceptFriendRequestCommand,
    ListMyRelationshipsQuery,
    RelationshipView,
    RemoveRelationshipCommand,
    RequestFriendByUsernameCommand,
    RequestFriendCommand
} from '../../application'
import {
    RelationshipListResponseDto,
    RelationshipResponseDto,
    SendFriendRequestRequestDto,
    UserIdParamsDto
} from './dto'
import { relationshipAfter } from './relationship-answer'

/**
 * My friends and friend requests (SRS 5.1, REQ-SOCIAL-01, REQ-SOCIAL-02,
 * D-237): the list, read once; a request by username or from a profile,
 * accepting, and one route that declines, cancels or unfriends. Each change
 * answers with the person as I see them after it, and both of us hear it as
 * `relationship.*`.
 */
@ApiTags('social')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class RelationshipsController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** Everyone in my list, all at once (D-242): friends with their presence, requests both ways, people I blocked. */
    @Get('me/relationships')
    @ApiEnvelopeResponse(RelationshipListResponseDto)
    async list(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<RelationshipListResponseDto>> {
        const relationships: RelationshipView[] = await this.queryBus.execute(new ListMyRelationshipsQuery(user.id))
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIPS_LISTED,
            validateAndTransform(RelationshipListResponseDto, { relationships })
        )
    }

    /**
     * Ask someone by username, with an optional note (REQ-SOCIAL-01, D-110).
     * They asked me first: friends. Not found: no such username, oneself,
     * an account deleted or waiting to be. CANNOT_MESSAGE_USER: a block
     * either way. FRIEND_REQUEST_PENDING, ALREADY_FRIENDS. 50 a day of my
     * time zone: RATE_LIMIT_EXCEEDED with `reason: friend_requests`.
     */
    @Post('me/relationships')
    @HttpCode(HttpStatus.OK)
    @Idempotent()
    @ApiEnvelopeResponse(RelationshipResponseDto)
    async requestByUsername(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: SendFriendRequestRequestDto
    ): Promise<ServiceResponse<RelationshipResponseDto>> {
        const { otherId }: { otherId: string } = await this.commandBus.execute(
            new RequestFriendByUsernameCommand(user.id, dto.username, dto.note ?? null)
        )
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIP_CHANGED,
            await relationshipAfter(this.queryBus, user.id, otherId)
        )
    }

    /**
     * Ask someone from their profile, no note (D-237): they asked me first,
     * friends; asked already or friends already, nothing changes. Refused as
     * the request by username is.
     */
    @Put('me/relationships/:userId')
    @ApiEnvelopeResponse(RelationshipResponseDto)
    async request(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { userId }: UserIdParamsDto
    ): Promise<ServiceResponse<RelationshipResponseDto>> {
        await this.commandBus.execute(new RequestFriendCommand(user.id, userId))
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIP_CHANGED,
            await relationshipAfter(this.queryBus, user.id, userId)
        )
    }

    /**
     * Accept their request (D-237). Friends already: nothing changes. No
     * request of theirs (cancelled meanwhile): NOT_FOUND_ERROR, which the
     * client says as an invitation no longer valid.
     */
    @Post('me/relationships/:userId/accept')
    @HttpCode(HttpStatus.OK)
    @Idempotent()
    @ApiEnvelopeResponse(RelationshipResponseDto)
    async accept(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { userId }: UserIdParamsDto
    ): Promise<ServiceResponse<RelationshipResponseDto>> {
        await this.commandBus.execute(new AcceptFriendRequestCommand(user.id, userId))
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIP_CHANGED,
            await relationshipAfter(this.queryBus, user.id, userId)
        )
    }

    /**
     * Decline their request, cancel mine, or unfriend (D-237): whatever
     * stands between us goes; with nothing there, nothing changes. A block
     * stays (`DELETE /me/blocks/{user_id}` takes it off).
     */
    @Delete('me/relationships/:userId')
    @ApiEnvelopeResponse(RelationshipResponseDto)
    async remove(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { userId }: UserIdParamsDto
    ): Promise<ServiceResponse<RelationshipResponseDto>> {
        await this.commandBus.execute(new RemoveRelationshipCommand(user.id, userId))
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIP_CHANGED,
            await relationshipAfter(this.queryBus, user.id, userId)
        )
    }
}
