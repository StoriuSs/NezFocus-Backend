import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { MentionableRoleResponseDto } from './mentionable-role.response.dto'

/** Highest first; never @everyone. */
export class MentionableRoleListResponseDto {
    @Expose()
    @ApiProperty({ type: [MentionableRoleResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MentionableRoleResponseDto)
    roles: MentionableRoleResponseDto[]
}
