import { IsUUID } from 'class-validator'

/** The person to open my DM with (`POST /me/dms`, D-242). */
export class OpenDmRequestDto {
    @IsUUID()
    userId: string
}
