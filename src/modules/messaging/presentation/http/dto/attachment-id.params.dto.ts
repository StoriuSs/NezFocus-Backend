import { IsUUID } from 'class-validator'

export class AttachmentIdParamsDto {
    @IsUUID()
    attachmentId: string
}
