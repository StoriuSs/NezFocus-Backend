/*
 * Request and response bodies for /auth, one class per file. The wire is
 * snake_case; the global pipe converts it, so properties are camelCase.
 * Property JSDoc is published in the API docs by the Swagger plugin.
 */

// Requests
export { ChangePasswordRequestDto } from './change-password.request.dto'
export { CompleteAccountRequestDto } from './complete-account.request.dto'
export { DeleteAccountRequestDto } from './delete-account.request.dto'
export { EmailCodeRequestDto } from './email-code.request.dto'
export { ForgotPasswordRequestDto } from './forgot-password.request.dto'
export { LoginRequestDto } from './login.request.dto'
export { ResetPasswordRequestDto } from './reset-password.request.dto'
export { VerifyEmailCodeRequestDto } from './verify-email-code.request.dto'

// Responses
export { AccountDeletionResponseDto } from './account-deletion.response.dto'
export { AuthOptionsResponseDto } from './auth-options.response.dto'
export { EmailCodeSignInResponseDto } from './email-code-sign-in.response.dto'
export { RevokedSessionsResponseDto } from './revoked-sessions.response.dto'
export { SessionListResponseDto } from './session-list.response.dto'
export { SessionResponseDto } from './session.response.dto'
export { TokenResponseDto } from './token.response.dto'
