import { DirectoryUser, normaliseUsername, USERNAME_PATTERN, UserDirectoryPort } from '@/modules/users'
import { UserLookupLimitError } from '../../domain'
import { SocialLimitPort } from '../ports'
import { USER_LOOKUPS_PER_PERSON } from '../rate-limits'

/**
 * A name asked by someone (D-110): counted first against their 30 lookups a
 * minute, whether it is found or not, then read as the dialog writes it
 * (trimmed, one leading "@" off, lower case). Both a lookup and a request by
 * username go through here: each answer says whether the name exists, so
 * either could walk the usernames. Refused while the counter cannot be
 * reached (LimitsUnavailableError, 503), as invite guesses are. The account,
 * or null when no such name.
 */
export async function findByUsername(
    users: UserDirectoryPort,
    limit: SocialLimitPort,
    userId: string,
    username: string
): Promise<DirectoryUser | null> {
    const counted = await limit.hit(USER_LOOKUPS_PER_PERSON, userId)
    if (counted.limited) throw new UserLookupLimitError(counted.retryAfterSeconds)
    const name = normaliseUsername(username.trim().replace(/^@/, ''))
    return USERNAME_PATTERN.test(name) ? users.findByUsername(name) : null
}
