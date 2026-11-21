import { IsUUID } from 'class-validator'

export class FocusSessionIdParamsDto {
    @IsUUID()
    sessionId: string
}
