import { Expose, Type } from 'class-transformer'
import { IsString, ValidateNested } from 'class-validator'
import { ServerResponseDto } from './server.response.dto'

/** A category or channel just made, and the server as it now is for them. */
export class CreatedInServerResponseDto {
    /** The new category's or channel's id. */
    @Expose()
    @IsString()
    id: string

    @Expose()
    @ValidateNested()
    @Type(() => ServerResponseDto)
    server: ServerResponseDto
}
