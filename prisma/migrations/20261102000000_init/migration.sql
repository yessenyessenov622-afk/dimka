CREATE TABLE "User" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Dialog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Dialog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Message" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "dialogId" INTEGER NOT NULL,
  "direction" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'OTHER',
  "text" TEXT,
  "telegramMessageId" INTEGER,
  "sourceChatId" BIGINT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "Dialog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OwnerSettings" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "ownerTelegramId" BIGINT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ReplySession" (
  "ownerId" INTEGER NOT NULL PRIMARY KEY,
  "dialogId" INTEGER NOT NULL,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReplySession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerSettings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReplySession_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "Dialog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OwnerFlow" (
  "ownerId" INTEGER NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "data" JSONB,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OwnerFlow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerSettings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Task" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "dueAt" DATETIME,
  "reminderAt" DATETIME,
  "reminderSentAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
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
