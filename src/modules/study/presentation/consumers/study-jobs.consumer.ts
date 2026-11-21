import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { EndFocusPhaseCommand } from '../../application'
import { EndFocusPhaseJob, STUDY_JOBS } from '../../infrastructure/adapters/study-jobs'

/**
 * Study Jobs Consumer: Inbound Adapter
 *
 * Runs the jobs the study module queues, each through its command: the end
 * of a session's phase at its time (ARCHITECTURE 5.1). A job that throws is
 * retried by the queue (DEFAULT_JOB_OPTIONS).
 */
@Processor(QUEUES.STUDY)
export class StudyJobsConsumer extends WorkerHost {
    private readonly logger = new Logger(StudyJobsConsumer.name)

    constructor(private readonly commandBus: CommandBus) {
        super()
    }

    async process(job: Job): Promise<void> {
        switch (job.name) {
            case STUDY_JOBS.END_PHASE: {
                const { sessionId, version } = job.data as EndFocusPhaseJob
                await this.commandBus.execute(new EndFocusPhaseCommand(sessionId, version))
                return
            }
            default:
                this.logger.warn(`Unknown study job "${job.name}" (${job.id}), ignored`)
        }
    }
}
