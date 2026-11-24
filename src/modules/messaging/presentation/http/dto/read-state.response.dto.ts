import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { READ_COUNT_CAP } from '../../../domain'

/** How far the reader has read one channel (text, a voice room's chat, or a DM), and what is new there to them (REQ-MSG-09). */
export class ReadStateResponseDto {
    /** The channel's server, for the rail's sums (C-05); null for a DM, which the 💬 badge counts (D-244). */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    serverId: string | null

    @Expose()
    @IsString()
    channelId: string

    /**
     * The last message read: an id to compare others with, or to open the
     * channel around (`around`); maybe of a deleted message, or no message at
     * all when the reader never marked the channel and stands where they
     * joined the server (D-170).
     */
    @Expose()
    @IsString()
    lastReadId: string

    /** Live messages after it not sent by the reader, counted up to 100 (D-173): over 99 shows as "99+". */
    @Expose()
    @IsInt()
    @Min(0)
    @Max(READ_COUNT_CAP)
    unreadCount: number

    /** Those of them about the reader (D-39, D-164, D-172), counted up to 100. */
    @Expose()
    @IsInt()
    @Min(0)
    @Max(READ_COUNT_CAP)
    mentionCount: number
}
