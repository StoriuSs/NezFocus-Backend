import { Expose } from 'class-transformer'
import { IsInt, IsString } from 'class-validator'

/** A role the composer suggests (C-12 MentionSuggest, D-171). */
export class MentionableRoleResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Shown as "{N} members". */
    @Expose()
    @IsInt()
    memberCount: number
}
