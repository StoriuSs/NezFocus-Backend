import { Expose } from 'class-transformer'
import { IsBoolean, IsInt, IsString } from 'class-validator'

/** A role of the server, not @everyone (the private-channel picker, S-SRV-05). */
export class ServerRoleResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Higher is more senior. */
    @Expose()
    @IsInt()
    position: number

    /** Holds ADMINISTRATOR: sees every channel, so it is shown ticked and locked. */
    @Expose()
    @IsBoolean()
    administrator: boolean
}
