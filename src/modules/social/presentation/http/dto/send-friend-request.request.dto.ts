import { IsOptional, IsString, MaxLength } from 'class-validator'
import { NOTE_MAX_LENGTH } from '../../../domain'

/** A friend request by username (REQ-SOCIAL-01, D-110). */
export class SendFriendRequestRequestDto {
    /** As typed: trimmed, a leading "@" taken off and lower-cased here as the dialog does. */
    @IsString()
    @MaxLength(64)
    username: string

    /** Seen only by the one asked (tab Đang chờ, inbox); trimmed, empty is none. */
    @IsOptional()
    @IsString()
    @MaxLength(NOTE_MAX_LENGTH)
    note?: string | null
}
