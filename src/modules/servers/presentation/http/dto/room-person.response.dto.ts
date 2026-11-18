import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, ValidateNested } from 'class-validator'
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
