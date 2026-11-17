import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { DONE_PAGE_SIZE, foldForSearch, HISTORY_PAGE_SIZE, StaleTaskCursorError, TaskFilter } from '../../../domain'
import { openBoard, openTask } from '../../services/board-access'
import { ReadBoard } from '../../services/read-board'
import { TaskEventView, taskEventViews, TaskView, taskView, taskViews } from '../../services/task-views'
import { GetTaskQuery, ListBoardTasksQuery, ListDoneTasksQuery, ListTaskHistoryQuery } from './task.queries'

/**
 * A board's tasks as `GET /channels/{id}/tasks` gives them: the tasks not
 * done with how many are done (`hasMore` false), or a page of done ones
 * (`doneCount` null).
 */
export interface TaskList {
    items: TaskView[]
    doneCount: number | null
    hasMore: boolean
}

/** A task's history, newest first, and how many lines it has. */
export interface TaskHistory {
    items: TaskEventView[]
    total: number
}

/** The words searched for, folded as titles are; nothing left of them is no search. */
const searchOf = (channelId: string, search: string | null): TaskFilter => {
    const folded = search === null ? '' : foldForSearch(search)
    return { channelId, search: folded === '' ? null : folded }
}

/**
 * The tasks not done, by due date, none last, then the order they were made
 * in (S-TASK-01), and the count behind "XONG — n" (D-186). At most 500.
 */
@QueryHandler(ListBoardTasksQuery)
export class ListBoardTasksHandler extends ReadBoard implements IQueryHandler<ListBoardTasksQuery> {
    async execute({ userId, channelId, search }: ListBoardTasksQuery): Promise<TaskList> {
        await openBoard(this.sources, channelId, userId, new Date())
        const filter = searchOf(channelId, search)
        const [open, doneCount] = await Promise.all([this.tasks.listOpen(filter), this.tasks.countDone(filter)])
        return { items: await taskViews(this.viewSources, open), doneCount, hasMore: false }
    }
}

/**
 * The done tasks, the latest done first, 50 a page (D-97). The page starts
 * after a task the client holds: one reopened or deleted since cannot say
 * where, so the client starts the group again (CONFLICT_ERROR).
 */
@QueryHandler(ListDoneTasksQuery)
export class ListDoneTasksHandler extends ReadBoard implements IQueryHandler<ListDoneTasksQuery> {
    async execute({ userId, channelId, search, beforeId }: ListDoneTasksQuery): Promise<TaskList> {
        await openBoard(this.sources, channelId, userId, new Date())
        const page = await this.tasks.listDone(searchOf(channelId, search), beforeId, DONE_PAGE_SIZE)
        if (page === 'stale') throw new StaleTaskCursorError(beforeId!)
        return {
            items: await taskViews(this.viewSources, page.slice(0, DONE_PAGE_SIZE)),
            doneCount: null,
            hasMore: page.length > DONE_PAGE_SIZE
        }
    }
}

@QueryHandler(GetTaskQuery)
export class GetTaskHandler extends ReadBoard implements IQueryHandler<GetTaskQuery> {
    async execute({ userId, taskId }: GetTaskQuery): Promise<TaskView> {
        const { task } = await openTask(this.tasks, this.sources, taskId, userId, new Date())
        return taskView(this.viewSources, task)
    }
}

/** The newest 200 lines, and how many there are (the "Xem toàn bộ lịch sử (n)" button, S-TASK-02). */
@QueryHandler(ListTaskHistoryQuery)
export class ListTaskHistoryHandler extends ReadBoard implements IQueryHandler<ListTaskHistoryQuery> {
    async execute({ userId, taskId }: ListTaskHistoryQuery): Promise<TaskHistory> {
        await openTask(this.tasks, this.sources, taskId, userId, new Date())
        const { items, total } = await this.tasks.history(taskId, HISTORY_PAGE_SIZE)
        return { items: await taskEventViews(this.users, items), total }
    }
}

export const TASK_QUERY_HANDLERS = [ListBoardTasksHandler, ListDoneTasksHandler, GetTaskHandler, ListTaskHistoryHandler]
