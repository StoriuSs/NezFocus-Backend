import {
    Controller,
    Get,
    Body,
    Delete,
    Patch,
    Post,
    Param,
    UseInterceptors,
    UploadedFile,
    HttpCode,
    HttpStatus
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { memoryStorage } from 'multer'
import { CommandBus, QueryBus } from '@nestjs/cqrs'

// Presentation DTOs
import {
    UpdateProfileRequestDto,
    CheckUsernameParamsDto,
    UserProfileResponseDto,
    UpdateProfileResponseDto,
    UploadAvatarResponseDto,
    UsernameAvailabilityResponseDto
} from './dto'

// Application
import {
    CheckUsernameQuery,
    ResolveAvatarUrlQuery,
    RemoveAvatarCommand,
    UpdateProfileCommand,
    UploadAvatarCommand,
    UploadAvatarResult
} from '@/modules/users/application'
import { AVATAR_MAX_BYTES, UserEntity } from '@/modules/users/domain'
import { AvatarFilePipe } from './avatar-file.pipe'

// Shared
import { AllowIncomplete, ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'

@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller({ path: 'users', version: '1' })
export class UsersController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** A stored avatar key as a URL the client can fetch (presigned on S3). */
    private toAvatarUrl(key: string | null | undefined): Promise<string | null> {
        return this.queryBus.execute(new ResolveAvatarUrlQuery(key))
    }

    /** Also before the account is completed: the client reads `completed` to know where to go. */
    @Get('me')
    @AllowIncomplete()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(UserProfileResponseDto)
    async getProfile(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<UserProfileResponseDto>> {
        const profile = validateAndTransform(UserProfileResponseDto, {
            id: user.id,
            email: user.email ?? undefined,
            username: user.username ?? undefined,
            displayName: user.displayName ?? undefined,
            avatarUrl: await this.toAvatarUrl(user.avatarUrl),
            roles: user.roles,
            bio: user.bio ?? undefined,
            completed: user.completed
        })

        return createResponse(MESSAGES.USER.FETCHED, profile)
    }

    /** For the "complete your account" page, where a username is chosen (D-61). */
    @Get('username-available/:username')
    @AllowIncomplete()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(UsernameAvailabilityResponseDto)
    async checkUsernameAvailability(
        @Param() { username }: CheckUsernameParamsDto
    ): Promise<ServiceResponse<UsernameAvailabilityResponseDto>> {
        const available: boolean = await this.queryBus.execute(new CheckUsernameQuery(username))
        return createResponse(available ? MESSAGES.USER.USERNAME_AVAILABLE : MESSAGES.USER.USERNAME_TAKEN, {
            available
        })
    }

    @Patch('me')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(UpdateProfileResponseDto)
    // 10 minutes, not the presigned-URL lifetime (1h): a replay returns the
    // original body, avatar link included, so it must be well inside the
    // link's validity. Genuine retries happen within seconds anyway.
    @Idempotent('10m')
    async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileRequestDto) {
        const result: UserEntity = await this.commandBus.execute(
            new UpdateProfileCommand(user.id, dto.displayName, dto.bio)
        )

        const responseData = validateAndTransform(UpdateProfileResponseDto, {
            username: result.username,
            displayName: result.displayName,
            avatarUrl: await this.toAvatarUrl(result.avatarUrl),
            bio: result.bio
        })

        return createResponse(MESSAGES.USER.PROFILE_UPDATED, responseData)
    }

    @Post('me/avatar')
    @HttpCode(HttpStatus.OK)
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: { type: 'object', required: ['avatar'], properties: { avatar: { type: 'string', format: 'binary' } } }
    })
    @ApiEnvelopeResponse(UploadAvatarResponseDto)
    @Idempotent('10m') // Replays return a presigned avatar URL; see updateProfile
    @UseInterceptors(
        FileInterceptor('avatar', {
            storage: memoryStorage(),
            // Enforced by multer while streaming, so an oversized body is
            // rejected before it is ever buffered into memory. Without this the
            // default is Infinity — a handful of concurrent large uploads was
            // enough to OOM the container.
            // Over the limit: 413 UPLOAD_FILE_TOO_LARGE (GlobalExceptionFilter).
            limits: { fileSize: AVATAR_MAX_BYTES, files: 1 }
        })
    )
    async uploadAvatar(
        @CurrentUser() user: AuthenticatedUser,
        @UploadedFile(AvatarFilePipe)
        file: Express.Multer.File
    ) {
        const result: UploadAvatarResult = await this.commandBus.execute(
            new UploadAvatarCommand(user.id, file.buffer, file.originalname)
        )

        const responseData = validateAndTransform(UploadAvatarResponseDto, {
            avatarUrl: await this.toAvatarUrl(result.upload.key),
            width: result.upload.width,
            height: result.upload.height,
            uploadedAt: new Date().toISOString()
        })

        return createResponse(MESSAGES.UPLOAD.SUCCESS, responseData)
    }

    /**
     * Back to the initial (S-ME-02, D-72). The profile page calls this only
     * once its "Undo" has run out. Without an avatar it answers the same.
     */
    @Delete('me/avatar')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async removeAvatar(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RemoveAvatarCommand(user.id))
        return createResponse(MESSAGES.USER.AVATAR_REMOVED, null)
    }
}
