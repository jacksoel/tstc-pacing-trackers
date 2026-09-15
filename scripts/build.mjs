#!/usr/bin/env node
/**
 * build.mjs — data + template -> dist/<program>.html
 *
 * This is the "build" stage of the pipeline. It reads the JSON source of
 * truth in data/ and src/template.html, substitutes tokens, and writes a
 * fully self-contained HTML file per program into dist/.
 *
 * Run:  node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

function main() {
  const config = readJSON("data/config.json");
  const courses = readJSON("data/courses.json");
  const template = readFileSync(join(ROOT, "src/template.html"), "utf8");
  const theme = readFileSync(join(ROOT, "src/theme.css"), "utf8");

  const programs = Object.keys(config.programs);
  mkdirSync(join(ROOT, "dist"), { recursive: true });

  const manifest = [];

  for (const key of programs) {
    const prog = config.programs[key];
    const creds = readJSON(`data/programs/${key}.json`);
    const courseMeta = courses[key];
    if (!courseMeta) throw new Error(`No course metadata for program "${key}"`);
    if (!creds) throw new Error(`No credential data for program "${key}"`);

    const title = `${prog.shortName} Course Pacing Tracker`;
    const order = prog.credentialOrder;

    let html = template;
    const subs = {
      "/*__THEME__*/": theme,
      // JSON embedded in <script>: escape "<" so a "</script>" in data can't
      // close the tag early. (Safe JSON-in-HTML hardening.)
      "/*__COURSE_META__*/": jsonForScript(courseMeta),
      "/*__CREDENTIALS__*/": jsonForScript(creds),
      "/*__CRED_ORDER__*/": jsonForScript(order),
      "/*__PACE_START__*/": `new Date(${ymdToArgs(config.paceStart)})`,
      "/*__DROP_DATE__*/": `new Date(${ymdToArgs(config.dropDate)})`,
      "/*__PT_PER_TERM__*/": String(config.ptPerTerm),
      // eyebrow/title are plain text -> escape. subtitle intentionally contains
      // markup (<strong>) and is injected verbatim.
      "/*__EYEBROW__*/": escapeHtml(prog.eyebrow),
      "/*__SUBTITLE__*/": prog.subtitle,
      "/*__TITLE__*/": escapeHtml(title),
      "/*__PROGRAM_NAME__*/": escapeHtml(prog.name),
      "/*__ORG__*/": escapeHtml(config.brand.org),
      "/*__MARK__*/": escapeHtml(config.brand.mark),
      "/*__MANAGED_URL__*/": escapeHtml(config.managedBy.url),
      "/*__MANAGED_LABEL__*/": escapeHtml(config.managedBy.label),
    };

    for (const [token, value] of Object.entries(subs)) {
      if (!html.includes(token)) {
        throw new Error(`Template is missing token ${token} for program "${key}"`);
      }
      html = html.replaceAll(token, value);
    }

    const left = html.match(/\/\*__[A-Z_]+__\*\//g);
    if (left) throw new Error(`Unsubstituted tokens for "${key}": ${left.join(", ")}`);

    const outPath = join(ROOT, "dist", `${key}.html`);
    writeFileSync(outPath, html, "utf8");
    manifest.push({ program: key, title, out: `dist/${key}.html`, bytes: html.length });
    console.log(`built dist/${key}.html (${html.length} bytes)`);
  }

  writeFileSync(
    join(ROOT, "dist/manifest.json"),
    JSON.stringify({ artifacts: manifest }, null, 2) + "\n"
  );
  console.log(`\nBuild complete: ${manifest.length} artifact(s).`);
}

/** "2026-11-20" -> "2026, 10, 20" (zero-based month for `new Date(y, m, d)`) */
function ymdToArgs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}, ${m - 1}, ${d}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Pretty JSON safe to embed inside a <script> block. */
function jsonForScript(value) {
  return JSON.stringify(value, null, 2).replaceAll("<", "\\u003c");
}

main();
