import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { InviteListItemResponseDto } from './invite-list-item.response.dto'

export class InviteListResponseDto {
    /** The links that still open, newest first. */
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => InviteListItemResponseDto)
    invites: InviteListItemResponseDto[]
}
