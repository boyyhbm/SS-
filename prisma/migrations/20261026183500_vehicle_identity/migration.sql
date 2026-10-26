-- Existing results keep NULL: do not invent historical vehicle configurations.
ALTER TABLE "MatchParticipant" ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "MatchParticipant" ADD COLUMN "vehicleVersion" INTEGER;
