-- CreateTable
CREATE TABLE "PrivateReply" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "ruleId" TEXT,
    "provider" TEXT NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "externalCommentId" TEXT NOT NULL,
    "commentText" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "keyword" TEXT,
    "replyText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'matched',
    "error" TEXT,
    "errorCategory" TEXT,
    "providerMessageId" TEXT,
    "providerRecipientId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "commentCreatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateReply_brandId_createdAt_idx" ON "PrivateReply"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivateReply_status_updatedAt_idx" ON "PrivateReply"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateReply_socialAccountId_externalCommentId_key" ON "PrivateReply"("socialAccountId", "externalCommentId");

-- AddForeignKey
ALTER TABLE "PrivateReply" ADD CONSTRAINT "PrivateReply_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateReply" ADD CONSTRAINT "PrivateReply_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateReply" ADD CONSTRAINT "PrivateReply_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
