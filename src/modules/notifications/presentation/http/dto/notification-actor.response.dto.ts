import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Who an item is from. Names and picture are null once the account is erased, or while it waits to be (D-182). */
export class NotificationActorResponseDto {
    @Expose()
    @IsString()
    id: string

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
