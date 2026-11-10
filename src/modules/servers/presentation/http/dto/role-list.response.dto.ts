import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { RoleResponseDto } from './role.response.dto'

/** Highest first, @everyone last. */
export class RoleListResponseDto {
    @Expose()
    @ApiProperty({ type: [RoleResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => RoleResponseDto)
    roles: RoleResponseDto[]
}
