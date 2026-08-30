import { hash, verify } from "@node-rs/argon2";

const argon2Options = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise: Promise<string> | undefined;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, argon2Options);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function verifyPasswordAgainstDummy(
  password: string,
): Promise<void> {
  dummyHashPromise ??= hashPassword("leadguard-timing-dummy");
  await verifyPassword(await dummyHashPromise, password);
}
