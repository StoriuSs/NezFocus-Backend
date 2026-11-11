import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

/** The longest password taken in, as the auth module's routes (their PASSWORD_INPUT_MAX). */
const PASSWORD_INPUT_MAX = 1024

/** POST /servers/{id}/transfer (S-SET-07 `transfer-password`). */
export class TransferOwnershipRequestDto {
    /** The member who becomes the owner: not one waiting to be deleted, nor timed out (D-91). */
    @IsUUID()
    userId: string

    /** The owner's password (wrong: 400 AUTH_CURRENT_PASSWORD_INVALID, counted as when changing it). */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string
}
