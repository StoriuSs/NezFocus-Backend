/*
 * Request and response bodies for tasks, one class per file. The wire is
 * snake_case; the global pipe converts it, so properties are camelCase.
 * Property JSDoc is published in the API docs by the Swagger plugin. Each
 * class is named here, so a constant in a DTO file is never exported by
 * accident.
 */

// Requests
export { AssignTaskRequestDto } from './assign-task.request.dto'
export { ChannelIdParamsDto } from './channel-id.params.dto'
export { CreateTaskRequestDto } from './create-task.request.dto'
export { TaskAssigneeParamsDto } from './task-assignee.params.dto'
export { TaskIdParamsDto } from './task-id.params.dto'
export { TaskListQueryDto } from './task-list.query.dto'
export { UpdateTaskRequestDto } from './update-task.request.dto'

// Responses
export { TaskAssigneeResponseDto } from './task-assignee.response.dto'
export { TaskEventResponseDto } from './task-event.response.dto'
export { TaskHistoryResponseDto } from './task-history.response.dto'
export { TaskListResponseDto } from './task-list.response.dto'
export { TaskPersonResponseDto } from './task-person.response.dto'
export { TaskResponseDto } from './task.response.dto'
