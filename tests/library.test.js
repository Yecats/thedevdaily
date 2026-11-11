'use strict';

/** Library scan ordering, cache freshness, and edition numbering (port of test_library.py). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { EditionLibrary } = require('../server/library');
const { story, writeEdition, makeEditionsDir } = require('./helpers');

test('newest first, broken last', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-04', story('Older'));
  writeEdition(dir, '2026-11-06', story('Newer'));
  fs.writeFileSync(path.join(dir, '2026-11-05.md'), 'not an edition', 'utf-8');
  const lib = new EditionLibrary(dir);
  const items = lib.scan();
  assert.deepEqual(
    items.filter((i) => i.date).map((i) => i.date),
    ['2026-11-06', '2026-11-04']
  );
  assert.equal(items.at(-1).filename, '2026-11-05.md');
});

test('new file appears without restart', () => {
  const dir = makeEditionsDir();
  const lib = new EditionLibrary(dir);
  writeEdition(dir, '2026-11-06', story('First'));
  assert.deepEqual(lib.issues().map((i) => i.date), ['2026-11-06']);
  writeEdition(dir, '2026-11-07', story('Second'));
  assert.deepEqual(lib.issues().map((i) => i.date), ['2026-11-07', '2026-11-06']);
});

test('unchanged files not reparsed', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('First'));
  const lib = new EditionLibrary(dir);
  lib.scan(); // prime cache

  let calls = 0;
  const parsingModule = require.cache[require.resolve('../server/parsing')];
  const original = parsingModule.exports.parseEdition;
  parsingModule.exports.parseEdition = (p) => {
    calls += 1;
    return original(p);
  };
  // library.js calls parseEdition through the module namespace, so the patch applies.
  lib.scan();
  lib.scan();
  parsingModule.exports.parseEdition = original;
  assert.equal(calls, 0); // everything served from the mtime/size cache
});

test('changed file is reparsed', () => {
  const dir = makeEditionsDir();
  const filePath = writeEdition(dir, '2026-11-06', story('Before'));
  const lib = new EditionLibrary(dir);
  lib.scan();
  fs.writeFileSync(
    filePath,
    fs.readFileSync(filePath, 'utf-8').replace('Before', 'After'),
    'utf-8'
  );
  const items = lib.scan();
  assert.equal(items[0].stories[0].title, 'After');
});

test('edition numbers: oldest is one', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-05', story('A'));
  writeEdition(dir, '2026-11-06', story('B'));
  writeEdition(dir, '2026-11-07', story('C'));
  const lib = new EditionLibrary(dir);
  const issues = lib.issues();
  assert.equal(lib.editionNumber(issues[0].date), 3); // newest
  assert.equal(lib.editionNumber(issues.at(-1).date), 1); // oldest
});

// ---------------------------------------------------------------------------
// multiple editions per day (hour-tagged ids)
// ---------------------------------------------------------------------------

test('same-day editions sort newest-first, day-only file is earliest', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-09', story('Previous Day'));
  writeEdition(dir, '2026-11-10', story('Day Edition'));
  writeEdition(dir, '2026-11-10-02', story('Early Edition'));
  writeEdition(dir, '2026-11-10-12', story('Midday Edition'));
  const lib = new EditionLibrary(dir);
  assert.deepEqual(lib.issues().map((i) => i.id), [
    '2026-11-10-12',
    '2026-11-10-02',
    '2026-11-10',
    '2026-11-09',
  ]);
  assert.equal(lib.newest().id, '2026-11-10-12');
});

test('lookup by full id; a bare date still finds the legacy file', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-10', story('Day Edition', { featured: 'true' }));
  writeEdition(dir, '2026-11-10-12', story('Midday Edition', { featured: 'true' }));
  const lib = new EditionLibrary(dir);
  assert.equal(lib.get('2026-11-10-12').stories[0].title, 'Midday Edition');
  assert.equal(lib.get('2026-11-10').stories[0].title, 'Day Edition');
  assert.equal(lib.get('2026-11-10-03'), null); // hour with no file of that id
});

test('edition numbers count every edition, not just calendar days', () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-09', story('A'));
  writeEdition(dir, '2026-11-10', story('B'));
  writeEdition(dir, '2026-11-10-02', story('C'));
  writeEdition(dir, '2026-11-10-12', story('D'));
  const lib = new EditionLibrary(dir);
  assert.equal(lib.editionNumber('2026-11-09'), 1);
  assert.equal(lib.editionNumber('2026-11-10'), 2);
  assert.equal(lib.editionNumber('2026-11-10-02'), 3);
  assert.equal(lib.editionNumber('2026-11-10-12'), 4);
});
