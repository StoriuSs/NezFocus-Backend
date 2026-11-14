import { IsInt, IsString, IsUUID, Length, Min } from 'class-validator'

/** POST /attachments (REQ-MSG-04, D-165). */
export class RequestUploadRequestDto {
    /** The channel the file is for: sending files there needs ATTACH_FILES (REQ-ROLE-03). */
    @IsUUID()
    channelId: string

    /**
     * The file's name; its extension says its type (D-92, D-177). Kept without
     * folders or control characters, at most 255 characters.
     */
    @IsString()
    @Length(1, 1024)
    filename: string

    /** In bytes: at most 25 MB (UPLOAD_FILE_TOO_LARGE), which the storage keeps too. */
    @IsInt()
    @Min(1)
    size: number
}
