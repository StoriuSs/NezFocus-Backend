import { Expose } from 'class-transformer'
import { IsIn, IsOptional, IsString } from 'class-validator'

/** Who made a link; no name once they have left or the account is deleted (S-SET-04). */
export class InviteCreatorResponseDto {
    @Expose()
    @IsIn(['member', 'left', 'deleted'])
    state: 'member' | 'left' | 'deleted'

    @Expose()
    @IsOptional()
    @IsString()
    displayName?: string | null

    @Expose()
    @IsOptional()
    @IsString()
    username?: string | null
}
