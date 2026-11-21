import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, ValidateNested } from 'class-validator'
import { RoomPersonResponseDto } from './room-person.response.dto'
import { RoomSessionResponseDto } from './room-session.response.dto'
import { BITS } from './shared/fields'

export class ServerChannelResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Null: listed above the first category. */
    @Expose()
    @IsOptional()
    @IsString()
    categoryId: string | null

    @Expose()
    @IsIn(['text', 'voice'])
    type: 'text' | 'voice'

    @Expose()
    @IsString()
    name: string

    /** Order within its category, 0 first. */
    @Expose()
    @IsInt()
    position: number

    @Expose()
    @IsBoolean()
    isPrivate: boolean

    /** `managers`: only those with MANAGE_MESSAGES may post. */
    @Expose()
    @IsIn(['everyone', 'managers'])
    sendMode: 'everyone' | 'managers'

    @Expose()
    @IsBoolean()
    isStudyRoom: boolean

    /**
     * Who may start a session in it, and the cycle a session starts with
     * (REQ-STUDY-01). Kept while the room is not a study room; a text channel
     * has the defaults, meaningless there.
     */
    @ApiProperty({ enum: ['anyone', 'managers'] })
    @Expose()
    @IsIn(['anyone', 'managers'])
    studyStarter: 'anyone' | 'managers'

    @Expose()
    @IsInt()
    studyFocusMinutes: number

    @Expose()
    @IsInt()
    studyShortBreakMinutes: number

    /** Both null: no long break. */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    studyLongBreakMinutes: number | null

    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    studyLongBreakEvery: number | null

    @Expose()
    @IsBoolean()
    taskBoardEnabled: boolean

    /** What they may do in this channel (appendix B, steps 1–6). */
    @ApiProperty({ example: '3657472' })
    @Expose()
    @Matches(BITS)
    permissions: string

    /** The roles that see it when private, sent only to those who may edit that; null otherwise. */
    @ApiProperty({ type: [String], nullable: true })
    @Expose()
    @IsOptional()
    @IsString({ each: true })
    viewRoleIds: string[] | null

    /**
     * A voice room: who is in it, in the order they joined (D-205); kept up to
     * date by `voice_state.updated`. Null for a text channel.
     */
    @ApiProperty({ type: [RoomPersonResponseDto], nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => RoomPersonResponseDto)
    voiceStates: RoomPersonResponseDto[] | null

    /**
     * A voice room: its study session not yet ended, or null (D-220); kept up
     * to date by `focus_session.*`. Null for a text channel.
     */
    @ApiProperty({ type: RoomSessionResponseDto, nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => RoomSessionResponseDto)
    focusSession: RoomSessionResponseDto | null
}
