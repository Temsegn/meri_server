-- CreateTable
CREATE TABLE "SyncState" (
    "userId" TEXT NOT NULL,
    "rev" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "userId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rev" BIGINT NOT NULL,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("userId","collection","key")
);

-- CreateTable
CREATE TABLE "SyncBlob" (
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncBlob_pkey" PRIMARY KEY ("userId","id")
);

-- CreateIndex
CREATE INDEX "SyncRecord_userId_rev_idx" ON "SyncRecord"("userId", "rev");

-- CreateIndex
CREATE UNIQUE INDEX "SyncBlob_key_key" ON "SyncBlob"("key");

-- AddForeignKey
ALTER TABLE "SyncState" ADD CONSTRAINT "SyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRecord" ADD CONSTRAINT "SyncRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncBlob" ADD CONSTRAINT "SyncBlob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
