-- The running sessions by when their phase is due: the sweep that runs the
-- phase ends whose job was lost or late (D-225) reads only these, not the
-- ended sessions that are nearly every row.
CREATE INDEX "FocusSession_running_due" ON "FocusSession"("phaseEndsAt") WHERE "status" = 'running';
