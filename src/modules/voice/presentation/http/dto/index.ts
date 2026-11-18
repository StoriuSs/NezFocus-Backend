/*
 * Request and response bodies for /voice, one class per file. The wire is
 * snake_case; the global pipe converts it, so properties are camelCase.
 * Property JSDoc is published in the API docs by the Swagger plugin. Each
 * class is named here, so a constant in a DTO file is never exported by
 * accident.
 */

// Requests
export { JoinVoiceRequestDto } from './join-voice.request.dto'

// Responses
export { VoiceTokenResponseDto } from './voice-token.response.dto'
