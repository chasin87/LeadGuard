import { spawn } from "node:child_process";
import {
  applyE2eEnvironment,
  e2eRepoRoot,
  ensureE2eDatabase,
  loadE2eEnvironment,
  resetE2eDatabase,
} from "./e2e-env";

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: e2eRepoRoot,
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${command} ${args.join(" ")} failed with code ${code}`),
      );
    });
  });
}

async function main() {
  const env = loadE2eEnvironment();
  applyE2eEnvironment(env);
  process.stdout.write(
    `E2E run ${env.E2E_RUN_ID} against ${env.DATABASE_URL} on ${env.APP_URL}\n`,
  );
  await ensureE2eDatabase(env.DATABASE_URL!);
  await resetE2eDatabase(env.DATABASE_URL!, env);
  await run("npx", ["prisma", "generate"], env);
  await run("npx", ["prisma", "migrate", "deploy"], env);
  await run("npx", ["next", "build"], env);
  const extra = process.argv.slice(2);
  await run("npx", ["playwright", "test", "--retries=0", ...extra], env);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
