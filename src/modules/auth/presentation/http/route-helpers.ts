import { Request } from 'express'
import { createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'

/** What the auth controllers share besides the cookies (auth-cookies.ts). */

export const clientIp = (req: Request) => req.ip ?? 'unknown'

/** Longer than any browser sends; the header itself can be kilobytes. */
const USER_AGENT_MAX_LENGTH = 512

/** Who is using a session: kept on its row at sign-in and at each refresh (D-138). */
export const client = (req: Request) => ({
    ip: clientIp(req),
    userAgent: req.get('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH)
})

export const ok = <T>(data: T) => createResponse(MESSAGES.SUCCESS.OPERATION_SUCCESSFUL, data)

/** For 202 answers, which carry nothing but the message. */
export const accepted = (message: string) => createResponse(message, null)
