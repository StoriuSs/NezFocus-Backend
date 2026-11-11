import { UserEntity, UserRepositoryPort } from '@/modules/users/domain'
import { StoragePort } from '@/modules/users/application/ports/storage.port'
import { UserDirectory } from './user-directory.adapter'

const noStorage = {} as StoragePort

// An account made by Google takes the name Google has (REQ-AUTH-10), under the profile's rules (D-139).
describe('UserDirectory.create', () => {
    function directory() {
        const createWithEmail = jest.fn((email: string, data: { displayName: string | null }) =>
            Promise.resolve(new UserEntity({ id: 'user-1', email, displayName: data.displayName }))
        )
        const users = { createWithEmail } as unknown as UserRepositoryPort
        return { directory: new UserDirectory(users, noStorage), createWithEmail }
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

// Other modules list people with their pictures (a server's members).
describe('UserDirectory.avatarUrl', () => {
    it("gives the storage's address for a stored key, and nothing without one", async () => {
        const getReadUrl = jest.fn((key: string) => Promise.resolve(`https://files.example.test/${key}?signed`))
        const directory = new UserDirectory({} as UserRepositoryPort, { getReadUrl } as unknown as StoragePort)

        await expect(directory.avatarUrl('avatars/user-1.webp')).resolves.toBe(
            'https://files.example.test/avatars/user-1.webp?signed'
        )
        await expect(directory.avatarUrl(null)).resolves.toBeNull()
        expect(getReadUrl).toHaveBeenCalledTimes(1)
    })
})
