-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'SUBSCRIPTION_UPDATE';

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('SIX_MONTHS', 'ONE_YEAR');

-- CreateEnum
CREATE TYPE "SubscriptionPayMethod" AS ENUM ('TELEBIRR', 'CBE', 'ABYSSINIA');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "amountEtb" INTEGER NOT NULL,
    "method" "SubscriptionPayMethod" NOT NULL,
    "receiptFileId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_receiptFileId_key" ON "Subscription"("receiptFileId");

-- CreateIndex
CREATE INDEX "Subscription_status_createdAt_idx" ON "Subscription"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_createdAt_idx" ON "Subscription"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
