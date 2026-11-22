import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString } from 'class-validator'

/**
 * A line of the history (C-47, D-105): one session of one's, all one's joins
 * in it as one. Where it was, as one may know it now (D-230): `room_name`
 * and `server_name`; `room_deleted` and `server_name`; only `server_name`
 * (a room one no longer views); or none (a server one is no longer in, or
 * deleted, and a Solo).
 */
export class StudySessionLineResponseDto {
    @Expose()
    @IsString()
    sessionId: string

    @Expose()
    @IsIn(['room', 'solo'])
    kind: 'room' | 'solo'

    @ApiProperty({ type: String, nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    roomName: string | null

    @Expose()
    @IsBoolean()
    roomDeleted: boolean

    @ApiProperty({ type: String, nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    serverName: string | null

    @Expose()
    @IsDate()
    firstJoinedAt: Date

    /** Null while one is in it ("Đang học", "– bây giờ"). */
    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    lastLeftAt: Date | null

    /** The seconds counted so far; the client adds what runs on the line one is in. */
    @Expose()
    @IsInt()
    seconds: number

    /** "· vào N lần" from 2. */
    @Expose()
    @IsInt()
    joinCount: number
}
