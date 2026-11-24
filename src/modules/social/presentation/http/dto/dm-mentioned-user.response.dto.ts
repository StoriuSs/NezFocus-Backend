import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Someone the last message mentions, as its text names them (D-171); nulls for an account deleted or waiting to be. */
export class DmMentionedUserResponseDto {
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
