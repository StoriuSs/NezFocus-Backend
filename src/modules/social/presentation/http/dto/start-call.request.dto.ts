import { IsBoolean } from 'class-validator'

/** How to call the other one of a DM (`POST /dms/{id}/calls`, REQ-SOCIAL-05). */
export class StartCallRequestDto {
    /** A video call: the camera on from the start. Either camera turns on or off at any time. */
    @IsBoolean()
    video: boolean
}
