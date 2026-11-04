import { check } from 'k6'
import http from 'k6/http'
import { imageQueueFull, expect, postForm, sheddingIsFine } from './lib/api.js'

/**
 * Avatar uploads — the expensive route.
 *
 * Resizing an image is the one thing this API does that costs real CPU, and it
 * is deliberately capped: only IMAGE_PROCESSING_CONCURRENCY images are
 * converted at a time, a few more wait in a queue, and anything past that is
 * refused with 503 rather than queued forever or allowed to exhaust memory.
 *
 * This script climbs in four steps of thirty seconds, so you can watch where
 * that ceiling is on your hardware and decide whether it is in the right place.
 *
 *     k6 run k6/upload.js
 *     UPLOAD_PEAK_VUS=40 k6 run k6/upload.js
 *
 * **The peak has to be high enough to reach the cap.** Each virtual user waits
 * for its upload before sending the next, so the number of uploads in flight
 * never exceeds the number of virtual users. Nothing is refused until there
 * are more in flight than `IMAGE_PROCESSING_CONCURRENCY` plus
 * `IMAGE_PROCESSING_QUEUE_LIMIT` — twelve, with the shipped settings. The
 * default peak of twenty clears that; if you raise the queue limit, raise
 * `UPLOAD_PEAK_VUS` with it or the cap will never show up in the results.
 *
 * **It writes real files.** Every successful upload stores an avatar and
 * replaces the user's previous one. Run it against a throwaway environment,
 * and watch the disk if you raise the numbers a lot.
 *
 * What to look at afterwards:
 *
 * - `image_queue_full` — the share refused with 503. Zero at every step means
 *   the cap never engaged; climbing steadily means you found it.
 * - `http_req_failed` — must stay at zero. A 503 is the cap doing its job; a
 *   500 or a dropped connection is not.
 * - The container's memory, in Grafana or `docker stats`, while this runs.
 */

// k6 reads files once, at startup, before any virtual user starts — which is
// why this is out here and not inside the function.
const avatar = open('./fixtures/avatar.png', 'b')

const PEAK = Number(__ENV.UPLOAD_PEAK_VUS || 20)
const step = (fraction) => Math.max(1, Math.round(PEAK * fraction))

export const options = {
    stages: [
        { duration: '30s', target: step(0.1) },
        { duration: '30s', target: step(0.25) },
        { duration: '30s', target: step(0.5) },
        { duration: '30s', target: PEAK },
        { duration: '10s', target: 0 }
    ],
    thresholds: {
        // Refusing work is allowed; failing at it is not.
        http_req_failed: ['rate<0.01'],
        checks: ['rate>0.99']
    }
}

export default function () {
    const response = postForm(
        'users/me/avatar',
        'POST users/me/avatar',
        { avatar: http.file(avatar, 'avatar.png', 'image/png') },
        // 503 here is the image cap refusing work, not a failure.
        sheddingIsFine
    )

    // 200 processed, 429 rate-limited, 503 image queue full.
    expect(response, 'the server gave a valid answer', [200, 429, 503])
    imageQueueFull.add(response.status === 503)

    if (response.status === 200) {
        check(response, {
            'the stored avatar is reported back': (r) => typeof r.json('data.avatar_url') === 'string'
        })
    }
}
