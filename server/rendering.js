'use strict';

/**
 * Markdown rendering with content-safety post-processing.
 *
 * AI-written editions are content, not trusted markup, so:
 *
 * - raw HTML in Markdown is escaped (html: false),
 * - rendered <a href> / <img src> URLs are scheme-checked
 *   (http, https, mailto and relative-only),
 * - relative image paths are resolved against the issue file and rewritten
 *   to /media/... URLs only when they land inside the configured images
 *   tree after path and symlink resolution; otherwise the image is dropped
 *   and the layout stays intact.
 *
 * Date formatting uses explicit name tables so a calendar date can never
 * shift by timezone or server locale.
 */

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ html: false, linkify: false });
md.enable('table');
md.enable('strikethrough');

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const IMG_TAG_RE = /<img\s[^>]*>/g;
const A_TAG_RE = /<a\s[^>]*>[\s\S]*?<\/a>/g;
const A_OPENING_RE = /^<a\s[^>]*>/;
const SRC_ATTR_RE = /\bsrc="([^"]*)"/;
const HREF_ATTR_RE = /\bhref="([^"]*)"/;
const ALT_ATTR_RE = /\balt="([^"]*)"/;

const SAFE_HREF_SCHEMES = new Set(['http', 'https', 'mailto']);
const EXTERNAL_IMAGE_SCHEMES = new Set(['http', 'https']);
const IMAGE_EXTENSIONS = new Set([
  '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.avif', '.bmp', '.ico',
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
// getUTCDay() is Sunday-first; Python's weekday() was Monday-first.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// escaping helpers
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Reverse the escapes markdown-it applies inside attribute values. */
function unescapeHtml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** lenient %-decode (JS decodeURIComponent throws on malformed input). */
function decodeSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Python quote() keeps "/" separators; encode each path segment instead. */
function quotePath(rel) {
  return rel.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

// ---------------------------------------------------------------------------
// dates — deterministic calendar formatting, no timezone or locale drift
// ---------------------------------------------------------------------------

function formatLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

function formatMedium(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// `2026-11-10-02` and `-12` are LA-local publishing hours; the label is a
// pure string read of that number (no Date involved), so it cannot shift.
function amPm(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Human label for an edition id, used in the masthead, TOC and archive. */
function formatEditionLabel(id) {
  const text = String(id).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2}))?$/.exec(text);
  if (!match) return text;
  const month = Number(match[2]);
  const hour = match[4] === undefined ? null : Number(match[4]);
  if (month < 1 || month > 12 || (hour !== null && hour > 23)) return text;
  const base = `${MONTHS_FULL[month - 1]} ${Number(match[3])}, ${match[1]}`;
  return hour === null ? base : `${base} · ${amPm(hour)}`;
}

// A coverage bound is either a bare calendar date or a full ISO 8601
// timestamp with an explicit zone; a timestamp is displayed in UTC so the
// window reads the same on every machine.
const COVERAGE_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatCoverage(raw) {
  const text = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatMedium(text);
  if (COVERAGE_TIMESTAMP_RE.test(text)) {
    const instant = Date.parse(text);
    if (!Number.isNaN(instant)) {
      const d = new Date(instant);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
    }
  }
  return text;
}

function formatNewsDate(raw) {
  if (raw === 'Unknown') return 'Unknown';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    try {
      return formatMedium(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------

function renderInline(text) {
  return md.renderInline(text);
}

function renderBlock(text) {
  return md.render(text);
}

// ---------------------------------------------------------------------------
// media resolution
// ---------------------------------------------------------------------------

/** Map a relative image src to a /media URL inside the images tree. */
function resolveMedia(src, issueDir, imagesRoot) {
  const cleaned = String(src).trim();
  if (!cleaned || SCHEME_RE.test(cleaned)) return null;
  let target;
  try {
    target = path.resolve(issueDir, decodeSafe(cleaned));
  } catch {
    return null;
  }
  const base = path.resolve(imagesRoot);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const ext = path.extname(target).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;
  let stat;
  try {
    stat = fs.statSync(target); // follows symlinks; caller verified containment below
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  // Re-verify the real path (symlink escape check).
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return null;
  }
  const relReal = path.relative(path.resolve(imagesRoot), real);
  if (relReal.startsWith('..') || path.isAbsolute(relReal)) return null;
  return '/media/' + quotePath(relReal.split(path.sep).join('/'));
}

function attr(tag, regex) {
  const match = regex.exec(tag);
  return match ? unescapeHtml(match[1]) : null;
}

function isSafeHref(url) {
  const match = SCHEME_RE.exec(url);
  return match === null || SAFE_HREF_SCHEMES.has(match[1].toLowerCase());
}

function isExternalImage(url) {
  const match = SCHEME_RE.exec(url);
  return Boolean(match && EXTERNAL_IMAGE_SCHEMES.has(match[1].toLowerCase()));
}

// ---------------------------------------------------------------------------
// sanitization post-pass
// ---------------------------------------------------------------------------

/** Scheme-check links and rewrite/drop images in rendered Markdown. */
function sanitizeFragment(fragment, issueDir, imagesRoot) {
  fragment = fragment.replace(IMG_TAG_RE, (tag) => {
    const src = attr(tag, SRC_ATTR_RE);
    if (src === null) return '';
    if (isExternalImage(src)) {
      return tag.replace('<img ', '<img loading="lazy" ');
    }
    const mediaUrl = resolveMedia(src, issueDir, imagesRoot);
    if (mediaUrl === null) return ''; // missing or blocked: layout handles the absence
    const alt = attr(tag, ALT_ATTR_RE) || '';
    return `<img src="${mediaUrl}" alt="${escapeHtml(alt)}" loading="lazy">`;
  });

  return fragment.replace(A_TAG_RE, (tag) => {
    const opening = A_OPENING_RE.exec(tag)[0];
    const href = attr(opening, HREF_ATTR_RE);
    const inner = tag.slice(opening.length, tag.lastIndexOf('</a>'));
    if (href === null || !isSafeHref(href)) {
      return inner; // unwrap unsafe or href-less anchors
    }
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    return `<a href="${escapeHtml(href)}">${inner}</a>`;
  });
}

/** Return src when it is a hotlinkable http(s) URL, else null. */
function externalHttpUrl(src) {
  const cleaned = String(src).trim();
  const match = SCHEME_RE.exec(cleaned);
  if (match && EXTERNAL_IMAGE_SCHEMES.has(match[1].toLowerCase())) {
    return cleaned;
  }
  return null;
}

module.exports = {
  formatLong,
  formatMedium,
  formatEditionLabel,
  formatCoverage,
  formatNewsDate,
  renderInline,
  renderBlock,
  resolveMedia,
  sanitizeFragment,
  externalHttpUrl,
  escapeHtml,
  IMAGE_EXTENSIONS,
};
