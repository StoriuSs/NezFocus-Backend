import { Expose } from 'class-transformer'
import { IsBoolean } from 'class-validator'
import { TaskPersonResponseDto } from './task-person.response.dto'

/** Who made a task (S-TASK-02 › Người tạo). */
export class TaskCreatorResponseDto extends TaskPersonResponseDto {
    /** No longer a member of the task's server: "(đã rời server)", no presence (D-194). */
    @Expose()
    @IsBoolean()
    leftServer: boolean
}
