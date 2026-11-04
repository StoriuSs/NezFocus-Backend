/*
 * Request and response bodies for /users, one class per file.
 *
 * A response DTO's TypeScript types are what the OpenAPI spec (and every
 * client generated from it) says is on the wire: `?` = the key may be absent,
 * `| null` = the key is sent as null. Keep them true to what the controller
 * actually returns.
 */

// Requests
export { CheckUsernameParamsDto } from './check-username.params.dto'
export { SetUsernameRequestDto } from './set-username.request.dto'
export { UpdateProfileRequestDto } from './update-profile.request.dto'

// Responses
export { SetUsernameResponseDto } from './set-username.response.dto'
export { UpdateProfileResponseDto } from './update-profile.response.dto'
export { UploadAvatarResponseDto } from './upload-avatar.response.dto'
export { UsernameAvailabilityResponseDto } from './username-availability.response.dto'
export { UserProfileResponseDto } from './user-profile.response.dto'
