import { futureMarks, reminderChange, reminderHolds, reminderRecipients } from './reminder.rules'

const HOUR = 3600_000
const now = new Date('2026-10-17T14:47:00Z')
const after = (hours: number) => new Date(now.getTime() + hours * HOUR)

describe('futureMarks (REQ-TASK-04, D-95)', () => {
    it('gives both marks of a due date more than a day ahead, 24 hours then 2 hours before it', () => {
        const due = after(30)
        expect(futureMarks(due, now)).toEqual([
            { mark: '24h', at: after(6) },
            { mark: '2h', at: after(28) }
        ])
    })

    it('gives only the marks still ahead: a task made or moved past a mark gets those left', () => {
        expect(futureMarks(after(3), now)).toEqual([{ mark: '2h', at: after(1) }])
        expect(futureMarks(after(24), now)).toEqual([{ mark: '2h', at: after(22) }])
        expect(futureMarks(after(2), now)).toEqual([])
        expect(futureMarks(after(1), now)).toEqual([])
    })

    it('gives none without a due date', () => {
        expect(futureMarks(null, now)).toEqual([])
    })
})

describe('reminderChange (ARCHITECTURE 7)', () => {
    const open = (dueAt: Date | null) => ({ status: 'todo' as const, dueAt })
    const done = (dueAt: Date | null) => ({ status: 'done' as const, dueAt })
    const due = after(30)
    const later = after(50)

    it('schedules a task made with a due date, and nothing for one without', () => {
        expect(reminderChange(null, open(due))).toEqual({ cancel: null, schedule: due })
        expect(reminderChange(null, open(null))).toEqual({ cancel: null, schedule: null })
    })

    it('moves the reminders of a due date changed, and drops those of one taken off', () => {
        expect(reminderChange(open(due), open(later))).toEqual({ cancel: due, schedule: later })
        expect(reminderChange(open(due), open(null))).toEqual({ cancel: due, schedule: null })
        expect(reminderChange(open(null), open(due))).toEqual({ cancel: null, schedule: due })
    })

    it('drops them when the task is done or deleted, and sets them again when it is reopened', () => {
        expect(reminderChange(open(due), done(due))).toEqual({ cancel: due, schedule: null })
        expect(reminderChange(open(due), null)).toEqual({ cancel: due, schedule: null })
        expect(reminderChange(done(due), open(due))).toEqual({ cancel: null, schedule: due })
    })

    it('leaves them be when neither the due date nor being done changed', () => {
        expect(reminderChange(open(due), open(due))).toEqual({ cancel: null, schedule: null })
        expect(reminderChange(open(due), { status: 'doing', dueAt: new Date(due) })).toEqual({
            cancel: null,
            schedule: null
        })
        expect(reminderChange(done(due), done(later))).toEqual({ cancel: null, schedule: null })
        expect(reminderChange(done(due), null)).toEqual({ cancel: null, schedule: null })
    })
})

describe('reminderHolds (ARCHITECTURE 7: read again when it runs)', () => {
    const due = after(30)
    const open = { status: 'doing' as const, dueAt: new Date(due) }
    // The 24-hour reminder's time, and the 2-hour one's.
    const at24 = after(6)
    const at2 = after(28)

    it('holds for the task as it was scheduled, open with the same due date, run at its time', () => {
        expect(reminderHolds(open, '24h', due, at24)).toBe(true)
        expect(reminderHolds(open, '2h', due, at2)).toBe(true)
    })

    it('does not for a task deleted, done, or whose due date moved meanwhile', () => {
        expect(reminderHolds(null, '24h', due, at24)).toBe(false)
        expect(reminderHolds({ status: 'done', dueAt: due }, '24h', due, at24)).toBe(false)
        expect(reminderHolds({ status: 'todo', dueAt: after(35) }, '24h', due, at24)).toBe(false)
        expect(reminderHolds({ status: 'todo', dueAt: null }, '24h', due, at24)).toBe(false)
    })

    it('does not once it is missed, run late after the next mark or the due date (D-95)', () => {
        // Run late, as after a restart: "Còn 24 giờ" with 2 hours left, or anything once due, says the wrong thing.
        expect(reminderHolds(open, '24h', due, new Date(at2.getTime() - 1))).toBe(true)
        expect(reminderHolds(open, '24h', due, at2)).toBe(false)
        expect(reminderHolds(open, '2h', due, new Date(due.getTime() - 1))).toBe(true)
        expect(reminderHolds(open, '2h', due, due)).toBe(false)
    })
})

describe('reminderRecipients (REQ-TASK-04)', () => {
    it('goes to the people on it who view the channel, in the order they were given it', () => {
        expect(reminderRecipients(['binh', 'chi', 'dung'], 'an', new Set(['an', 'dung', 'binh']))).toEqual([
            'binh',
            'dung'
        ])
    })

    it('goes to its creator when no one on it views the channel, or no one is on it', () => {
        expect(reminderRecipients(['chi'], 'an', new Set(['an']))).toEqual(['an'])
        expect(reminderRecipients([], 'an', new Set(['an']))).toEqual(['an'])
    })

    it('goes to no one when the creator cannot view the channel either', () => {
        expect(reminderRecipients(['chi'], 'an', new Set())).toEqual([])
    })
})
