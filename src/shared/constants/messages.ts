export const MESSAGES = {
    // Success messages
    SUCCESS: {
        OPERATION_SUCCESSFUL: 'Operation completed successfully'
    },

    // Auth messages
    AUTH: {
        ACCOUNT_COMPLETED: 'Account completed',
        LOGIN_SUCCESS: 'Login successful',
        // The same whether or not the address has an account.
        CODE_SENT: 'Check your email for the code.',
        CODE_SENT_IF_ACCOUNT: 'If that address has an account, an email is on its way.',
        CODE_SIGN_IN_SUCCESS: 'You are signed in.',
        OTHER_SESSIONS_ENDED: 'Signed out the other devices',
        SESSION_ENDED: 'Signed out that device',
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
        ACCOUNT_DELETION_REQUESTED: 'Account will be deleted',
        ACCOUNT_RESTORED: 'Account restored',
        PROFILE_UPDATED: 'Profile updated successfully',
        AVATAR_REMOVED: 'Avatar removed',
        SETTINGS_FETCHED: 'Settings fetched',
        SETTINGS_UPDATED: 'Settings saved',
        USERNAME_AVAILABLE: 'Username is available',
        USERNAME_TAKEN: 'Username is taken'
    },

    // Server messages
    SERVER: {
        CREATED: 'Server created',
        LISTED: 'Servers fetched',
        UPDATED: 'Server saved',
        ICON_UPDATED: 'Server icon updated',
        ICON_REMOVED: 'Server icon removed',
        CATEGORY_CREATED: 'Category created',
        CATEGORY_UPDATED: 'Category saved',
        CATEGORY_DELETED: 'Category deleted',
        CHANNEL_CREATED: 'Channel created',
        CHANNEL_UPDATED: 'Channel saved',
        CHANNEL_DELETED: 'Channel deleted',
        LAYOUT_MOVED: 'Order saved'
    },

    // Health messages
    HEALTH: {
        CHECK_SUCCESS: 'Health check successful'
    }
}
