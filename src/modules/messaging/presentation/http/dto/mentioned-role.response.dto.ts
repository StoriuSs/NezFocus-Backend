import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

/** A role a message mentions in effect, named as it is now (D-171). */
export class MentionedRoleResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string
}
