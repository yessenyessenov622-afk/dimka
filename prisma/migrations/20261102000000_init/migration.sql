CREATE TYPE "DialogStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE', 'STICKER', 'ANIMATION', 'VIDEO_NOTE', 'LOCATION', 'CONTACT', 'POLL', 'VENUE', 'OTHER');
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "TaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "User" (
  "id" SERIAL NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Dialog" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "DialogStatus" NOT NULL DEFAULT 'OPEN',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dialog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Message" (
  "id" SERIAL NOT NULL,
  "dialogId" INTEGER NOT NULL,
  "direction" "MessageDirection" NOT NULL,
  "kind" "MessageKind" NOT NULL DEFAULT 'OTHER',
  "text" TEXT,
  "telegramMessageId" INTEGER,
  "sourceChatId" BIGINT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OwnerSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "ownerTelegramId" BIGINT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerSettings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReplySession" (
  "ownerId" INTEGER NOT NULL,
  "dialogId" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReplySession_pkey" PRIMARY KEY ("ownerId")
);
CREATE TABLE "OwnerFlow" (
  "ownerId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "data" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerFlow_pkey" PRIMARY KEY ("ownerId")
);
CREATE TABLE "Task" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
  "dueAt" TIMESTAMP(3),
  "reminderAt" TIMESTAMP(3),
  "reminderSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE INDEX "User_username_idx" ON "User"("username");
CREATE INDEX "User_firstName_lastName_idx" ON "User"("firstName", "lastName");
CREATE UNIQUE INDEX "Dialog_userId_key" ON "Dialog"("userId");
CREATE INDEX "Dialog_status_lastMessageAt_idx" ON "Dialog"("status", "lastMessageAt");
CREATE INDEX "Message_dialogId_createdAt_idx" ON "Message"("dialogId", "createdAt");
CREATE INDEX "Message_direction_isRead_createdAt_idx" ON "Message"("direction", "isRead", "createdAt");
CREATE UNIQUE INDEX "OwnerSettings_ownerTelegramId_key" ON "OwnerSettings"("ownerTelegramId");
CREATE INDEX "ReplySession_dialogId_idx" ON "ReplySession"("dialogId");
CREATE INDEX "Task_status_priority_dueAt_idx" ON "Task"("status", "priority", "dueAt");
CREATE INDEX "Task_reminderAt_reminderSentAt_idx" ON "Task"("reminderAt", "reminderSentAt");

ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "Dialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplySession" ADD CONSTRAINT "ReplySession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplySession" ADD CONSTRAINT "ReplySession_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "Dialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerFlow" ADD CONSTRAINT "OwnerFlow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
