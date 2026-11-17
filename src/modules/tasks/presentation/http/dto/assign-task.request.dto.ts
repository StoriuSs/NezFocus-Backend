import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator'
import { MAX_ASSIGNEES_A_REQUEST } from './shared/fields'

/** POST /tasks/{id}/assignees: "Thêm người", or "Tôi làm" with one's own id (REQ-TASK-02). */
export class AssignTaskRequestDto {
    /** People already on it are skipped. */
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_ASSIGNEES_A_REQUEST)
    @IsUUID('all', { each: true })
    userIds: string[]
}
