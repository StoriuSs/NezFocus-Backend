import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import {
    ConfirmTwoFactorCommand,
    DisableTwoFactorCommand,
    GetTwoFactorStatusQuery,
    ReplaceRecoveryCodesCommand,
    SetUpTwoFactorCommand,
    TwoFactorSetUp,
    TwoFactorStatus
} from '@/modules/auth/application'
import {
    RecoveryCodesResponseDto,
    TwoFactorCodeRequestDto,
    TwoFactorSetUpResponseDto,
    TwoFactorStatusResponseDto
} from './dto'
import { ok } from './route-helpers'

/**
 * Two-step sign-in, from the settings page: turning it on and off, and the
 * recovery codes (docs/auth/two-step-sign-in.md). Its step at sign-in,
 * `POST /auth/login/2fa`, is with the other sign-in routes, in AuthController.
 */
@ApiTags('auth')
@ApiBearerAuth('bearer')
@Controller({ path: 'auth/2fa', version: '1' })
export class TwoFactorController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** Whether two-step sign-in is on, and how many recovery codes are left. */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TwoFactorStatusResponseDto)
    async status(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<TwoFactorStatusResponseDto>> {
        const status: TwoFactorStatus = await this.queryBus.execute(new GetTwoFactorStatusQuery(user.id))
        return ok(validateAndTransform(TwoFactorStatusResponseDto, status))
    }

    /**
     * Start turning two-step sign-in on: a new secret, for the authenticator
     * app. Not asked for at sign-in until confirmed with a code.
     */
    @Post('setup')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TwoFactorSetUpResponseDto)
    async setUp(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<TwoFactorSetUpResponseDto>> {
        const setUp: TwoFactorSetUp = await this.commandBus.execute(new SetUpTwoFactorCommand(user.id))
        return ok(validateAndTransform(TwoFactorSetUpResponseDto, setUp))
    }

    /** Turn it on with a code from the app. Answers with the recovery codes, this once. */
    @Post('confirm')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(RecoveryCodesResponseDto)
    async confirm(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: TwoFactorCodeRequestDto
    ): Promise<ServiceResponse<RecoveryCodesResponseDto>> {
        const result: { recoveryCodes: string[] } = await this.commandBus.execute(
            new ConfirmTwoFactorCommand(user.id, dto.code)
        )
        return ok(validateAndTransform(RecoveryCodesResponseDto, result))
    }

    /**
     * New recovery codes, with a code from the app. The earlier ones stop
     * working; the new ones are in the answer, this once.
     */
    @Post('recovery-codes')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(RecoveryCodesResponseDto)
    async replaceRecoveryCodes(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: TwoFactorCodeRequestDto
    ): Promise<ServiceResponse<RecoveryCodesResponseDto>> {
        const result: { recoveryCodes: string[] } = await this.commandBus.execute(
            new ReplaceRecoveryCodesCommand(user.id, dto.code)
        )
        return ok(validateAndTransform(RecoveryCodesResponseDto, result))
    }

    /** Turn it off, with a code from the app or a recovery code. */
    @Post('disable')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async disable(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: TwoFactorCodeRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DisableTwoFactorCommand(user.id, dto.code))
        return ok(null)
    }
}
