import { Controller, Delete, Param, Put } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { MESSAGES } from '@/shared/constants'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, createResponse, ServiceResponse } from '@/shared/types'
import { BlockUserCommand, UnblockUserCommand } from '../../application'
import { RelationshipResponseDto, UserIdParamsDto } from './dto'
import { relationshipAfter } from './relationship-answer'

/**
 * Blocks (SRS 5.1, REQ-SOCIAL-03, D-237): one way, each person's own. The
 * one blocked is not told; they only lose the friendship or request
 * (`relationship.removed`).
 */
@ApiTags('social')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class BlocksController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * Block someone: the friendship or request between us goes; neither can
     * ask, write or call the other (D-242). Blocked already: nothing changes.
     * Not found: oneself, an account deleted or waiting to be (D-243).
     */
    @Put('me/blocks/:userId')
    @ApiEnvelopeResponse(RelationshipResponseDto)
    async block(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { userId }: UserIdParamsDto
    ): Promise<ServiceResponse<RelationshipResponseDto>> {
        await this.commandBus.execute(new BlockUserCommand(user.id, userId))
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIP_CHANGED,
            await relationshipAfter(this.queryBus, user.id, userId)
        )
    }

    /** Unblock them: strangers again, their inbox items back (D-242). Not blocked: nothing changes. */
    @Delete('me/blocks/:userId')
    @ApiEnvelopeResponse(RelationshipResponseDto)
    async unblock(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { userId }: UserIdParamsDto
    ): Promise<ServiceResponse<RelationshipResponseDto>> {
        await this.commandBus.execute(new UnblockUserCommand(user.id, userId))
        return createResponse(
            MESSAGES.SOCIAL.RELATIONSHIP_CHANGED,
            await relationshipAfter(this.queryBus, user.id, userId)
        )
    }
}
