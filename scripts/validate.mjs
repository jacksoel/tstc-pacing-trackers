#!/usr/bin/env node
/**
 * validate.mjs — data integrity gate for the CI pipeline.
 *
 * Runs BEFORE the build. If any rule fails, it exits non-zero, which fails
 * the pull request. This is the "automated testing" lesson: a bad data edit
 * can never reach students because the pipeline blocks it.
 *
 * Run:  node scripts/validate.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { derive } from "./derive-required.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

function validateCourse(code, m, program) {
  const where = `${program}/${code}`;
  if (typeof m.title !== "string" || !m.title.trim()) fail(`${where}: title is required`);
  if (m.total != null && (!Number.isInteger(m.total) || m.total <= 0))
    fail(`${where}: total must be a positive integer or null (got ${m.total})`);

  // required <= total
  if (m.required != null && m.total != null && m.required > m.total)
    fail(`${where}: required (${m.required}) exceeds total (${m.total})`);
  // target >= required, and target <= total (recommended pace can't exceed course)
  if (m.target != null && m.required != null && m.target < m.required)
    fail(`${where}: target (${m.target}) is below required (${m.required})`);
  if (m.target != null && m.total != null && m.target > m.total)
    fail(`${where}: target (${m.target}) exceeds total (${m.total})`);

  if (m.total == null) warn(`${where}: no module map yet (total is null)`);
  if (m.total != null && m.required == null)
    warn(`${where}: modules known but no drop-date target set`);
}

function validateProgram(key, prog, creds, courseMeta) {
  if (!prog.name || !prog.eyebrow || !prog.subtitle)
    fail(`config.programs.${key}: name, eyebrow and subtitle are required`);

  const order = prog.credentialOrder;
  if (!Array.isArray(order) || order.length === 0)
    fail(`config.programs.${key}: credentialOrder must be a non-empty array`);

  for (const cid of order) {
    if (!creds[cid]) fail(`config.programs.${key}: credentialOrder references missing credential "${cid}"`);
  }
  for (const cid of Object.keys(creds)) {
    if (!order.includes(cid)) warn(`programs/${key}.json: credential "${cid}" is not in credentialOrder`);
    const c = creds[cid];
    if (!c.label || !c.short) fail(`${key}.${cid}: label and short are required`);
    if (!Number.isInteger(c.months)) fail(`${key}.${cid}: months must be an integer`);
    if (!Array.isArray(c.terms) || c.terms.length === 0) fail(`${key}.${cid}: terms must be a non-empty array`);

    // every referenced course must exist in this program's catalog, and no
    // course may appear twice within a credential.
    const seen = new Set();
    const checkCourse = (code, ctx) => {
      if (!courseMeta[code]) fail(`${key}.${cid}: ${ctx} references unknown course "${code}"`);
      if (seen.has(code)) fail(`${key}.${cid}: course "${code}" appears more than once`);
      seen.add(code);
    };
    c.terms.forEach((t, i) => {
      if (!Array.isArray(t.courses)) return fail(`${key}.${cid}: term ${i + 1} missing courses[]`);
      t.courses.forEach((code) => checkCourse(code, `term ${i + 1}`));
      (t.options || []).forEach((group, gi) =>
        group.forEach((code) => checkCourse(code, `term ${i + 1} option ${gi + 1}`))
      );
    });
  }
}

function validateDates(config) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(config.dropDate)) fail(`config.dropDate must be YYYY-MM-DD (got "${config.dropDate}")`);
  if (!iso.test(config.paceStart)) fail(`config.paceStart must be YYYY-MM-DD (got "${config.paceStart}")`);
  if (iso.test(config.dropDate) && iso.test(config.paceStart) && config.paceStart >= config.dropDate)
    fail(`config.paceStart (${config.paceStart}) must be before dropDate (${config.dropDate})`);
  if (!Number.isInteger(config.ptPerTerm) || config.ptPerTerm < 1)
    fail(`config.ptPerTerm must be an integer >= 1 (got ${config.ptPerTerm})`);
  if (!config.managedBy?.url || !config.managedBy?.label)
    fail(`config.managedBy: label and url are required`);
}

/* If an authoritative module schedule exists for a program, its derived
   counts/targets must match data/courses.json. This keeps hand edits from
   drifting away from the schedule. */
function validateScheduleSync(errors) {
  const schedulePath = join(ROOT, "data/sources/fall-2026-cnsa-module-schedule.json");
  if (!existsSync(schedulePath)) return;
  const config = readJSON("data/config.json");
  const courses = readJSON("data/courses.json");
  const schedule = JSON.parse(readFileSync(schedulePath, "utf8"));
  const derived = derive(schedule, config.dropDate);
  for (const [code, d] of Object.entries(derived)) {
    const cur = courses.cnsa?.[code];
    if (!cur) {
      errors.push(`data/courses.json cnsa: missing course "${code}" from the module schedule`);
      continue;
    }
    for (const key of ["total", "required", "target"]) {
      if (cur[key] !== d[key]) {
        errors.push(
          `cnsa/${code}.${key} is ${cur[key]} but the module schedule derives ${d[key]} ` +
          `(run: node scripts/derive-required.mjs)`
        );
      }
    }
  }
}

function main() {
  const config = readJSON("data/config.json");
  const courses = readJSON("data/courses.json");

  validateDates(config);
  validateScheduleSync(errors);

  for (const key of Object.keys(config.programs)) {
    const courseMeta = courses[key];
    if (!courseMeta) {
      fail(`data/courses.json: no entry for program "${key}"`);
      continue;
    }
    for (const [code, m] of Object.entries(courseMeta)) validateCourse(code, m, key);
    let creds;
    try {
      creds = readJSON(`data/programs/${key}.json`);
    } catch {
      fail(`data/programs/${key}.json is missing`);
      continue;
    }
    validateProgram(key, config.programs[key], creds, courseMeta);
  }

  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (errors.length) {
    console.error(`\n✗ Validation failed with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✓ Validation passed (${warnings.length} warning(s)).`);
}

main();
