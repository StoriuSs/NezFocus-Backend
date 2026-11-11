-- Deleting a category sets its channels' "categoryId" to null. Without an index
-- led by "categoryId", Postgres 16 reads the whole
-- "Channel_serverId_categoryId_type_nameKey_key" index to find them, across
-- every server (M1 A2b, EXPLAIN).

-- CreateIndex
CREATE INDEX "Channel_categoryId_idx" ON "Channel"("categoryId");
