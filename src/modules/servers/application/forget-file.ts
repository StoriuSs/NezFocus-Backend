import { Logger } from '@nestjs/common'
import { FileCleanupPort } from './ports'

const logger = new Logger('ServerIcons')

/**
 * Queue a file nothing points at any more for deletion. A failure is logged,
 * not passed on: the change it follows is already saved, and the file only
 * stays behind in storage.
 */
export async function forgetFile(cleanup: FileCleanupPort, key: string | null): Promise<void> {
    if (!key) return
    try {
        await cleanup.deleteFileLater(key)
    } catch (error) {
        logger.error(`Could not schedule deletion of replaced icon ${key}: ${(error as Error).message}`)
    }
}
