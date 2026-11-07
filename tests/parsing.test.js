'use strict';

/** Structural parsing tests: the template is the contract (port of test_parsing.py). */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { parseEdition } = require('../server/parsing');
const { story, writeEdition, makeEditionsDir } = require('./helpers');

function parse(dir, date) {
  return parseEdition(path.join(dir, `${date}.md`));
}

test('valid edition parses', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('First Story', { featured: 'true' }) + story('Second Story', { section: '3D & Blender' }));
  const parsed = parse(dir, '2026-11-06');
  assert.ok(!parsed.reason, parsed.reason);
  assert.equal(parsed.title, 'The Dev Daily');
  assert.equal(parsed.heading, 'The Dev Daily');
  assert.deepEqual(parsed.stories.map((s) => s.slug), ['first-story', 'second-story']);
  assert.equal(parsed.featured.slug, 'first-story');
  assert.equal(parsed.date, '2026-11-06');
});

test('fields read across merged paragraph', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Fields Story'));
  const s = parse(dir, '2026-11-06').stories[0];
  assert.equal(s.section, 'AI Tools');
  assert.equal(s.featured, false);
  assert.equal(s.news_date, '2026-11-01');
  assert.equal(s.availability, 'Shipped');
  assert.deepEqual(s.tags, ['AI', 'Testing']);
  assert.equal(s.summary, 'A short summary of the story.');
});

test('summary wraps across lines', () => {
  const dir = makeEditionsDir();
  const body = story('Wrapped Story', {
    extra:
      '**Summary:** This is a long summary that the AI wrapped\n' +
      'onto a second line, and even a third one appears here.\n' +
      '\n### About the tool\n\nBody.\n',
  });
  writeEdition(dir, '2026-11-06', body);
  const s = parse(dir, '2026-11-06').stories[0];
  assert.equal(
    s.summary,
    'This is a long summary that the AI wrapped onto a second line, and even a third one appears here.'
  );
});

test('heading inside code fence does not split story', () => {
  const dir = makeEditionsDir();
  const body =
    story('Fenced Story', {
      extra: '### Try or teach\n\n```python\n## Not a story\n**Section:** fake\n```\n',
    }) + story('After Story');
  writeEdition(dir, '2026-11-06', body);
  const parsed = parse(dir, '2026-11-06');
  assert.equal(parsed.stories.length, 2);
  assert.equal(parsed.stories[0].slug, 'fenced-story');
  assert.ok(parsed.stories[0].sections.at(-1).content.includes('## Not a story'));
  assert.equal(parsed.stories[0].section, 'AI Tools'); // the fence line did not overwrite
});

test('featured first marked wins when multiple', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('A', { featured: 'false' }) + story('B', { featured: 'true' }) + story('C', { featured: 'true' }));
  assert.equal(parse(dir, '2026-11-06').featured.slug, 'b');
});

test('featured falls back to first story', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('A', { featured: 'false' }) + story('B', { featured: 'false' }));
  assert.equal(parse(dir, '2026-11-06').featured.slug, 'a');
});

test('duplicate slugs are deterministic', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Same Title Here') + story('Same Title Here') + story('Same Title Here'));
  const parsed = parse(dir, '2026-11-06');
  assert.deepEqual(
    parsed.stories.map((s) => s.slug),
    ['same-title-here', 'same-title-here-2', 'same-title-here-3']
  );
});

test('empty sections are dropped', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Gaps', { extra: '### Empty one\n\n### About the tool\n\nReal content.\n' }));
  const sections = parse(dir, '2026-11-06').stories[0].sections;
  assert.deepEqual(sections.map((s) => s.heading), ['About the tool']);
});

test('image and credit are captured', () => {
  const dir = makeEditionsDir();
  const src = 'x.webp';
  const imgDir = path.join(dir, 'images', '2026-11-06');
  require('fs').mkdirSync(imgDir, { recursive: true });
  const body = story('With Image', {
    extra: `### Before\n\n![An alt text](${src})\n*Image credit: [Someone](https://example.com/photo).*\n\n### About the tool\n\nBody.\n`,
  });
  writeEdition(dir, '2026-11-06', body);
  const s = parse(dir, '2026-11-06').stories[0];
  assert.equal(s.image_src, src);
  assert.equal(s.image_alt, 'An alt text');
  assert.equal(s.credit, 'Image credit: [Someone](https://example.com/photo).');
});

test('news date bad value becomes unknown', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Bad Date', { news_date: 'sometime soon' }));
  assert.equal(parse(dir, '2026-11-06').stories[0].news_date, 'Unknown');
});

test('one story issue', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Only Story'));
  const parsed = parse(dir, '2026-11-06');
  assert.equal(parsed.stories.length, 1);
  assert.equal(parsed.featured, parsed.stories[0]);
});

test('long headline slugs cleanly', () => {
  const dir = makeEditionsDir();
  const longTitle =
    'Blender Releases an Extremely Long Headline About Gaussian Splatting, ' +
    'Procedural Nodes, and Everything Else That Went Into This Massive Update';
  writeEdition(dir, '2026-11-06', story(longTitle));
  const parsed = parse(dir, '2026-11-06');
  assert.ok(parsed.stories[0].slug.startsWith('blender-releases-an-extremely-long'));
});

// ---------------------------------------------------------------------------
// invalid editions
// ---------------------------------------------------------------------------

test('missing frontmatter', () => {
  const dir = makeEditionsDir();
  const fs = require('fs');
  fs.writeFileSync(path.join(dir, '2026-11-06.md'), '# The Dev Daily\n', 'utf-8');
  const parsed = parse(dir, '2026-11-06');
  assert.equal(parsed.filename, '2026-11-06.md');
  assert.ok(parsed.reason.toLowerCase().includes('frontmatter'));
});

test('edition date must match filename', () => {
  const dir = makeEditionsDir();
  const fs = require('fs');
  fs.writeFileSync(
    path.join(dir, '2026-11-06.md'),
    '---\ntitle: "T"\nedition_date: "2026-11-05"\ncoverage_start: "2026-11-05"\ncoverage_end: "2026-11-06"\n---\n' + story('A'),
    'utf-8'
  );
  const parsed = parse(dir, '2026-11-06');
  assert.ok(parsed.reason.includes('does not match'));
});

test('coverage must be ordered', () => {
  const dir = makeEditionsDir();
  const fs = require('fs');
  fs.writeFileSync(
    path.join(dir, '2026-11-06.md'),
    '---\ntitle: "T"\nedition_date: "2026-11-06"\ncoverage_start: "2026-11-07"\ncoverage_end: "2026-11-05"\n---\n' + story('A'),
    'utf-8'
  );
  const parsed = parse(dir, '2026-11-06');
  assert.ok(parsed.reason.toLowerCase().includes('coverage'));
});

test('broken yaml reports filename', () => {
  const dir = makeEditionsDir();
  const fs = require('fs');
  fs.writeFileSync(path.join(dir, '2026-11-06.md'), '---\ntitle: [unclosed\n---\nbody\n', 'utf-8');
  const parsed = parse(dir, '2026-11-06');
  assert.equal(parsed.filename, '2026-11-06.md');
  assert.ok(parsed.reason);
});

test('missing required key', () => {
  const dir = makeEditionsDir();
  const fs = require('fs');
  fs.writeFileSync(
    path.join(dir, '2026-11-06.md'),
    '---\ntitle: "T"\nedition_date: "2026-11-06"\n---\n' + story('A'),
    'utf-8'
  );
  const parsed = parse(dir, '2026-11-06');
  assert.ok(parsed.reason.includes('coverage_start'));
});
