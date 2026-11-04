/** Thrown when a task can't get a slot: the queue is full, or the wait timed out. */
export class ConcurrencyLimitError extends Error {
    constructor(readonly reason: 'queue-full' | 'wait-timeout') {
        super(reason === 'queue-full' ? 'Too many tasks waiting' : 'Timed out waiting for a free slot')
        this.name = 'ConcurrencyLimitError'
    }
}

export interface ConcurrencyLimiterOptions {
    /** Tasks running at the same time. */
    concurrency: number
    /** Tasks allowed to wait for a slot; beyond that, `run` rejects at once. */
    maxQueued: number
    /** How long a task may wait for a slot before `run` rejects. */
    maxWaitMs: number
}

/**
 * Runs at most `concurrency` tasks at a time, in arrival order, within this
 * process. Waiting is bounded in both length and time, so a burst is refused
 * quickly rather than piling up requests whose clients have already given up.
 */
export class ConcurrencyLimiter {
    private running = 0
    private readonly waiting: Array<() => void> = []

    constructor(private readonly options: ConcurrencyLimiterOptions) {
        if (!(options.concurrency >= 1)) throw new Error('concurrency must be at least 1')
    }

    get active(): number {
        return this.running
    }

    get queued(): number {
        return this.waiting.length
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire()
        try {
            return await task()
        } finally {
            this.release()
        }
    }

    private acquire(): Promise<void> {
        if (this.running < this.options.concurrency) {
            this.running++
            return Promise.resolve()
        }
        if (this.waiting.length >= this.options.maxQueued) {
            return Promise.reject(new ConcurrencyLimitError('queue-full'))
        }
        return new Promise((resolve, reject) => {
            const start = () => {
                clearTimeout(timer)
                resolve()
            }
            const timer = setTimeout(() => {
                const index = this.waiting.indexOf(start)
                if (index >= 0) this.waiting.splice(index, 1)
                reject(new ConcurrencyLimitError('wait-timeout'))
            }, this.options.maxWaitMs)
            this.waiting.push(start)
        })
    }

    private release(): void {
        const next = this.waiting.shift()
        // The slot passes straight to the next task, so `running` is unchanged.
        if (next) next()
        else this.running--
    }
}
