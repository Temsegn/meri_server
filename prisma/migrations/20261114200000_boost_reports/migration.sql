-- CreateTable
CREATE TABLE "BoostReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientTaskId" TEXT NOT NULL,
    "channelUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subscribeGoal" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "checkedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoostReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoostReportAccount" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subscriptionState" TEXT NOT NULL,
    "newlySubscribed" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoostReportAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoostReport_userId_clientTaskId_key" ON "BoostReport"("userId", "clientTaskId");

-- CreateIndex
CREATE INDEX "BoostReport_userId_createdAt_idx" ON "BoostReport"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoostReportAccount_reportId_email_key" ON "BoostReportAccount"("reportId", "email");

-- CreateIndex
CREATE INDEX "BoostReportAccount_email_idx" ON "BoostReportAccount"("email");

-- AddForeignKey
ALTER TABLE "BoostReport" ADD CONSTRAINT "BoostReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoostReportAccount" ADD CONSTRAINT "BoostReportAccount_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BoostReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
