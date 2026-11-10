import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { SessionResponseDto } from './session.response.dto'

/** The live sessions: this device first, then by latest use (D-75). */
export class SessionListResponseDto {
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => SessionResponseDto)
    sessions: SessionResponseDto[]
}
