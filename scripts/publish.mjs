#!/usr/bin/env node
/**
 * publish.mjs — the CD "deploy" step.
 *
 * Publishes a built artifact (dist/<program>.html) to OpenArtifacts using the
 * bundled wrapper from the openartifacts-publish skill. In CI the license key
 * arrives via an environment variable from GitHub Secrets; locally it comes
 * from your Copilot Plus environment.
 *
 * Usage:  node scripts/publish.mjs <program> <docId> "<Note title>"
 */
import { readFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const [, , program, docId, title] = process.argv;
if (!program || !docId || !title) {
  console.error('Usage: node scripts/publish.mjs <program> <docId> "<title>"');
  process.exit(2);
}
if (!process.env.COPILOT_PLUS_LICENSE_KEY) {
  console.error("COPILOT_PLUS_LICENSE_KEY is not set — cannot publish.");
  process.exit(2);
}

const artifact = join(ROOT, "dist", `${program}.html`);
if (!existsSync(artifact)) {
  console.error(`Missing artifact ${artifact}. Run build first.`);
  process.exit(2);
}

// Locate the OpenArtifacts wrapper. The repo vendors a copy in vendor/ so CI
// does not depend on any machine-specific path. Override with OA_WRAPPER.
const wrapper = process.env.OA_WRAPPER ||
  [
    join(ROOT, "vendor/openartifacts-publish.sh"),
    join(os.homedir(), "Desktop/ANT-Colony-Vault/.agents/skills/openartifacts-publish/openartifacts-publish.sh"),
  ].find(existsSync);

if (!wrapper) {
  console.error("Could not find the openartifacts-publish wrapper. Set OA_WRAPPER to its path.");
  process.exit(2);
}

// The wrapper expects the HTML under a handoffs/ dir; stage a copy there.
const handoffDir = join(ROOT, ".openartifacts/handoffs");
spawnSync("mkdir", ["-p", handoffDir]);
const staged = join(handoffDir, `deploy-${program}.html`);
copyFileSync(artifact, staged);

const res = spawnSync("sh", [wrapper, "publish", staged, title, docId], {
  stdio: "inherit",
  env: process.env,
});
rmSync(staged, { force: true });
process.exit(res.status ?? 1);
