import { Expose } from 'class-transformer'
import { IsInt, IsString } from 'class-validator'

/** A ticket to open one socket with (D-13). */
export class RealtimeTicketResponseDto {
    /** Sent once in the socket's `auth`; never in a URL. Spent on the first connection. */
    @Expose()
    @IsString()
    ticket: string

    /** How long it can still be spent: 30 seconds. */
    @Expose()
    @IsInt()
    expiresInSeconds: number
}
