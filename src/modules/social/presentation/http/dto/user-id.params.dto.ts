import { IsUUID } from 'class-validator'

export class UserIdParamsDto {
    @IsUUID()
    userId: string
}
