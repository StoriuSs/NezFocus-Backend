import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, Public, SkipRateLimit, SkipTimeout } from '@/shared/presentation/decorators'
import { ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { ApplyMediaEventCommand } from '../../application'

/**
 * LiveKit's webhooks (D-210): who joins and leaves each room. Called by
 * LiveKit, never by a browser: public, with no access token, but every call
 * is signed (Authorization, checked by MEDIA_EVENTS; anything else 401).
 *
 * The body arrives as text, exactly as sent: LiveKit posts
 * `application/webhook+json`, which configure-app.ts reads as a string, so
 * the sha256 in the signature can be checked against it. Out of the
 * general rate limit (every room's joins and leaves come from LiveKit's few
 * addresses) and of the request timeout: an answer other than 2xx makes
 * LiveKit send the event again, and the work is safe to repeat.
 */
@ApiTags('voice')
@Controller({ path: 'voice', version: '1' })
export class LiveKitWebhookController {
    constructor(private readonly commandBus: CommandBus) {}

    @Public()
    @SkipRateLimit()
    @SkipTimeout()
    @Post('livekit-webhook')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async receive(
        @Body() body: unknown,
        @Headers('authorization') authorization: string | undefined
    ): Promise<ServiceResponse<null>> {
        // Any other content type was parsed into an object, or not at all: no signature can match it.
        await this.commandBus.execute(new ApplyMediaEventCommand(typeof body === 'string' ? body : '', authorization))
        return createResponse(MESSAGES.VOICE.EVENT_RECEIVED, null)
    }
}
