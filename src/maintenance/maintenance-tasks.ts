import { ConfigService } from '@nestjs/config'
import { ICommand } from '@nestjs/cqrs'
import { CleanUpAuthCommand } from '@/modules/auth'
import { SweepDeletedAccountsCommand } from '@/modules/users'

const MINUTE_MS = 60 * 1000

export interface MaintenanceTask {
    /**
     * The schedule's id in Redis, and the name of every job it adds. Renaming
     * one is removing a task and adding another: the old schedule is removed
     * at the next start (MaintenanceConsumer), and the new one starts its own.
     */
    id: string
    everyMs: number
    /** The command that does the work: the module that owns the data owns the job. */
    command: (now: Date, config: ConfigService) => ICommand
}

/**
 * Every periodic job in the app, in one list: what runs and how often. What
 * each one does is its module's command; this only says when.
 *
 * A module that needs one adds a line here, and exports its command from its
 * index.ts.
 */
export const MAINTENANCE_TASKS: MaintenanceTask[] = [
    {
        // Deletes the accounts whose 14 days are over: asked to be deleted,
        // or left incomplete (D-141).
        id: 'deleted-accounts-sweep',
        everyMs: 15 * MINUTE_MS,
        command: (now) => new SweepDeletedAccountsCommand(now)
    },
    {
        // Removes ended sessions and old codes, and finishes a deletion whose
        // event was lost.
        id: 'auth-clean-up',
        everyMs: 60 * MINUTE_MS,
        command: (now) => new CleanUpAuthCommand(now)
    }
]
