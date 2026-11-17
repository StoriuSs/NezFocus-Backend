import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Someone the message mentions with <@id>, named as they are now (D-171); null names: erased, or waiting to be (D-182). */
export class NotificationMentionedUserResponseDto {
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
