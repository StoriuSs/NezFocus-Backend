import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { ReadStateResponseDto } from './read-state.response.dto'

/** Every channel the reader may view (text, and voice rooms' chat), in each of their servers, server by server (REQ-MSG-09). */
export class ReadStateListResponseDto {
    @Expose()
    @ApiProperty({ type: [ReadStateResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => ReadStateResponseDto)
    items: ReadStateResponseDto[]
}
