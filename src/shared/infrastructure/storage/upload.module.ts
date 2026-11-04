import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { QUEUES, registerQueues } from '../queue/queues'
import { FileCleanupConsumer } from './file-cleanup.consumer'
import { UploadService } from './upload.service'
import { LocalStorageService } from './services/local-storage.service'
import { S3StorageService } from './services/s3-storage.service'
import { ImageProcessingService } from './services/image-processing.service'
import { STORAGE_SERVICE } from './interfaces/storage.interface'

@Module({
    imports: [ConfigModule, registerQueues(QUEUES.FILE_CLEANUP)],
    providers: [
        {
            provide: STORAGE_SERVICE,
            useFactory: (configService: ConfigService) => {
                const storageType = configService.get<string>('upload.storageType') || 'local'

                if (storageType === 's3') {
                    return new S3StorageService(configService)
                }

                return new LocalStorageService(configService)
            },
            inject: [ConfigService]
        },
        ImageProcessingService,
        UploadService,
        // The single consumer of the file-cleanup queue, for every module
        FileCleanupConsumer
    ],
    exports: [UploadService, ImageProcessingService]
})
export class UploadModule {}
