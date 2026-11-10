import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Names are null once their account is deleted. */
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
