import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Someone a message mentions with <@id>, named as they are now (D-171); names null once the account is erased, or while it waits to be (D-182). */
export class MentionedUserResponseDto {
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
}
