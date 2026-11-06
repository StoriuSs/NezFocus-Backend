export const MESSAGES = {
    // Success messages
    SUCCESS: {
        OPERATION_SUCCESSFUL: 'Operation completed successfully'
    },

    // Auth messages
    AUTH: {
        LOGIN_SUCCESS: 'Login successful',
        // The same whether or not the address has an account.
        CODE_SENT: 'Check your email for the code.',
        CODE_SENT_IF_ACCOUNT: 'If that address has an account, an email is on its way.',
        CODE_SIGN_IN_SUCCESS: 'You are signed in.',
        LOGOUT_EVERYWHERE_SUCCESS: 'Signed out on every device',
        LOGOUT_SUCCESS: 'Logout successful',
        TOKEN_REFRESHED: 'Token refreshed successfully',
        PASSWORD_RESET_SUCCESS: 'Your password has been changed. You are signed in.',
        PASSWORD_CHANGED_SUCCESS: 'Password has been changed successfully'
    },

    // File upload messages
    UPLOAD: {
        SUCCESS: 'File uploaded successfully',
        FAILED: 'File upload failed',
        DELETE_FAILED: 'Failed to delete the file',
        INVALID_FILE_TYPE: 'Invalid file type',
        FILE_TOO_LARGE: 'File size exceeds the limit',
        IMAGE_PROCESSING_FAILED: 'Failed to process image',
        IMAGE_PROCESSING_BUSY: 'Too many images are being processed right now. Please try again shortly.'
    },

    // User messages
    USER: {
        FETCHED: 'User fetched successfully',
        ACCOUNT_DELETED: 'Account deleted successfully',
        PROFILE_UPDATED: 'Profile updated successfully',
        USERNAME_SET_SUCCESS: 'Username set successfully',
        USERNAME_AVAILABLE: 'Username is available',
        USERNAME_TAKEN: 'Username is taken'
    },

    // Health messages
    HEALTH: {
        CHECK_SUCCESS: 'Health check successful'
    }
}
