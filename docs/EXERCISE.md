# Student Exercise: Ship a Change Through the Pipeline

**Goal:** make one small data change, open a pull request, and watch automation
test and deploy it. You will not write any HTML.

**Time:** ~20 minutes.

---

## Background

This repo builds two student-facing pacing trackers from a JSON data source.
The rules that keep the trackers correct are encoded as scripts, and those
scripts run automatically on every pull request. Your job is to experience that
loop: **edit → test → review → deploy.**

```
data/*.json  →  validate  →  build  →  smoke test  →  (merge)  →  deploy
```

---

## Step 0 — Set up

```bash
git clone https://github.com/jacksoel/tstc-pacing-trackers.git
cd tstc-pacing-trackers
node scripts/validate.mjs   # should pass
node scripts/build.mjs      # should build dist/cnsa.html and dist/cys.html
node test/smoke.mjs         # should pass
```

Then open `dist/cnsa.html` in a browser and click around. That page is
**generated**, not hand-written.

---

## Step 1 — Find something to fix

Pick a course that shows a **warning** during validation. Run:

```bash
node scripts/validate.mjs
```

You'll see lines like:

```
warning: cys/ITSY1342: modules known but no drop-date target set
```

Open `data/courses.json` and find that course. It looks like:

```json
"ITSY1342": { "title": "Information Technology Security", "total": 5, "required": null, "target": null }
```

A `null` means "not set yet." Your task: set it.

---

## Step 2 — Make the change on a branch

```bash
git checkout -b exercise/set-itsy1342-target
```

Edit `data/courses.json`: give `ITSY1342` a `required` you can justify. For
example, if the course requires finishing 3 of 5 modules by Nov. 20:

```json
"ITSY1342": { "title": "Information Technology Security", "total": 5, "required": 3, "target": 4 }
```

Rebuild and look at the page again — your course now shows a required zone and
a real progress bar.

```bash
node scripts/build.mjs
open dist/cys.html
```

---

## Step 3 — Run the checks (what CI will do)

```bash
node scripts/validate.mjs
node scripts/build.mjs
node test/smoke.mjs
```

All three must pass. This is exactly what runs in the cloud on your PR.

---

## Step 4 — Commit and open a pull request

```bash
git add data/
git commit -m "data(cys): set ITSY1342 drop-date target to 3"
git push -u origin exercise/set-itsy1342-target
gh pr create --fill     # or open the PR in the GitHub web UI
```

Watch the **Actions** tab. The **CI** workflow runs `validate`, `build`, and
`smoke`. It turns green when your data is valid.

---

## Step 5 — Prove the gate works (the important part)

Now deliberately break the rule. On the same branch, set `required` higher than
the number of modules:

```json
"ITSY1342": { "title": "...", "total": 5, "required": 9, "target": 9 }
```

```bash
node scripts/validate.mjs   # fails locally — read the message
git commit -am "data(cys): deliberately break the rule"
git push
```

CI now fails the PR with a message naming the exact course and rule:

```
- cys/ITSY1342: required (9) exceeds total (5)
```

**What you just learned:** the pipeline will not let a bad data edit reach
students. The error is specific and actionable. Fix it, push again, and CI
goes green.

---

## Step 6 — Merge and deploy

Once CI is green and a reviewer approves, **merge to `main`**. The **Deploy**
workflow runs automatically and publishes the updated tracker to OpenArtifacts.
No one copies files by hand.

---

## What to turn in

1. The URL of your merged pull request.
2. One screenshot of the **failed** CI run from Step 5.
3. One sentence: which pipeline stage caught your error, and why that matters
   for a page students rely on.

---

## Concepts you touched

| Concept | Where you used it |
| --- | --- |
| Version control & branching | Step 2 |
| Single source of truth | Editing `data/`, never `dist/` |
| Build automation | `scripts/build.mjs` |
| Automated testing | `scripts/validate.mjs`, `test/smoke.mjs` |
| Continuous integration | Step 4 — CI on the PR |
| Failure as feedback | Step 5 — a red check with a precise message |
| Continuous deployment | Step 6 — publish on merge |
| Secrets management | The publish key lives in repo Secrets, not code |
