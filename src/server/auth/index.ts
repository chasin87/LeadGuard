import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { loginSchema } from "@/lib/validation/auth";
import { authConfig } from "@/server/auth/config";
import { findUserForCredentials } from "@/server/auth/service";
import {
  verifyPassword,
  verifyPasswordAgainstDummy,
} from "@/server/auth/password";
import { createLogger } from "@/server/logger";
import { database } from "@/server/database";

const logger = createLogger("auth");

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const user = await findUserForCredentials(parsed.data.email);
        if (!user?.passwordHash || user.status !== "ACTIVE") {
          await verifyPasswordAgainstDummy(parsed.data.password);
          logger.info("Login failed");
          return null;
        }

        const valid = await verifyPassword(
          user.passwordHash,
          parsed.data.password,
        );
        if (!valid) {
          logger.info("Login failed");
          return null;
        }

        await database.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
