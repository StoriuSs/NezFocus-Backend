import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsArray, IsOptional, ValidateNested } from 'class-validator'
import { CallResponseDto } from './call.response.dto'

/** My open calls (`GET /me/call`, D-245), read on opening or reloading the app. */
export class MyCallResponseDto {
    /** The call I make (ringing) or am in (active): the call page and the `call` dock; null for none. */
    @Expose()
    @ApiProperty({ type: CallResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => CallResponseDto)
    current: CallResponseDto | null

    /** The calls ringing to me, oldest first, at most two (the cards). */
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CallResponseDto)
    incoming: CallResponseDto[]
}
