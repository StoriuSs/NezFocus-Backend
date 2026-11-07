/**
 * Test Setup File
 *
 * This file runs before each test suite to set up the testing environment.
 * It provides default environment variables and global test configuration.
 */

// Required for decorators (class-validator, class-transformer)
import 'reflect-metadata'

// ========================
// Environment Variables
// ========================

// App Configuration
process.env.NODE_ENV = 'test'
process.env.PORT = '3001' // Different port to avoid conflicts
process.env.API_PREFIX = 'api'
process.env.APP_NAME = 'Test App'
process.env.BASE_URL = 'http://localhost:3001'

// Database Configuration (use test database or mock)
process.env.DB_PORT = '5432'
process.env.DB_USERNAME = 'postgres'
process.env.DB_PASSWORD = 'postgres'
process.env.DB_NAME = 'test_app_db_test'

// Redis Configuration
process.env.REDIS_HOST = 'localhost'
process.env.REDIS_PORT = '6379'
process.env.REDIS_PASSWORD = ''

// Cache Configuration
process.env.CACHE_TTL = '3600'
process.env.CACHE_LRU_SIZE = '500'

// Throttle Configuration (relaxed for testing)
process.env.THROTTLE_TTL = '60'
process.env.THROTTLE_LIMIT = '1000'
process.env.THROTTLE_ANONYMOUS_LIMIT = '300'

// Authentication
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef0123456789'

// Email Configuration (disabled for testing)
process.env.EMAIL_HOST = 'localhost'
process.env.EMAIL_PORT = '1025'
process.env.EMAIL_USER = 'test'
process.env.EMAIL_PASSWORD = 'test'
process.env.EMAIL_FROM_ADDRESS = 'test@example.com'

// Upload Configuration
process.env.STORAGE_TYPE = 'local'
process.env.MAX_FILE_SIZE = '5242880'
process.env.UPLOAD_DEST = './test-uploads'

// Timeout Configuration
process.env.REQUEST_TIMEOUT_MS = '30000'
process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = '5000'

// Log Level (reduce noise in tests)
process.env.LOG_LEVEL = 'warn'

// CORS
process.env.CORS_ORIGINS = 'http://localhost:3001'

// ========================
// Global Jest Configuration
// ========================

// Increase timeout for async operation debugging
jest.setTimeout(30000)

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//     ...console,
//     log: jest.fn(),
//     debug: jest.fn(),
//     info: jest.fn(),
//     warn: jest.fn(),
// }
