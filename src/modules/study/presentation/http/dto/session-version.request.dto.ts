import { IsInt, Min } from 'class-validator'

/**
 * POST /focus-sessions/{id}/pause|resume|skip|stop|continue (REQ-STUDY-03, STUDY-05): the
 * session's version the client saw. Another one by now (someone pressed
 * first, the phase moved) changes nothing, and the session comes back as it
 * is (D-225).
 */
export class SessionVersionRequestDto {
    @IsInt()
    @Min(0)
    version: number
}
