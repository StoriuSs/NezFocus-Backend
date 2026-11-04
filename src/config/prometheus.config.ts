import { registerAs } from '@nestjs/config'

export default registerAs('prometheus', () => ({
    defaultMetrics: true,
    defaultLabels: {
        app: 'nestjs-starter',
        environment: process.env.NODE_ENV || 'development'
    }
}))
