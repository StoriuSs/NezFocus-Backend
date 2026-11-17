import { randomBytes } from 'crypto'
import { TaskEventDraft } from '../../domain'

/** The 48-bit time and the 12-bit counter (where UUIDv7 has random bits after the version) of an id made here. */
function partsOf(id: string): { ms: number; counter: number } {
    const hex = id.replace(/-/g, '')
    return { ms: parseInt(hex.slice(0, 12), 16), counter: parseInt(hex.slice(13, 16), 16) }
}

/**
 * Ids for the lines of history one write makes, in the order given, each
 * above `after`, the task's last line. The history is read newest first by
 * id (REQ-TASK-03), and its lines are UUIDv7 like every other id; but the
 * lines of one write share a millisecond, and so may two writes of one task
 * in a row, whose random bits would put them in any order. So the bits after
 * the version count instead: from 0 in a new millisecond, on from the last
 * line in the same one (or in a later one, should this clock be behind the
 * one that wrote it). The task's row lock makes its writes take turns, so
 * `after` is always the last line.
 */
export function eventIds(count: number, at: Date, after: string | null): string[] {
    let ms = at.getTime()
    let next = 0
    if (after) {
        const last = partsOf(after)
        if (last.ms >= ms) {
            ms = last.ms
            next = last.counter + 1
        }
    }
    // 4096 lines in one millisecond: go on in the next one.
    if (next + count > 0x1000) {
        ms += 1
        next = 0
    }
    return Array.from({ length: count }, (_, index) => {
        const counter = next + index
        const bytes = randomBytes(16)
        for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff
        bytes[6] = 0x70 | ((counter >> 8) & 0x0f)
        bytes[7] = counter & 0xff
        bytes[8] = (bytes[8]! & 0x3f) | 0x80
        const hex = bytes.toString('hex')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    })
}

/** The rows of a write's history lines, after the task's last line (`after`, null for a new task). */
export const eventRows = (
    taskId: string,
    actorId: string,
    events: TaskEventDraft[],
    at: Date,
    after: string | null
) => {
    const ids = eventIds(events.length, at, after)
    return events.map((event, index) => ({
        id: ids[index]!,
        taskId,
        actorId,
        kind: event.kind,
        data: event.data,
        createdAt: at
    }))
}
