import { ApiProperty } from '@nestjs/swagger'
import type { Presence } from '@/modules/realtime'
import { SHOWN_PRESENCES } from '../../../application'
import { RELATIONSHIP_TYPES, RelationshipType } from '../../../domain'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { ActivityResponseDto } from './activity.response.dto'
import { SocialPersonResponseDto } from './social-person.response.dto'

/**
 * A person and where they stand with me (D-237, D-242): `friend`;
 * `incoming`, their request to me; `outgoing`, mine to them; `blocked`, I
 * blocked them; `none`, nothing (only in the answer to a change: the list
 * holds the other four). Someone who blocked me shows as `none`.
 */
export class RelationshipResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => SocialPersonResponseDto)
    user: SocialPersonResponseDto

    @Expose()
    @ApiProperty({ enum: RELATIONSHIP_TYPES })
    @IsIn(RELATIONSHIP_TYPES)
    type: RelationshipType

    /** A request's note: theirs to me, or mine to them (REQ-SOCIAL-01, D-248); null otherwise. */
    @Expose()
    @IsOptional()
    @IsString()
    note: string | null

    /** When the request was sent, the friendship accepted or the block made; null for `none`. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    since: Date | null

    /** What I see of a friend (D-242); null for anyone else. */
    @Expose()
    @ApiProperty({ enum: SHOWN_PRESENCES, nullable: true })
    @IsOptional()
    @IsIn(SHOWN_PRESENCES)
    presence: Presence | null

    /** What a friend studies now (D-240, D-247); null for anyone else, and for a friend who shows nothing. */
    @Expose()
    @ApiProperty({ type: ActivityResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => ActivityResponseDto)
    activity: ActivityResponseDto | null
}
