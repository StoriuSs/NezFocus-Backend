import { Expose } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'

export class InviteServerResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Null: show the initials. */
    @Expose()
    @IsOptional()
    @IsString()
    iconUrl: string | null

    @Expose()
    @IsInt()
    memberCount: number
}
