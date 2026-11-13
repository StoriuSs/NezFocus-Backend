import { IsUUID } from 'class-validator'

export class MessageIdParamsDto {
    @IsUUID()
    messageId: string
}
