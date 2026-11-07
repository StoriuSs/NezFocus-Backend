import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { AvatarUploadedEvent } from '../avatar-uploaded.event'
import { AvatarRemovedEvent } from '../avatar-removed.event'
import { BackgroundJobsPort, BACKGROUND_JOBS } from '../../ports'

/**
 * Event Handler: Cleanup Old Avatar
 *
 * Reacts to AvatarUploaded and AvatarRemoved events by scheduling the
 * deletion of the file no longer referenced.
 */
@EventsHandler(AvatarUploadedEvent, AvatarRemovedEvent)
export class CleanupOldAvatarHandler implements IEventHandler<AvatarUploadedEvent | AvatarRemovedEvent> {
    private readonly logger = new Logger(CleanupOldAvatarHandler.name)

    constructor(@Inject(BACKGROUND_JOBS) private readonly jobs: BackgroundJobsPort) {}

    async handle(event: AvatarUploadedEvent | AvatarRemovedEvent): Promise<void> {
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
