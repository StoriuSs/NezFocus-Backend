import { IsString, MaxLength } from 'class-validator'

/** A username to look up before asking (D-110). */
export class LookUpPersonQueryDto {
    /** As typed: trimmed, a leading "@" taken off and lower-cased here as the dialog does. */
    @IsString()
    @MaxLength(64)
    username: string
}
