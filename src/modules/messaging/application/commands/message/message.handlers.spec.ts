import { dms } from '../../dm-test-world.shared-spec'
import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, MembershipPort, RoleDirectoryPort } from '@/modules/servers'
import type { Presence, PresencePort } from '@/modules/realtime'
import { UserDirectoryPort } from '@/modules/users'
import { RateLimitState } from '@/shared/types/rate-limit.type'
import {
    CannotDeleteMessageError,
    CannotMessageUserError,
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
import { MessagesBulkDeletedEvent } from '../../events/messages-bulk-deleted.event'
import { MessageUpdatedEvent } from '../../events/message-updated.event'
import { SendLimitPort } from '../../ports'
import {
    DeleteMessageCommand,
    DeleteRecentMessagesCommand,
    EditMessageCommand,
    SendMessageCommand
} from './message.commands'
import {
    DeleteMessageHandler,
    DeleteRecentMessagesHandler,
    EditMessageHandler,
    SendMessageHandler
} from './message.handlers'
import { AttachmentStoragePort } from '../../ports'
import { AttachmentNotFoundError, type AttachmentRepositoryPort } from '../../../domain'

/** A DM of Dũng and Giang (their ids below); Chi may no longer write in hers with An (D-238). */
const DM_WORLD = {
    conversations: [
        {
            channelId: 'dm-dung-giang',
            userIds: ['0190a0b0-0000-7000-8000-0000000000d1', '0190a0b0-0000-7000-8000-0000000000d2'] as [
                string,
                string
            ]
        },
        { channelId: 'dm-an-chi', userIds: ['an', 'chi'] as [string, string] }
    ],
    silenced: ['chi']
}

/** Links signed by name only: no storage in these tests. */
const FILES = { readLink: async (key: string) => `signed:${key}` } as unknown as AttachmentStoragePort

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        {
            id: 'quan-ly',
            permissions: Permission.MANAGE_MESSAGES | Permission.MENTION_EVERYONE,
            position: 1,
            isEveryone: false
        }
    ],
    channels: [
        {
            id: 'hoi-dap',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'tai-lieu',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'thong-bao',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'managers',
            taskBoardEnabled: false
        },
        {
            id: 'ban-quan-ly',
            type: 'text',
            isPrivate: true,
            viewRoleIds: ['quan-ly'],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
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

/* People and roles a text can name: tokens carry ids of the UUID form. */
const DUNG = '0190a0b0-0000-7000-8000-0000000000d1'
const GIANG = '0190a0b0-0000-7000-8000-0000000000d2'
/** Has an account, but is in no server here. */
const KHACH = '0190a0b0-0000-7000-8000-0000000000d3'
/** "Trợ giảng": everyone may mention it. */
const TRO_GIANG = '0190a0b0-0000-7000-8000-0000000000e1'
/** "Ban tổ chức": only MENTION_EVERYONE may. */
const BAN_TO = '0190a0b0-0000-7000-8000-0000000000e2'
/** A long name only MENTION_EVERYONE may mention. */
const BAN_DAI = '0190a0b0-0000-7000-8000-0000000000e3'
/** A member timed out: still sees the channel (appendix B). */
const HUNG = '0190a0b0-0000-7000-8000-0000000000d4'
const ROLES = [
    { id: TRO_GIANG, name: 'Trợ giảng', mentionable: true },
    { id: BAN_TO, name: 'Ban tổ chức', mentionable: false },
    { id: BAN_DAI, name: 'Ban điều hành câu lạc bộ học thuật khoa công nghệ thông tin', mentionable: false }
]
const NO_MENTIONS = { mentionEveryone: false, mentionHereUserIds: [], mentionRoleIds: [], mentionUsers: [] }
/** A quoted message's mentions: none in these texts. */
const QUOTED = { mentionRoleIds: [], mentionUsers: [], files: { count: 0, images: 0 } }

/**
 * One server: Bình a member, Chi a moderator (MANAGE_MESSAGES), Phong timed
 * out for an hour, An the owner; #thong-bao for managers only, #ban-quan-ly
 * private to moderators. Dũng and Giang are members too, Khách is not. The
 * moderator role may mention everyone. Messages kept in memory.
 */
function world({ limited = false } = {}) {
    const saved: Row[] = []
    const byId = (id: string) => saved.find((row) => row.id === id)
    const replyOf = (id: string | null) => {
        const target = id ? byId(id) : undefined
        if (!target) return null
        return target.deleted
            ? { id: target.id, author: null, content: '', deleted: true, ...QUOTED }
            : { id: target.id, author: target.author, content: target.content, deleted: false, ...QUOTED }
    }
    const repository: MessageRepositoryPort = {
        findLive: jest.fn(),
        mentionedIn: jest.fn(),
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
                systemUsers: [],
                mentionEveryone: input.mentions.everyone,
                mentionHereUserIds: input.mentions.hereUserIds,
                mentionRoleIds: input.mentions.roleIds,
                mentionUsers: [],
                attachments: input.attachmentIds.map((id) => ({
                    id,
                    filename: `${id}.png`,
                    size: 10,
                    contentType: 'image/png',
                    storageKey: `attachments/${id}`,
                    thumbnailKey: null,
                    width: 4,
                    height: 3
                })),
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
        edit: jest.fn(async (id: string, content: string, _mentions: unknown, at: Date) => {
            const row = byId(id)
            if (!row || row.deleted) return null
            Object.assign(row, { content, editedAt: at })
            return row
        }),
        remove: jest.fn(async (id: string) => {
            const row = byId(id)
            if (!row || row.deleted) return false
            Object.assign(row, { deleted: true, content: '' })
            // Replies now quote it by its id alone, as the repository reads them.
            for (const reply of saved.filter((other) => other.replyTo?.id === id))
                reply.replyTo = { id, author: null, content: '', deleted: true, ...QUOTED }
            return true
        }),
        page: jest.fn(),
        latestId: jest.fn(),
        createMemberJoined: jest.fn(),
        createTaskDue: jest.fn(),
        createStudySession: jest.fn(),
        createCallEnded: jest.fn(),
        removeRecent: jest.fn()
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
            systemUsers: [],
            ...NO_MENTIONS,
            attachments: [],
            createdAt: new Date('2026-10-18T20:11:00Z'),
            deleted: false,
            nonce: by ? `seed-${saved.length + 1}` : null
        }
        saved.push(row)
        return row
    }
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (id) => (CHANNELS.includes(id) ? 'ot' : null)),
        channelIdsOf: async () => [],

        studyRoomOf: async () => null,
        namesOf: async () => ({ servers: new Map(), channels: new Map() }),
        studyRoomsAmong: async () => []
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => {
            if (userId === KHACH) return null
            const timeoutUntil = ['phong', HUNG].includes(userId) ? new Date(Date.now() + 3600_000) : null
            const roleIds = userId === 'chi' ? ['quan-ly'] : []
            return { server, member: { userId, roleIds, timeoutUntil } }
        })
    }
    const state: RateLimitState = { count: 6, limited, retryAfterSeconds: 4 }
    const limit: SendLimitPort = { hit: jest.fn().mockResolvedValue(state), release: jest.fn() }
    const users = { avatarUrl: jest.fn(async (key: string | null) => (key ? `https://cdn.test/${key}` : null)) }
    const events = { publish: jest.fn() }
    const userDirectory = users as unknown as UserDirectoryPort
    const roles: RoleDirectoryPort = {
        rolesOf: jest.fn(async (_serverId: string, ids: string[]) => ROLES.filter((role) => ids.includes(role.id)))
    }
    const bus = events as unknown as EventBus
    // Who others see now: Bình is away, Giang does not disturb, Khách is in no server here; Dũng is offline.
    const presence: PresencePort = {
        everyoneShown: async () =>
            new Map<string, Presence>([
                ['binh', 'idle'],
                [GIANG, 'dnd'],
                [KHACH, 'online'],
                ['chi', 'online']
            ]),
        connected: async () => false
    }

    // The server's members among those asked about: Khách is in no server here.
    const membership = {
        membersAmong: jest.fn(async (_serverId: string, ids: string[]) => ids.filter((id) => id !== KHACH))
    } as unknown as MembershipPort
    // No uploads in these: the file rules have their own tests (message-files).
    // Bình's checked uploads, never sent: any id starting "f-".
    const attachments = {
        findMany: jest.fn(async (ids: string[]) =>
            ids
                .filter((id) => id.startsWith('f-'))
                .map((id) => ({
                    id,
                    uploaderId: 'binh',
                    messageId: null,
                    position: null,
                    completedAt: new Date(),
                    createdAt: new Date()
                }))
        )
    } as unknown as AttachmentRepositoryPort
    const dmAccess = dms(DM_WORLD)
    const sender = new SendMessageHandler(
        repository,
        attachments,
        channels,
        checker,
        limit,
        userDirectory,
        roles,
        FILES,
        presence,
        membership,
        bus,
        dmAccess
    )
    const editor = new EditMessageHandler(
        repository,
        channels,
        checker,
        userDirectory,
        roles,
        FILES,
        presence,
        membership,
        bus,
        dmAccess
    )
    const deleter = new DeleteMessageHandler(repository, channels, checker, bus, dmAccess)
    const send = (
        userId: string,
        content: string,
        nonce = 'n1',
        channelId = 'hoi-dap',
        replyToId: string | null = null,
        attachmentIds: string[] = []
    ) => sender.execute(new SendMessageCommand(userId, channelId, content, nonce, replyToId, attachmentIds))
    const edit = (userId: string, messageId: string, content: string) =>
        editor.execute(new EditMessageCommand(userId, messageId, content))
    const remove = (userId: string, messageId: string) => deleter.execute(new DeleteMessageCommand(userId, messageId))
    return { send, edit, remove, seed, saved, repository, limit, events, users, checker, membership, roles }
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

describe('Sending files (REQ-MSG-04, D-93)', () => {
    it('sends a message of files alone, in the order given, each with its links', async () => {
        const { send, repository } = world()

        const message = await send('binh', '', 'n1', 'hoi-dap', null, ['f-2', 'f-1'])

        expect(jest.mocked(repository.create).mock.calls[0][0].attachmentIds).toEqual(['f-2', 'f-1'])
        expect(message.content).toBe('')
        expect(message.attachments.map((file) => [file.id, file.url])).toEqual([
            ['f-2', 'signed:attachments/f-2'],
            ['f-1', 'signed:attachments/f-1']
        ])
    })

    it('refuses a message with no text and no file, before counting it', async () => {
        const { send, limit } = world()
        await expect(send('binh', '', 'n1')).rejects.toEqual(new MessageRuleError('empty'))
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('refuses a file that cannot be sent, naming it, before counting the message', async () => {
        const { send, limit, repository } = world()
        const error = await send('binh', 'Bài giải câu 4', 'n1', 'hoi-dap', null, ['f-1', 'someone-elses']).catch(
            (e: unknown) => e
        )
        expect((error as AttachmentNotFoundError).details.attachmentIds).toEqual(['someone-elses'])
        expect(limit.hit).not.toHaveBeenCalled()
        expect(repository.create).not.toHaveBeenCalled()
    })

    it('lets the author take all the text out of a message that has files, and not of one without', async () => {
        const { send, edit, seed } = world()
        const withFiles = await send('binh', 'Ảnh bài giải', 'n1', 'hoi-dap', null, ['f-1'])
        const plain = seed('hoi-dap', 'binh')

        expect((await edit('binh', withFiles.id, '')).content).toBe('')
        await expect(edit('binh', plain.id, '')).rejects.toEqual(new MessageRuleError('empty'))
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
            deleted: false,
            mentionUsers: [],
            mentionRoles: [],
            files: { count: 0, images: 0 }
        })
    })

    it('still answers a message deleted meanwhile, which the reply line then says', async () => {
        const { send, seed, remove } = world()
        const original = seed('hoi-dap', 'an')
        await remove('an', original.id)

        const reply = await send('binh', 'Mình giữ chỗ rồi', 'n1', 'hoi-dap', original.id)

        expect(reply.replyTo).toEqual({
            id: original.id,
            author: null,
            content: '',
            deleted: true,
            mentionUsers: [],
            mentionRoles: [],
            files: { count: 0, images: 0 }
        })
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

    it("answers a timed-out member with the time-out before anything else: someone else's message, a system one", async () => {
        const { edit, seed } = world()
        await expect(edit('phong', seed('hoi-dap', 'binh').id, 'Sửa')).rejects.toBeInstanceOf(TimedOutError)
        await expect(edit('phong', seed('hoi-dap', null).id, 'Sửa')).rejects.toBeInstanceOf(TimedOutError)
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

    it("answers a timed-out member with the time-out before anything else: a system message, someone else's", async () => {
        const { remove, seed } = world()
        await expect(remove('phong', seed('hoi-dap', null).id)).rejects.toBeInstanceOf(TimedOutError)
        await expect(remove('phong', seed('hoi-dap', 'binh').id)).rejects.toBeInstanceOf(TimedOutError)
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

describe('Mentions when sending and editing (REQ-MSG-03, MSG-09, D-164, D-172)', () => {
    const savedMentions = (repository: MessageRepositoryPort) =>
        (repository.create as jest.Mock).mock.calls.at(-1)![0] as NewMessage

    it('keeps a role the author may mention, and turns one they may not into its name as words', async () => {
        const { send, repository } = world()

        const message = await send('binh', `<@&${TRO_GIANG}> <@&${BAN_TO}> @everyone`)

        expect(savedMentions(repository)).toMatchObject({
            content: `<@&${TRO_GIANG}> @Ban tổ chức @everyone`,
            mentions: { everyone: false, roleIds: [TRO_GIANG], userIds: [] }
        })
        expect(message).toMatchObject({ mentionEveryone: false, mentionRoles: [{ id: TRO_GIANG, name: 'Trợ giảng' }] })
    })

    it('lets MENTION_EVERYONE mention everyone and any role', async () => {
        const { send, repository } = world()

        await send('chi', `@everyone <@&${BAN_TO}>`)

        expect(savedMentions(repository)).toMatchObject({
            content: `@everyone <@&${BAN_TO}>`,
            mentions: { everyone: true, roleIds: [BAN_TO], userIds: [] }
        })
    })

    it('gives a mention row to the people mentioned who see the channel, never to the sender', async () => {
        const { send, repository } = world()

        await send(DUNG, `<@${DUNG}> <@${GIANG}> <@${KHACH}>`)
        expect(savedMentions(repository).mentions.userIds).toEqual([GIANG])

        // #ban-quan-ly is for moderators: Giang cannot see the message there.
        await send('chi', `<@${GIANG}> <@${DUNG}>`, 'n2', 'ban-quan-ly')
        expect(savedMentions(repository).mentions.userIds).toEqual([])
    })

    it('refuses a text the role names make longer than 2000 characters, before counting it', async () => {
        const { send, repository, limit } = world()
        const text = `${'x'.repeat(1950)} <@&${BAN_DAI}>`

        await expect(send('binh', text)).rejects.toMatchObject({ details: { rule: 'length' } })
        expect(limit.hit).not.toHaveBeenCalled()
        expect(repository.create).not.toHaveBeenCalled()
    })

    it('mentions a member who is timed out: they still see the channel', async () => {
        const { send, repository } = world()

        await send('binh', `<@${HUNG}>`)

        expect(savedMentions(repository).mentions.userIds).toEqual([HUNG])
    })

    it('counts the author of the message answered, deleted or not, unless it is the sender (D-39)', async () => {
        const { send, seed, remove, repository } = world()
        const giangs = seed('hoi-dap', GIANG)
        const binhs = seed('hoi-dap', 'binh')
        const gone = seed('hoi-dap', DUNG)
        await remove(DUNG, gone.id)

        await send('binh', 'Mình giữ chỗ rồi', 'n1', 'hoi-dap', giangs.id)
        expect(savedMentions(repository).mentions.userIds).toEqual([GIANG])
        await send('binh', 'Mình vào phòng rồi', 'n2', 'hoi-dap', binhs.id)
        expect(savedMentions(repository).mentions.userIds).toEqual([])
        await send('binh', 'Ai xóa vậy', 'n3', 'hoi-dap', gone.id)
        expect(savedMentions(repository).mentions.userIds).toEqual([DUNG])
    })

    it('keeps the author answered when a reply is edited after the message answered is deleted', async () => {
        const { send, edit, seed, remove, repository } = world()
        const giangs = seed('hoi-dap', GIANG)
        const answer = await send('binh', 'Mình giữ chỗ rồi', 'n1', 'hoi-dap', giangs.id)
        await remove(GIANG, giangs.id)

        await edit('binh', answer.id, 'Mình giữ chỗ cạnh bạn rồi')

        expect(repository.edit).toHaveBeenCalledWith(
            answer.id,
            'Mình giữ chỗ cạnh bạn rồi',
            { everyone: false, here: false, roleIds: [], userIds: [GIANG], hereUserIds: [] },
            expect.any(Date)
        )
    })

    it('mentions no one from code', async () => {
        const { send, repository } = world()

        await send('chi', `\`@everyone\` \`<@${GIANG}>\``)

        expect(savedMentions(repository).mentions).toEqual({
            everyone: false,
            here: false,
            roleIds: [],
            userIds: [],
            hereUserIds: []
        })
    })

    it('mentions with @here those who see the channel and are not offline as it is sent: away and do not disturb count (D-166)', async () => {
        const { send, repository } = world()

        await send('chi', '@here họp nhóm')
        expect(savedMentions(repository).mentions).toMatchObject({ here: true, hereUserIds: ['binh', GIANG] })

        // #ban-quan-ly is for moderators: only Chi, who sent it.
        await send('chi', '@here', 'n2', 'ban-quan-ly')
        expect(savedMentions(repository).mentions).toMatchObject({ here: true, hereUserIds: [] })
    })

    it('asks the permissions only of the server’s members among those online: one read narrows them (D-166)', async () => {
        const { send, checker, membership } = world()
        await send('chi', '@here họp nhóm')
        expect(membership.membersAmong).toHaveBeenCalledWith('ot', ['binh', GIANG, KHACH])
        expect(checker.access).not.toHaveBeenCalledWith('ot', KHACH)
    })

    it('keeps whom an @here reached when the message is edited; one added by the edit reaches who is here then (D-176)', async () => {
        const { edit, seed, repository } = world()
        const held = seed('hoi-dap', 'chi', '@here họp nhóm')
        held.mentionHereUserIds = [DUNG]
        await edit('chi', held.id, '@here họp nhóm lúc 21:00')
        expect((repository.edit as jest.Mock).mock.calls.at(-1)![2]).toMatchObject({ hereUserIds: [DUNG] })

        const plain = seed('hoi-dap', 'chi', 'họp nhóm')
        await edit('chi', plain.id, '@here họp nhóm')
        expect((repository.edit as jest.Mock).mock.calls.at(-1)![2]).toMatchObject({ hereUserIds: ['binh', GIANG] })
    })

    it('mentions no one with @here without MENTION_EVERYONE', async () => {
        const { send, repository } = world()
        await send('binh', '@here')
        expect(savedMentions(repository).mentions).toMatchObject({ here: false, hereUserIds: [] })
    })

    it('writes the mentions of the new text when editing', async () => {
        const { edit, seed, repository } = world()
        const row = seed('hoi-dap', DUNG, 'Ai giải câu 3?')

        await edit(DUNG, row.id, `<@${GIANG}> giải câu 3?`)

        expect(repository.edit).toHaveBeenCalledWith(
            row.id,
            `<@${GIANG}> giải câu 3?`,
            { everyone: false, here: false, roleIds: [], userIds: [GIANG], hereUserIds: [] },
            expect.any(Date)
        )
    })

    it('changes nothing when the edit comes to the same kept text', async () => {
        const { edit, seed, repository, events } = world()
        const row = seed('hoi-dap', 'binh', 'Hỏi @Ban tổ chức')

        await edit('binh', row.id, `Hỏi <@&${BAN_TO}>`)

        expect(repository.edit).not.toHaveBeenCalled()
        expect(events.publish).not.toHaveBeenCalled()
    })
})

describe('DeleteRecentMessagesHandler (D-181)', () => {
    /** The batch: what one transaction deletes, and one event tells. */
    const DELETE_BATCH = 100
    const FROM = new Date('2026-11-09T09:00:00Z')
    const TO = new Date('2026-11-16T09:00:00Z')
    const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`)

    /** ÔT has #hoi-dap (a full batch of Khánh's messages, then 2 more), #tai-lieu (1) and a voice channel (none). */
    function world() {
        const batches: Record<string, string[][]> = {
            'hoi-dap': [ids('h', DELETE_BATCH), ['h-a', 'h-b']],
            'tai-lieu': [['t-0']],
            'phong-hoc': []
        }
        const messages = {
            removeRecent: jest.fn(async (channelId: string) => batches[channelId].shift() ?? [])
        } as unknown as jest.Mocked<MessageRepositoryPort>
        const channels = {
            channelIdsOf: jest.fn(async () => ['hoi-dap', 'tai-lieu', 'phong-hoc'])
        } as unknown as ChannelDirectoryPort
        const events = { publish: jest.fn() }
        const handler = new DeleteRecentMessagesHandler(messages, channels, events as unknown as EventBus)
        return { handler, messages, channels, events }
    }

    it('deletes their messages of the window channel by channel, a batch at a time, until a batch is short', async () => {
        const { handler, messages, channels } = world()

        await handler.execute(new DeleteRecentMessagesCommand('ot', 'khanh', FROM, TO))

        expect(channels.channelIdsOf).toHaveBeenCalledWith('ot')
        const calls = messages.removeRecent.mock.calls
        expect(calls.map(([channelId]) => channelId)).toEqual(['hoi-dap', 'hoi-dap', 'tai-lieu', 'phong-hoc'])
        for (const [, authorId, window, , limit, at] of calls) {
            expect([authorId, window, limit]).toEqual(['khanh', { from: FROM, to: TO }, DELETE_BATCH])
            expect(at).toBeInstanceOf(Date)
        }
    })

    it('starts each batch after the last message of the one before, each channel from the start', async () => {
        const { handler, messages } = world()

        await handler.execute(new DeleteRecentMessagesCommand('ot', 'khanh', FROM, TO))

        expect(messages.removeRecent.mock.calls.map(([, , , after]) => after)).toEqual([
            null,
            `h-${DELETE_BATCH - 1}`,
            null,
            null
        ])
    })

    it('tells each channel which messages went, a batch per event, nothing for a channel with none', async () => {
        const { handler, events } = world()

        await handler.execute(new DeleteRecentMessagesCommand('ot', 'khanh', FROM, TO))

        expect(events.publish.mock.calls.map(([event]) => event)).toEqual([
            new MessagesBulkDeletedEvent('hoi-dap', ids('h', DELETE_BATCH)),
            new MessagesBulkDeletedEvent('hoi-dap', ['h-a', 'h-b']),
            new MessagesBulkDeletedEvent('tai-lieu', ['t-0'])
        ])
    })

    it('a batch that fails stops the job, for the queue to run it again (what is deleted stays deleted)', async () => {
        const { handler, messages, events } = world()
        messages.removeRecent.mockRejectedValueOnce(new Error('connection lost'))

        await expect(handler.execute(new DeleteRecentMessagesCommand('ot', 'khanh', FROM, TO))).rejects.toThrow(
            'connection lost'
        )
        expect(events.publish).not.toHaveBeenCalled()
    })
})

describe('In a DM (D-238)', () => {
    const savedMentions = (repository: MessageRepositoryPort) =>
        (repository.create as jest.Mock).mock.calls.at(-1)![0] as NewMessage

    it('sends between its two, reaching only the other one: no roles, no one else, no @everyone', async () => {
        const { send, repository, checker, roles, events } = world()

        const message = await send(
            DUNG,
            `<@${GIANG}> <@${HUNG}> <@&${TRO_GIANG}> @everyone @here`,
            'n1',
            'dm-dung-giang'
        )

        expect(savedMentions(repository).mentions).toMatchObject({
            everyone: false,
            here: false,
            roleIds: [],
            userIds: [GIANG],
            hereUserIds: []
        })
        expect(message.channelId).toBe('dm-dung-giang')
        expect(events.publish).toHaveBeenCalledWith(new MessageCreatedEvent(message, 'n1'))
        expect(checker.access).not.toHaveBeenCalled()
        expect(roles.rolesOf).not.toHaveBeenCalled()
    })

    it('refuses someone who may no longer message the other one, counting nothing', async () => {
        const { send, repository, limit } = world()

        await expect(send('chi', 'Còn đó không?', 'n1', 'dm-an-chi')).rejects.toBeInstanceOf(CannotMessageUserError)
        expect(repository.create).not.toHaveBeenCalled()
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('answers not found to anyone not one of its two', async () => {
        const { send } = world()
        await expect(send('binh', 'Chào', 'n1', 'dm-dung-giang')).rejects.toBeInstanceOf(ChannelNotFoundError)
    })

    it('lets them edit their own message only while they may still message the other one', async () => {
        const { edit, seed } = world()
        const mine = seed('dm-dung-giang', DUNG)
        const silenced = seed('dm-an-chi', 'chi')

        await expect(edit(DUNG, mine.id, 'Sửa lại')).resolves.toMatchObject({ content: 'Sửa lại' })
        await expect(edit('chi', silenced.id, 'Sửa lại')).rejects.toBeInstanceOf(CannotMessageUserError)
    })

    it('lets each delete only their own, even once they may no longer write: no one manages a DM', async () => {
        const { remove, seed, saved } = world()
        const ans = seed('dm-an-chi', 'an')
        const chis = seed('dm-an-chi', 'chi')

        await expect(remove('chi', ans.id)).rejects.toBeInstanceOf(CannotDeleteMessageError)
        await remove('chi', chis.id)
        expect(saved.find((row) => row.id === chis.id)?.deleted).toBe(true)
    })
})
