import { IsUUID } from 'class-validator'

export class TaskIdParamsDto {
    @IsUUID()
    taskId: string
}
