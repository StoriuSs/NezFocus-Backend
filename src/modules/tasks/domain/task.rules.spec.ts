import {
    MAX_OPEN_TASKS,
    planAssign,
    planCreate,
    planEdit,
    planLeftServer,
    planUnassign,
    requireDelete,
    requireOpenRoom,
    TaskActor,
    TaskFacts
} from './task.rules'

const NOW = new Date('2026-10-18T14:47:00Z')
const LATER = new Date('2026-10-23T16:59:00Z')
const PAST = new Date('2026-10-15T16:59:00Z')

const actor = (userId: string, extra: Partial<TaskActor> = {}): TaskActor => ({
    userId,
    manages: false,
    creates: true,
    timedOutUntil: null,
    ...extra
})
const AN = actor('an')
const BINH = actor('binh')
const MINH = actor('minh', { manages: true })

/** "Sửa lỗi đăng nhập": An made it, Bình and Chi are on it. */
const task = (extra: Partial<TaskFacts> = {}): TaskFacts => ({
    id: 'task-1',
    channelId: 'viec-nhom',
    creatorId: 'an',
    title: 'Sửa lỗi đăng nhập',
    description: '',
    status: 'todo',
    dueAt: LATER,
    assigneeIds: ['binh', 'chi'],
    openCount: null,
    ...extra
})

const error = (run: () => unknown): string => {
    try {
        run()
    } catch (caught) {
        const e = caught as Error & { details?: { reason?: string } }
        return e.details?.reason ? `${e.constructor.name}:${e.details.reason}` : e.constructor.name
    }
    return 'none'
}

const viewers = new Set(['an', 'binh', 'chi', 'minh'])

describe('creating a task (REQ-TASK-01, 02)', () => {
    const draft = { title: 'Nộp báo cáo giữa kỳ', description: '', dueAt: LATER, assigneeIds: ['binh', 'an'] }

    it('needs CREATE_TASKS, and a member timed out creates nothing (D-188)', () => {
        expect(error(() => planCreate(actor('an', { creates: false }), draft, viewers, NOW))).toBe(
            'CannotChangeTaskError'
        )
        const until = new Date('2026-10-18T15:00:00Z')
        expect(error(() => planCreate(actor('an', { timedOutUntil: until }), draft, viewers, NOW))).toBe(
            'TaskTimedOutError'
        )
    })

    it('refuses a due date already passed, or this very moment', () => {
        expect(error(() => planCreate(AN, { ...draft, dueAt: PAST }, viewers, NOW))).toBe('InvalidTaskDueDateError')
        expect(error(() => planCreate(AN, { ...draft, dueAt: NOW }, viewers, NOW))).toBe('InvalidTaskDueDateError')
        expect(planCreate(AN, { ...draft, dueAt: null }, viewers, NOW).dueAt).toBeNull()
    })

    it('refuses anyone who cannot view the channel, naming them', () => {
        try {
            planCreate(AN, { ...draft, assigneeIds: ['binh', 'lan', 'mai'] }, viewers, NOW)
            throw new Error('not refused')
        } catch (caught) {
            expect(caught).toMatchObject({ errorKey: 'INVALID_TASK_ASSIGNEE', details: { userIds: ['lan', 'mai'] } })
        }
    })

    it('keeps the title searchable and writes its history in order: made, due, then each person', () => {
        const made = planCreate(AN, { ...draft, assigneeIds: ['binh', 'an', 'binh'] }, viewers, NOW)
        expect(made.titleSearch).toBe('nop bao cao giua ky')
        expect(made.assigneeIds).toEqual(['binh', 'an'])
        expect(made.events).toEqual([
            { kind: 'created', data: {} },
            { kind: 'due_changed', data: { from: null, to: LATER.toISOString() } },
            { kind: 'assignee_added', data: { userId: 'binh' } },
            { kind: 'assignee_added', data: { userId: 'an' } }
        ])
    })

    it('stops at 500 open tasks in the channel', () => {
        expect(() => requireOpenRoom(MAX_OPEN_TASKS - 1)).not.toThrow()
        expect(error(() => requireOpenRoom(MAX_OPEN_TASKS))).toBe('MaxOpenTasksReachedError')
    })
})

describe('editing a task (REQ-TASK-02, D-96)', () => {
    it('lets the creator and MANAGE_TASKS change the title, description and due date, not an assignee', () => {
        expect(planEdit(task(), AN, { title: 'Sửa lỗi OTP' }, NOW)).toEqual({
            changes: { title: 'Sửa lỗi OTP', titleSearch: 'sua loi otp' },
            addAssigneeIds: [],
            removeAssigneeIds: [],
            events: [{ kind: 'title_changed', data: { from: 'Sửa lỗi đăng nhập', to: 'Sửa lỗi OTP' } }]
        })
        expect(planEdit(task(), MINH, { description: 'Xem phần gửi mã' }, NOW)?.events).toEqual([
            { kind: 'description_changed', data: {} }
        ])
        expect(error(() => planEdit(task(), BINH, { title: 'x' }, NOW))).toBe('CannotChangeTaskError')
        expect(error(() => planEdit(task(), BINH, { dueAt: null }, NOW))).toBe('CannotChangeTaskError')
    })

    it('lets the creator, any assignee and MANAGE_TASKS change the status, nobody else', () => {
        for (const who of [AN, BINH, MINH]) {
            expect(planEdit(task(), who, { status: 'doing' }, NOW)?.events).toEqual([
                { kind: 'status_changed', data: { from: 'todo', to: 'doing' } }
            ])
        }
        expect(error(() => planEdit(task(), actor('dung'), { status: 'done' }, NOW))).toBe('CannotChangeTaskError')
    })

    it('checks only what really changes: a field sent back as it is needs no right', () => {
        expect(planEdit(task(), BINH, { title: 'Sửa lỗi đăng nhập', status: 'doing' }, NOW)?.changes).toEqual({
            status: 'doing'
        })
        expect(planEdit(task(), BINH, { title: 'Sửa lỗi đăng nhập', dueAt: LATER }, NOW)).toBeNull()
    })

    it('stamps the time it is done, and empties it when reopened (ARCHITECTURE 7)', () => {
        expect(planEdit(task(), BINH, { status: 'done' }, NOW)?.changes).toEqual({ status: 'done', completedAt: NOW })
        expect(planEdit(task({ status: 'done' }), BINH, { status: 'todo' }, NOW)?.changes).toEqual({
            status: 'todo',
            completedAt: null
        })
        expect(planEdit(task({ status: 'doing' }), BINH, { status: 'todo' }, NOW)?.changes).toEqual({ status: 'todo' })
    })

    it('reopens a done task only while the channel has room for one more not done (spec 05 › Edge case)', () => {
        const done = (openCount: number) => task({ status: 'done', openCount })
        expect(planEdit(done(MAX_OPEN_TASKS - 1), BINH, { status: 'todo' }, NOW)?.changes.status).toBe('todo')
        expect(error(() => planEdit(done(MAX_OPEN_TASKS), BINH, { status: 'doing' }, NOW))).toBe(
            'MaxOpenTasksReachedError'
        )
        expect(planEdit(task({ openCount: null }), BINH, { status: 'doing' }, NOW)?.changes.status).toBe('doing')
    })

    it('refuses a new due date in the past, but keeps an old one when other fields change (D-96)', () => {
        expect(error(() => planEdit(task(), AN, { dueAt: PAST }, NOW))).toBe('InvalidTaskDueDateError')
        const old = task({ status: 'done', dueAt: PAST })
        expect(planEdit(old, AN, { title: 'Sửa lỗi OTP', dueAt: PAST }, NOW)?.changes).toEqual({
            title: 'Sửa lỗi OTP',
            titleSearch: 'sua loi otp'
        })
        expect(planEdit(old, AN, { dueAt: null }, NOW)?.events).toEqual([
            { kind: 'due_changed', data: { from: PAST.toISOString(), to: null } }
        ])
    })

    it('lets nobody timed out change anything, the creator included (D-188)', () => {
        const until = new Date('2026-10-18T15:00:00Z')
        expect(error(() => planEdit(task(), actor('an', { timedOutUntil: until }), { status: 'done' }, NOW))).toBe(
            'TaskTimedOutError'
        )
    })

    it('lets the creator and MANAGE_TASKS delete it, nobody else', () => {
        expect(() => requireDelete(task(), AN)).not.toThrow()
        expect(() => requireDelete(task(), MINH)).not.toThrow()
        expect(error(() => requireDelete(task(), BINH))).toBe('CannotChangeTaskError')
    })
})

describe('people on a task (REQ-TASK-02)', () => {
    it('lets anyone who views the channel take it on themselves', () => {
        expect(planAssign(task(), actor('minh'), ['minh'], viewers)).toEqual({
            changes: {},
            addAssigneeIds: ['minh'],
            removeAssigneeIds: [],
            events: [{ kind: 'assignee_added', data: { userId: 'minh' } }]
        })
    })

    it('lets the creator, an assignee and MANAGE_TASKS add others, nobody else', () => {
        expect(planAssign(task(), BINH, ['an'], viewers)?.addAssigneeIds).toEqual(['an'])
        expect(planAssign(task({ assigneeIds: [] }), AN, ['minh'], viewers)?.addAssigneeIds).toEqual(['minh'])
        expect(error(() => planAssign(task(), actor('dung'), ['dung', 'an'], viewers))).toBe('CannotChangeTaskError')
    })

    it('skips people already on it, and refuses anyone who cannot view the channel', () => {
        expect(planAssign(task(), AN, ['binh', 'chi'], viewers)).toBeNull()
        expect(error(() => planAssign(task(), AN, ['lan'], viewers))).toBe('InvalidTaskAssigneeError')
    })

    it('lets an assignee take themselves off, but only the creator or MANAGE_TASKS take off another', () => {
        expect(planUnassign(task(), BINH, 'binh')).toEqual({
            changes: {},
            addAssigneeIds: [],
            removeAssigneeIds: ['binh'],
            events: [{ kind: 'assignee_removed', data: { userId: 'binh' } }]
        })
        expect(error(() => planUnassign(task(), BINH, 'chi'))).toBe('CannotChangeTaskError')
        expect(planUnassign(task(), AN, 'chi')?.removeAssigneeIds).toEqual(['chi'])
        expect(planUnassign(task(), MINH, 'chi')?.removeAssigneeIds).toEqual(['chi'])
        expect(planUnassign(task(), AN, 'minh')).toBeNull()
    })

    it('lets nobody timed out take a task on or off (D-188)', () => {
        const until = new Date('2026-10-18T15:00:00Z')
        const held = actor('binh', { timedOutUntil: until })
        expect(error(() => planUnassign(task(), held, 'binh'))).toBe('TaskTimedOutError')
        expect(error(() => planAssign(task(), held, ['binh'], viewers))).toBe('TaskTimedOutError')
    })
})

describe('planLeftServer (REQ-TASK-04, D-195)', () => {
    it('takes the person off with one line of history', () => {
        expect(planLeftServer('lan')).toEqual({
            changes: {},
            addAssigneeIds: [],
            removeAssigneeIds: ['lan'],
            events: [{ kind: 'assignee_removed', data: { userId: 'lan' } }]
        })
    })
})
