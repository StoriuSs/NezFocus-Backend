import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { BanResponseDto } from './ban.response.dto'
import { PageMetaResponseDto } from './page-meta.response.dto'

export class BanPageResponseDto {
    @Expose()
    @ApiProperty({ type: [BanResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => BanResponseDto)
    items: BanResponseDto[]

    @Expose()
    @ValidateNested()
    @Type(() => PageMetaResponseDto)
    meta: PageMetaResponseDto
}
