import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { InviteCreatorResponseDto } from './invite-creator.response.dto'
import { InviteResponseDto } from './invite.response.dto'

export class InviteListItemResponseDto extends InviteResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => InviteCreatorResponseDto)
    creator: InviteCreatorResponseDto
}
