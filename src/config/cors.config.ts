import { registerAs } from '@nestjs/config'
import { parseBooleanEnv } from '@/shared/utils'

export default registerAs('cors', () => ({
    // Trimmed: "https://a.com, https://b.com" otherwise yields " https://b.com",
    // which never equals a request's Origin header.
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3001')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    // Unset: on. The refresh cookie reaches the API only with credentials on,
    // and without it every session ends when its first access token expires.
    credentials: process.env.CORS_CREDENTIALS?.trim() ? parseBooleanEnv(process.env.CORS_CREDENTIALS) : true
}))
