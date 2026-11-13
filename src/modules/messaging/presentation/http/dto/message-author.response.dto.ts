import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Names and picture are null once the account's personal data is erased: the chat says "deleted account". */
export class MessageAuthorResponseDto {
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
