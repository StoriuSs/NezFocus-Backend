/*
 * Request and response bodies for messages, one class per file. The wire is
 * snake_case; the global pipe converts it, so properties are camelCase.
 * Property JSDoc is published in the API docs by the Swagger plugin. Each
 * class is named here, so a constant in a DTO file is never exported by
 * accident.
 */

// Requests
export { ChannelIdParamsDto } from './channel-id.params.dto'
export { EditMessageRequestDto } from './edit-message.request.dto'
export { MessageIdParamsDto } from './message-id.params.dto'
export { MessageHistoryQueryDto } from './message-history.query.dto'
export { SendMessageRequestDto } from './send-message.request.dto'

// Responses
export { MessageAuthorResponseDto } from './message-author.response.dto'
export { MessagePageResponseDto } from './message-page.response.dto'
export { MessageResponseDto } from './message.response.dto'
export { RepliedMessageResponseDto } from './replied-message.response.dto'
