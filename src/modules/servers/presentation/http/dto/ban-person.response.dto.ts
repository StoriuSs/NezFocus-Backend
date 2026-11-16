import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Names and picture are null once their account is deleted, or while it waits to be (D-182). */
export class BanPersonResponseDto {
    @Expose()
    @IsString()
    userId: string

    @Expose()
    @IsOptional()
    @IsString()
    username: string | null

    @Expose()
    @IsOptional()
    @IsString()
    displayName: string | null

    @Expose()
    @IsOptional()
    @IsString()
    avatarUrl: string | null
}
