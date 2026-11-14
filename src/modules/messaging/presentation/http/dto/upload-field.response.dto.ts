import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

/** One field of the upload form, sent as it is: its name is the storage's, never changed in case. */
export class UploadFieldResponseDto {
    @Expose()
    @IsString()
    name: string

    @Expose()
    @IsString()
    value: string
}
