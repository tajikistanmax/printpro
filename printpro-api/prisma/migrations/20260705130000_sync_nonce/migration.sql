-- CreateTable: durable nonce-store для sync (P0-5)
CREATE TABLE "SyncNonce" (
    "id" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncNonce_node_nonce_key" ON "SyncNonce"("node", "nonce");

-- CreateIndex
CREATE INDEX "SyncNonce_expiresAt_idx" ON "SyncNonce"("expiresAt");
