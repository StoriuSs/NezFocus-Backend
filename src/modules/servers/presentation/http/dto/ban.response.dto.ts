import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsOptional, IsString, ValidateNested } from 'class-validator'
import { BanPersonResponseDto } from './ban-person.response.dto'

export class BanResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => BanPersonResponseDto)
    user: BanPersonResponseDto

    @Expose()
    @IsOptional()
    @IsString()
    reason: string | null

    @Expose()
    @IsDate()
    createdAt: Date

    /** Null when that account is gone for good. */
    @Expose()
    @ApiProperty({ type: BanPersonResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => BanPersonResponseDto)
    bannedBy: BanPersonResponseDto | null
}
