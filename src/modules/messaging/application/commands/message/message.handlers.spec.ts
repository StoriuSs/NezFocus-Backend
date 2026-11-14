import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { RateLimitState } from '@/shared/types/rate-limit.type'
import {
    CannotDeleteMessageError,
    CannotSendError,
    ChannelNotFoundError,
    MessageNotFoundError,
    MessageRepositoryPort,
    NewMessage,
    NonceUsedElsewhereError,
    NotYourMessageError,
    MessageRuleError,
    SendingTooFastError,
    StoredMessage,
    TimedOutError
} from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { MessageDeletedEvent } from '../../events/message-deleted.event'
import { MessageUpdatedEvent } from '../../events/message-updated.event'
import { SendLimitPort } from '../../ports'
import { DeleteMessageCommand, EditMessageCommand, SendMessageCommand } from './message.commands'
import { DeleteMessageHandler, EditMessageHandler, SendMessageHandler } from './message.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'quan-ly', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false }
    ],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'tai-lieu', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'thong-bao', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'managers' },
        { id: 'ban-quan-ly', type: 'text', isPrivate: true, viewRoleIds: ['quan-ly'], sendMode: 'everyone' }
    ]
}

const CHANNELS = server.channels.map((channel) => channel.id)
const NAMES: Record<string, string> = { an: 'An', binh: 'Bình', chi: 'Chi', phong: 'Phong' }
const author = (id: string) => ({
    id,
    username: `${id}.user`,
    displayName: NAMES[id] ?? id,
    avatarKey: `avatars/${id}.webp`
})

type Row = StoredMessage & { nonce: string | null }

/**
 * One server: Bình a member, Chi a moderator (MANAGE_MESSAGES), Phong timed
 * out for an hour, An the owner; #thong-bao for managers only, #ban-quan-ly
 * private to moderators. Messages kept in memory.
 */
function world({ limited = false } = {}) {
    const saved: Row[] = []
    const byId = (id: string) => saved.find((row) => row.id === id)
    const replyOf = (id: string | null) => {
        const target = id ? byId(id) : undefined
        if (!target) return null
        return target.deleted
            ? { id: target.id, author: null, content: '', deleted: true }
            : { id: target.id, author: target.author, content: target.content, deleted: false }
    }
    const repository: MessageRepositoryPort = {
        create: jest.fn(async (input: NewMessage) => {
            const existing = saved.find((row) => row.author?.id === input.authorId && row.nonce === input.nonce)
            if (existing) return { message: existing, created: false, deleted: existing.deleted }
            const row: Row = {
                id: `m${saved.length + 1}`,
                channelId: input.channelId,
                type: 'regular',
                author: author(input.authorId),
                content: input.content,
                systemEvent: null,
                systemData: null,
                replyTo: replyOf(input.replyToId),
                editedAt: null,
                pinned: false,
                systemUser: null,
                createdAt: new Date('2026-10-18T20:02:00Z'),
                deleted: false,
                nonce: input.nonce
            }
            saved.push(row)
            return { message: row, created: true, deleted: false }
        }),
        findByNonce: jest.fn(
            async (authorId: string, nonce: string) =>
                saved.find((row) => row.author?.id === authorId && row.nonce === nonce) ?? null
        ),
        find: jest.fn(async (id: string) => byId(id) ?? null),
        edit: jest.fn(async (id: string, content: string, at: Date) => {
            const row = byId(id)
            if (!row || row.deleted) return null
            Object.assign(row, { content, editedAt: at })
            return row
        }),
        remove: jest.fn(async (id: string) => {
            const row = byId(id)
            if (!row || row.deleted) return false
            Object.assign(row, { deleted: true, content: '' })
            return true
        }),
        page: jest.fn()
    }
    /** A message already in a channel, by someone (or a system message when `by` is null). */
    const seed = (channelId: string, by: string | null, content = 'Ok, mình vào sớm giữ chỗ') => {
        const row: Row = {
            id: `m${saved.length + 1}`,
            channelId,
            type: by ? 'regular' : 'system',
            author: by ? author(by) : null,
            content: by ? content : '',
            systemEvent: by ? null : 'member_joined',
            systemData: by ? null : { userId: 'chi' },
            replyTo: null,
            editedAt: null,
            pinned: false,
            systemUser: null,
            createdAt: new Date('2026-10-18T20:11:00Z'),
            deleted: false,
            nonce: by ? `seed-${saved.length + 1}` : null
        }
        saved.push(row)
        return row
    }
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (id) => (CHANNELS.includes(id) ? 'ot' : null))
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => {
            const timeoutUntil = userId === 'phong' ? new Date(Date.now() + 3600_000) : null
            const roleIds = userId === 'chi' ? ['quan-ly'] : []
            return { server, member: { userId, roleIds, timeoutUntil } }
        })
    }
    const state: RateLimitState = { count: 6, limited, retryAfterSeconds: 4 }
    const limit: SendLimitPort = { hit: jest.fn().mockResolvedValue(state), release: jest.fn() }
    const users = { avatarUrl: jest.fn(async (key: string | null) => (key ? `https://cdn.test/${key}` : null)) }
    const events = { publish: jest.fn() }
    const userDirectory = users as unknown as UserDirectoryPort
    const bus = events as unknown as EventBus

    const sender = new SendMessageHandler(repository, channels, checker, limit, userDirectory, bus)
    const editor = new EditMessageHandler(repository, channels, checker, userDirectory, bus)
    const deleter = new DeleteMessageHandler(repository, channels, checker, bus)
    const send = (
        userId: string,
        content: string,
        nonce = 'n1',
        channelId = 'hoi-dap',
        replyToId: string | null = null
    ) => sender.execute(new SendMessageCommand(userId, channelId, content, nonce, replyToId))
    const edit = (userId: string, messageId: string, content: string) =>
        editor.execute(new EditMessageCommand(userId, messageId, content))
    const remove = (userId: string, messageId: string) => deleter.execute(new DeleteMessageCommand(userId, messageId))
    return { send, edit, remove, seed, saved, repository, limit, events, users }
}

describe('SendMessageHandler (REQ-MSG-01, REQ-MSG-10)', () => {
    it('saves the message, and tells the channel with the nonce', async () => {
        const { send, saved, events } = world()

        const message = await send('binh', 'Mọi người ơi, câu 3?')

        expect(saved.map((row) => row.content)).toEqual(['Mọi người ơi, câu 3?'])
        expect(message).toMatchObject({
            id: 'm1',
            content: 'Mọi người ơi, câu 3?',
            replyTo: null,
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

    it('answers a nonce whose message was deleted meanwhile with not found, uncounted (REQ-MSG-10)', async () => {
        const { send, remove, limit } = world()
        const first = await send('binh', 'Câu 3?')
        await remove('binh', first.id)
        ;(limit.hit as jest.Mock).mockClear()

        await expect(send('binh', 'Câu 3?')).rejects.toBeInstanceOf(MessageNotFoundError)
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('answers not found when the send that won the race made a message deleted since', async () => {
        const { send, remove, repository, limit } = world()
        const first = await send('binh', 'Câu 3?')
        await remove('binh', first.id)
        ;(repository.findByNonce as jest.Mock).mockResolvedValueOnce(null)
        ;(limit.release as jest.Mock).mockClear()

        await expect(send('binh', 'Câu 3?')).rejects.toBeInstanceOf(MessageNotFoundError)
        expect(limit.release).toHaveBeenCalledTimes(2)
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

describe('Replying (REQ-MSG-05, C-10 reply)', () => {
    it('answers a message of the channel, quoting who wrote it and what', async () => {
        const { send, seed } = world()
        const original = seed('hoi-dap', 'an')

        const reply = await send('binh', 'Mình giữ chỗ cạnh An rồi nè', 'n1', 'hoi-dap', original.id)

        expect(reply.replyTo).toEqual({
            id: original.id,
            author: { id: 'an', username: 'an.user', displayName: 'An', avatarUrl: 'https://cdn.test/avatars/an.webp' },
            content: 'Ok, mình vào sớm giữ chỗ',
            deleted: false
        })
    })

    it('still answers a message deleted meanwhile, which the reply line then says', async () => {
        const { send, seed, remove } = world()
        const original = seed('hoi-dap', 'an')
        await remove('an', original.id)

        const reply = await send('binh', 'Mình giữ chỗ rồi', 'n1', 'hoi-dap', original.id)

        expect(reply.replyTo).toEqual({ id: original.id, author: null, content: '', deleted: true })
    })

    it.each([
        ['no such message', () => 'khong-co'],
        ['a message of another channel', (seed: ReturnType<typeof world>['seed']) => seed('tai-lieu', 'an').id],
        ['a system message', (seed: ReturnType<typeof world>['seed']) => seed('hoi-dap', null).id]
    ])('refuses to answer %s, saving and counting nothing', async (_case, target) => {
        const { send, seed, saved, limit } = world()
        const replyToId = target(seed)
        const before = saved.length

        await expect(send('binh', 'Trả lời', 'n1', 'hoi-dap', replyToId)).rejects.toMatchObject(
            Object.assign(new MessageRuleError('reply_target'), { details: { rule: 'reply_target' } })
        )
        expect(saved).toHaveLength(before)
        expect(limit.hit).not.toHaveBeenCalled()
    })
})

describe('EditMessageHandler (REQ-MSG-05)', () => {
    it('changes the text, marks it edited and tells the channel', async () => {
        const { edit, seed, events } = world()
        const message = seed('hoi-dap', 'binh')

        const edited = await edit('binh', message.id, 'Mình vào phòng rồi nhé')

        expect(edited).toMatchObject({ id: message.id, content: 'Mình vào phòng rồi nhé', author: { id: 'binh' } })
        expect(edited.editedAt).toBeInstanceOf(Date)
        expect(events.publish).toHaveBeenCalledWith(new MessageUpdatedEvent(edited))
    })

    it('leaves a message whose text did not change as it was: not marked edited, no one told', async () => {
        const { edit, seed, repository, events } = world()
        const message = seed('hoi-dap', 'binh')

        const same = await edit('binh', message.id, message.content)

        expect(same.editedAt).toBeNull()
        expect(repository.edit).not.toHaveBeenCalled()
        expect(events.publish).not.toHaveBeenCalled()
    })

    it("refuses someone else's message, even a moderator's or the owner's edit", async () => {
        const { edit, seed } = world()
        const message = seed('hoi-dap', 'binh')

        await expect(edit('chi', message.id, 'Sửa hộ')).rejects.toBeInstanceOf(NotYourMessageError)
        await expect(edit('an', message.id, 'Sửa hộ')).rejects.toBeInstanceOf(NotYourMessageError)
    })

    it('refuses a system message (REQ-MSG-08)', async () => {
        const { edit, seed } = world()
        const message = seed('hoi-dap', null)
        await expect(edit('an', message.id, 'Sửa')).rejects.toBeInstanceOf(NotYourMessageError)
    })

    it('refuses the author while timed out, saying until when', async () => {
        const { edit, seed } = world()
        const message = seed('hoi-dap', 'phong')
        await expect(edit('phong', message.id, 'Sửa')).rejects.toBeInstanceOf(TimedOutError)
    })

    it('refuses the author in a channel only managers may post in now', async () => {
        const { edit, seed } = world()
        const message = seed('thong-bao', 'binh')
        await expect(edit('binh', message.id, 'Sửa')).rejects.toBeInstanceOf(CannotSendError)
    })

    it('answers "not found", naming no channel, for a deleted message or one in a channel they cannot view', async () => {
        const { edit, remove, seed } = world()
        const deleted = seed('hoi-dap', 'binh')
        await remove('binh', deleted.id)
        const hidden = seed('ban-quan-ly', 'binh')

        await expect(edit('binh', deleted.id, 'Sửa')).rejects.toBeInstanceOf(MessageNotFoundError)
        await expect(edit('binh', hidden.id, 'Sửa')).rejects.toBeInstanceOf(MessageNotFoundError)
        await expect(edit('binh', 'khong-co', 'Sửa')).rejects.toBeInstanceOf(MessageNotFoundError)
    })

    it('answers "not found" when the message is deleted between the check and the save', async () => {
        const { edit, seed, repository, events } = world()
        const message = seed('hoi-dap', 'binh')
        ;(repository.edit as jest.Mock).mockResolvedValueOnce(null)

        await expect(edit('binh', message.id, 'Sửa')).rejects.toBeInstanceOf(MessageNotFoundError)
        expect(events.publish).not.toHaveBeenCalled()
    })
})

describe('DeleteMessageHandler (REQ-MSG-05)', () => {
    it('deletes the author’s own message and tells the channel which one', async () => {
        const { remove, seed, saved, events } = world()
        const message = seed('hoi-dap', 'binh')

        await remove('binh', message.id)

        expect(saved[0]).toMatchObject({ deleted: true, content: '' })
        expect(events.publish).toHaveBeenCalledWith(new MessageDeletedEvent(message.id, 'hoi-dap'))
    })

    it('lets the author delete in a channel only managers may post in', async () => {
        const { remove, seed } = world()
        const message = seed('thong-bao', 'binh')
        await expect(remove('binh', message.id)).resolves.toBeUndefined()
    })

    it("lets MANAGE_MESSAGES delete someone else's message", async () => {
        const { remove, seed, saved } = world()
        const message = seed('hoi-dap', 'binh')

        await remove('chi', message.id)

        expect(saved[0]?.deleted).toBe(true)
    })

    it("refuses someone else's message without MANAGE_MESSAGES", async () => {
        const { remove, seed, events } = world()
        const message = seed('hoi-dap', 'chi')

        await expect(remove('binh', message.id)).rejects.toBeInstanceOf(CannotDeleteMessageError)
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('refuses the author while timed out, saying until when', async () => {
        const { remove, seed } = world()
        const message = seed('hoi-dap', 'phong')
        await expect(remove('phong', message.id)).rejects.toBeInstanceOf(TimedOutError)
    })

    it('refuses a system message, even to the owner (REQ-MSG-08)', async () => {
        const { remove, seed } = world()
        const message = seed('hoi-dap', null)
        await expect(remove('an', message.id)).rejects.toBeInstanceOf(CannotDeleteMessageError)
    })

    it('answers "not found" for a message deleted already, telling no one twice', async () => {
        const { remove, seed, events } = world()
        const message = seed('hoi-dap', 'binh')
        await remove('binh', message.id)
        events.publish.mockClear()

        await expect(remove('chi', message.id)).rejects.toBeInstanceOf(MessageNotFoundError)
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('answers "not found" when another delete won the race', async () => {
        const { remove, seed, repository, events } = world()
        const message = seed('hoi-dap', 'binh')
        ;(repository.remove as jest.Mock).mockResolvedValueOnce(false)

        await expect(remove('binh', message.id)).rejects.toBeInstanceOf(MessageNotFoundError)
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('answers "not found" in a channel they cannot view', async () => {
        const { remove, seed } = world()
        const message = seed('ban-quan-ly', 'chi')
        await expect(remove('binh', message.id)).rejects.toBeInstanceOf(MessageNotFoundError)
    })
})
