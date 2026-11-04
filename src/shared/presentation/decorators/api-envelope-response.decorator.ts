import { applyDecorators, HttpStatus, Type } from '@nestjs/common'
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, ApiResponse, getSchemaPath } from '@nestjs/swagger'

/**
 * The `meta` block of a success (TransformInterceptor builds it). An error's
 * also has `code` and `type`; a success needs neither, as the route and the
 * status already say what happened.
 */
export class ApiResponseMetaDto {
    @ApiProperty({ example: 'Operation completed successfully' })
    message: string

    @ApiProperty({ format: 'date-time' })
    timestamp: string

    @ApiPropertyOptional({ format: 'uuid' })
    requestId?: string

    @ApiPropertyOptional({ description: 'Milliseconds' })
    requestDuration?: number
}

/**
 * Documents a success response as the API actually sends it:
 * `{ meta, data: <model> }`. Without this the spec described no responses, so
 * clients generated from it had no types for what they receive.
 *
 * @param model the DTO in `data`, or null when `data` is null
 */
export const ApiEnvelopeResponse = (model: Type<unknown> | null, status: HttpStatus = HttpStatus.OK) =>
    applyDecorators(
        ApiExtraModels(ApiResponseMetaDto, ...(model ? [model] : [])),
        ApiResponse({
            status,
            schema: {
                type: 'object',
                required: ['meta', 'data'],
                properties: {
                    meta: { $ref: getSchemaPath(ApiResponseMetaDto) },
                    data: model ? { $ref: getSchemaPath(model) } : { type: 'null' }
                }
            }
        })
    )
