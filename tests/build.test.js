'use strict';

/** Static build behavior: pages, section pages, media copy, notices, cleaning. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { story, writeEdition, addImage, makeEditionsDir } = require('./helpers');
const { main } = require('../build');

function makeOutDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdaily-build-'));
  return path.join(root, 'dist');
}

function build(editionsDir, out = makeOutDir()) {
  const code = main(['--editions', editionsDir, '--out', out]);
  return { code, out };
}

function read(out, rel) {
  return fs.readFileSync(path.join(out, ...rel.split('/')), 'utf-8');
}

function roundupHtml(html) {
  // The Roundup at a Glance region only (lead/cards keep every section).
  return html.match(/<section class="roundup"[\s\S]*?<\/section>/)[0];
}

test('build writes front, section, article and archive pages', () => {
  const dir = makeEditionsDir();
  const src = addImage(dir, '2026-11-06');
  writeEdition(
    dir,
    '2026-11-06',
    story('Lead Story', { featured: 'true', extra: `### About\n\n![Lead image](${src})\n\nBody.\n` }) +
      story('Alpha AI') +
      story('Beta AI') +
      story('Gamma AI') +
      story('Print Story', { section: '3D Printing' })
  );
  writeEdition(dir, '2026-11-04', story('Older Story'));
  const { code, out } = build(dir);
  assert.equal(code, 0);

  // home page: newest issue, TOC linked at pre-built section pages
  const home = read(out, 'index.html');
  assert.ok(home.includes('Lead Story'));
  assert.ok(home.includes('Edition #002'));
  assert.ok(home.includes('href="/issue/2026-11-06/section/ai-tools/#roundup"'));
  assert.ok(home.includes('src="/media/2026-11-06/pic.webp"'));

  // front page of the issue itself
  const issue = read(out, 'issue/2026-11-06/index.html');
  assert.ok(issue.includes('Lead Story') && issue.includes('Print Story'));

  // per-section pages narrow the Roundup like ?section= does live
  const section = read(out, 'issue/2026-11-06/section/ai-tools/index.html');
  const roundup = roundupHtml(section);
  assert.ok(roundup.includes('Gamma AI'));
  assert.ok(!roundup.includes('Print Story') && !roundup.includes('Beta AI'));
  assert.ok(section.includes('Showing 1 of 2 stories in'));
  assert.ok(section.includes('aria-current="true"'));
  assert.ok(section.includes('href="/issue/2026-11-06/#roundup"')); // Show all

  // article pages, with media rewritten into /media and a back link
  const article = read(out, 'issue/2026-11-06/lead-story/index.html');
  assert.ok(article.includes('Lead Story'));
  assert.ok(article.includes('href="/issue/2026-11-06"'));
  assert.ok(article.includes('src="/media/2026-11-06/pic.webp"'));

  // archive lists every issue newest first, with edition numbers
  const archive = read(out, 'archive/index.html');
  assert.ok(archive.includes('/issue/2026-11-06') && archive.includes('/issue/2026-11-04'));
  assert.ok(archive.includes('Edition #002') && archive.includes('Edition #001'));

  // assets copied verbatim, plus the notice and healthcheck files
  assert.ok(fs.existsSync(path.join(out, 'static', 'css', 'paper.css')));
  assert.ok(fs.existsSync(path.join(out, 'media', '2026-11-06', 'pic.webp')));
  assert.ok(read(out, '404.html').includes("isn't in this issue"));
  assert.equal(read(out, 'healthz'), 'ok');
});

test('broken files are warned about and archived, not rendered', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Good'));
  fs.writeFileSync(path.join(dir, '2026-11-01.md'), 'garbage without frontmatter', 'utf-8');
  const { code, out } = build(dir);
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(path.join(out, 'issue', '2026-11-01')));
  const archive = read(out, 'archive/index.html');
  assert.ok(archive.includes('2026-11-01.md'));
  assert.ok(read(out, 'index.html').includes('Good'));
});

test('empty editions folder still builds a home page', () => {
  const { code, out } = build(makeEditionsDir());
  assert.equal(code, 0);
  assert.ok(read(out, 'index.html').includes("hasn't delivered yet"));
  assert.ok(fs.existsSync(path.join(out, 'archive', 'index.html')));
  assert.ok(!fs.existsSync(path.join(out, 'media')));
});

test('site-base prefixes internal URLs for subfolder hosting', () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('Pictured', { featured: 'true', extra: '### About\n\n![Cover](https://example.com/cover.webp)\n\nBody.\n' })
  );
  const out = makeOutDir();
  assert.equal(main(['--editions', dir, '--out', out, '--site-base', 'TheDevDaily']), 0);

  const home = read(out, 'index.html');
  assert.ok(home.includes('href="/TheDevDaily/static/css/paper.css"'));
  assert.ok(home.includes('href="/TheDevDaily/issue/2026-11-06/section/ai-tools/#roundup"'));
  assert.ok(!/href="\/(?!\/|TheDevDaily)/.test(home)); // nothing left at the domain root
  assert.ok(home.includes('src="https://example.com/cover.webp"')); // hotlinks untouched
  assert.ok(read(out, 'issue/2026-11-06/pictured/index.html').includes(
    'href="/TheDevDaily/issue/2026-11-06"'
  ));
  assert.ok(read(out, '404.html').includes('href="/TheDevDaily/static/css/paper.css"'));

  // slash placement and casing are the user's choice; output is identical
  const out2 = makeOutDir();
  main(['--editions', dir, '--out', out2, '--site-base', '/TheDevDaily/']);
  assert.equal(read(out2, 'index.html'), home);
});

test('rebuilding replaces stale output entirely', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('A'));
  const out = makeOutDir();
  assert.equal(main(['--editions', dir, '--out', out]), 0);
  assert.ok(fs.existsSync(path.join(out, 'issue', '2026-11-06', 'index.html')));

  fs.rmSync(path.join(dir, '2026-11-06.md'));
  assert.equal(main(['--editions', dir, '--out', out]), 0);
  assert.ok(!fs.existsSync(path.join(out, 'issue', '2026-11-06', 'index.html')));
  assert.ok(read(out, 'index.html').includes("hasn't delivered yet"));
});
