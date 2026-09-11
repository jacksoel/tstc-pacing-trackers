# Contributing

Most changes are **data changes** — a module count, a drop-date target, a term
sequence. You edit JSON, open a pull request, and CI checks your work. You do
not need to touch any HTML.

## The workflow (this is the lesson)

```bash
# 1. Branch
git checkout -b fix/itsy1342-target

# 2. Edit the data
#    e.g. open data/programs/cys.json and change a course's target

# 3. Run the same checks CI will run
node scripts/validate.mjs
node scripts/build.mjs
node test/smoke.mjs

# 4. Commit with a clear message
git add data/
git commit -m "fix(cys): set ITSY1342 drop-date target to 3"

# 5. Push and open a pull request
git push -u origin fix/itsy1342-target
```

CI runs automatically. If it's green and a reviewer approves, merging to `main`
publishes the updated tracker.

## Where each value lives

**A course's module numbers** — `data/courses.json`, under the program key:

```json
"cys": {
  "ITSY1342": { "title": "Information Technology Security", "total": 5, "required": null, "target": null }
}
```

- `total` — how many modules the course has (`null` = not yet mapped)
- `required` — modules that must be done by Nov. 20 (`null` = target not set)
- `target` — recommended pace, `≥ required` (`null` = none)

**A program's term structure** — `data/programs/<program>.json`. Each credential
lists `terms`, and each term lists course codes. A `terms[].options` array marks
a "choose one" group.

**Dates and labels** — `data/config.json` (`dropDate`, `paceStart`, program
names, branding, the managed-by link).

## The rules CI enforces

From `scripts/validate.mjs`:

- `required ≤ total` and `target ≥ required` for every course
- Every course referenced by a credential exists in `courses.json`
- No course appears twice within one credential
- `dropDate` is after `paceStart`; both are `YYYY-MM-DD`
- Every credential in `credentialOrder` exists

If your pull request goes red, read the error — it names the exact course and
rule. Fix the data and push again; CI re-runs.

## What NOT to do

- **Don't edit `dist/`.** It's generated. Your change will be overwritten.
- **Don't edit `src/template.html` for a data fix.** Data belongs in `data/`.
- **Don't commit secrets.** The publishing key is a GitHub Secret.

## Changing the UI or theme

If you're changing layout or branding, edit `src/template.html` or
`src/theme.css`, rebuild, and include a screenshot of `dist/<program>.html` in
your pull request so reviewers can see the result.
