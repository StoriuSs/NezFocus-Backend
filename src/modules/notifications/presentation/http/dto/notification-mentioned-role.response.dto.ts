import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

/** A role the message mentions in effect, named as it is now (D-171); one deleted since is left out. */
export class NotificationMentionedRoleResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string
}
