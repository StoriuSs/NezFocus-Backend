import { Expose } from 'class-transformer'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'

/**
 * Response for uploadAvatar endpoint
 */
export class UploadAvatarResponseDto {
    @Expose()
    @IsOptional()
    @IsString()
    avatarUrl: string | null

    @Expose()
    @IsOptional()
    @IsInt()
    @Min(1)
    width?: number

    @Expose()
    @IsOptional()
    @IsInt()
    @Min(1)
    height?: number

    @Expose()
    @IsString()
    uploadedAt: string
}
