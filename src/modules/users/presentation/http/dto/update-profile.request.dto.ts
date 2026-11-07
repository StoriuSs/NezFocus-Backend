import { ValidateIf } from 'class-validator'
import { BioField, DisplayNameField } from './profile-text.decorators'

/** Checked only when sent: `null` is not "not sent", and is refused rather than blanking the field. */
const IfSent = () => ValidateIf((_dto: object, value: unknown) => value !== undefined)

/**
 * PATCH /users/me (S-ME-02, REQ-AUTH-06, D-139). Either field may be left
 * out; the profile page sends both. Both are composed (NFC) and trimmed, and
 * counted in characters, not UTF-16 units.
 *
 * The limits keep a 100 KB bio (body-parser's limit) out of the database,
 * the Redis cache and every /users/me, and an empty or invisible display
 * name off the member list.
 */
export class UpdateProfileRequestDto {
    /** 1-32 characters, at least one visible; it cannot be cleared (D-69). */
    @IfSent()
    @DisplayNameField(false)
    displayName?: string

    /** Up to 200 characters, line breaks allowed. An empty string clears the bio. */
    @IfSent()
    @BioField()
    bio?: string
}
