/*
 * Request and response bodies for friends and blocks, one class per file.
 * The wire is snake_case; the global pipe converts it, so properties are
 * camelCase. Property JSDoc is published in the API docs by the Swagger
 * plugin.
 */

// Requests
export { LookUpPersonQueryDto } from './look-up-person.query.dto'
export { SendFriendRequestRequestDto } from './send-friend-request.request.dto'
export { UserIdParamsDto } from './user-id.params.dto'

// Responses
export { MutualServerResponseDto } from './mutual-server.response.dto'
export { PersonProfileResponseDto } from './person-profile.response.dto'
export { RelationshipListResponseDto } from './relationship-list.response.dto'
export { RelationshipResponseDto } from './relationship.response.dto'
export { SocialPersonResponseDto } from './social-person.response.dto'
