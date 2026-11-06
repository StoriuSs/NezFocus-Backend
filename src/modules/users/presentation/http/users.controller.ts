import {
    Controller,
    Get,
    Body,
    Patch,
    Post,
    Param,
    UseInterceptors,
    UploadedFile,
    HttpCode,
    HttpStatus,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { memoryStorage } from 'multer'
import { UPLOAD_LIMITS } from '@/config/upload.config'
import { CommandBus, QueryBus } from '@nestjs/cqrs'

// Presentation DTOs
import {
    UpdateProfileRequestDto,
    SetUsernameRequestDto,
    CheckUsernameParamsDto,
    UserProfileResponseDto,
    UpdateProfileResponseDto,
    SetUsernameResponseDto,
    UploadAvatarResponseDto,
    UsernameAvailabilityResponseDto
} from './dto'

// Application
import {
    CheckUsernameQuery,
    ResolveAvatarUrlQuery,
    SetUsernameCommand,
    UpdateProfileCommand,
    UploadAvatarCommand,
    UploadAvatarResult
} from '@/modules/users/application'
import { UserEntity } from '@/modules/users/domain'

// Shared
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'

/** The accepted image types, as FileTypeValidator takes them. */
const IMAGE_TYPES = new RegExp(
    `^(${UPLOAD_LIMITS.allowedImageMimeTypes.map((type) => type.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`
)

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

    @Get('me')
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
            hasSetUsername: user.hasSetUsername
        })

        return createResponse(MESSAGES.USER.FETCHED, profile)
    }

    @Post('me/username')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(SetUsernameResponseDto)
    @Idempotent('1h') // Protect against double-submissions when setting username
    async setUsername(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetUsernameRequestDto) {
        const result: UserEntity = await this.commandBus.execute(new SetUsernameCommand(user.id, dto.username))

        const responseData = validateAndTransform(SetUsernameResponseDto, {
            username: result.username,
            hasSetUsername: result.hasSetUsername
        })

        return createResponse(MESSAGES.USER.USERNAME_SET_SUCCESS, responseData)
    }

    @Get('username-available/:username')
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
            bio: result.bio,
            hasSetUsername: result.hasSetUsername
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
            limits: { fileSize: UPLOAD_LIMITS.maxFileSizeBytes, files: 1 }
        })
    )
    async uploadAvatar(
        @CurrentUser() user: AuthenticatedUser,
        @UploadedFile(
            new ParseFilePipe({
                fileIsRequired: true,
                validators: [
                    // The validator wants a size below maxSize; multer (2.4)
                    // accepts a file of exactly the limit, so both allow it.
                    new MaxFileSizeValidator({ maxSize: UPLOAD_LIMITS.maxFileSizeBytes + 1 }),
                    // Raster images only. The declared Content-Type is a client
                    // claim, so this is a first pass — sharp verifies the actual
                    // decoded format downstream.
                    new FileTypeValidator({ fileType: IMAGE_TYPES })
                ]
            })
        )
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
}
