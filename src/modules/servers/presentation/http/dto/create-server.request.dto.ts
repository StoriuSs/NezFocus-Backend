import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsIn, ValidateBy } from 'class-validator'
import {
    isServerName,
    normaliseServerName,
    SERVER_NAME_MAX_LENGTH,
    SERVER_NAME_MIN_LENGTH,
    SERVER_TEMPLATES,
    ServerTemplateName
} from '../../../domain'

/** POST /servers (S-SRV-01, REQ-SRV-01). The icon follows in a second request, once there is a server to keep it. */
export class CreateServerRequestDto {
    /** 2–100 characters, counted after composing and trimming. */
    @ApiProperty({ minLength: SERVER_NAME_MIN_LENGTH, maxLength: SERVER_NAME_MAX_LENGTH })
    @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normaliseServerName(value) : value))
    @ValidateBy({
        name: 'isServerName',
        validator: {
            validate: (value: unknown) => typeof value === 'string' && isServerName(value),
            defaultMessage: () =>
                `name must be ${SERVER_NAME_MIN_LENGTH}-${SERVER_NAME_MAX_LENGTH} characters, at least one of them visible, on one line`
        }
    })
    name: string

    /** Study Server or a plain one: only the channels it starts with differ. */
    @ApiProperty({ enum: SERVER_TEMPLATES })
    @IsIn(SERVER_TEMPLATES)
    template: ServerTemplateName
}
