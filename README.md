# CNSA / CYS Course Pacing Trackers

[![CI](https://github.com/jacksoel/tstc-pacing-trackers/actions/workflows/ci.yml/badge.svg)](https://github.com/jacksoel/tstc-pacing-trackers/actions/workflows/ci.yml)
[![Deploy](https://github.com/jacksoel/tstc-pacing-trackers/actions/workflows/deploy.yml/badge.svg)](https://github.com/jacksoel/tstc-pacing-trackers/actions/workflows/deploy.yml)

Interactive pacing guides for the TSTC **Computer Networking & Systems
Administration (CNSA)** and **Cybersecurity (CYS)** programs. Students pick
their credential and tracking term; the tracker shows whether they're on pace
for the **Nov. 20, 2026 drop date**.

This repository is also a small, complete **DevOps teaching artifact**: the
data is separate from the code, the build is scripted, every change is tested
before it can ship, and deployment is automated. Nothing here is hand-edited.

---

## The pipeline

```
data/*.json  +  src/template.html  ──►  scripts/build.mjs  ──►  dist/*.html
      │                                                              │
      │  scripts/validate.mjs  (data integrity gate)                 │
      │  test/smoke.mjs        (does the built page render?)         │
      │                                                              ▼
      └────────────────  .github/workflows/ci.yml  ────────►  CI on every PR
                         .github/workflows/deploy.yml  ─────►  publish on merge
```

| Stage | Command | What it proves |
| --- | --- | --- |
| Validate | `node scripts/validate.mjs` | The data is internally consistent |
| Build | `node scripts/build.mjs` | The data renders into two HTML pages |
| Test | `node test/smoke.mjs` | The built pages load and render cleanly |
| Deploy | `.github/workflows/deploy.yml` | Merged changes reach students automatically |

## Repository layout

```
data/                 ← SOURCE OF TRUTH (edit here, never the HTML)
  config.json           drop date, pace anchor, program labels, branding
  courses.json          per-course module counts (keyed by program + code)
  programs/cnsa.json    credentials + term sequences for CNSA
  programs/cys.json     credentials + term sequences for CYS
src/
  template.html         one page shell with /*__TOKEN__*/ placeholders
  theme.css             TSTC brand theme (colors + Hando typeface)
scripts/
  validate.mjs          data integrity checks (the CI gate)
  build.mjs             data + template -> dist/*.html
  publish.mjs           deploy step (OpenArtifacts)
test/
  smoke.mjs             headless render + assertions
dist/                   ← GENERATED. Never edit by hand.
```

## Quick start

```bash
node scripts/validate.mjs   # check the data
node scripts/build.mjs      # produce dist/cnsa.html and dist/cys.html
node test/smoke.mjs         # confirm they render
open dist/cnsa.html         # look at the result
```

## The DevOps ideas on display

1. **Single source of truth.** Course data lives in `data/`, not scattered
   through two HTML files. Change a module count once; both the validation and
   the build see it.
2. **Separation of concerns.** `data/` is what changes often; `src/` is the
   shell; `scripts/` is the machinery. Students editing data never touch code.
3. **Automated testing.** `validate.mjs` encodes the rules a human would
   otherwise have to remember (`required ≤ total`, no duplicate courses, every
   referenced course exists). The smoke test renders the actual artifact.
4. **Continuous integration.** `.github/workflows/ci.yml` runs the three stages
   on every pull request. A rule violation fails the PR — before students see it.
5. **Continuous deployment.** `deploy.yml` builds and publishes on merge to
   `main`. No manual copying.
6. **Secrets management.** The publishing key is a GitHub Secret
   (`COPILOT_PLUS_LICENSE_KEY`), never a committed file. Document IDs are
   GitHub Variables.
7. **Infrastructure / config as code.** The workflows themselves are reviewed
   files in this repo.
8. **Immutable artifacts.** `dist/` is generated and regenerable. If it's ever
   lost, `node scripts/build.mjs` recreates it byte-for-byte from source.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: edit `data/`, open
a pull request, let CI tell you if it's valid.

## Branding & attribution

The theme follows TSTC's published colors and the **Hando** typeface. Pages are
published via [OpenArtifacts](https://openartifacts.ai). Managed by Eric Jackson.
