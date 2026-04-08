# Arch IDE — AI Development Contract

This file is read at the start of every session. It defines conventions, forbidden patterns, and the reasoning behind key architectural decisions. Update it whenever a significant decision is made.

---

## Project Overview

Arch IDE is a backend-first tool that ingests a repository, builds a SQLite-backed architectural model, and surfaces architecture-level change intelligence at session start. There is no Electron shell yet — all code is Node.js ESM modules.

**Entry points:**
- `scripts/ingest.js` — FR-0: repo ingestion, produces `.arch-ide/arch.db`
- `scripts/session-start.js` — FR-1: session start change surfacing

---

## Module Structure

Every module follows this layout, in this order:

```
1. Imports (external first, then internal)
2. Constants (with source/reason comments — see Constants section below)
3. Exported functions (public API)
4. Internal helper functions
```

New modules must follow this template. Stating "add a new module following the standard layout" is sufficient in a prompt — do not deviate from this order.

### Module types and their locations

| Type | Location | Purpose |
|---|---|---|
| Ingestion stages | `src/ingestion/` | FR-0: walk, parse, cluster, hypothesise |
| Session stages | `src/session/` | FR-1+: git diff, drift, reporting |
| CLI scripts | `scripts/` | Thin commander wrappers only — no logic |
| DB utilities | `src/ingestion/db.js` | All SQLite schema and query helpers |

---

## Coding Conventions

### Explicit over implicit
Never make the model infer intent. Constants, constraints, and decisions must be stated — not deduced from surrounding code.

### Comment the *why*, not the *what*
Code shows what it does. Comments explain why a decision was made, especially when the code looks like it could be simplified or removed.

### One source of truth
Any value, rule, or enumeration referenced in multiple places lives in exactly one location. Drift between copies is a primary source of bugs.

### No magic numbers
Every non-trivial constant must have a comment stating:
- Where the value came from
- When it was last verified
- Any measurement gotchas (e.g. "this is the encoded size, not the raw size")

### Grep-able markers
Use structured comment tags to mark locations affected by a specific class of change:

```js
// @[SCHEMA_CHANGE] — update this query if the files table gains new columns
// @[SECURITY_REVIEW] — this list must be audited before any permission system changes
// @[RELEASE] — bump this constant when cutting a release
```

A single grep for `@[SCHEMA_CHANGE]` must find every location that needs updating when the schema changes. Apply these at call sites, not just definition sites.

---

## Forbidden Patterns

**Do not:**
- Add logic to CLI scripts (`scripts/`) — they are thin wrappers only
- Use `db.js` functions that don't exist yet — add them to `db.js` and export them; do not inline raw SQL outside of `db.js` except for session-specific queries documented in `src/session/index.js`
- Leave string literals for status values, modes, or error types scattered across files — centralise them
- Use `console.log` outside of CLI entry points and the session/report formatter
- Add LLM calls to session modules — FR-1 is intentionally local-only (SQLite + git, <500ms target)
- Remove or inline a named workaround without first confirming the underlying cause is resolved

---

## "Do Not Change" Zones

### `src/ingestion/db.js` — schema block (lines 4–83)
The `SCHEMA` constant defines all tables. The `CREATE TABLE IF NOT EXISTS` pattern is intentional — it makes `openDb` idempotent on existing databases. Do not change it to explicit CREATE without IF NOT EXISTS.

### `package.json` — `"type": "module"`
All imports use ESM. Node `--experimental-sqlite` is required for `DatabaseSync`. Do not convert to CommonJS.

### `scripts/session-start.js` and `scripts/ingest.js` — shebang line
`#!/usr/bin/env node` must remain the first line exactly. It is required for the scripts to run as executables.

---

## Error Handling

Use named error types (or error objects with a `type` field) for distinct failure modes — not generic `Error` with string messages. Attach structured recovery data to the error where possible.

Example pattern used in `src/session/git.js`:
```js
return { error: 'no_git', errorDetail: err.message }
// Callers check `result.error` — they do not parse strings
```

Error mode strings are treated as enumerations. If you add a new mode, add it to the `meta.mode` values documented in `src/session/report.js` and update the formatter switch.

---

## Security

All security-sensitive constants (blocked paths, permission levels, sensitive operations) must live in a single dedicated location with per-entry inline comments explaining why each entry exists.

When adding a permission or access rule, include a comment indicating its origin (user config, project config, CLI argument, hardcoded policy) so denials can be explained accurately without additional investigation.

---

## Feature Flags / Conditional Code

When code is conditionally active (environment-specific, experimental, disabled by default), make the condition explicit and named. Add a comment at the condition site stating what the flag controls and who it applies to. Do not bury "only runs in production" assumptions in logic.

---

## Data Structures and Schemas

Every field in a data structure, DB row shape, or return type should have a comment or description stating its purpose and constraints — not just restating the name.

Return type shapes for exported functions should be documented in a JSDoc comment above the function. Example:

```js
/**
 * @returns {{ changedFiles: Array<{path: string, status: string}>, fileAuthors: Map, commits: Array, fromCommitHash: string|null, toCommitHash: string, error?: string }}
 */
export async function getGitChanges(targetPath, baselineTimestamp) {
```

---

## Platform Quirks

Any workaround for a platform-specific behaviour, version difference, or environmental quirk must be extracted into a small, well-named function with a comment citing the exact cause.

**Known quirk — SQLite timestamp format:**
`completed_at` is stored as `YYYY-MM-DD HH:MM:SS` (SQLite `datetime('now')` format, no `T`, no `Z`).
When passing to `isomorphic-git`'s `since:` option, append `'Z'` and replace the space with `'T'`:
```js
new Date(baselineTimestamp.replace(' ', 'T') + 'Z')
```
<!-- Do not remove this workaround — SQLite does not store timezone info, so the Z is required to treat the value as UTC -->

---

## Architectural Decisions

### Why SQLite (not a file-based store)?
The graph, cluster, and hypothesis data is relational — files belong to clusters, clusters belong to layers. SQLite gives us joins and indexed queries without a server. `DatabaseSync` (Node 22.5+) keeps the API synchronous, matching the rest of the ingestion pipeline.

### Why `isomorphic-git` (not `simple-git` or `child_process`)?
`isomorphic-git` reads git objects directly without spawning a subprocess. This keeps session start fast and avoids shell injection vectors. The tree-diffing approach (compare OIDs between parent and commit trees) is lower-level but does not require the git binary to be on `PATH`.

### Why is FR-1 (session start) local-only with no LLM calls?
Session start must complete in <500ms to be viable as an IDE hook. LLM calls add latency and cost that would make this unusable as an always-on feature. Drift signals are deterministic rules, not heuristics — they do not need a model.

### Why are session-specific DB queries inlined in `src/session/index.js`?
The two queries (latest completed run, latest validated hypothesis) are session-specific reads with no write side-effects. Adding them to `db.js` would pollute a module that is otherwise focused on ingestion schema management. This is an intentional exception — all other DB access goes through `db.js`.

---

## Subdirectory Contracts

- `src/ingestion/CLAUDE.md` — ingestion pipeline conventions *(add when ingestion grows)*
- `src/session/CLAUDE.md` — session module conventions *(add when session grows)*
