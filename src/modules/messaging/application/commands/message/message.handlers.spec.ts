import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { RateLimitState } from '@/shared/types/rate-limit.type'
import {
    ChannelNotFoundError,
    NonceUsedElsewhereError,
    MessageRecord,
    MessageRepositoryPort,
    NewMessage,
    SendingTooFastError,
    TimedOutError
} from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { SendLimitPort } from '../../ports'
import { SendMessageCommand } from './message.commands'
import { SendMessageHandler } from './message.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'tai-lieu', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' }
    ]
}

/** One server with #hoi-dap; Bình a member, Phong timed out for an hour; messages kept in memory. */
function world({ limited = false } = {}) {
    const saved: (MessageRecord & { nonce: string })[] = []
    const repository: MessageRepositoryPort = {
        create: jest.fn(async (input: NewMessage) => {
            const existing = saved.find((row) => row.author?.id === input.authorId && row.nonce === input.nonce)
            if (existing) return { message: existing, created: false }
            const row = {
                id: `m${saved.length + 1}`,
                channelId: input.channelId,
                type: 'regular' as const,
                author: {
                    id: input.authorId,
                    username: 'binh.tran',
                    displayName: 'Bình',
                    avatarKey: 'avatars/binh.webp'
                },
                content: input.content,
                systemEvent: null,
                systemData: null,
                editedAt: null,
                createdAt: new Date('2026-10-18T20:02:00Z'),
                nonce: input.nonce
            }
            saved.push(row)
            return { message: row, created: true }
        }),
        findByNonce: jest.fn(
            async (authorId: string, nonce: string) =>
                saved.find((row) => row.author?.id === authorId && row.nonce === nonce) ?? null
        ),
        page: jest.fn()
    }
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (id) => (['hoi-dap', 'tai-lieu'].includes(id) ? 'ot' : null))
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => {
            const timeoutUntil = userId === 'phong' ? new Date(Date.now() + 3600_000) : null
            return { server, member: { userId, roleIds: [], timeoutUntil } }
        })
    }
    const state: RateLimitState = { count: 6, limited, retryAfterSeconds: 4 }
    const limit: SendLimitPort = { hit: jest.fn().mockResolvedValue(state), release: jest.fn() }
    const users = { avatarUrl: jest.fn(async (key: string | null) => (key ? `https://cdn.test/${key}` : null)) }
    const events = { publish: jest.fn() }
    const handler = new SendMessageHandler(
        repository,
        channels,
        checker,
        limit,
        users as unknown as UserDirectoryPort,
        events as unknown as EventBus
    )
    const send = (userId: string, content: string, nonce = 'n1', channelId = 'hoi-dap') =>
        handler.execute(new SendMessageCommand(userId, channelId, content, nonce))
    return { send, saved, repository, limit, events, users }
}

describe('SendMessageHandler (REQ-MSG-01, REQ-MSG-10)', () => {
    it('saves the message, and tells the channel with the nonce', async () => {
        const { send, saved, events } = world()

        const message = await send('binh', 'Mọi người ơi, câu 3?')

        expect(saved.map((row) => row.content)).toEqual(['Mọi người ơi, câu 3?'])
        expect(message).toMatchObject({
            id: 'm1',
            content: 'Mọi người ơi, câu 3?',
            author: { id: 'binh', displayName: 'Bình', avatarUrl: 'https://cdn.test/avatars/binh.webp' }
        })
        expect(events.publish).toHaveBeenCalledWith(new MessageCreatedEvent(message, 'n1'))
    })

    it('answers a nonce it has seen with the same message, uncounted and untold', async () => {
        const { send, saved, limit, events } = world()
        const first = await send('binh', 'Câu 3?')
        ;(limit.hit as jest.Mock).mockClear()
        events.publish.mockClear()

        const again = await send('binh', 'Câu 3?')

        expect(again.id).toBe(first.id)
        expect(saved).toHaveLength(1)
        expect(limit.hit).not.toHaveBeenCalled()
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('refuses a nonce already used in another channel, giving nothing of that message', async () => {
        const { send, limit } = world()
        await send('binh', 'Ở kênh khác', 'n1', 'tai-lieu')
        ;(limit.hit as jest.Mock).mockClear()

        await expect(send('binh', 'Ở đây', 'n1', 'hoi-dap')).rejects.toBeInstanceOf(NonceUsedElsewhereError)
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('tells no one when a send of the same nonce won the race to save', async () => {
        const { send, repository, events } = world()
        await send('binh', 'Câu 3?')
        events.publish.mockClear()
        ;(repository.findByNonce as jest.Mock).mockResolvedValueOnce(null)

        await send('binh', 'Câu 3?')

        expect(events.publish).not.toHaveBeenCalled()
    })

    it('checks the channel before counting: a refused message costs nothing', async () => {
        const { send, limit } = world()
        await expect(send('phong', 'Câu 3?')).rejects.toBeInstanceOf(TimedOutError)
        await expect(send('binh', 'Câu 3?', 'n2', 'khong-co')).rejects.toBeInstanceOf(ChannelNotFoundError)
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('gives the count back when a send of the same nonce won the race to save', async () => {
        const { send, repository, limit } = world()
        await send('binh', 'Câu 3?')
        ;(repository.findByNonce as jest.Mock).mockResolvedValueOnce(null)
        ;(limit.release as jest.Mock).mockClear()

        await send('binh', 'Câu 3?')

        expect(limit.release).toHaveBeenCalledTimes(2)
    })

    it('gives the count back when the channel goes before the message is saved', async () => {
        const { send, repository, limit } = world()
        ;(repository.create as jest.Mock).mockRejectedValueOnce(new ChannelNotFoundError('hoi-dap'))

        await expect(send('binh', 'Câu 3?')).rejects.toBeInstanceOf(ChannelNotFoundError)
        expect(limit.release).toHaveBeenCalledTimes(2)
    })

    it('still sends when a picture cannot be signed, the picture left out', async () => {
        const { send, users, events } = world()
        users.avatarUrl.mockRejectedValueOnce(new Error('storage down'))

        const message = await send('binh', 'Câu 3?')

        expect(message.author?.avatarUrl).toBeNull()
        expect(events.publish).toHaveBeenCalledTimes(1)
    })

    it('saves nothing when sending too fast', async () => {
        const { send, saved, events } = world({ limited: true })
        await expect(send('binh', 'Câu 3?')).rejects.toBeInstanceOf(SendingTooFastError)
        expect(saved).toHaveLength(0)
        expect(events.publish).not.toHaveBeenCalled()
    })
})
