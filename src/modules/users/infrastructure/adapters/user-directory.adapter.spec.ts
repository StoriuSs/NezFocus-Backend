import { UserEntity, UserRepositoryPort } from '@/modules/users/domain'
import { UserDirectory } from './user-directory.adapter'

// An account made by Google takes the name Google has (REQ-AUTH-10), under the profile's rules (D-139).
describe('UserDirectory.create', () => {
    function directory() {
        const createWithEmail = jest.fn((email: string, data: { displayName: string | null }) =>
            Promise.resolve(new UserEntity({ id: 'user-1', email, displayName: data.displayName }))
        )
        const users = { createWithEmail } as unknown as UserRepositoryPort
        return { directory: new UserDirectory(users), createWithEmail }
    }

    it('cuts a long name at 32 characters without splitting an emoji', async () => {
        const { directory: users } = directory()
        const user = await users.create('ada@example.test', `${'a'.repeat(31)}🙂🙂`)
        expect(user?.displayName).toBe(`${'a'.repeat(31)}🙂`)
    })

    it('makes the account without a name when Google gives only hidden characters', async () => {
        const { directory: users, createWithEmail } = directory()
        await users.create('ada@example.test', 'ㅤ')
        expect(createWithEmail).toHaveBeenCalledWith('ada@example.test', { displayName: null })
    })
})
