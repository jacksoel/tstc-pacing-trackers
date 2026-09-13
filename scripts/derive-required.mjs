#!/usr/bin/env node
/**
 * derive-required.mjs — regenerate CNSA module counts and drop-date targets
 * from the authoritative Fall 2026 module schedule.
 *
 *   total    = number of instructional modules
 *   required = modules whose scheduled release is on or before config.dropDate
 *   target   = min(total, required + 1)   (recommended pace: one module ahead)
 *
 * The schedule (first/last module dates) is the SOURCE OF TRUTH; total/required
 * /target are derived. Run with --check to verify without writing (used by
 * validate.mjs in CI), or without flags to rewrite data/courses.json.
 *
 * Usage:
 *   node scripts/derive-required.mjs          # apply
 *   node scripts/derive-required.mjs --check  # verify only, non-zero on drift
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const CHECK = process.argv.includes("--check");

/** Midnight UTC for a YYYY-MM-DD string. Comparing calendar days avoids any
 *  time-of-day / fractional-ms edge (e.g. a module landing exactly on the
 *  drop date must count as due). */
function utcDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar day (UTC midnight) on which module i (1-indexed) releases, assuming
 *  even spacing between the first and last module dates. A module whose
 *  interpolated instant falls partway through a day still releases ON that day,
 *  so we floor to the containing day — otherwise a module landing exactly on
 *  the drop date (e.g. ITNW2354 module 3 on 2026-11-20) is wrongly excluded. */
const MS_DAY = 86400000;
function moduleDay(i, n, first, last) {
  const f = utcDay(first), l = utcDay(last);
  if (n === 1) return f;
  const t = f + ((l - f) * (i - 1)) / (n - 1);
  return Math.floor(t / MS_DAY) * MS_DAY;   // floor to the containing calendar day
}

/** How many modules are released on or before the drop date. */
function requiredBy(n, first, last, dropISO) {
  const drop = utcDay(dropISO);
  let count = 0;
  for (let i = 1; i <= n; i++) if (moduleDay(i, n, first, last) <= drop) count++;
  return count;
}

export function derive(schedule, dropISO) {
  const out = {};
  for (const c of schedule.courses) {
    const total = c.modules;
    const required = requiredBy(total, c.firstModule, c.lastModule, dropISO);
    const target = Math.min(total, required + 1);
    out[c.code] = { total, required, target };
  }
  return out;
}

function main() {
  const config = readJSON("data/config.json");
  const schedule = readJSON("data/sources/fall-2026-cnsa-module-schedule.json");
  const courses = readJSON("data/courses.json");
  const cnsa = courses.cnsa;

  const derived = derive(schedule, config.dropDate);
  const drift = [];

  for (const [code, d] of Object.entries(derived)) {
    const cur = cnsa[code] || (cnsa[code] = {
      title: schedule.courses.find((c) => c.code === code).title,
    });
    for (const key of ["total", "required", "target"]) {
      if (cur[key] !== d[key]) drift.push(`${code}.${key}: ${cur[key]} -> ${d[key]}`);
    }
    Object.assign(cur, d);
  }

  if (CHECK) {
    if (drift.length) {
      console.error("✗ Derived values are out of sync with the module schedule:");
      for (const d of drift) console.error(`  - ${d}`);
      console.error("\nRun: node scripts/derive-required.mjs");
      process.exit(1);
    }
    console.log(`✓ Derived values match the module schedule (${Object.keys(derived).length} courses).`);
    return;
  }

  if (!drift.length) {
    console.log("✓ Already in sync — nothing to change.");
    return;
  }
  writeFileSync(join(ROOT, "data/courses.json"), JSON.stringify(courses, null, 2) + "\n");
  console.log(`Updated ${drift.length} value(s):`);
  for (const d of drift) console.log(`  - ${d}`);
}

// Only run when invoked directly, so validate.mjs can import derive()
// without triggering a write.
if (import.meta.url === `file://${process.argv[1]}`) main();
