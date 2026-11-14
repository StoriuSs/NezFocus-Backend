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

    /** Members not offline to others now; an invisible one is not counted (S-SRV-03 Q15, REQ-AUTH-07). */
    @Expose()
    @IsInt()
    onlineCount: number
}
