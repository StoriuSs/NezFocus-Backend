import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    AssignTaskCommand,
    DeleteTaskCommand,
    GetTaskQuery,
    ListTaskHistoryQuery,
    TaskHistory,
    TaskView,
    UnassignTaskCommand,
    UpdateTaskCommand
} from '../../application'
import {
    AssignTaskRequestDto,
    TaskAssigneeParamsDto,
    TaskHistoryResponseDto,
    TaskIdParamsDto,
    TaskResponseDto,
    UpdateTaskRequestDto
} from './dto'
import { dueAtOf } from './task-input'

/**
 * One task (SRS 5.1, REQ-TASK-01 to 03, S-TASK-02, S-TASK-03). A task in a
 * channel one may not view is NOT_FOUND (NFR-SEC-05); on a board that is
 * off, FORBIDDEN_ERROR with `reason: task_board_disabled`; someone timed out
 * changes nothing (MEMBER_TIMED_OUT, D-188). Every write answers with the
 * task as it now is, which the channel hears as `task.updated` (D-191).
 */
@ApiTags('tasks')
@ApiBearerAuth('bearer')
@Controller({ path: 'tasks/:taskId', version: '1' })
export class TasksController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** The task as it is now: a link to it (`?task=`), an inbox item, a reminder. */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TaskResponseDto)
    async get(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { taskId }: TaskIdParamsDto
    ): Promise<ServiceResponse<TaskResponseDto>> {
        const task: TaskView = await this.queryBus.execute(new GetTaskQuery(user.id, taskId))
        return createResponse(MESSAGES.TASKS.TASK_FETCHED, validateAndTransform(TaskResponseDto, task))
    }

    /**
     * Title, description and due date (the creator or MANAGE_TASKS), status
     * (also anyone on it). Only what really changes is checked; a new due
     * date already passed is INVALID_TASK_DUE_DATE (D-96).
     */
    @Patch()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TaskResponseDto)
    async update(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { taskId }: TaskIdParamsDto,
        @Body() dto: UpdateTaskRequestDto
    ): Promise<ServiceResponse<TaskResponseDto>> {
        const task: TaskView = await this.commandBus.execute(
            new UpdateTaskCommand(user.id, taskId, {
                title: dto.title,
                description: dto.description,
                dueAt: dueAtOf(dto.dueAt),
                status: dto.status
            })
        )
        return createResponse(MESSAGES.TASKS.TASK_UPDATED, validateAndTransform(TaskResponseDto, task))
    }

    /** Gone for everyone (the creator or MANAGE_TASKS), told as `task.deleted`. */
    @Delete()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async delete(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { taskId }: TaskIdParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DeleteTaskCommand(user.id, taskId))
        return createResponse(MESSAGES.TASKS.TASK_DELETED, null)
    }

    /**
     * "Thêm người", or "Tôi làm" with one's own id: oneself by anyone who
     * views the channel, others by the creator, anyone on it or
     * MANAGE_TASKS. Someone who cannot view the channel is
     * INVALID_TASK_ASSIGNEE.
     */
    @Post('assignees')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TaskResponseDto)
    async assign(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { taskId }: TaskIdParamsDto,
        @Body() dto: AssignTaskRequestDto
    ): Promise<ServiceResponse<TaskResponseDto>> {
        const task: TaskView = await this.commandBus.execute(new AssignTaskCommand(user.id, taskId, dto.userIds))
        return createResponse(MESSAGES.TASKS.TASK_ASSIGNED, validateAndTransform(TaskResponseDto, task))
    }

    /** "Rút khỏi việc này" with one's own id; another, by the creator or MANAGE_TASKS. */
    @Delete('assignees/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TaskResponseDto)
    async unassign(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { taskId, userId }: TaskAssigneeParamsDto
    ): Promise<ServiceResponse<TaskResponseDto>> {
        const task: TaskView = await this.commandBus.execute(new UnassignTaskCommand(user.id, taskId, userId))
        return createResponse(MESSAGES.TASKS.TASK_UNASSIGNED, validateAndTransform(TaskResponseDto, task))
    }

    /** Its history, newest first: the latest 200 lines and how many there are (REQ-TASK-03). */
    @Get('history')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TaskHistoryResponseDto)
    async history(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { taskId }: TaskIdParamsDto
    ): Promise<ServiceResponse<TaskHistoryResponseDto>> {
        const history: TaskHistory = await this.queryBus.execute(new ListTaskHistoryQuery(user.id, taskId))
        return createResponse(MESSAGES.TASKS.HISTORY_LISTED, validateAndTransform(TaskHistoryResponseDto, history))
    }
}
