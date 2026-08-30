-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebsiteDnsStatus" AS ENUM ('RESOLVED', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "dnsStatus" "WebsiteDnsStatus" NOT NULL,
    "lastValidatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Website_organizationId_idx" ON "Website"("organizationId");

-- CreateIndex
CREATE INDEX "Website_hostname_idx" ON "Website"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "Website_organizationId_normalizedUrl_key" ON "Website"("organizationId", "normalizedUrl");

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
