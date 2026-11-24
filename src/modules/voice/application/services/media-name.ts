import { UserDirectoryPort } from '@/modules/users'
import { isHidden } from '@/shared/domain'

/**
 * The name the others see of someone in a media room, a voice room's or a
 * call's (D-210): none for an account shown as deleted (D-182).
 */
export async function mediaNameOf(users: UserDirectoryPort, userId: string): Promise<string> {
    const user = await users.findById(userId)
    return user && !isHidden(user) ? (user.displayName ?? user.username ?? '') : ''
}
