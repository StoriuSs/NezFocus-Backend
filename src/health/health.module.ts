import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'
import { HealthController, PrismaHealthIndicator, RedisHealthIndicator } from './health.controller'
import { ThrottlerHealthIndicator } from './throttler.health'

@Module({
    // logger: false. Terminus logged every failed check itself, with no
    // context, on top of the exception filter's line for the same 503. The
    // filter's line carries the per-dependency result now.
    imports: [TerminusModule.forRoot({ logger: false })],
    controllers: [HealthController],
    providers: [PrismaHealthIndicator, RedisHealthIndicator, ThrottlerHealthIndicator]
})
export class HealthModule {}
