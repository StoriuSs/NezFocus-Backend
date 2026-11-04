import { DiscoveryService } from '@nestjs/core'
import { WorkerHost } from '@nestjs/bullmq'
import { Queue, Worker } from 'bullmq'

/**
 * Every BullMQ Queue instance in the app.
 *
 * Found among the providers rather than looked up by name: a queue that two
 * modules register (file-cleanup: the users and the upload module) is two
 * instances, each with its own Redis connection, and looking it up by name
 * finds only one of them.
 */
export function findQueueInstances(discovery: DiscoveryService): Queue[] {
    return discovery
        .getProviders()
        .map((wrapper) => wrapper.instance as unknown)
        .filter((instance): instance is Queue => instance instanceof Queue)
}

/**
 * The worker of every processor (WorkerHost). @nestjs/bullmq creates them in
 * its own onModuleInit, so call this from onApplicationBootstrap.
 */
export function findWorkers(discovery: DiscoveryService): Worker[] {
    const workers: Worker[] = []
    for (const wrapper of discovery.getProviders()) {
        if (!(wrapper.instance instanceof WorkerHost)) continue
        try {
            workers.push(wrapper.instance.worker)
        } catch {
            // A processor registered manually and not started: it has no worker.
        }
    }
    return workers
}
