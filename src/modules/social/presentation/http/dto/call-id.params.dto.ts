import { IsUUID } from 'class-validator'

export class CallIdParamsDto {
    /** A call of mine: one of two others is not found, as none (NFR-SEC-05). */
    @IsUUID()
    callId: string
}
