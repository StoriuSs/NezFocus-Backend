import { IsString, MaxLength } from 'class-validator'

export class InviteCodeParamsDto {
    /** Checked against 8–10 letters and digits by the handler, so a bad one counts as a wrong code. */
    @IsString()
    @MaxLength(64)
    code: string
}
