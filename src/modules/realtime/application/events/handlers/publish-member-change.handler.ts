import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { MemberChangedEvent } from '@/modules/servers'
import { EVENT_PUBLISHER, EventPublisherPort } from '../../ports'
import { RoomMoves } from '../../services/room-moves'

/**
 * Someone who joined a server, changed in it (a role, a timeout) or left it
 * (SRS 5.2, D-178). Their sockets are moved to the rooms they may be in now,
 * then the server hears `member.<action> {server_id, user_id}`: one who
 * joined is in its room by then, so their own tabs hear it too. One who left
 * hears `member.left` first, on their own tabs alone, with who removed them
 * and why (`removed_by`, `reason`: S-MOD-02), which the others never hear;
 * by the time the server hears it, they are out of its rooms.
 *
 * Not retried (adding-a-module.md › Events): sockets that could not be moved
 * keep their rooms until they connect again; the change is told all the same.
 */
@EventsHandler(MemberChangedEvent)
export class PublishMemberChangeHandler implements IEventHandler<MemberChangedEvent> {
    private readonly logger = new Logger(PublishMemberChangeHandler.name)

    constructor(
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        private readonly roomMoves: RoomMoves
    ) {}

    async handle({ serverId, userId, action, removedBy, reason }: MemberChangedEvent): Promise<void> {
        const news = { serverId, userId }
        if (action === 'left') this.publisher.toUser(userId, 'member.left', { ...news, removedBy, reason })
        try {
            await this.roomMoves.moveInto(serverId, [userId])
        } catch (error) {
            this.logger.warn(`Sockets of ${userId} in server ${serverId} not moved: ${(error as Error)?.message}`)
        }
        this.publisher.toServer(serverId, `member.${action}`, news)
    }
}
