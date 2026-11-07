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

const EDITION_FILENAME_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const FIELD_RE = /^\s*\*\*(Section|Featured|News date|Availability|Tags|Summary)(?:\s*:)?\*\*\s*:?\s*(.*)$/i;
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)\s*$/;
const CREDIT_RE = /^\s*\*\s*(Image credit\b.*)$/i;
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/** Accept a YAML string or Date; return an ISO `YYYY-MM-DD` string. */
function asIsoDate(value, label) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (ISO_DATE_RE.test(trimmed)) {
      return trimmed;
    }
  }
  throw new EditionError(
    `${label} must be a YYYY-MM-DD calendar date, got ${JSON.stringify(value)}`
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
  const filenameDate = filename.slice(0, 10); // guaranteed by EDITION_FILENAME_RE
  const { meta, body } = parseFrontmatter(text, filename);

  const editionDate = asIsoDate(meta['edition_date'], 'edition_date');
  if (editionDate !== filenameDate) {
    throw new EditionError(
      `edition_date ${editionDate} does not match the filename date ${filenameDate}.`
    );
  }
  const coverageStart = asIsoDate(meta['coverage_start'], 'coverage_start');
  const coverageEnd = asIsoDate(meta['coverage_end'], 'coverage_end');
  if (coverageStart > coverageEnd) {
    throw new EditionError(
      `coverage_start ${coverageStart} is after coverage_end ${coverageEnd}.`
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
    date: filenameDate,
    title,
    heading: heading || title,
    coverage_start: coverageStart,
    coverage_end: coverageEnd,
    stories,
    featured,
  });
}

module.exports = {
  EDITION_FILENAME_RE,
  EditionError,
  StorySection,
  Story,
  Issue,
  BrokenIssue,
  slugify,
  parseEdition,
  parseEditionText,
};
