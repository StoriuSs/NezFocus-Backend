/*
 * Request and response bodies for friends, blocks, DMs and calls, one class per file.
 * The wire is snake_case; the global pipe converts it, so properties are
 * camelCase. Property JSDoc is published in the API docs by the Swagger
 * plugin.
 */

// Requests
export { CallIdParamsDto } from './call-id.params.dto'
export { DmIdParamsDto } from './dm-id.params.dto'
export { LookUpPersonQueryDto } from './look-up-person.query.dto'
export { OpenDmRequestDto } from './open-dm.request.dto'
export { SendFriendRequestRequestDto } from './send-friend-request.request.dto'
export { StartCallRequestDto } from './start-call.request.dto'
export { UserIdParamsDto } from './user-id.params.dto'

// Responses
export { ActivityResponseDto } from './activity.response.dto'
export { CallMediaResponseDto } from './call-media.response.dto'
export { CallResponseDto } from './call.response.dto'
export { DmLastMessageResponseDto } from './dm-last-message.response.dto'
export { DmListResponseDto } from './dm-list.response.dto'
export { DmMentionedUserResponseDto } from './dm-mentioned-user.response.dto'
export { DmMessageFilesResponseDto } from './dm-message-files.response.dto'
export { DmResponseDto } from './dm.response.dto'
export { JoinCallResponseDto } from './join-call.response.dto'
export { MutualServerResponseDto } from './mutual-server.response.dto'
export { MyCallResponseDto } from './my-call.response.dto'
export { PersonProfileResponseDto } from './person-profile.response.dto'
export { RelationshipListResponseDto } from './relationship-list.response.dto'
export { RelationshipResponseDto } from './relationship.response.dto'
export { SocialPersonResponseDto } from './social-person.response.dto'
export { SoloActivityResponseDto } from './solo-activity.response.dto'
