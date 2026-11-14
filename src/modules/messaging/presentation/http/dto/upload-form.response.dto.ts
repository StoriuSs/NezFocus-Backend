import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsString, ValidateNested } from 'class-validator'
import { UploadFieldResponseDto } from './upload-field.response.dto'

/**
 * Posting the file (multipart/form-data) straight to the storage: every
 * field in this order, then the file as `file`, to `url` (D-165).
 */
export class UploadFormResponseDto {
    @Expose()
    @IsString()
    url: string

    @Expose()
    @ApiProperty({ type: [UploadFieldResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => UploadFieldResponseDto)
    fields: UploadFieldResponseDto[]
}
