import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { MaintenanceConsumer } from './maintenance.consumer'

/**
 * The periodic jobs of every module (maintenance-tasks.ts). App-level, beside
 * health/, because it is the one place that names other modules' commands:
 * the modules themselves never import each other's insides.
 */
@Module({
    imports: [CqrsModule, registerQueues(QUEUES.MAINTENANCE)],
    providers: [MaintenanceConsumer]
})
export class MaintenanceModule {}
