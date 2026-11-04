import { Request } from 'express'
import { createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'

/** What the auth controllers share besides the cookies (auth-cookies.ts). */

export const clientIp = (req: Request) => req.ip ?? 'unknown'

/** Who is starting a session: kept on the session row. */
export const client = (req: Request) => ({ ip: clientIp(req), userAgent: req.get('user-agent') })

export const ok = <T>(data: T) => createResponse(MESSAGES.SUCCESS.OPERATION_SUCCESSFUL, data)

/** For 202 answers, which carry nothing but the message. */
export const accepted = (message: string) => createResponse(message, null)
