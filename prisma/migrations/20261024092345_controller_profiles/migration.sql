-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "controllerProfileId" TEXT;

-- CreateTable
CREATE TABLE "ControllerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceKey" TEXT,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControllerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ControllerProfile_userId_idx" ON "ControllerProfile"("userId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_controllerProfileId_fkey" FOREIGN KEY ("controllerProfileId") REFERENCES "ControllerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControllerProfile" ADD CONSTRAINT "ControllerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
