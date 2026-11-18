import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES, jobIdFor } from '@/shared/infrastructure/queue/queues'
import { REMINDER_MARKS, ReminderAt, ReminderMark } from '../../domain'
import { TaskJobsPort } from '../../application/ports'
import { SendTaskReminderJob, TASKS_JOBS, TasksJob } from './tasks-jobs'

/** A reminder's job, named by the task, the mark and the due date (ARCHITECTURE 7): a new due date is a new job. */
const reminderJobId = (taskId: string, mark: ReminderMark, dueAt: Date) =>
    jobIdFor('task', `${taskId}-${mark}-${dueAt.getTime()}`)

/**
 * Jobs named by what they act on, so queueing one twice is one job; retried
 * by the queue's defaults. A leave is named by where, who and when; a
 * reminder waits in the queue until its time (`delay`), in Redis, so a
 * restart keeps it (NFR-REL-02).
 */
@Injectable()
export class BullMqTaskJobs implements TaskJobsPort {
    constructor(@InjectQueue(QUEUES.TASKS) private readonly queue: Queue<TasksJob>) {}

    async unassignLeftMemberLater(serverId: string, userId: string, leftAt: Date): Promise<void> {
        await this.queue.add(
            TASKS_JOBS.UNASSIGN_LEFT_MEMBER,
            { serverId, userId },
            { jobId: jobIdFor('unassign-left-member', `${serverId}-${userId}-${leftAt.getTime()}`) }
        )
    }

    async remindLater(taskId: string, dueAt: Date, reminders: ReminderAt[]): Promise<void> {
        if (reminders.length === 0) return
        const now = Date.now()
        await this.queue.addBulk(
            reminders.map(({ mark, at }) => ({
                name: TASKS_JOBS.SEND_REMINDER,
                data: { taskId, mark, dueAt: dueAt.toISOString() } satisfies SendTaskReminderJob,
                opts: { jobId: reminderJobId(taskId, mark, dueAt), delay: Math.max(0, at.getTime() - now) }
            }))
        )
    }

    async cancelReminders(taskId: string, dueAt: Date): Promise<void> {
        // A job running now is locked and stays: it reads the task again and does nothing.
        await Promise.all(REMINDER_MARKS.map(({ mark }) => this.queue.remove(reminderJobId(taskId, mark, dueAt))))
    }
}
