import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'

/** A checked file (REQ-MSG-04): in a message, or in the tray before it is sent. */
export class AttachmentResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    filename: string

    /** In bytes. */
    @Expose()
    @IsInt()
    size: number

    /** What its content was checked to be (D-93); text files are `text/plain; charset=utf-8` (D-177). */
    @Expose()
    @IsString()
    contentType: string

    /** An image's size, upright, to keep its place before it loads (C-10); null for other files. */
    @Expose()
    @ApiProperty({ type: Number, nullable: true })
    @IsOptional()
    @IsInt()
    width: number | null

    @Expose()
    @ApiProperty({ type: Number, nullable: true })
    @IsOptional()
    @IsInt()
    height: number | null

    /**
     * Reads the file for an hour: shown in the browser for an image, a PDF,
     * video or sound, downloaded for anything else (D-94). Past that,
     * `GET /attachments/{id}/url` gives new links.
     */
    @Expose()
    @IsString()
    url: string

    /** Saves the file under its name, for as long as `url`: `url` itself for a file that is only downloaded. */
    @Expose()
    @IsString()
    downloadUrl: string

    /** An image's thumbnail (WebP, at most 720 x 640), for as long as `url`; null for other files. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    thumbnailUrl: string | null
}
