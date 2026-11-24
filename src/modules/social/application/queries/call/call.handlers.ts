import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { CALL_REPOSITORY, CallRepositoryPort } from '../../../domain'
import { CallView, callViews, MyCallsView, myCallsView } from '../../services/call-views'
import { GetCallQuery, GetMyCallQuery } from './call.queries'

/** One call of mine, open or over, with the other one as I see them; null for none, or one of two others. */
@QueryHandler(GetCallQuery)
export class GetCallHandler implements IQueryHandler<GetCallQuery> {
    constructor(
        @Inject(CALL_REPOSITORY) private readonly calls: CallRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async execute({ userId, callId }: GetCallQuery): Promise<CallView | null> {
        const call = await this.calls.find(callId)
        if (!call || (call.callerId !== userId && call.calleeId !== userId)) return null
        const [view] = await callViews(this.users, userId, [call])
        return view!
    }
}

/**
 * My open calls (D-245), as the app reads them on opening or reloading
 * (not in `ready`, as D-220): the one I make or am in (the call page, the
 * `call` dock), and up to two ringing to me (the cards), oldest first.
 */
@QueryHandler(GetMyCallQuery)
export class GetMyCallHandler implements IQueryHandler<GetMyCallQuery> {
    constructor(
        @Inject(CALL_REPOSITORY) private readonly calls: CallRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async execute({ userId }: GetMyCallQuery): Promise<MyCallsView> {
        return myCallsView(this.users, userId, await this.calls.openOf(userId))
    }
}

export const CALL_QUERY_HANDLERS = [GetCallHandler, GetMyCallHandler]
