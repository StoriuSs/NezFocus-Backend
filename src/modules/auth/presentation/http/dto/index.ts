/*
 * Request and response bodies for /auth, one class per file. The wire is
 * snake_case; the global pipe converts it, so properties are camelCase.
 * Property JSDoc is published in the API docs by the Swagger plugin.
 */

// Requests
export { ChangePasswordRequestDto } from './change-password.request.dto'
export { DeleteAccountRequestDto } from './delete-account.request.dto'
export { EmailRequestDto } from './email.request.dto'
export { ForgotPasswordRequestDto } from './forgot-password.request.dto'
export { LoginRequestDto } from './login.request.dto'
export { RegisterRequestDto } from './register.request.dto'
export { ResetPasswordRequestDto } from './reset-password.request.dto'
export { SetPasswordRequestDto } from './set-password.request.dto'
export { VerifyEmailRequestDto } from './verify-email.request.dto'

// Responses
export { AuthOptionsResponseDto } from './auth-options.response.dto'
export { SignInMethodsResponseDto } from './sign-in-methods.response.dto'
export { TokenResponseDto } from './token.response.dto'
