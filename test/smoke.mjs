#!/usr/bin/env node
/**
 * smoke.mjs — post-build smoke test.
 *
 * Loads each built artifact, pulls the tracker logic out of its <script>,
 * runs it against a minimal fake DOM, and asserts the page renders without
 * "undefined"/"NaN" and with the expected structure. This is the "test the
 * artifact, not just the source" lesson.
 *
 * Run:  node test/smoke.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const config = JSON.parse(readFileSync(join(ROOT, "data/config.json"), "utf8"));
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

/** A tiny element stub capturing innerHTML/className. */
function makeEl() {
  return {
    innerHTML: "",
    className: "",
    dataset: {},
    onclick: null,
    querySelectorAll: () => [],
  };
}

function runArtifact(programKey) {
  const path = join(ROOT, "dist", `${programKey}.html`);
  check(existsSync(path), `${programKey}: dist artifact missing (run build first)`);
  if (!existsSync(path)) return;

  const html = readFileSync(path, "utf8");
  check(html.includes("<!DOCTYPE html>"), `${programKey}: missing doctype`);
  check(html.trimEnd().endsWith("</html>"), `${programKey}: not closed with </html>`);
  // The served page gets an OpenArtifacts <div> wrapper injected at deploy time.
  // Our source may reference the class name in CSS (e.g. to hide the byline),
  // but must never contain the wrapper *element* — that would duplicate it.
  check(!/<div class="openartifacts-(header|footer)"/.test(html),
    `${programKey}: artifact contains an OpenArtifacts wrapper element (dup risk)`);
  check(!/\/\*__[A-Z_]+__\*\//.test(html), `${programKey}: unsubstituted token remains`);
  check(html.includes("brandbar-mark"), `${programKey}: brand bar missing`);
  check(html.includes("managed-by"), `${programKey}: managed-by footer missing`);

  const script = html.match(/<script>([\s\S]*)<\/script>/);
  check(script, `${programKey}: no <script> block`);
  if (!script) return;

  const els = {};
  const document = { getElementById: (id) => (els[id] = els[id] || makeEl()) };
  const sandbox = { document, setInterval: () => 0, console, Date, Math, JSON };
  sandbox.globalThis = sandbox;

  try {
    vm.createContext(sandbox);
    vm.runInContext(script[1], sandbox, { timeout: 5000 });
  } catch (err) {
    failures.push(`${programKey}: script threw during load: ${err.message}`);
    return;
  }

  // Exercise the render path directly if the functions were exposed.
  try {
    vm.runInContext(
      "if (typeof renderAll === 'function') renderAll(); if (typeof renderBoard === 'function') renderBoard();",
      sandbox
    );
  } catch (err) {
    failures.push(`${programKey}: render threw: ${err.message}`);
    return;
  }

  const all = Object.keys(els).map((k) => els[k].innerHTML).join("\n");
  check(!all.includes("undefined"), `${programKey}: rendered output contains "undefined"`);
  check(!all.includes("NaN"), `${programKey}: rendered output contains "NaN"`);

  const board = (els.board && els.board.innerHTML) || "";
  const program = config.programs[programKey];
  const expectedCreds = program.credentialOrder.length;
  check(expectedCreds > 0, `${programKey}: credentialOrder empty`);

  // Focused board should render at least one course card for the default term.
  check(/class="course/.test(board), `${programKey}: no course cards rendered`);
  check(board.includes("paceline"), `${programKey}: no pace track rendered`);

  console.log(`  ${programKey}: script loaded, rendered OK`);
}

function main() {
  for (const key of Object.keys(config.programs)) runArtifact(key);
  if (failures.length) {
    console.error(`\n✗ Smoke test failed with ${failures.length} issue(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n✓ Smoke test passed for ${Object.keys(config.programs).length} artifact(s).`);
}

main();
