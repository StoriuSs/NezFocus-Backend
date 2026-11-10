import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { MemberResponseDto } from './member.response.dto'
import { PageMetaResponseDto } from './page-meta.response.dto'

export class MemberPageResponseDto {
    @Expose()
    @ApiProperty({ type: [MemberResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MemberResponseDto)
    items: MemberResponseDto[]

    @Expose()
    @ValidateNested()
    @Type(() => PageMetaResponseDto)
    meta: PageMetaResponseDto
}
