-- System messages of a study room's chat: a session started, a session ended
-- (REQ-MSG-08, D-222).
ALTER TYPE "SystemEvent" ADD VALUE 'study_session_started';
ALTER TYPE "SystemEvent" ADD VALUE 'study_session_ended';
