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
        FILE_NOT_FOUND: 'File not found',
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
        FOUND: 'Server fetched',
        UPDATED: 'Server saved',
        ICON_UPDATED: 'Server icon updated',
        ICON_REMOVED: 'Server icon removed',
        DELETED: 'Server deleted',
        LEFT: 'Left the server',
        TRANSFERRED: 'Ownership handed over',
        CATEGORY_CREATED: 'Category created',
        CATEGORY_UPDATED: 'Category saved',
        CATEGORY_DELETED: 'Category deleted',
        CHANNEL_CREATED: 'Channel created',
        CHANNEL_UPDATED: 'Channel saved',
        CHANNEL_DELETED: 'Channel deleted',
        LAYOUT_MOVED: 'Order saved',
        INVITE_CREATED: 'Invite link ready',
        INVITES_LISTED: 'Invites fetched',
        INVITE_REVOKED: 'Invite revoked',
        INVITE_FOUND: 'Invite fetched',
        INVITE_ACCEPTED: 'Joined the server',
        ROLES_LISTED: 'Roles fetched',
        ROLE_CREATED: 'Role created',
        ROLE_UPDATED: 'Role updated',
        ROLE_DELETED: 'Role deleted',
        ROLES_REORDERED: 'Roles reordered',
        ROLE_GRANTED: 'Role given',
        ROLE_REVOKED: 'Role taken back',
        MEMBERS_LISTED: 'Members fetched',
        MEMBER_KICKED: 'Member kicked',
        MEMBER_TIMEOUT_CHANGED: 'Timeout changed',
        MEMBER_BANNED: 'Member banned',
        MEMBER_UNBANNED: 'Ban lifted',
        BANS_LISTED: 'Bans fetched'
    },

    // Realtime messages
    REALTIME: {
        TICKET_ISSUED: 'Realtime ticket issued'
    },

    VOICE: {
        TOKEN_ISSUED: 'Voice token issued',
        LEFT: 'Left the voice room',
        PARTICIPANT_MUTED: 'Microphone turned off',
        PARTICIPANT_UNMUTED: 'Microphone allowed again',
        PARTICIPANT_DISCONNECTED: 'Put out of the voice room',
        EVENT_RECEIVED: 'Media event received'
    },

    // Messaging messages
    MESSAGING: {
        MESSAGE_SENT: 'Message sent',
        MESSAGES_LISTED: 'Messages fetched',
        MESSAGE_EDITED: 'Message edited',
        MESSAGE_DELETED: 'Message deleted',
        REACTION_ADDED: 'Reaction added',
        REACTION_REMOVED: 'Reaction removed',
        REACTORS_LISTED: 'Reactions fetched',
        MESSAGE_PINNED: 'Message pinned',
        MESSAGE_UNPINNED: 'Message unpinned',
        PINS_LISTED: 'Pinned messages fetched',
        READ_STATES_LISTED: 'Read states fetched',
        CHANNEL_ACKED: 'Channel marked as read',
        UPLOAD_READY: 'Upload form issued',
        UPLOAD_COMPLETED: 'File checked',
        ATTACHMENT_LINKS: 'File links issued'
    },

    // Task Board messages
    TASKS: {
        TASKS_LISTED: 'Tasks fetched',
        TASK_FETCHED: 'Task fetched',
        TASK_CREATED: 'Task created',
        TASK_UPDATED: 'Task updated',
        TASK_DELETED: 'Task deleted',
        TASK_ASSIGNED: 'People added to the task',
        TASK_UNASSIGNED: 'Person taken off the task',
        HISTORY_LISTED: 'Task history fetched'
    },

    NOTIFICATIONS: {
        NOTIFICATIONS_LISTED: 'Notifications fetched',
        NOTIFICATIONS_READ: 'Notifications marked read'
    },

    // Health messages
    HEALTH: {
        CHECK_SUCCESS: 'Health check successful'
    }
}
