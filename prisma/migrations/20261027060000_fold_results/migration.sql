-- Additive, game-specific authoritative result details. Existing racing records
-- remain unchanged; no invented score or Fold identity is backfilled.
ALTER TABLE "MatchResult" ADD COLUMN "details" JSONB;
