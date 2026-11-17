import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import {
    DONE_PAGE_SIZE,
    DueGroup,
    dueGroupOf,
    FALLBACK_TIME_ZONE,
    isDueSoon,
    searchWordsOf,
    StaleTaskCursorError
} from '../../../domain'
import { myBoards } from '../../services/my-boards'
import { ReadBoard } from '../../services/read-board'
import { TaskView, taskViews } from '../../services/task-views'
import { ListMyDoneTasksQuery, ListMyTasksQuery } from './mine.queries'

/** A task on the To-do page: its group by due date; null when done (D-186). */
export type MyTaskView = TaskView & { group: DueGroup | null }

/**
 * The To-do page's tasks as `GET /me/tasks` gives them: the tasks not done
 * with how many are done and how many are overdue or due today (the rail's
 * badge), or a page of done ones (the counts null).
 */
export interface MyTaskList {
    items: MyTaskView[]
    doneCount: number | null
    dueCount: number | null
    hasMore: boolean
}

/**
 * One's tasks not done, by due date, none last, then the order they were
 * made in, each in its group counted in the time zone of one's settings
 * (REQ-TASK-05, AUTH-08). The client does not regroup them (D-186); it reads
 * the list again on `task.*` and at midnight (D-196).
 */
@QueryHandler(ListMyTasksQuery)
export class ListMyTasksHandler extends ReadBoard implements IQueryHandler<ListMyTasksQuery> {
    async execute({ userId, serverId, search }: ListMyTasksQuery): Promise<MyTaskList> {
        const now = new Date()
        const [channelIds, timeZone] = await Promise.all([
            myBoards(this.tasks, this.checker, userId, serverId, now),
            this.users.timeZoneOf(userId)
        ])
        const filter = { userId, channelIds, search: searchWordsOf(search) }
        const [open, doneCount] = await Promise.all([this.tasks.listMineOpen(filter), this.tasks.countMineDone(filter)])
        const items = (await taskViews(this.viewSources, open)).map((task) => ({
            ...task,
            group: dueGroupOf(task.dueAt, now, timeZone ?? FALLBACK_TIME_ZONE)
        }))
        return { items, doneCount, dueCount: items.filter((task) => isDueSoon(task.group)).length, hasMore: false }
    }
}

/**
 * One's done tasks, the latest done first, 50 a page (D-97). A task paged
 * after that is no longer one of them (reopened, deleted, its channel out of
 * sight) cannot say where to go on: the client starts again (CONFLICT_ERROR).
 */
@QueryHandler(ListMyDoneTasksQuery)
export class ListMyDoneTasksHandler extends ReadBoard implements IQueryHandler<ListMyDoneTasksQuery> {
    async execute({ userId, serverId, search, beforeId }: ListMyDoneTasksQuery): Promise<MyTaskList> {
        const channelIds = await myBoards(this.tasks, this.checker, userId, serverId, new Date())
        const page = await this.tasks.listMineDone(
            { userId, channelIds, search: searchWordsOf(search) },
            beforeId,
            DONE_PAGE_SIZE
        )
        if (page === 'stale') throw new StaleTaskCursorError(beforeId!)
        const items = await taskViews(this.viewSources, page.slice(0, DONE_PAGE_SIZE))
        return {
            items: items.map((task) => ({ ...task, group: null })),
            doneCount: null,
            dueCount: null,
            hasMore: page.length > DONE_PAGE_SIZE
        }
    }
}

export const MINE_QUERY_HANDLERS = [ListMyTasksHandler, ListMyDoneTasksHandler]
