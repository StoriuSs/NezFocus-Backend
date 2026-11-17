import { Expose } from 'class-transformer'
import { IsBoolean, IsDate } from 'class-validator'
import { TaskPersonResponseDto } from './task-person.response.dto'

/** Someone on a task, and since when (S-TASK-02 lists them in that order, oneself first). */
export class TaskAssigneeResponseDto extends TaskPersonResponseDto {
    @Expose()
    @IsDate()
    assignedAt: Date

    /** False: still on the task but no longer views its channel ("Mất quyền xem kênh", D-194). */
    @Expose()
    @IsBoolean()
    viewsChannel: boolean
}
