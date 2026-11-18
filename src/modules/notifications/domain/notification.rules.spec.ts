import {
    HeldMessageItem,
    isKept,
    keptSince,
    createdRead,
    messageRecipients,
    planMessageItems,
    taskItemRecipients
} from './notification.rules'

const none = { users: [], repliedTo: null, roles: [], everyone: [], here: [] }

describe('messageRecipients (REQ-NOTIF-01, D-183)', () => {
    it('gives each person one item, by the strongest reason: by name, then a role, then @everyone, then @here', () => {
        const found = messageRecipients('an', {
            users: ['binh'],
            repliedTo: 'chi',
            roles: [
                { roleId: 'truong-nhom', userIds: ['binh', 'dung'] },
                { roleId: 'thu-ky', userIds: ['dung', 'giang'] }
            ],
            everyone: ['binh', 'chi', 'dung', 'giang', 'huy'],
            here: ['huy', 'khanh']
        })
        expect(found).toEqual([
            { userId: 'binh', type: 'mention', reason: 'user', roleId: null },
            { userId: 'dung', type: 'mention', reason: 'role', roleId: 'truong-nhom' },
            { userId: 'giang', type: 'mention', reason: 'role', roleId: 'thu-ky' },
            { userId: 'chi', type: 'mention', reason: 'everyone', roleId: null },
            { userId: 'huy', type: 'mention', reason: 'everyone', roleId: null },
            { userId: 'khanh', type: 'mention', reason: 'here', roleId: null }
        ])
    })

    it('makes an answer a reply, unless the message also mentions its author', () => {
        expect(messageRecipients('an', { ...none, repliedTo: 'binh' })).toEqual([
            { userId: 'binh', type: 'reply', reason: null, roleId: null }
        ])
        expect(messageRecipients('an', { ...none, repliedTo: 'binh', users: ['binh'] })).toEqual([
            { userId: 'binh', type: 'mention', reason: 'user', roleId: null }
        ])
    })

    it('never gives the author an item of their own message', () => {
        const found = messageRecipients('an', {
            users: ['an'],
            repliedTo: 'an',
            roles: [{ roleId: 'r', userIds: ['an'] }],
            everyone: ['an'],
            here: ['an']
        })
        expect(found).toEqual([])
    })
})

describe('planMessageItems (D-188)', () => {
    const held = (
        userId: string,
        type: 'mention' | 'reply',
        reason: HeldMessageItem['reason'],
        roleId: string | null = null
    ) => ({
        id: `n-${userId}`,
        userId,
        type,
        reason,
        roleId
    })

    it('adds the people now mentioned, takes off those no longer, and changes the reason of the others', () => {
        const plan = planMessageItems(
            [held('binh', 'mention', 'user'), held('chi', 'reply', null), held('dung', 'mention', 'everyone')],
            [
                { userId: 'binh', type: 'mention', reason: 'user', roleId: null },
                { userId: 'chi', type: 'mention', reason: 'user', roleId: null },
                { userId: 'giang', type: 'mention', reason: 'here', roleId: null }
            ],
            true
        )
        expect(plan.add).toEqual([{ userId: 'giang', type: 'mention', reason: 'here', roleId: null }])
        expect(plan.remove).toEqual(['n-dung'])
        expect(plan.change).toEqual([{ id: 'n-chi', type: 'mention', reason: 'user', roleId: null }])
    })

    it('adds nothing for a message older than the inbox keeps, still taking items off', () => {
        const plan = planMessageItems(
            [held('binh', 'mention', 'user')],
            [{ userId: 'chi', type: 'mention', reason: 'user', roleId: null }],
            false
        )
        expect(plan.add).toEqual([])
        expect(plan.remove).toEqual(['n-binh'])
    })
})

describe('the 90 days the inbox keeps (REQ-NOTIF-03)', () => {
    const now = new Date('2026-11-17T12:00:00.000Z')

    it('keeps what is 90 days old to the millisecond, not a moment more', () => {
        expect(keptSince(now).toISOString()).toBe('2026-08-19T12:00:00.000Z')
        expect(isKept(new Date('2026-08-19T12:00:00.000Z'), now)).toBe(true)
        expect(isKept(new Date('2026-08-19T11:59:59.999Z'), now)).toBe(false)
    })
})

describe('taskItemRecipients (D-95, D-98)', () => {
    it('gives each person one item, never the one who acted: taking a task on oneself makes none', () => {
        expect(taskItemRecipients('an', ['binh', 'an', 'chi', 'binh'])).toEqual(['binh', 'chi'])
        expect(taskItemRecipients('binh', ['binh'])).toEqual([])
    })

    it('leaves the creator without an item when they are the one who left the task', () => {
        expect(taskItemRecipients('an', ['an'])).toEqual([])
        expect(taskItemRecipients('binh', ['an'])).toEqual(['an'])
    })

    it('gives everyone theirs when the app acted (a reminder)', () => {
        expect(taskItemRecipients(null, ['binh', 'chi'])).toEqual(['binh', 'chi'])
    })
})

describe('createdRead (D-187, D-201)', () => {
    it('makes a kick or ban read when it reached an open app: its dialog showed it', () => {
        expect(createdRead('kick', true)).toBe(true)
        expect(createdRead('ban', true)).toBe(true)
        expect(createdRead('kick', false)).toBe(false)
        expect(createdRead('ban', false)).toBe(false)
    })

    it('leaves a timeout and an owner item unread, open app or not: no dialog says them', () => {
        expect(createdRead('timeout', true)).toBe(false)
        expect(createdRead(null, true)).toBe(false)
    })
})
