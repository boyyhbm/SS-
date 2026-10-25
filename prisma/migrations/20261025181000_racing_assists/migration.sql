ALTER TABLE "UserSettings" ADD COLUMN "racingLine" TEXT NOT NULL DEFAULT 'corners';
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_racingLine_check" CHECK ("racingLine" IN ('off', 'corners', 'full'));
