import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

export class CreatedRoleResponseDto {
    @Expose()
    @IsString()
    roleId: string
}
