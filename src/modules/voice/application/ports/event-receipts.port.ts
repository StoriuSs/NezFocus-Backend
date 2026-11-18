/**
 * Event Receipts Port — the webhooks already taken, by id, for a day
 * (MEDIA_EVENT_MEMORY_SECONDS): the media server may send one again (D-210).
 *
 * Never throws: while the store cannot be reached every event counts as new.
 * The rules make most taken twice change nothing; a join taken again after
 * its leave puts back a person gone, until the reconciliation removes them
 * (within a few minutes).
 */
export interface EventReceiptsPort {
    /** True the first time `id` is seen; the next calls with it give false. */
    firstSight(id: string): Promise<boolean>

    /** Forget `id`, so the event sent again is taken: what it should have changed failed. */
    forget(id: string): Promise<void>
}

export const EVENT_RECEIPTS = Symbol('EventReceiptsPort')
