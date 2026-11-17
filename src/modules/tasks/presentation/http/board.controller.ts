import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { CreateTaskCommand, ListBoardTasksQuery, ListDoneTasksQuery, TaskList, TaskView } from '../../application'
import { ChannelIdParamsDto, CreateTaskRequestDto, TaskListQueryDto, TaskListResponseDto, TaskResponseDto } from './dto'
import { dueAtOf } from './task-input'

/**
 * A text channel's Task Board (SRS 5.1, REQ-TASK-01, S-TASK-01, S-TASK-03).
 * A channel one may not view is NOT_FOUND (NFR-SEC-05); a board that is off
 * is FORBIDDEN_ERROR with `reason: task_board_disabled`.
 */
@ApiTags('tasks')
@ApiBearerAuth('bearer')
@Controller({ path: 'channels/:channelId/tasks', version: '1' })
export class BoardController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * Every task not done, and how many are done (D-186); `status=done`: 50
     * done tasks, the latest done first, after `before` (a task no longer
     * done there is CONFLICT_ERROR: start again). `q` searches titles,
     * whatever the accents and case (D-97).
     */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TaskListResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto,
        @Query() { q, status, before }: TaskListQueryDto
    ): Promise<ServiceResponse<TaskListResponseDto>> {
        const list: TaskList = await this.queryBus.execute(
            status === 'done'
                ? new ListDoneTasksQuery(user.id, channelId, q ?? null, before ?? null)
                : new ListBoardTasksQuery(user.id, channelId, q ?? null)
        )
        return createResponse(MESSAGES.TASKS.TASKS_LISTED, validateAndTransform(TaskListResponseDto, list))
    }

    /**
     * A new task (CREATE_TASKS), told to the channel as `task.created`. A due
     * date already passed is INVALID_TASK_DUE_DATE, someone who cannot view
     * the channel INVALID_TASK_ASSIGNEE, a 501st task not done
     * MAX_OPEN_TASKS_REACHED.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(TaskResponseDto, HttpStatus.CREATED)
    @Idempotent()
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto,
        @Body() dto: CreateTaskRequestDto
    ): Promise<ServiceResponse<TaskResponseDto>> {
        const task: TaskView = await this.commandBus.execute(
            new CreateTaskCommand(user.id, channelId, {
                title: dto.title,
                description: dto.description ?? '',
                dueAt: dueAtOf(dto.dueAt) ?? null,
                assigneeIds: dto.assigneeIds ?? []
            })
        )
        return createResponse(MESSAGES.TASKS.TASK_CREATED, validateAndTransform(TaskResponseDto, task))
    }
}
