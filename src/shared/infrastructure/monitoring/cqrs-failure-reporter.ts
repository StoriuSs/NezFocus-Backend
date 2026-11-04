import { Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { CqrsModule, UnhandledExceptionBus } from '@nestjs/cqrs'
import type { Subscription } from 'rxjs'
import { reportError } from './error-reporting'

/**
 * Sends a failed CQRS event handler (or saga command) to error tracking.
 *
 * The event bus catches the error so the other handlers keep running, logs
 * it, and publishes it on the UnhandledExceptionBus; nothing else sees it. The
 * account-deleted handlers (avatar cleanup, identity deletion) run this way,
 * after the request has already answered 200.
 */
@Injectable()
export class CqrsFailureReporter implements OnModuleInit, OnModuleDestroy {
    private subscription?: Subscription

    constructor(private readonly unhandledExceptions: UnhandledExceptionBus) {}

    onModuleInit() {
        this.subscription = this.unhandledExceptions.subscribe(({ exception, cause }) => {
            const causeName = (cause as object | undefined)?.constructor?.name
            reportError(exception, { tags: { cqrs_cause: causeName } })
        })
    }

    onModuleDestroy() {
        this.subscription?.unsubscribe()
    }
}

@Module({
    imports: [CqrsModule],
    providers: [CqrsFailureReporter]
})
export class CqrsObservabilityModule {}
