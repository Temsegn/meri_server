-- CreateTable
CREATE TABLE "FeaturedChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeaturedChannel_active_sortOrder_idx" ON "FeaturedChannel"("active", "sortOrder");
