import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsIn, IsOptional, ValidateNested } from 'class-validator'
import { MemberSoloActivityResponseDto } from './member-solo-activity.response.dto'

/**
 * A member's study activity, the same for every viewer (D-240, D-247): the
 * client adds the room's name and phase when it may view the room, and
 * says "Đang học cùng nhóm" / "Đang ở một phòng voice" when not.
 */
export class MemberActivityResponseDto {
    /** The kind of room they are in: a study room, with a session or not, or another voice room. */
    @Expose()
    @ApiProperty({ enum: ['study', 'voice'], nullable: true })
    @IsOptional()
    @IsIn(['study', 'voice'])
    room: 'study' | 'voice' | null

    @Expose()
    @ApiProperty({ type: MemberSoloActivityResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => MemberSoloActivityResponseDto)
    solo: MemberSoloActivityResponseDto | null
}
