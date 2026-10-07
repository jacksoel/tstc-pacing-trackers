#!/usr/bin/env node
/**
 * derive-required.mjs — regenerate module counts and drop-date targets from the
 * authoritative Fall 2026 module schedules.
 *
 *   total    = number of instructional modules
 *   required = modules whose scheduled release is on or before config.dropDate
 *   target   = min(total, required + 1)   (recommended pace: one module ahead)
 *
 * A schedule is COURSE-level truth: it maps a course code to its module count and
 * release dates. `config.schedules` lists the authoritative schedule files and the
 * program that OWNS each one. Any program block that references a scheduled code
 * takes the derived values, so a course shared by two programs (e.g. ITNW1308 on
 * both the CNSA and CYS plans) can never drift between them. Courses that no
 * schedule covers stay hand-maintained.
 *
 * A schedule course records its release dates one of two ways:
 *   - `moduleDates: ["YYYY-MM-DD", ...]` — the explicit date of every module. Used
 *     verbatim. This is what an instructor-provided dates sheet gives you.
 *   - `firstModule` / `lastModule` — the dates are then interpolated evenly across
 *     `modules` (the older CNSA form).
 *
 * planScheduleSync() is the single source of truth for both the writer below and
 * the CI gate in validate.mjs, so "check" and "apply" can never disagree.
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

/** Release day (UTC midnight) of every module in one schedule course.
 *  Explicit `moduleDates` win; otherwise the dates are interpolated evenly
 *  between `firstModule` and `lastModule` across `modules`. */
export function releaseDays(c) {
  if (c.moduleDates != null) {
    if (!Array.isArray(c.moduleDates) || c.moduleDates.length === 0)
      throw new Error(`${c.code}: moduleDates must be a non-empty array when present`);
    if (c.modules != null && c.moduleDates.length !== c.modules)
      throw new Error(
        `${c.code}: moduleDates has ${c.moduleDates.length} entries but modules is ${c.modules}`
      );
    return c.moduleDates.map(utcDay);
  }
  const n = c.modules;
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${c.code}: modules must be a positive integer (got ${n})`);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(moduleDay(i, n, c.firstModule, c.lastModule));
  return out;
}

/** total / required / target for every course in one schedule document. */
export function derive(schedule, dropISO) {
  const drop = utcDay(dropISO);
  const out = {};
  for (const c of schedule.courses) {
    const days = releaseDays(c);
    const total = days.length;
    const required = days.filter((day) => day <= drop).length;
    const target = Math.min(total, required + 1);
    out[c.code] = { total, required, target };
  }
  return out;
}

/** Every schedule named in config.schedules, with its owning program.
 *  Shape: [{ program: "cnsa", schedule: <parsed document> }] */
export function loadSchedules(config) {
  return (config.schedules || []).map((entry) => ({
    program: entry.program,
    file: entry.file,
    schedule: readJSON(entry.file),
  }));
}

/** One code -> derived map across all schedules. A code must derive identically
 *  everywhere it appears; two schedules disagreeing on a course is a data error,
 *  not a silent last-writer-wins. */
export function scheduledValues(config) {
  const out = {};
  for (const { file, schedule } of loadSchedules(config)) {
    for (const [code, d] of Object.entries(derive(schedule, config.dropDate))) {
      const prev = out[code];
      if (prev && (prev.total !== d.total || prev.required !== d.required || prev.target !== d.target)) {
        throw new Error(
          `schedule conflict for ${code} in ${file}: ` +
          `${prev.total}/${prev.required}/${prev.target} vs ${d.total}/${d.required}/${d.target}`
        );
      }
      out[code] = d;
    }
  }
  return out;
}

/** Compare data/courses.json against the schedules, without mutating anything.
 *  Returns { scheduled, missing, drift }:
 *    scheduled — code -> derived values from every schedule
 *    missing   — owning programs that don't carry a scheduled course
 *    drift     — existing courses whose total/required/target disagree */
export function planScheduleSync(courses, config) {
  const scheduled = scheduledValues(config);

  const missing = [];
  for (const { program, file, schedule } of loadSchedules(config)) {
    const meta = courses[program];
    if (!meta) {
      missing.push(`data/courses.json has no "${program}" block for ${file}`);
      continue;
    }
    for (const c of schedule.courses) {
      if (!meta[c.code]) {
        missing.push(`${program}: scheduled course "${c.code}" is missing from data/courses.json (${file})`);
      }
    }
  }

  // A scheduled course is overlaid onto EVERY program that references it, not
  // just the owner — that is what keeps shared courses consistent.
  const drift = [];
  for (const [program, courseMeta] of Object.entries(courses)) {
    for (const [code, d] of Object.entries(scheduled)) {
      const cur = courseMeta[code];
      if (!cur) continue;                    // this program doesn't offer the course
      for (const key of ["total", "required", "target"]) {
        if (cur[key] !== d[key]) drift.push({ program, code, key, from: cur[key], to: d[key] });
      }
    }
  }
  return { scheduled, missing, drift };
}

function main() {
  const config = readJSON("data/config.json");
  const courses = readJSON("data/courses.json");

  let plan;
  try {
    plan = planScheduleSync(courses, config);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  const { scheduled, missing, drift } = plan;

  if (CHECK) {
    if (missing.length || drift.length) {
      console.error("✗ Data is out of sync with the module schedule(s):");
      for (const m of missing) console.error(`  - ${m}`);
      for (const d of drift) console.error(`  - ${d.program}/${d.code}.${d.key}: ${d.from} -> ${d.to}`);
      console.error("\nRun: node scripts/derive-required.mjs");
      process.exit(1);
    }
    console.log(`✓ Derived values match the module schedule(s) (${Object.keys(scheduled).length} courses).`);
    return;
  }

  // A missing scheduled course can't be auto-created for the owning program —
  // that is an authoring decision. Refuse rather than silently inventing it.
  if (missing.length) {
    console.error("✗ Refusing to apply — scheduled courses are missing from data/courses.json:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  if (!drift.length) {
    console.log("✓ Already in sync — nothing to change.");
    return;
  }
  for (const [program, courseMeta] of Object.entries(courses)) {
    for (const [code, d] of Object.entries(scheduled)) {
      if (courseMeta[code]) Object.assign(courseMeta[code], d);
    }
  }
  writeFileSync(join(ROOT, "data/courses.json"), JSON.stringify(courses, null, 2) + "\n");
  console.log(`Updated ${drift.length} value(s):`);
  for (const d of drift) console.log(`  - ${d.program}/${d.code}.${d.key}: ${d.from} -> ${d.to}`);
}

// Only run when invoked directly, so validate.mjs can import planScheduleSync()
// without triggering a write.
if (import.meta.url === `file://${process.argv[1]}`) main();
