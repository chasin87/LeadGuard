import { config } from "dotenv";
import type { PlatformRole } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import {
  grantPlatformAccess,
  PlatformBootstrapError,
} from "@/server/platform-admin/roles";

if (!process.env.DATABASE_URL) {
  config({ path: process.env.E2E_ENV_FILE ?? ".env" });
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const email = arg("--email");
  const role = (arg("--role") ?? "SUPER_ADMIN") as PlatformRole;
  const reason = arg("--reason") ?? "bootstrap";
  const confirm = hasFlag("--confirm");
  if (!email) {
    throw new PlatformBootstrapError(
      "Usage: npm run platform-admin:grant -- --email user@example.com --role SUPER_ADMIN --reason bootstrap --confirm",
    );
  }
  if (role !== "SUPER_ADMIN" && role !== "SUPPORT") {
    throw new PlatformBootstrapError("Role must be SUPER_ADMIN or SUPPORT.");
  }
  const result = await grantPlatformAccess({
    email,
    role,
    confirm,
    reason,
    actor: null,
  });
  console.log(
    `Granted ${result.role} to ${email} (${result.created ? "created" : "existing"})`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await database.$disconnect();
  });
