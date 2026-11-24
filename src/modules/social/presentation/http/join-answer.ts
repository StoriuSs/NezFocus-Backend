import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { validateAndTransform } from '@/shared/utils'
import { CallView, GetCallQuery, JoinCallCommand } from '../../application'
import { CallNotFoundError } from '../../domain'
import { JoinCallResponseDto } from './dto'

/**
 * The answer of `POST /calls/{id}/join` (D-246): the call as I see it, and a
 * token to its room exactly when that call is active. The call is read
 * first and the token asked only for an active one, so a call answered
 * between the two (a reload while it rang) answers `ringing` with no token,
 * as it was read, and its `call.updated` follows; one over between the read
 * and the token is read again, so an active call never comes without a
 * token. Not one of its two: not found.
 */
export async function joinAnswer(
    commandBus: CommandBus,
    queryBus: QueryBus,
    userId: string,
    callId: string,
    sessionId: string
): Promise<JoinCallResponseDto> {
    const read = () => queryBus.execute<GetCallQuery, CallView | null>(new GetCallQuery(userId, callId))
    let call = await read()
    if (!call) throw new CallNotFoundError(callId)
    let media: { token: string; url: string } | null = null
    if (call.status === 'active') {
        media = await commandBus.execute(new JoinCallCommand(userId, callId, sessionId))
        if (!media) call = (await read()) ?? call
    }
    return validateAndTransform(JoinCallResponseDto, { call, media })
}
