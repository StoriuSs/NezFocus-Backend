import { IsString, MaxLength } from 'class-validator'
import { TYPED_MAX } from './shared/fields'

/** DELETE /servers/{id} (S-SET-07 `delete-type-name`). */
export class DeleteServerRequestDto {
    /**
     * The server's name typed again to confirm, compared without case or
     * accents (REQ-SRV-05). Another name: VALIDATION_ERROR, `data.rule`
     * `name_mismatch`.
     */
    @IsString()
    @MaxLength(TYPED_MAX)
    name: string
}
