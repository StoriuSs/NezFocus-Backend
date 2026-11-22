import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsOptional, ValidateNested } from 'class-validator'
import { NextHostPersonResponseDto } from './next-host-person.response.dto'

/** GET /focus-sessions/{id}/next-host (REQ-STUDY-03, D-233). */
export class NextHostResponseDto {
    /**
     * Who would control the session if its Host left now, by the rule a
     * leaving uses; null when nobody present may start, so the session would
     * run with no Host.
     */
    @ApiProperty({ type: NextHostPersonResponseDto, nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => NextHostPersonResponseDto)
    nextHost: NextHostPersonResponseDto | null
}
