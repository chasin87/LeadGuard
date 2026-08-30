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
        if (!user?.passwordHash) {
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

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
