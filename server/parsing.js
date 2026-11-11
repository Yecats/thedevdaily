'use strict';

/**
 * Structural parsing of edition Markdown files.
 *
 * The template (EDITION_TEMPLATE.md) is the contract:
 *
 * - one H1 is the issue heading,
 * - each H2 starts a story,
 * - each H3 inside a story is an article section rendered in order,
 * - the labeled story fields are `Section`, `Featured`, `News date`,
 *   `Availability`, `Tags` and `Summary`.
 *
 * Structure is parsed from the raw lines (outside code fences) so a heading
 * inside a code fence can never split a story, and so field lines are read
 * even when a Markdown renderer would merge consecutive lines into one
 * paragraph. A summary that wraps across lines is supported.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Edition id: `YYYY-MM-DD` or `YYYY-MM-DD-HH` (hour 00–23, LA-local,
// zero-padded). The two-digit shape is checked here; the 00–23 range is
// checked where the id is validated, so an out-of-range hour surfaces as a
// broken file with a clear reason instead of vanishing from the paper.
const EDITION_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?\.md$/;
const EDITION_ID_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?$/;

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const FIELD_RE = /^\s*\*\*(Section|Featured|News date|Availability|Tags|Summary)(?:\s*:)?\*\*\s*:?\s*(.*)$/i;
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)\s*$/;
const CREDIT_RE = /^\s*\*\s*(Image credit\b.*)$/i;
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Full ISO 8601 timestamp with an explicit zone (Z or ±HH:MM). The instant
// is verified by round-trip below, since Date.parse rolls bogus calendar
// values over (2026-11-31 silently becomes December 1).
const ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

const REQUIRED_META_KEYS = ['title', 'edition_date', 'coverage_start', 'coverage_end'];

const DEFAULT_SECTION = 'Other Tools';

class EditionError extends Error {}

class StorySection {
  constructor(heading, content) {
    this.heading = heading;
    this.content = content;
  }
}

class Story {
  constructor(fields) {
    Object.assign(this, fields);
  }
}

class Issue {
  constructor(fields) {
    Object.assign(this, fields);
  }
}

class BrokenIssue {
  constructor(filename, reason) {
    this.filename = filename;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

/**
 * Validate an edition id: `YYYY-MM-DD` or `YYYY-MM-DD-HH`, never coerced to
 * a Date. YAML turns a bare `2026-11-10` scalar into a Date at UTC midnight,
 * so a Date is normalized back with UTC calendar parts — that is exactly the
 * day the author wrote, on any machine — and a Date carrying any time of
 * day cannot name an edition at all.
 */
function asEditionId(value, label) {
  if (value instanceof Date) {
    const atMidnightUtc =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    if (atMidnightUtc) {
      return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    }
    throw new EditionError(
      `${label} must be a YYYY-MM-DD or YYYY-MM-DD-HH edition id, got a value with a time of day.`
    );
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = EDITION_ID_RE.exec(trimmed);
    if (match) {
      if (match[2] !== undefined && Number(match[2]) > 23) {
        throw new EditionError(
          `${label} hour ${match[2]} is out of range (must be 00–23).`
        );
      }
      return trimmed;
    }
  }
  throw new EditionError(
    `${label} must be a YYYY-MM-DD or YYYY-MM-DD-HH edition id, got ${JSON.stringify(value)}`
  );
}

/**
 * Epoch milliseconds for a bare `YYYY-MM-DD` date (UTC midnight) or a full
 * ISO 8601 timestamp, or null when the value is not a real instant.
 * Calendar fields are verified by round-trip; Date.parse alone would accept
 * things like November 31 by rolling them into December.
 */
function toInstant(raw) {
  const dateMatch = ISO_DATE_RE.exec(raw);
  if (dateMatch) {
    const [y, m, d] = raw.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const check = new Date(t);
    const real =
      check.getUTCFullYear() === y &&
      check.getUTCMonth() === m - 1 &&
      check.getUTCDate() === d;
    return real ? t : null;
  }
  const tsMatch = ISO_TIMESTAMP_RE.exec(raw);
  if (!tsMatch) return null;
  const [y, mo, d, hh, mi] = tsMatch.slice(1, 6).map(Number);
  const ss = tsMatch[6] === undefined ? 0 : Number(tsMatch[6]);
  const ms = tsMatch[7] ? Number((tsMatch[7] + '00').slice(0, 3)) : 0;
  let offsetMs = 0;
  if (tsMatch[8] !== 'Z') {
    const offH = Number(tsMatch[10]);
    const offM = Number(tsMatch[11]);
    if (offH > 23 || offM > 59) return null;
    offsetMs = (offH * 60 + offM) * 60000 * (tsMatch[9] === '-' ? -1 : 1);
  }
  const wall = Date.UTC(y, mo - 1, d, hh, mi, ss, ms);
  const check = new Date(wall);
  const real =
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === mo - 1 &&
    check.getUTCDate() === d &&
    check.getUTCHours() === hh &&
    check.getUTCMinutes() === mi &&
    check.getUTCSeconds() === ss &&
    check.getUTCMilliseconds() === ms;
  return real ? wall - offsetMs : null;
}

/**
 * Validate a coverage bound: a bare `YYYY-MM-DD` date OR a full ISO 8601
 * timestamp. Returns the raw string (for display, kept exactly as authored)
 * and the parsed instant (for ordering, since old date-only and new
 * timestamp values can never be compared as strings).
 */
function asCoverage(value, label) {
  if (value instanceof Date) {
    // js-yaml reads a bare `2026-11-09` scalar as midnight UTC; the UTC
    // parts are the day as authored, on every machine.
    const atMidnightUtc =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    const raw = atMidnightUtc
      ? `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`
      : value.toISOString();
    return { raw, instant: value.getTime() };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const instant = toInstant(trimmed);
    if (instant !== null) return { raw: trimmed, instant };
  }
  throw new EditionError(
    `${label} must be a YYYY-MM-DD date or an ISO 8601 timestamp, got ${JSON.stringify(value)}`
  );
}

function parseFrontmatter(text, filename) {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    throw new EditionError(
      "Missing YAML frontmatter (the file must start with '---')."
    );
  }
  let meta;
  try {
    meta = yaml.load(match[1]);
  } catch (err) {
    throw new EditionError(`Invalid YAML frontmatter: ${err.message}`);
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new EditionError('YAML frontmatter must be a mapping of keys to values.');
  }
  for (const key of REQUIRED_META_KEYS) {
    const value = meta[key];
    if (value === undefined || value === null || value === '') {
      throw new EditionError(`Frontmatter is missing the required '${key}' key.`);
    }
  }
  return { meta, body: match[2] };
}

// ---------------------------------------------------------------------------
// body splitting
// ---------------------------------------------------------------------------

function fenceMarker(line) {
  const match = FENCE_RE.exec(line);
  return match ? match[1] : null;
}

function isClosingFence(line, marker) {
  const match = CLOSING_FENCE_RE.exec(line);
  return Boolean(match && match[1][0] === marker[0] && match[1].length >= marker.length);
}

/** Split the body into the issue heading and per-story raw line blocks. */
function splitBody(body) {
  let heading = null;
  const stories = [];
  let current = null;
  let fence = null;

  for (const line of body.split(/\r\n|\r|\n/)) {
    if (fence === null) {
      const marker = fenceMarker(line);
      if (marker) {
        fence = marker;
      }
    } else if (isClosingFence(line, fence)) {
      fence = null;
    } else {
      // Inside a fence: always content of the current story.
      if (current !== null) current.push(line);
      continue;
    }
    if (fence !== null) {
      // The opening fence line itself.
      if (current !== null) current.push(line);
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (level === 1 && heading === null) {
        heading = headingMatch[2].trim();
        continue;
      }
      if (level <= 2) {
        // H2 starts a story; later H1s defensively too.
        current = [line];
        stories.push(current);
        continue;
      }
    }
    if (current !== null) current.push(line);
    // Lines before the first story (after the H1) are template scaffolding
    // and intentionally ignored.
  }

  return { heading, stories };
}

// ---------------------------------------------------------------------------
// story parsing
// ---------------------------------------------------------------------------

function slugify(text) {
  const folded = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
  const slug = folded.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'story';
}

/** Deterministic dedup: first story keeps the plain slug, later ones get -2, -3... */
function uniqueSlug(base, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  const slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

function appendLine(sections, preamble, line) {
  if (sections.length > 0) {
    sections[sections.length - 1].content += line + '\n';
  } else {
    preamble.push(line);
  }
}

function collapse(text) {
  return text.replace(/[ \t]+/g, ' ');
}

/** Read the summary line plus any wrapped continuation lines. */
function absorbSummary(rawLines, start, firstValue) {
  const lines = firstValue ? [firstValue] : [];
  let i = start + 1;
  while (i < rawLines.length) {
    const next = rawLines[i];
    if (!next.trim()) break;
    if (
      FIELD_RE.test(next) ||
      IMAGE_LINE_RE.test(next) ||
      CREDIT_RE.test(next) ||
      HEADING_RE.test(next) ||
      fenceMarker(next)
    ) {
      break;
    }
    lines.push(next.trim());
    i += 1;
  }
  return { lines, next: i };
}

function parseStory(rawLines, slug) {
  const titleMatch = HEADING_RE.exec(rawLines[0]);
  const title = titleMatch ? titleMatch[2].trim() : rawLines[0].trim();

  const fields = {};
  let summaryLines = [];
  let image = null; // { alt, src }
  let credit = null;
  const sections = [];
  const preamble = [];
  let fence = null;

  let i = 1; // rawLines[0] is the H2 title line, already extracted
  while (i < rawLines.length) {
    const line = rawLines[i];

    if (fence === null) {
      const marker = fenceMarker(line);
      if (marker) {
        fence = marker;
        appendLine(sections, preamble, line);
        i += 1;
        continue;
      }
    } else {
      if (isClosingFence(line, fence)) fence = null;
      appendLine(sections, preamble, line);
      i += 1;
      continue;
    }

    const fieldMatch = FIELD_RE.exec(line);
    if (fieldMatch) {
      const name = fieldMatch[1].toLowerCase();
      const value = fieldMatch[2].trim();
      if (name === 'summary') {
        const absorbed = absorbSummary(rawLines, i, value);
        summaryLines = absorbed.lines;
        i = absorbed.next;
      } else {
        fields[name] = value;
        i += 1;
      }
      continue;
    }

    if (image === null) {
      const imageMatch = IMAGE_LINE_RE.exec(line);
      if (imageMatch) {
        image = { alt: imageMatch[1].trim(), src: imageMatch[2].trim() };
        i += 1;
        continue;
      }
    }

    if (credit === null) {
      const creditMatch = CREDIT_RE.exec(line);
      if (creditMatch) {
        credit = creditMatch[1].trim();
        if (credit.endsWith('*')) credit = credit.slice(0, -1).trim();
        i += 1;
        continue;
      }
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch && headingMatch[1].length >= 3) {
      sections.push(new StorySection(headingMatch[2].trim(), ''));
      i += 1;
      continue;
    }

    appendLine(sections, preamble, line);
    i += 1;
  }

  const keptSections = sections.filter((s) => s.content.trim());

  let newsDate = (fields['news date'] || '').trim() || 'Unknown';
  if (!ISO_DATE_RE.test(newsDate)) newsDate = 'Unknown';

  const tags = (fields.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return new Story({
    slug,
    title,
    section: (fields.section || '').trim() || DEFAULT_SECTION,
    featured: (fields.featured || '').trim().toLowerCase() === 'true',
    news_date: newsDate,
    availability: (fields.availability || '').trim(),
    tags,
    summary: collapse(summaryLines.join(' ')),
    image_src: image ? image.src : null,
    image_alt: image ? image.alt : '',
    credit,
    sections: keptSections,
    preamble: collapse(preamble.join('\n')).trim(),
  });
}

// ---------------------------------------------------------------------------
// edition entry point
// ---------------------------------------------------------------------------

/** Parse one edition file; never throws, returns BrokenIssue on problems. */
function parseEdition(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  } catch (err) {
    return new BrokenIssue(path.basename(filePath), `The file could not be read (${err.message}).`);
  }
  try {
    return parseEditionText(text, filePath);
  } catch (err) {
    if (err instanceof EditionError) {
      return new BrokenIssue(path.basename(filePath), err.message);
    }
    // Defensive: a bad file must never kill the app.
    return new BrokenIssue(path.basename(filePath), `Unexpected error while parsing (${err.message}).`);
  }
}

function parseEditionText(text, filePath) {
  const filename = path.basename(filePath);
  const nameMatch = EDITION_FILENAME_RE.exec(filename);
  if (!nameMatch) {
    throw new EditionError(
      'Filename must be YYYY-MM-DD.md or YYYY-MM-DD-HH.md (hour 00–23), ' +
        `got '${filename}'.`
    );
  }
  // Full stem without the extension: the edition id, `2026-11-10` or
  // `2026-11-10-02`. Lexicographic order on the id is chronological, with
  // the date-only file treated as the day's earlier edition.
  const stem = nameMatch[1] + (nameMatch[2] === undefined ? '' : `-${nameMatch[2]}`);
  const hour = nameMatch[2] === undefined ? null : Number(nameMatch[2]);
  if (hour !== null && hour > 23) {
    throw new EditionError(
      `Edition hour ${nameMatch[2]} in '${filename}' is out of range (must be 00–23).`
    );
  }
  const { meta, body } = parseFrontmatter(text, filename);

  const editionDate = asEditionId(meta['edition_date'], 'edition_date');
  if (editionDate !== stem) {
    throw new EditionError(
      `edition_date ${editionDate} does not match the filename edition ${stem}.`
    );
  }
  const coverageStart = asCoverage(meta['coverage_start'], 'coverage_start');
  const coverageEnd = asCoverage(meta['coverage_end'], 'coverage_end');
  // Order by instants, not strings: a bare date and a timestamp in the same
  // file are both legal, and `2026-11-10T23:00:00-05:00` < `2026-11-11` as
  // text even though its instant is later.
  if (coverageStart.instant > coverageEnd.instant) {
    throw new EditionError(
      `coverage_start ${coverageStart.raw} is after coverage_end ${coverageEnd.raw}.`
    );
  }
  const title = String(meta['title']).trim();

  const { heading, stories: storyBlocks } = splitBody(body);
  const usedSlugs = new Set();
  const stories = storyBlocks.map((block) => {
    const first = HEADING_RE.exec(block[0]);
    const rawTitle = first ? first[2].trim() : block[0].trim();
    return parseStory(block, uniqueSlug(slugify(rawTitle), usedSlugs));
  });
  const featured = stories.find((s) => s.featured) || stories[0] || null;

  return new Issue({
    filename,
    // Full edition id (`2026-11-10-02`) for URLs and lookups; the calendar
    // day and hour for grouping and the masthead day.
    id: stem,
    date: nameMatch[1],
    hour,
    title,
    heading: heading || title,
    coverage_start: coverageStart.raw,
    coverage_end: coverageEnd.raw,
    stories,
    featured,
  });
}

module.exports = {
  EDITION_FILENAME_RE,
  EDITION_ID_RE,
  EditionError,
  StorySection,
  Story,
  Issue,
  BrokenIssue,
  slugify,
  parseEdition,
  parseEditionText,
};
