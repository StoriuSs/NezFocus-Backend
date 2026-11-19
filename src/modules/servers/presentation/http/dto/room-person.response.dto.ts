import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsString, ValidateNested } from 'class-validator'
import { RoomPersonUserResponseDto } from './room-person-user.response.dto'

/**
 * Someone in a voice room (D-205), as `voice_state.updated` sends them too:
 * the client swaps the room's whole list for the one in the event.
 */
export class RoomPersonResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => RoomPersonUserResponseDto)
    user: RoomPersonUserResponseDto

    /** Their roles in the server, not @everyone; none once they left it. With is_owner, what a moderator's menu needs (D-208). */
    @Expose()
    @IsString({ each: true })
    roleIds: string[]

    /** Whether they own the server: no one mutes or puts out the owner (REQ-ROLE-02). */
    @Expose()
    @IsBoolean()
    isOwner: boolean

    @Expose()
    @IsDate()
    joinedAt: Date

    /** What their own browser says (D-206): icons only. */
    @Expose()
    @IsBoolean()
    micOn: boolean

    @Expose()
    @IsBoolean()
    cameraOn: boolean

    @Expose()
    @IsBoolean()
    screenSharing: boolean

    /** A moderator turned their microphone off (D-207). */
    @Expose()
    @IsBoolean()
    modMuted: boolean
}
