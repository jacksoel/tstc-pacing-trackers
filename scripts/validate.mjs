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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadSchedules, planScheduleSync } from "./derive-required.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!ISO.test(config.dropDate)) fail(`config.dropDate must be YYYY-MM-DD (got "${config.dropDate}")`);
  if (!ISO.test(config.paceStart)) fail(`config.paceStart must be YYYY-MM-DD (got "${config.paceStart}")`);
  if (ISO.test(config.dropDate) && ISO.test(config.paceStart) && config.paceStart >= config.dropDate)
    fail(`config.paceStart (${config.paceStart}) must be before dropDate (${config.dropDate})`);
  if (!Number.isInteger(config.ptPerTerm) || config.ptPerTerm < 1)
    fail(`config.ptPerTerm must be an integer >= 1 (got ${config.ptPerTerm})`);
  if (!config.managedBy?.url || !config.managedBy?.label)
    fail(`config.managedBy: label and url are required`);
}

/* The schedule documents ARE the source of truth, so a malformed one must fail
   loudly rather than silently deriving nonsense. Checks the shape of every file
   named in config.schedules. (A code may appear in more than one schedule — the
   two must then derive identical values, which validateScheduleSync enforces.) */
function validateSchedules(config) {
  if (!Array.isArray(config.schedules) || config.schedules.length === 0)
    return fail(`config.schedules must be a non-empty array`);

  let loaded;
  try {
    loaded = loadSchedules(config);
  } catch (err) {
    return fail(`config.schedules: ${err.message}`);
  }

  for (const { program, file, schedule } of loaded) {
    if (!config.programs?.[program])
      fail(`config.schedules: "${program}" is not a configured program (${file})`);
    if (!Array.isArray(schedule.courses) || schedule.courses.length === 0) {
      fail(`${file}: courses must be a non-empty array`);
      continue;
    }
    const seen = new Set();
    for (const c of schedule.courses) {
      const at = `${file} ${c.code || "(no code)"}`;
      if (!c.code) fail(`${file}: a course entry is missing "code"`);
      else if (seen.has(c.code)) fail(`${at}: declared more than once in ${file}`);
      else seen.add(c.code);

      if (!Number.isInteger(c.modules) || c.modules <= 0)
        fail(`${at}: modules must be a positive integer`);

      if (c.moduleDates != null) {
        // Explicit per-module dates. Length must match `modules`, the dates must
        // be YYYY-MM-DD, and they must be strictly ascending (module order).
        if (!Array.isArray(c.moduleDates) || c.moduleDates.length === 0) {
          fail(`${at}: moduleDates must be a non-empty array when present`);
        } else {
          if (c.moduleDates.length !== c.modules)
            fail(`${at}: moduleDates has ${c.moduleDates.length} entries but modules is ${c.modules}`);
          c.moduleDates.forEach((d, i) => {
            if (!ISO.test(d)) fail(`${at}: moduleDates[${i}] is not YYYY-MM-DD (got "${d}")`);
            if (i > 0 && c.moduleDates[i - 1] >= d)
              fail(`${at}: moduleDates must be strictly ascending (${c.moduleDates[i - 1]} then ${d})`);
          });
        }
      } else {
        // Interpolated form: first/last module date across `modules`.
        if (!ISO.test(c.firstModule)) fail(`${at}: firstModule must be YYYY-MM-DD`);
        if (!ISO.test(c.lastModule)) fail(`${at}: lastModule must be YYYY-MM-DD`);
        if (c.firstModule >= c.lastModule) fail(`${at}: firstModule must be before lastModule`);
      }
    }
  }
}

/* Every program block that references a scheduled course must agree with the
   derived counts/targets. This is what keeps a course shared by two programs
   (e.g. ITNW1358 on CNSA + CYS) from drifting — a hand edit to either copy
   fails CI. */
function validateScheduleSync(errors) {
  const config = readJSON("data/config.json");
  const courses = readJSON("data/courses.json");

  let plan;
  try {
    plan = planScheduleSync(courses, config);
  } catch (err) {
    errors.push(`schedule sync: ${err.message}`);
    return;
  }

  for (const m of plan.missing) errors.push(m);
  for (const d of plan.drift) {
    errors.push(
      `${d.program}/${d.code}.${d.key} is ${d.from} but the module schedule derives ${d.to} ` +
      `(run: node scripts/derive-required.mjs)`
    );
  }
}

function main() {
  const config = readJSON("data/config.json");
  const courses = readJSON("data/courses.json");

  validateDates(config);
  validateSchedules(config);
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
