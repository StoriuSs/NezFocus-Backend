-- The values M6 adds to enums of other modules (D-242). A migration of its
-- own: Postgres cannot use a value added to an enum in the transaction that
-- added it, and 20261124100000_social names them in its checks.

-- A direct message conversation is a channel with no server (D-167).
ALTER TYPE "ChannelType" ADD VALUE 'dm';

-- The inbox items of friend requests and missed calls (REQ-SOCIAL-01, 06).
ALTER TYPE "NotificationType" ADD VALUE 'friend_request';
ALTER TYPE "NotificationType" ADD VALUE 'friend_accepted';
ALTER TYPE "NotificationType" ADD VALUE 'missed_call';

-- A call's system message in its conversation (REQ-SOCIAL-05).
ALTER TYPE "SystemEvent" ADD VALUE 'call_ended';
