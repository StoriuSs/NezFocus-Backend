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
export { PinParamsDto } from './pin.params.dto'
export { ReactionParamsDto } from './reaction.params.dto'
export { SendMessageRequestDto } from './send-message.request.dto'

// Responses
export { MentionedRoleResponseDto } from './mentioned-role.response.dto'
export { MentionedUserResponseDto } from './mentioned-user.response.dto'
export { MessageAuthorResponseDto } from './message-author.response.dto'
export { MessagePageResponseDto } from './message-page.response.dto'
export { MessageResponseDto } from './message.response.dto'
export { PinListResponseDto } from './pin-list.response.dto'
export { PinnedMessageResponseDto } from './pinned-message.response.dto'
export { ReactionSummaryResponseDto } from './reaction-summary.response.dto'
export { ReactorResponseDto } from './reactor.response.dto'
export { ReactorsResponseDto } from './reactors.response.dto'
export { ReadMessageResponseDto } from './read-message.response.dto'
export { RepliedMessageResponseDto } from './replied-message.response.dto'
