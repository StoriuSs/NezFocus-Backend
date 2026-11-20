/** The study module's tunables, read once from config (src/config/study.config.ts). */
export interface StudySettings {
    /**
     * How long one "minute" of a session lasts, in milliseconds (D-221): the
     * phases, a Solo's 10 minutes of waiting, a room's 5 minutes empty, the 3
     * minutes away. 60000 but in the end-to-end tests and demos.
     */
    minuteMs: number
}

export const STUDY_SETTINGS = Symbol('StudySettings')
