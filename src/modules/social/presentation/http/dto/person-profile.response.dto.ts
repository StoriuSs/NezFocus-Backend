import { ApiProperty } from '@nestjs/swagger'
import type { Presence } from '@/modules/realtime'
import { SHOWN_PRESENCES } from '../../../application'
import { RELATIONSHIP_TYPES, RelationshipType } from '../../../domain'
import { Expose, Type } from 'class-transformer'
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { ActivityResponseDto } from './activity.response.dto'
import { MutualServerResponseDto } from './mutual-server.response.dto'
import { SocialPersonResponseDto } from './social-person.response.dto'

/**
 * A person's card in Thêm bạn (D-110) and their profile outside a server
 * (D-109, D-111): who they are, where we stand, the servers we share in the
 * order of my list. An account waiting to be deleted: no name, no bio, no
 * servers (D-182).
 */
export class PersonProfileResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => SocialPersonResponseDto)
    user: SocialPersonResponseDto

    @Expose()
    @IsOptional()
    @IsString()
    bio: string | null

    /** Only when we are friends or share a server; null otherwise. */
    @Expose()
    @ApiProperty({ enum: SHOWN_PRESENCES, nullable: true })
    @IsOptional()
    @IsIn(SHOWN_PRESENCES)
    presence: Presence | null

    /** What they study now, the ProfilePopover's block (D-79, D-240): only when we are friends or share a server; null otherwise. */
    @Expose()
    @ApiProperty({ type: ActivityResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => ActivityResponseDto)
    activity: ActivityResponseDto | null

    /** Where we stand, as RelationshipResponseDto's `type`. */
    @Expose()
    @ApiProperty({ enum: RELATIONSHIP_TYPES })
    @IsIn(RELATIONSHIP_TYPES)
    relationship: RelationshipType

    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MutualServerResponseDto)
    mutualServers: MutualServerResponseDto[]
}
