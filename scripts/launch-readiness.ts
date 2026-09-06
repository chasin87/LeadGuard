import {
  evaluateLaunchReadiness,
  launchReadinessFailed,
} from "@/server/ops/launch";

const items = evaluateLaunchReadiness(process.env);
for (const item of items) {
  const mark = item.ok ? "ok" : item.required ? "FAIL" : "warn";
  console.log(`${mark.padEnd(4)} ${item.id}: ${item.message}`);
}

if (launchReadinessFailed(items)) {
  console.error("Launch readiness check failed.");
  process.exit(1);
}

console.log("Launch readiness check passed.");
