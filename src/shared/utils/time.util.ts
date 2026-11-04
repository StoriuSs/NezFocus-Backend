/**
 * Calculate expiry date from a time string format
 * @param expiresIn - Time string in format: number + unit (s|m|h|d)
 * @returns Date object representing the expiry time
 * @example
 * calculateExpiryDate('15m') // 15 minutes from now
 * calculateExpiryDate('7d')  // 7 days from now
 */
export function calculateExpiryDate(expiresIn: string): Date {
    const now = new Date()
    const match = expiresIn.match(/^(\d+)([smhd])$/)

    if (!match) {
        throw new Error('Invalid expiration format')
    }

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
        case 's':
            return new Date(now.getTime() + value * 1000)
        case 'm':
            return new Date(now.getTime() + value * 60 * 1000)
        case 'h':
            return new Date(now.getTime() + value * 60 * 60 * 1000)
        case 'd':
            return new Date(now.getTime() + value * 24 * 60 * 60 * 1000)
        default:
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    }
}

/**
 * Calculate TTL (Time To Live) in seconds from a time string format
 * @param expiresIn - Time string in format: number + unit (s|m|h|d)
 * @returns TTL in seconds
 * @example
 * calculateTTLInSeconds('15m') // 900 seconds
 * calculateTTLInSeconds('7d')  // 604800 seconds
 */
export function calculateTTLInSeconds(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/)

    if (!match) {
        throw new Error('Invalid expiration format')
    }

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
        case 's':
            return value
        case 'm':
            return value * 60
        case 'h':
            return value * 60 * 60
        case 'd':
            return value * 24 * 60 * 60
        default:
            return 7 * 24 * 60 * 60 // 7 days
    }
}
