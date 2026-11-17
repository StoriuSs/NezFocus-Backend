import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { ListMyDoneTasksQuery, ListMyTasksQuery, MyTaskList } from '../../application'
import { MyTaskListQueryDto, MyTaskListResponseDto } from './dto'

/**
 * The To-do page (SRS 5.1, REQ-TASK-05, S-TASK-04): the tasks given to the
 * reader and those they made and gave no one, from every channel they still
 * view with its Task Board on.
 */
@ApiTags('tasks')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class MyTasksController {
    constructor(private readonly queryBus: QueryBus) {}

    /**
     * Every task not done, each with its `group` by due date in the time zone
     * of one's settings, with how many are done and how many are overdue or
     * due today (D-186); `status=done`: 50 done tasks, the latest done first,
     * after `before` (a task no longer among them is CONFLICT_ERROR: start
     * again). `server` keeps one server's, `q` searches titles whatever the
     * accents and case (D-97).
     */
    @Get('me/tasks')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(MyTaskListResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Query() { server, q, status, before }: MyTaskListQueryDto
    ): Promise<ServiceResponse<MyTaskListResponseDto>> {
        const list: MyTaskList = await this.queryBus.execute(
            status === 'done'
                ? new ListMyDoneTasksQuery(user.id, server ?? null, q ?? null, before ?? null)
                : new ListMyTasksQuery(user.id, server ?? null, q ?? null)
        )
        return createResponse(MESSAGES.TASKS.TASKS_LISTED, validateAndTransform(MyTaskListResponseDto, list))
    }
}
