import { Logger } from '@nestjs/common'

/**
 * Run the steps that follow a change already committed — dropping cached
 * copies, queueing the email that tells the owner — so that one failing is
 * logged rather than answered as a failure. The change has happened either
 * way: a 500 would only have the page say it did not, and its next try be
 * refused for what the first one did (Kiểm 2 review). Each step runs even if
 * an earlier one failed.
 *
 * The rule, for every handler: once the change is written, a step whose
 * failure a retry could not repair goes here (emails, dropping cached
 * sessions, resetting a limit). Reset, change password, complete, delete,
 * restore, sign out the other devices, and linking Google all follow it.
 * Revoking one session keeps its cache step on the main path: sending the
 * request again repeats that step, so a failure is worth answering.
 */
export async function afterCommit(logger: Logger, what: string, steps: (() => Promise<unknown>)[]): Promise<void> {
    for (const step of steps) {
        try {
            await step()
        } catch (error) {
            logger.error(`${what}: a step after the change failed: ${(error as Error)?.message}`)
        }
    }
}
