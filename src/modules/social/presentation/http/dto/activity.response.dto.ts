import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsIn, IsOptional, ValidateNested } from 'class-validator'
import { ACTIVITY_ROOMS, ActivityRoom } from '../../../domain'
import { SoloActivityResponseDto } from './solo-activity.response.dto'

/**
 * What someone studies now, the same for every viewer (D-240, D-247): the
 * client adds the room's name and phase when it may view the room, and
 * says "Đang học cùng nhóm" / "Đang ở một phòng voice" when not.
 */
export class ActivityResponseDto {
    /** The kind of room they are in: a study room, with a session or not, or another voice room. */
    @Expose()
    @ApiProperty({ enum: ACTIVITY_ROOMS, nullable: true })
    @IsOptional()
    @IsIn(ACTIVITY_ROOMS)
    room: ActivityRoom | null

    @Expose()
    @ApiProperty({ type: SoloActivityResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => SoloActivityResponseDto)
    solo: SoloActivityResponseDto | null
}
