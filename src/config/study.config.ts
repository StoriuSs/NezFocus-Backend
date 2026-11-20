import { registerAs } from '@nestjs/config'

/**
 * Study sessions (ARCHITECTURE 5). Validated in validation.ts; see
 * docs/environment.md, "Study sessions".
 */
export default registerAs('study', () => ({
    /**
     * How long one "minute" of the study module lasts, in milliseconds: the
     * phases, a Solo's 10 minutes of waiting, a room's 5 minutes empty, the 3
     * minutes away (D-221). 60000 everywhere but the end-to-end tests and
     * demos, which shorten it; production takes nothing else. Seconds studied
     * are still counted in real time.
     *
     * Read as Joi's number() reads it, not with parseInt: "6e4" passes the
     * production check as 60000, and parseInt would make it 6.
     */
    minuteMs: readNumber(process.env.STUDY_MINUTE_MS, 60_000)
}))

function readNumber(value: string | undefined, fallback: number): number {
    const text = value?.trim()
    return text ? Number(text) : fallback
}
