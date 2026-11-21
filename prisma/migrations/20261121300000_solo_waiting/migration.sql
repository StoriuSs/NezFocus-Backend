-- The waiting Solo sessions by when their wait ends: the sweep that ends the
-- ones whose job was lost or late, as expired (REQ-STUDY-05, D-225), reads
-- only these, as FocusSession_running_due does for the running ones.
CREATE INDEX "FocusSession_waiting_due" ON "FocusSession"("waitingUntil") WHERE "status" = 'waiting';
