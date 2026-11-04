import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { AvatarUploadedEvent } from '../avatar-uploaded.event'
import { BackgroundJobsPort, BACKGROUND_JOBS } from '../../ports'

/**
 * Event Handler: Cleanup Old Avatar
 *
 * Reacts to AvatarUploaded events by scheduling the replaced file's deletion.
 */
@EventsHandler(AvatarUploadedEvent)
export class CleanupOldAvatarHandler implements IEventHandler<AvatarUploadedEvent> {
    private readonly logger = new Logger(CleanupOldAvatarHandler.name)

    constructor(@Inject(BACKGROUND_JOBS) private readonly jobs: BackgroundJobsPort) {}

    async handle(event: AvatarUploadedEvent): Promise<void> {
        try {
            await this.jobs.deleteFileLater(event.previousAvatarUrl)
        } catch (error) {
            // Nothing references the file any more; it stays orphaned in storage.
            this.logger.error(
                `Failed to schedule deletion of replaced avatar ${event.previousAvatarUrl}: ${(error as Error).message}`
            )
        }
    }
}
