import { createHash, randomBytes } from 'crypto'
import { Inject, Injectable } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { TICKET_TTL_SECONDS, TicketsUnavailableError } from '@/modules/realtime/domain'
import { TicketHolder, TicketStorePort } from '@/modules/realtime/application/ports'

/**
 * Tickets in Redis, each under the hash of its value: one read from Redis
 * hands nobody a ticket they could spend, as refresh tokens are kept in auth.
 * GETDEL spends it in one step, so two sockets with the same ticket cannot
 * both get in.
 */
@Injectable()
export class RedisTicketStore implements TicketStorePort {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async issue(holder: TicketHolder): Promise<string> {
        const ticket = randomBytes(32).toString('base64url')
        const value = JSON.stringify({ userId: holder.userId, sessionId: holder.sessionId })
        await this.reach(() => this.redis.set(ticketKey(ticket), value, { EX: TICKET_TTL_SECONDS }))
        return ticket
    }

    async redeem(ticket: string): Promise<TicketHolder | null> {
        const value = await this.reach(() => this.redis.getDel(ticketKey(ticket)))
        if (!value) return null
        const { userId, sessionId } = JSON.parse(value) as TicketHolder
        return { userId, sessionId }
    }

    private async reach<T>(command: () => Promise<T>): Promise<T> {
        try {
            return await command()
        } catch {
            throw new TicketsUnavailableError()
        }
    }
}

const ticketKey = (ticket: string) => `realtime:ticket:${createHash('sha256').update(ticket).digest('hex')}`
