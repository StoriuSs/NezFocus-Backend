/*
 * Request and response bodies for study sessions, one class per file. The
 * wire is snake_case; the global pipe converts it, so properties are
 * camelCase. Property JSDoc is published in the API docs by the Swagger
 * plugin.
 */

// Requests
export { ChangeCycleRequestDto } from './change-cycle.request.dto'
export { ChannelIdParamsDto } from './channel-id.params.dto'
export { FocusSessionIdParamsDto } from './focus-session-id.params.dto'
export { SessionVersionRequestDto } from './session-version.request.dto'
export { StartRoomSessionRequestDto } from './start-room-session.request.dto'
export { StartSoloSessionRequestDto } from './start-solo-session.request.dto'
export { StudyPeriodQueryDto } from './study-period.query.dto'
export { StudySessionsQueryDto } from './study-sessions.query.dto'

// Responses
export { FocusSessionResponseDto } from './focus-session.response.dto'
export { NextHostPersonResponseDto } from './next-host-person.response.dto'
export { NextHostResponseDto } from './next-host.response.dto'
export { SoloSessionResponseDto } from './solo-session.response.dto'
export { StudyCycleResponseDto } from './study-cycle.response.dto'
export { StudyDayResponseDto } from './study-day.response.dto'
export { StudyGridDayResponseDto } from './study-grid-day.response.dto'
export { StudyPeriodResponseDto } from './study-period.response.dto'
export { StudySessionLineResponseDto } from './study-session-line.response.dto'
export { StudySessionPageResponseDto } from './study-session-page.response.dto'
export { StudyStatsResponseDto } from './study-stats.response.dto'
export { StudyStreakResponseDto } from './study-streak.response.dto'
