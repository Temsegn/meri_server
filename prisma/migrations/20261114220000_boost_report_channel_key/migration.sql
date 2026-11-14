-- AlterTable: link every report to its channel (same normalisation as Order.targetNormalized).
ALTER TABLE "BoostReport" ADD COLUMN "channelKey" TEXT NOT NULL DEFAULT '';

-- Backfill existing rows (mirrors normalizeTarget in src/common/targets.ts).
UPDATE "BoostReport" SET "channelKey" = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim("channelUrl")), '^https?://', ''),
        '^(www\.|m\.)', ''),
      '^(youtube\.com/|youtu\.be/)', ''),
    '([?#].*$)|(/(videos|featured|shorts|streams|about|reels)?/*$)', '', 'g'),
  '^@', '');

ALTER TABLE "BoostReport" ALTER COLUMN "channelKey" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "BoostReport_channelKey_startedAt_idx" ON "BoostReport"("channelKey", "startedAt");
