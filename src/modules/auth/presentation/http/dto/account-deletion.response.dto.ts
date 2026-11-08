import { Expose } from 'class-transformer'
import { IsDate } from 'class-validator'

/** What asking to delete the account answers (D-141). */
export class AccountDeletionResponseDto {
    /**
     * When the account is deleted: 14 days from now. Signing in before then
     * offers to restore it. The sign-in page shows the date.
     */
    @Expose()
    @IsDate()
    deletesAt: Date
}
