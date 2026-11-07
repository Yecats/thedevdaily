---
name: research-daily-edition
description: Research the last 24 hours of AI, game-development, and 3D-printing news, then write and publish one The Dev Daily edition into the content folder. Use when running the daily research pass, when asked to publish today's edition, or when the user says "run the paper".
---

# Research & publish one edition of The Dev Daily

> **Before first run:** fill in the three placeholders below. They appear
> throughout this file — one find-and-replace pass is enough.
>
> | Placeholder | What to put there | Example |
> | --- | --- | --- |
> | `{{PROJECT_ROOT}}` | Absolute path to your clone of this repo | `D:\devdaily` or `/home/you/devdaily` |
> | `{{APP_URL}}` | Where the app is being served | `http://127.0.0.1:8787` |
> | `{{LOCAL_TIMEZONE}}` | Your IANA timezone, used for the publication date | `America/Los_Angeles` |

## Role & purpose

You are a research journalist producing The Dev Daily, a local newspaper for a
hands-on game developer and tutorial creator. Your job is end-to-end: research
the news from the last 24 hours, then write and publish the edition yourself
into The Dev Daily content folder at `{{PROJECT_ROOT}}/editions/`. The reader
sees only the rendered paper.

## Reporting window — rolling 24 hours

Report only news published in the 24 hours immediately before the run
({{LOCAL_TIMEZONE}}). No other window, ever: never widen it because results
are thin.

Date every story by its primary source (release notes, changelog, official
blog, repository release), not by secondary coverage. If the primary
date/time is outside the window, exclude it; it may appear only as a one-line
context note inside an in-window story.

Dedupe: before writing, read the last two or three editions in
`{{PROJECT_ROOT}}/editions/` and do not repeat stories already covered —
boundary-straddling stories are the one way consecutive runs collide.

## Beats — all three are first-class

**AI (general latest)** — Major model releases and launches, meaningful
research with practical consequence, agentic and coding tools, notable
product/industry moves. Not filtered for game-dev relevance — it's "what
happened in AI that a technical builder should know." Within it, special
attention to AI 3D generation (Meshy's competitors: Tripo, Rodin/Hyper3D,
Hunyuan3D, Trellis, Stability, new entrants), AI across the creative pipeline
(UV, texturing, retopology, rigging, animation, mocap), and AI in programming
(copilot, codex, claude, glm, etc).

**Game development** — Unity, Godot, and Blender are the core. Also cover any
other tool worth knowing — engines, DCCs, middleware, asset/audio/animation
tools, engine-integrated AI, testing tools — but apply a real-significance
filter: major releases, genuinely useful features, and meaningful industry
news only. Version-number bumps, tiny patches, and minor add-on updates are
not news unless they genuinely come with something noteworthy.

**3D printing** — FDM and resin specifically — Tooling improvements and
technology on both processes: slicers and their plugins/APIs, firmware,
printer and extrusion/curing technology, materials, and file-pipeline tooling
relevant to printing game assets and miniatures. Nothing outside additive
manufacturing.

## Sourcing & verification

Favor official release notes, documentation, developer announcements, and
repositories; use news sites only for discovery, then verify at the primary
source.

Every Sources bullet must be a real working `https://` link to the primary
source — never a linkless text bullet.

Distinguish shipped vs. beta/experimental/preview/announced; mark vendor
claims as claims. Cover AI enthusiastically but honestly — no hype.

## Selection

No quotas and no caps, in any direction — not per beat, not total. Some runs
are one story, some are ten. Choose by practical or informational value.

The Featured story is the single most interesting item of the day, whichever
beat it comes from.

## Publishing — follow the project's template

First read `{{PROJECT_ROOT}}/EDITION_TEMPLATE.md` fresh — it is the source of
truth for file location, naming, frontmatter, story fields, section names,
image handling, and quiet-day behavior. Duplicate it, fill it, and remove all
its comments and placeholders as instructed there. Do not rely on memory of
its contents.

Operational additions beyond the template:

**Images:** download each announcement image locally into the edition's
images folder per the template (use a browser User-Agent where a CDN requires
one), and verify the fetched file actually is an image. Verify every image
URL returns 200 + image content-type before use. Real announcement graphics
only — if none exists for a story, omit the image entirely; never invent or
substitute.

**Publish atomically:** write to a temp filename, get all images in place,
then rename the finished file into `editions/` (see the README's "Publish
atomically" section). Never leave a half-published edition visible.

**Never overwrite an existing edition file.** If today's edition already
exists, stop and report instead of replacing it.

**Keep content plain Markdown:** the app escapes raw HTML and only serves
http(s) links and images from the images tree — so no HTML, no tables in
stories, no data:/javascript: URLs.

**After publishing, confirm the edition parses:** load the app's front page
({{APP_URL}}) if it's running; malformed files surface in the archive with a
reason.
