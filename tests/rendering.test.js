'use strict';

/** Rendering safety: escaping, URL schemes, media resolution (port of test_rendering.py). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  formatLong,
  formatMedium,
  formatEditionLabel,
  formatCoverage,
  formatNewsDate,
  renderBlock,
  renderInline,
  resolveMedia,
  sanitizeFragment,
} = require('../server/rendering');
const { PNG_1PX, makeEditionsDir } = require('./helpers');

// --------------------------------------------------------------------------
// dates: calendar dates must never shift by timezone or locale
// --------------------------------------------------------------------------

test('date formatting is deterministic', () => {
  assert.equal(formatLong('2026-11-06'), 'Fri, Nov 6, 2026');
  assert.equal(formatMedium('2026-11-06'), 'Nov 6, 2026');
  assert.equal(formatMedium('2026-01-01'), 'Jan 1, 2026');
  assert.equal(formatNewsDate('Unknown'), 'Unknown');
  assert.equal(formatNewsDate('2026-11-03'), 'Nov 3, 2026');
});

test('edition labels for date-only and hour-tagged ids', () => {
  assert.equal(formatEditionLabel('2026-11-10'), 'November 10, 2026');
  assert.equal(formatEditionLabel('2026-11-10-02'), 'November 10, 2026 · 2 AM');
  assert.equal(formatEditionLabel('2026-11-10-12'), 'November 10, 2026 · 12 PM');
  assert.equal(formatEditionLabel('2026-11-10-00'), 'November 10, 2026 · 12 AM');
  assert.equal(formatEditionLabel('2026-11-10-23'), 'November 10, 2026 · 11 PM');
  assert.equal(formatEditionLabel('nonsense'), 'nonsense');
  assert.equal(formatEditionLabel('2026-11-10-25'), '2026-11-10-25'); // out-of-range hour passes through
});

test('coverage display handles bare dates and ISO timestamps', () => {
  assert.equal(formatCoverage('2026-11-09'), 'Nov 9, 2026');
  assert.equal(formatCoverage('2026-11-10T09:02:11Z'), 'Nov 10, 2026 09:02 UTC');
  assert.equal(formatCoverage('2026-11-10T23:00:00-05:00'), 'Nov 11, 2026 04:00 UTC');
});

// --------------------------------------------------------------------------
// markdown escaping
// --------------------------------------------------------------------------

test('raw html is escaped', () => {
  const html = renderBlock('<script>alert(1)</script>\n\n<b>hi</b>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<b>hi</b>'));
});

test('inline html is escaped', () => {
  const html = renderInline('hello <img src=x onerror=alert(1)> world');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

// --------------------------------------------------------------------------
// link schemes
// --------------------------------------------------------------------------

test('javascript link is unwrapped', () => {
  const dir = makeEditionsDir();
  const html = sanitizeFragment('<a href="javascript:alert(1)">click me</a>', dir, path.join(dir, 'images'));
  assert.ok(!html.includes('<a'));
  assert.ok(html.includes('click me'));
});

test('data link is unwrapped', () => {
  const dir = makeEditionsDir();
  const html = sanitizeFragment('<a href="data:text/html,hi">x</a>', dir, path.join(dir, 'images'));
  assert.ok(!html.includes('<a'));
});

test('https link kept with noopener', () => {
  const dir = makeEditionsDir();
  const html = sanitizeFragment('<a href="https://example.com/x">x</a>', dir, path.join(dir, 'images'));
  assert.ok(html.includes('href="https://example.com/x"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('target="_blank"'));
});

test('relative link kept', () => {
  const dir = makeEditionsDir();
  const html = sanitizeFragment('<a href="./other.md">x</a>', dir, path.join(dir, 'images'));
  assert.ok(html.includes('href="./other.md"'));
});

// --------------------------------------------------------------------------
// media resolution
// --------------------------------------------------------------------------

function setupEditions() {
  const root = makeEditionsDir();
  return { editions: root, images: path.join(root, 'images') };
}

test('resolve media inside tree', () => {
  const { editions, images } = setupEditions();
  const img = path.join(images, '2026-11-06', 'pic.webp');
  fs.mkdirSync(path.dirname(img), { recursive: true });
  fs.writeFileSync(img, PNG_1PX);
  const url = resolveMedia('./images/2026-11-06/pic.webp', editions, images);
  assert.equal(url, '/media/2026-11-06/pic.webp');
});

test('resolve media rejects escape', () => {
  const root = makeEditionsDir();
  const editions = root;
  const images = path.join(editions, 'images');
  fs.writeFileSync(path.join(root, 'outside.webp'), PNG_1PX);
  assert.equal(resolveMedia('../outside.webp', editions, images), null);
});

test('resolve media rejects missing file', () => {
  const { editions, images } = setupEditions();
  assert.equal(resolveMedia('./images/2026-11-06/nope.webp', editions, images), null);
});

test('resolve media rejects non-image', () => {
  const { editions, images } = setupEditions();
  fs.mkdirSync(images, { recursive: true });
  fs.writeFileSync(path.join(images, 'secret.md'), 'hi', 'utf-8');
  assert.equal(resolveMedia('./images/secret.md', editions, images), null);
});

test('resolve media rejects symlink escape', () => {
  const { editions, images } = setupEditions();
  const outside = path.join(path.dirname(editions), 'outside.webp');
  fs.writeFileSync(outside, PNG_1PX);
  try {
    fs.symlinkSync(outside, path.join(images, 'evil.webp'));
  } catch {
    return; // symlink unsupported on this platform/filesystem
  }
  assert.equal(resolveMedia('./images/evil.webp', editions, images), null);
});

// --------------------------------------------------------------------------
// image sanitization
// --------------------------------------------------------------------------

test('missing image is dropped', () => {
  const { editions, images } = setupEditions();
  const html = sanitizeFragment(
    '<img src="./images/2026-11-06/missing.webp" alt="gone">',
    editions,
    images
  );
  assert.ok(!html.includes('<img'));
});

test('external https image kept', () => {
  const { editions, images } = setupEditions();
  const html = sanitizeFragment(
    '<img src="https://example.com/pic.webp" alt="remote">',
    editions,
    images
  );
  assert.ok(html.includes('src="https://example.com/pic.webp"'));
  assert.ok(html.includes('alt="remote"'));
});

test('data image dropped', () => {
  const { editions, images } = setupEditions();
  const html = sanitizeFragment(
    '<img src="data:image/png;base64,AAAA" alt="inline">',
    editions,
    images
  );
  assert.ok(!html.includes('<img'));
});
