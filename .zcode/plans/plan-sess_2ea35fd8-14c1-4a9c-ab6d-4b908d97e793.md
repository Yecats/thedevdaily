## Context

The Dev Daily currently runs on Python 3.12 + Flask/waitress. The user wants the identical app rebuilt on **Node.js — no Python anywhere in the repo**. Everything else stays: the Sunday Comics design, the `editions/` folder contract, zero-JS front end, LAN-only security posture, Docker deployment. The Python code gets deleted (recoverable from git history); the Node port must be **behaviorally and visually indistinguishable**, verified by a ported test suite, a route security battery, and screenshot comparison.

## Target stack

- **Node ≥ 20** (machine has 22.19), **Express 4** (stable route wildcard semantics), **markdown-it 14** (the library markdown-it-py was ported *from* — identical rendering semantics with `html:false`), **js-yaml 4** (`load` is safe-by-default = PyYAML `safe_load`), **Nunjucks** (Jinja2 port for JS — templates migrate near-verbatim)
- **Tests:** Node's built-in `node:test` + `assert` — zero dev dependencies; `npm test` = `node --test tests/`
- **package.json deps:** `express`, `markdown-it`, `js-yaml`, `nunjucks` — nothing else

## New layout (mirrors the Python structure)

| Node (new) | Ports from (deleted) |
|---|---|
| `server.js` (root entry) | `run.py` + `devdaily/cli.py` — parseArgs (`node:util`), env precedence unchanged (`DEVDAILY_EDITIONS/HOST/PORT/IMAGES_DIRNAME`, defaults `./editions` / `127.0.0.1` / `8787`), startup banner |
| `server/parsing.js` | `devdaily/parsing.py` — line-based fence-aware parser, regexes ported 1:1, `EditionError`, `Issue/Story/BrokenIssue` as plain classes |
| `server/rendering.js` | `devdaily/rendering.py` — markdown-it config, date-name tables, `resolveMedia`, `sanitizeFragment`, `externalHttpUrl`, image-extension allowlist |
| `server/library.js` | `devdaily/library.py` — mtime/size cache, scan/issues/newest/get/editionNumber (no thread lock needed — single-threaded) |
| `server/routes.js` | `devdaily/routes.py` — all routes + `_frontContext` view-model incl. section filtering, roundup exclusion, topics-only TOC |
| `server/app.js` | `devdaily/__init__.py` — `createApp(editionsDir)`: express app, `/static` via `express.static`, nunjucks config, error handlers |
| `server/templates/*.njk` | `devdaily/templates/*.html` — ported; `{% extends/include/block %}`, `| safe`, `loop.first`, inline `if/else` all exist in Nunjucks |
| `server/static/**` | copied unchanged (paper.css, fonts + OFL.txt, artwork) |
| `tests/*.test.js` + `tests/helpers.js` | `tests/*.py` + `conftest.py` — all 60 tests ported (17 parsing, 15 rendering, 5 library, 23 routes) |
| `package.json` | replaces `requirements.txt` |

**Delete:** `devdaily/`, `run.py`, `requirements.txt`, `tests/*.py`, `.pytest_cache/`.

## Known porting gotchas (encode in the port, test for each)

1. **Regexes:** Python `re.match` anchors at start → JS needs explicit `^`; `re.DOTALL` → `s` flag; keep error-message strings **identical** so tests assert the same substrings ("frontmatter", "does not match", "coverage").
2. **BOM:** read files and strip leading `\uFEFF` (Python used `utf-8-sig`).
3. **Dates as ISO strings** throughout — string compare for ordering; `YYYY-MM-DD` validation via regex + UTC round-trip (rejects `2026-02-30`); explicit month/weekday tables port as-is.
4. **URL encoding:** Python `quote(rel)` keeps `/` — JS: `rel.split('/').map(encodeURIComponent).join('/')`; `unquote` → `decodeURIComponent` **wrapped in try/catch** (JS throws on malformed `%`, Python is lenient).
5. **Path containment:** `fs.realpathSync` for the strict resolve; containment = `path.relative(base, target)` not starting with `..` and not absolute — mirrors `Path.is_relative_to`.
6. **Slugify:** `normalize('NFKD')` + strip combining marks (`[\u0300-\u036f]`) before the ascii/alnum fold.
7. **Templates:** `url_for('static', ...)` → literal `/static/...`; Jinja `'%03d' | format(n)` has no Nunjucks equivalent → **precompute padded edition numbers in routes** (`String(n).padStart(3,'0')`); registered-but-unused Python date filters are dropped.
8. **Media route stays manual** (not `express.static`): reject `\` and `..` segments, realpath containment, extension allowlist, `res.sendFile` + `Cache-Control: max-age=300` — identical guard order to Python.
9. **Express 4** chosen over 5 deliberately (`/media/*` wildcard + `req.params[0]` semantics unchanged).
10. **Concurrency:** waitress `threads=8` → Node event loop; fine for this workload, nothing to port.

## Collateral updates

- **Dockerfile:** `FROM node:22-slim`, `npm ci --omit=dev`, keep non-root `USER`, same ENV block, `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/healthz')..."`, `CMD ["node", "server.js"]`
- **docker-compose.yml:** unchanged
- **README.md:** Node quick start (`node -v` 20+, `npm install`, `npm start` + same flag/env table), `npm test`, structure block; publishing/LAN/skill sections unchanged
- **.gitignore:** add `node_modules/` (keep OS junk); **.dockerignore:** swap Python entries for `node_modules`, `package-lock.json` stays copied for `npm ci`
- **Unchanged:** `editions/` (both trial editions + images), `skills/`, `EDITION_TEMPLATE.md`, `LICENSE`, `docker-compose.yml`

## Verification (end-to-end)

1. `npm test` — all 60 ported tests pass (same assertions as the Python suite)
2. Stop the running Python server (background task on 8787), start the Node server on 8787
3. Route battery via curl/scripts: home shows both editions correctly (front = Nov 7 Claude story, #002), archive newest-first with padded numbers, article 200 + image + credit, `?section=3d-printing` filtering, hotlinked https images, `/media/...` 200 vs traversal/symlink/extension 404s, raw-HTML escaping, `javascript:` unwrapping, healthz, friendly 404s
4. **Visual parity:** Playwright screenshots (Node vs Python baseline) — desktop 1280 front/article/archive + 320px, confirm zero horizontal overflow and identical layout
5. Restart-resilience: add nothing to disk, touch an edition file → refresh shows changes (mtime cache)

## Ship

Single commit on `main`: "Rebuild The Dev Daily in Node.js (no Python)" — then push to origin (repo is public; user has pushed straight to main each time). The old implementation remains recoverable at the previous commit.