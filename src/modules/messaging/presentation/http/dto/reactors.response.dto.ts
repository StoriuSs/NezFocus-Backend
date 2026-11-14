import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsInt, ValidateNested } from 'class-validator'
import { ReactorResponseDto } from './reactor.response.dto'

/** A reaction's tooltip (SRS 1.71): the first three people to give it, in that order, and how many did. */
export class ReactorsResponseDto {
    @Expose()
    @ApiProperty({ type: [ReactorResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => ReactorResponseDto)
    users: ReactorResponseDto[]

    @Expose()
    @IsInt()
    count: number
}
