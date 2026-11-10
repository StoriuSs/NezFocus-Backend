import { Expose, Type } from 'class-transformer'
import { IsBoolean, ValidateNested } from 'class-validator'
import { ServerResponseDto } from './server.response.dto'

/** POST /invites/{code}/accept: the server as GET /servers lists it. */
export class AcceptInviteResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => ServerResponseDto)
    server: ServerResponseDto

    /** False: already a member; nothing changed and no use was counted. */
    @Expose()
    @IsBoolean()
    joined: boolean
}
