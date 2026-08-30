import "server-only";
import { database } from "@/server/database";
import { loginSchema } from "@/features/auth/schemas";
import { verifyPassword } from "./password";

// A syntactically valid hash keeps unknown-email and wrong-password paths computationally comparable.
const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function authenticateCredentials(input: unknown) {
  const credentials = loginSchema.safeParse(input);
  if (!credentials.success) return null;
  const user = await database.user.findUnique({ where: { email: credentials.data.email } });
  const passwordMatches = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, credentials.data.password);
  if (!user || !passwordMatches) return null;
  return { id: user.id, name: user.name, email: user.email };
}
