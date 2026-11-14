import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsString, ValidateNested } from 'class-validator'
import { UploadFormResponseDto } from './upload-form.response.dto'

/** An upload waiting for its file: post it with `upload`, then `POST /attachments/{id}/complete`. */
export class UploadTicketResponseDto {
    @Expose()
    @IsString()
    attachmentId: string

    @Expose()
    @ApiProperty({ type: UploadFormResponseDto })
    @ValidateNested()
    @Type(() => UploadFormResponseDto)
    upload: UploadFormResponseDto

    /** The form is refused after this (15 minutes): ask for another. */
    @Expose()
    @IsDate()
    expiresAt: Date
}
