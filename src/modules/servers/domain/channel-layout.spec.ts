import { AccessMember, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import {
    LayoutState,
    LayoutWrite,
    planCreateCategory,
    planCreateChannel,
    planDeleteCategory,
    planDeleteChannel,
    planMove,
    planRenameCategory,
    planUpdateChannel
} from './channel-layout'
import { MAX_CHANNELS_AND_CATEGORIES } from './channel-name.rules'
import { ChannelSnapshot, ServerSnapshot } from './member-view'
import { DEFAULT_STUDY_SETTINGS } from './study-room.rules'

const NOW = new Date('2026-11-09T21:47:00Z')

const channel = (id: string, extra: Partial<ChannelSnapshot> = {}): ChannelSnapshot => ({
    id,
    type: 'text',
    isPrivate: false,
    viewRoleIds: [],
    sendMode: 'everyone',
    categoryId: 'info',
    name: id,
    position: 0,
    isStudyRoom: false,
    ...DEFAULT_STUDY_SETTINGS,
    taskBoardEnabled: false,
    ...extra
})

/**
 * ÔT: `chung` outside any category; THÔNG TIN with four text channels, the
 * last private to Trưởng nhóm; PHÒNG HỌC with one room.
 */
const server: ServerSnapshot = {
    id: 'ot',
    name: 'Ôn thi Giải tích 2',
    iconKey: null,
    ownerId: 'an',
    welcomeChannelId: 'chao-mung',
    categories: [
        { id: 'info', name: 'Thông tin', position: 0 },
        { id: 'rooms', name: 'Phòng học', position: 1 }
    ],
    channels: [
        channel('chung', { categoryId: null }),
        channel('chao-mung', { position: 0 }),
        channel('tai-lieu', { position: 1 }),
        channel('hoi-dap', { position: 2 }),
        channel('bi-mat', { position: 3, isPrivate: true, viewRoleIds: ['lead'] }),
        channel('phong-on', { categoryId: 'rooms', type: 'voice', name: 'Phòng ôn', isStudyRoom: true })
    ],
    roles: [
        { id: 'everyone', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'helper', name: 'Điều phối', permissions: Permission.MANAGE_CHANNELS, position: 1, isEveryone: false },
        { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.MANAGE_MESSAGES, position: 2, isEveryone: false }
    ]
}

const member = (userId: string, roleIds: string[] = [], timeoutUntil: Date | null = null): AccessMember => ({
    userId,
    roleIds,
    timeoutUntil
})

const as = (who: AccessMember, changed: Partial<ServerSnapshot> = {}): LayoutState => ({
    server: { ...server, ...changed },
    member: who
})

const AN = member('an')
/** Manages channels, but is not in Trưởng nhóm: `bi-mat` is hidden from her. */
const CHI = member('chi', ['helper'])
const PHONG = member('phong')

const error = (run: () => unknown) => {
    try {
        run()
    } catch (caught) {
        const { name, details } = caught as { name: string; details?: { rule: string } }
        return details ? `${name}:${details.rule}` : name
    }
    return 'none'
}

const placesOf = (writes: LayoutWrite[]) =>
    writes.flatMap((write) => (write.kind === 'placeChannels' || write.kind === 'placeCategories' ? write.places : []))

describe('who may change the channel list', () => {
    it('needs MANAGE_CHANNELS: a plain member is refused, a timed-out manager too', () => {
        expect(error(() => planCreateCategory(as(PHONG), 'Ôn tập', NOW))).toBe('MissingPermissionError')
        const timedOut = member('chi', ['helper'], new Date(NOW.getTime() + 60_000))
        expect(error(() => planCreateChannel(as(timedOut), draft('x'), NOW))).toBe('MissingPermissionError')
    })

    it('treats a channel they cannot see as not there, even when they manage channels', () => {
        expect(error(() => planDeleteChannel(as(CHI), 'bi-mat', NOW))).toBe('ChannelNotFoundError')
        expect(error(() => planDeleteChannel(as(CHI), 'nope', NOW))).toBe('ChannelNotFoundError')
        expect(error(() => planUpdateChannel(as(PHONG), 'hoi-dap', { name: 'x' }, NOW))).toBe('MissingPermissionError')
        expect(planDeleteChannel(as(AN), 'bi-mat', NOW)).toEqual([{ kind: 'deleteChannel', id: 'bi-mat' }])
    })
})

describe('categories', () => {
    it('adds one at the end, its name as typed', () => {
        expect(planCreateCategory(as(CHI), '  Ôn tập cuối kỳ ', NOW)).toEqual([
            { kind: 'createCategory', name: 'Ôn tập cuối kỳ', nameKey: 'ôn tập cuối kỳ', position: 2 }
        ])
    })

    it('refuses a name the server has, in any case but not with other accents (D-84)', () => {
        expect(error(() => planCreateCategory(as(AN), 'THÔNG TIN', NOW))).toBe('LayoutRuleError:name_taken')
        expect(planCreateCategory(as(AN), 'Thong tin', NOW)).toHaveLength(1)
        expect(error(() => planCreateCategory(as(AN), '   ', NOW))).toBe('LayoutRuleError:name_invalid')
    })

    it('counts channels and categories together up to 500', () => {
        const full = Array.from({ length: MAX_CHANNELS_AND_CATEGORIES - server.channels.length }, (_, i) => ({
            id: `c${i}`,
            name: `c${i}`,
            position: i
        }))
        expect(error(() => planCreateCategory(as(AN, { categories: full }), 'x', NOW))).toBe('LayoutRuleError:limit')
        expect(
            error(() => planCreateChannel(as(AN, { categories: full }), draft('x', { categoryId: null }), NOW))
        ).toBe('LayoutRuleError:limit')
    })

    it('renames, refusing another category name but not a change of case of its own', () => {
        expect(planRenameCategory(as(AN), 'info', 'THÔNG TIN', NOW)).toEqual([
            { kind: 'renameCategory', id: 'info', name: 'THÔNG TIN', nameKey: 'thông tin' }
        ])
        expect(planRenameCategory(as(AN), 'info', 'Thông tin', NOW)).toEqual([])
        expect(error(() => planRenameCategory(as(AN), 'info', 'phòng học', NOW))).toBe('LayoutRuleError:name_taken')
        expect(error(() => planRenameCategory(as(AN), 'gone', 'x', NOW))).toBe('CategoryNotFoundError')
    })

    it('on delete, moves its channels in order below the ones outside any, then deletes it', () => {
        expect(planDeleteCategory(as(AN), 'info', NOW)).toEqual([
            {
                kind: 'placeChannels',
                places: [
                    { id: 'chao-mung', categoryId: null, position: 1 },
                    { id: 'tai-lieu', categoryId: null, position: 2 },
                    { id: 'hoi-dap', categoryId: null, position: 3 },
                    { id: 'bi-mat', categoryId: null, position: 4 }
                ]
            },
            { kind: 'deleteCategory', id: 'info' }
        ])
    })

    it('refuses the delete when a channel would clash outside, naming only what they can see', () => {
        const clash = [...server.channels, channel('hoi-dap-ngoai', { categoryId: null, name: 'hoi-dap' })]
        const hidden = [...clash, channel('bi-mat-ngoai', { categoryId: null, name: 'bi-mat' })]
        let details: unknown
        try {
            planDeleteCategory(as(CHI, { channels: hidden }), 'info', NOW)
        } catch (caught) {
            details = (caught as { details: unknown }).details
        }
        expect(details).toEqual({ rule: 'name_taken', names: ['hoi-dap'] })
        // A room and a text channel of one name do not clash.
        const room = [...server.channels, channel('ph', { categoryId: null, type: 'voice', name: 'hoi-dap' })]
        expect(planDeleteCategory(as(AN, { channels: room }), 'info', NOW)).toHaveLength(2)
    })

    it('deletes an empty category with nothing to move', () => {
        const empty = [...server.categories, { id: 'empty', name: 'Trống', position: 2 }]
        expect(planDeleteCategory(as(AN, { categories: empty }), 'empty', NOW)).toEqual([
            { kind: 'deleteCategory', id: 'empty' }
        ])
    })
})

function draft(name: string, extra: Partial<Parameters<typeof planCreateChannel>[1]> = {}) {
    return {
        type: 'text' as const,
        name,
        categoryId: 'info',
        isStudyRoom: false,
        isPrivate: false,
        viewRoleIds: [],
        ...extra
    }
}

const created = (writes: LayoutWrite[]) => {
    const [write] = writes
    if (write.kind !== 'createChannel') throw new Error(write.kind)
    return write.channel
}

describe('creating a channel (S-SRV-05)', () => {
    it('stores a text channel normalised, at the end of its group', () => {
        expect(created(planCreateChannel(as(CHI), draft('Hỏi Đáp Chung'), NOW))).toMatchObject({
            name: 'hỏi-đáp-chung',
            nameKey: 'hỏi-đáp-chung',
            categoryId: 'info',
            position: 4
        })
        expect(created(planCreateChannel(as(CHI), draft('Tin', { categoryId: null }), NOW)).position).toBe(1)
    })

    it('keeps a room name as typed, and lets it be a study room', () => {
        const room = created(
            planCreateChannel(
                as(AN),
                draft(' Phòng ôn chương 3 ', { type: 'voice', categoryId: 'rooms', isStudyRoom: true }),
                NOW
            )
        )
        expect(room).toMatchObject({ name: 'Phòng ôn chương 3', isStudyRoom: true, position: 1 })
        expect(error(() => planCreateChannel(as(AN), draft('x', { isStudyRoom: true }), NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
    })

    it('refuses a clash in the group of the same kind only (D-84)', () => {
        expect(error(() => planCreateChannel(as(AN), draft('Tai Lieu'), NOW))).toBe('LayoutRuleError:name_taken')
        expect(planCreateChannel(as(AN), draft('Tài liệu'), NOW)).toHaveLength(1)
        expect(planCreateChannel(as(AN), draft('tai lieu', { categoryId: null }), NOW)).toHaveLength(1)
        expect(
            error(() => planCreateChannel(as(AN), draft('phòng ôn', { type: 'voice', categoryId: 'rooms' }), NOW))
        ).toBe('LayoutRuleError:name_taken')
        expect(planCreateChannel(as(AN), draft('phòng ôn', { categoryId: 'rooms' }), NOW)).toHaveLength(1)
    })

    it('refuses a name with nothing left, and a category that is gone', () => {
        expect(error(() => planCreateChannel(as(AN), draft('???'), NOW))).toBe('LayoutRuleError:name_invalid')
        expect(error(() => planCreateChannel(as(AN), draft('x', { categoryId: 'gone' }), NOW))).toBe(
            'CategoryNotFoundError'
        )
    })

    it('makes it private for the roles picked, never @everyone or a role of nowhere', () => {
        const made = created(
            planCreateChannel(as(AN), draft('ban', { isPrivate: true, viewRoleIds: ['lead', 'lead'] }), NOW)
        )
        expect(made).toMatchObject({ isPrivate: true, viewRoleIds: ['lead'] })
        expect(created(planCreateChannel(as(AN), draft('kin', { isPrivate: true }), NOW)).viewRoleIds).toEqual([])
        for (const viewRoleIds of [['everyone'], ['elsewhere']]) {
            expect(error(() => planCreateChannel(as(AN), draft('x', { isPrivate: true, viewRoleIds }), NOW))).toBe(
                'LayoutRuleError:view_roles'
            )
        }
        expect(error(() => planCreateChannel(as(AN), draft('x', { viewRoleIds: ['lead'] }), NOW))).toBe(
            'LayoutRuleError:view_roles'
        )
    })
})

describe('channel settings (S-SET-05)', () => {
    it('renames within its group, not onto another channel there', () => {
        expect(planUpdateChannel(as(CHI), 'hoi-dap', { name: 'Việc nhóm K22' }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'hoi-dap', changes: { name: 'việc-nhóm-k22', nameKey: 'việc-nhóm-k22' } }
        ])
        expect(error(() => planUpdateChannel(as(CHI), 'hoi-dap', { name: 'Tai lieu' }, NOW))).toBe(
            'LayoutRuleError:name_taken'
        )
        expect(planUpdateChannel(as(CHI), 'hoi-dap', { name: 'Hoi dap' }, NOW)).toEqual([])
    })

    it('sets who may post on text channels only', () => {
        expect(planUpdateChannel(as(AN), 'hoi-dap', { sendMode: 'managers' }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'hoi-dap', changes: { sendMode: 'managers' } }
        ])
        expect(error(() => planUpdateChannel(as(AN), 'phong-on', { sendMode: 'managers' }, NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
        expect(planUpdateChannel(as(AN), 'phong-on', { sendMode: 'everyone' }, NOW)).toEqual([])
    })

    it('turns the Task Board on and off on text channels only (REQ-TASK-01)', () => {
        expect(planUpdateChannel(as(CHI), 'hoi-dap', { taskBoardEnabled: true }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'hoi-dap', changes: { taskBoardEnabled: true } }
        ])
        expect(planUpdateChannel(as(CHI), 'hoi-dap', { taskBoardEnabled: false }, NOW)).toEqual([])
        expect(error(() => planUpdateChannel(as(AN), 'phong-on', { taskBoardEnabled: true }, NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
        expect(planUpdateChannel(as(AN), 'phong-on', { taskBoardEnabled: false }, NOW)).toEqual([])
        expect(error(() => planUpdateChannel(as(PHONG), 'hoi-dap', { taskBoardEnabled: true }, NOW))).toBe(
            'MissingPermissionError'
        )
    })

    it('makes a channel private, changes its roles, and making it public clears them', () => {
        expect(planUpdateChannel(as(AN), 'hoi-dap', { isPrivate: true, viewRoleIds: ['lead'] }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'hoi-dap', changes: { isPrivate: true, viewRoleIds: ['lead'] } }
        ])
        expect(planUpdateChannel(as(AN), 'bi-mat', { viewRoleIds: ['helper', 'lead'] }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'bi-mat', changes: { viewRoleIds: ['helper', 'lead'] } }
        ])
        expect(planUpdateChannel(as(AN), 'bi-mat', { isPrivate: false }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'bi-mat', changes: { isPrivate: false, viewRoleIds: [] } }
        ])
        expect(planUpdateChannel(as(AN), 'bi-mat', { isPrivate: true, viewRoleIds: ['lead'] }, NOW)).toEqual([])
        expect(error(() => planUpdateChannel(as(AN), 'hoi-dap', { viewRoleIds: ['lead'] }, NOW))).toBe(
            'LayoutRuleError:view_roles'
        )
    })
})

describe('room settings (S-SET-06, REQ-STUDY-01, D-210)', () => {
    /** Bình: Trưởng nhóm with MANAGE_STUDY_ROOMS, not MANAGE_CHANNELS. */
    const BINH = member('binh', ['coach'])
    const withCoach = as(BINH, {
        roles: [
            ...server.roles,
            {
                id: 'coach',
                name: 'Điều phối phòng học',
                permissions: Permission.MANAGE_STUDY_ROOMS,
                position: 3,
                isEveryone: false
            }
        ]
    })

    it('turns a room into a study room and back, with who may start and the cycle', () => {
        expect(planUpdateChannel(as(CHI), 'phong-on', { isStudyRoom: false }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'phong-on', changes: { isStudyRoom: false } }
        ])
        expect(
            planUpdateChannel(
                as(CHI),
                'phong-on',
                {
                    studyStarter: 'managers',
                    studyFocusMinutes: 50,
                    studyShortBreakMinutes: 10,
                    studyLongBreakMinutes: 20,
                    studyLongBreakEvery: 4
                },
                NOW
            )
        ).toEqual([
            {
                kind: 'updateChannel',
                id: 'phong-on',
                changes: {
                    studyStarter: 'managers',
                    studyFocusMinutes: 50,
                    studyShortBreakMinutes: 10,
                    studyLongBreakMinutes: 20,
                    studyLongBreakEvery: 4
                }
            }
        ])
        expect(planUpdateChannel(as(CHI), 'phong-on', { isStudyRoom: true, studyFocusMinutes: 25 }, NOW)).toEqual([])
    })

    it('keeps the cycle of a room that is not a study room yet', () => {
        const plain = as(CHI, {
            channels: server.channels.map((c) => (c.id === 'phong-on' ? { ...c, isStudyRoom: false } : c))
        })
        expect(planUpdateChannel(plain, 'phong-on', { studyFocusMinutes: 45 }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'phong-on', changes: { studyFocusMinutes: 45 } }
        ])
        expect(planUpdateChannel(plain, 'phong-on', { isStudyRoom: true, studyFocusMinutes: 45 }, NOW)).toEqual([
            { kind: 'updateChannel', id: 'phong-on', changes: { isStudyRoom: true, studyFocusMinutes: 45 } }
        ])
    })

    it('turns the long break off with both halves, and refuses one half alone', () => {
        const longBreak = as(CHI, {
            channels: server.channels.map((c) =>
                c.id === 'phong-on' ? { ...c, studyLongBreakMinutes: 15, studyLongBreakEvery: 4 } : c
            )
        })
        expect(
            planUpdateChannel(longBreak, 'phong-on', { studyLongBreakMinutes: null, studyLongBreakEvery: null }, NOW)
        ).toEqual([
            {
                kind: 'updateChannel',
                id: 'phong-on',
                changes: { studyLongBreakMinutes: null, studyLongBreakEvery: null }
            }
        ])
        expect(error(() => planUpdateChannel(longBreak, 'phong-on', { studyLongBreakEvery: null }, NOW))).toBe(
            'LayoutRuleError:study_cycle'
        )
        expect(error(() => planUpdateChannel(as(CHI), 'phong-on', { studyLongBreakMinutes: 15 }, NOW))).toBe(
            'LayoutRuleError:study_cycle'
        )
        expect(error(() => planUpdateChannel(as(CHI), 'phong-on', { studyFocusMinutes: 150 }, NOW))).toBe(
            'LayoutRuleError:study_cycle'
        )
    })

    it('says which part of the cycle is wrong', () => {
        try {
            planUpdateChannel(as(CHI), 'phong-on', { studyFocusMinutes: 150 }, NOW)
        } catch (caught) {
            expect((caught as { details: unknown }).details).toEqual({ rule: 'study_cycle', problem: 'focus_minutes' })
        }
        expect.assertions(1)
    })

    it('has no study settings on a text channel', () => {
        expect(error(() => planUpdateChannel(as(AN), 'hoi-dap', { isStudyRoom: true }, NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
        expect(error(() => planUpdateChannel(as(AN), 'hoi-dap', { studyStarter: 'managers' }, NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
        expect(error(() => planUpdateChannel(as(AN), 'hoi-dap', { studyFocusMinutes: 50 }, NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
        expect(planUpdateChannel(as(AN), 'hoi-dap', { isStudyRoom: false, studyFocusMinutes: 25 }, NOW)).toEqual([])
    })

    it('lets MANAGE_STUDY_ROOMS change the study part of a room only (study-only)', () => {
        expect(planUpdateChannel(withCoach, 'phong-on', { isStudyRoom: false, studyStarter: 'managers' }, NOW)).toEqual(
            [{ kind: 'updateChannel', id: 'phong-on', changes: { isStudyRoom: false, studyStarter: 'managers' } }]
        )
        // What did not change is no reason to refuse: the dialog sends what differs, a stale one may send it all.
        expect(planUpdateChannel(withCoach, 'phong-on', { name: 'Phòng ôn', isPrivate: false }, NOW)).toEqual([])
        expect(error(() => planUpdateChannel(withCoach, 'phong-on', { name: 'Phòng mới' }, NOW))).toBe(
            'MissingPermissionError'
        )
        expect(
            error(() => planUpdateChannel(withCoach, 'phong-on', { isPrivate: true, viewRoleIds: ['lead'] }, NOW))
        ).toBe('MissingPermissionError')
        expect(error(() => planDeleteChannel(withCoach, 'phong-on', NOW))).toBe('MissingPermissionError')
    })

    it('refuses MANAGE_STUDY_ROOMS any view roles: they were never shown them, so a match must not answer', () => {
        const privateRoom = as(BINH, {
            roles: withCoach.server.roles,
            channels: server.channels.map((c) =>
                c.id === 'phong-on' ? { ...c, isPrivate: true, viewRoleIds: ['lead', 'coach'] } : c
            )
        })
        expect(error(() => planUpdateChannel(privateRoom, 'phong-on', { viewRoleIds: ['lead', 'coach'] }, NOW))).toBe(
            'MissingPermissionError'
        )
        expect(planUpdateChannel(privateRoom, 'phong-on', { isPrivate: true }, NOW)).toEqual([])
    })

    it('refuses MANAGE_STUDY_ROOMS a name change before saying whether the name is taken', () => {
        const twoRooms = as(BINH, {
            roles: withCoach.server.roles,
            channels: [
                ...server.channels,
                channel('phong-2', { categoryId: 'rooms', type: 'voice', name: 'Phòng hai', position: 1 })
            ]
        })
        expect(error(() => planUpdateChannel(twoRooms, 'phong-on', { name: 'Phòng hai' }, NOW))).toBe(
            'MissingPermissionError'
        )
    })

    it('gives MANAGE_STUDY_ROOMS nothing on a text channel, and nothing to someone with neither', () => {
        expect(error(() => planUpdateChannel(withCoach, 'hoi-dap', { taskBoardEnabled: false }, NOW))).toBe(
            'MissingPermissionError'
        )
        expect(error(() => planUpdateChannel(as(PHONG), 'phong-on', { isStudyRoom: false }, NOW))).toBe(
            'MissingPermissionError'
        )
    })
})

describe('moving one channel or category (S-SRV-06, D-149)', () => {
    const move = (id: string, categoryId: string | null, afterId: string | null) =>
        ({ kind: 'channel', id, categoryId, afterId }) as const

    it('reorders within a category, numbering the group again, writing only what moved', () => {
        expect(placesOf(planMove(as(AN), move('hoi-dap', 'info', 'chao-mung'), NOW))).toEqual([
            { id: 'hoi-dap', categoryId: 'info', position: 1 },
            { id: 'tai-lieu', categoryId: 'info', position: 2 }
        ])
        expect(placesOf(planMove(as(AN), move('tai-lieu', 'info', null), NOW))).toEqual([
            { id: 'tai-lieu', categoryId: 'info', position: 0 },
            { id: 'chao-mung', categoryId: 'info', position: 1 }
        ])
        expect(planMove(as(AN), move('tai-lieu', 'info', 'chao-mung'), NOW)).toEqual([])
    })

    it('moves into another category or out of all of them', () => {
        expect(placesOf(planMove(as(AN), move('hoi-dap', 'rooms', 'phong-on'), NOW))).toEqual([
            { id: 'hoi-dap', categoryId: 'rooms', position: 1 }
        ])
        expect(placesOf(planMove(as(AN), move('hoi-dap', null, null), NOW))).toEqual([
            { id: 'hoi-dap', categoryId: null, position: 0 },
            { id: 'chung', categoryId: null, position: 1 }
        ])
    })

    it('leaves a channel they cannot see where it is, after the one dropped', () => {
        // Chi does not see bi-mat (3): chao-mung dropped after hoi-dap lands before it, and it keeps its place.
        expect(placesOf(planMove(as(CHI), move('chao-mung', 'info', 'hoi-dap'), NOW))).toEqual([
            { id: 'tai-lieu', categoryId: 'info', position: 0 },
            { id: 'hoi-dap', categoryId: 'info', position: 1 },
            { id: 'chao-mung', categoryId: 'info', position: 2 }
        ])
    })

    it('refuses a drop place that is not (or no longer) a channel they see in that group', () => {
        for (const afterId of ['phong-on', 'gone', 'hoi-dap']) {
            const id = afterId === 'hoi-dap' ? 'hoi-dap' : 'chao-mung'
            expect(error(() => planMove(as(AN), move(id, 'info', afterId), NOW))).toBe('LayoutRuleError:stale_move')
        }
        expect(error(() => planMove(as(CHI), move('chao-mung', 'info', 'bi-mat'), NOW))).toBe(
            'LayoutRuleError:stale_move'
        )
        expect(error(() => planMove(as(AN), move('hoi-dap', 'gone', null), NOW))).toBe('CategoryNotFoundError')
    })

    it('refuses a move into a group where its name is taken (D-84)', () => {
        const clash = [...server.channels, channel('hd2', { categoryId: 'rooms', name: 'Hoi-dap', position: 1 })]
        expect(error(() => planMove(as(AN, { channels: clash }), move('hoi-dap', 'rooms', null), NOW))).toBe(
            'LayoutRuleError:name_taken'
        )
    })

    it('reorders categories; a manager is needed, and a stale place is refused', () => {
        const category = (id: string, afterId: string | null) => ({ kind: 'category', id, afterId }) as const
        expect(placesOf(planMove(as(CHI), category('rooms', null), NOW))).toEqual([
            { id: 'rooms', position: 0 },
            { id: 'info', position: 1 }
        ])
        expect(planMove(as(CHI), category('rooms', 'info'), NOW)).toEqual([])
        expect(error(() => planMove(as(AN), category('rooms', 'rooms'), NOW))).toBe('LayoutRuleError:stale_move')
        expect(error(() => planMove(as(AN), category('rooms', 'gone'), NOW))).toBe('LayoutRuleError:stale_move')
        expect(error(() => planMove(as(PHONG), category('rooms', null), NOW))).toBe('MissingPermissionError')
    })
})
