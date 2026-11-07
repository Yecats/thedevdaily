'use strict';

/** HTTP route behavior: pages, URLs, archive, error states, safety (port of test_routes.py). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { story, writeEdition, addImage, makeEditionsDir, makeClient } = require('./helpers');

function roundupHtml(html) {
  // The Roundup at a Glance region only (lead/cards keep every section).
  return html.match(/<section class="roundup"[\s\S]*?<\/section>/)[0];
}

async function withEditions(body, extra = {}) {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', body);
  const client = await makeClient(dir);
  return { client, dir, ...extra };
}

test('home serves newest issue', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-04', story('Older Story'));
  writeEdition(dir, '2026-11-06', story('Newer Story', { featured: 'true' }) + story('Backup Story'));
  const client = await makeClient(dir);
  const html = (await client.get('/')).text;
  assert.ok(html.includes('Newer Story'));
  assert.ok(html.includes('Backup Story')); // roundup keeps remaining stories discoverable
  assert.ok(!html.includes('Older Story')); // another issue's story stays in its issue
  assert.ok(html.includes('Edition #002'));
  assert.ok(html.includes('Fri, Nov 6, 2026'));
  assert.ok(html.includes('/issue/2026-11-06/newer-story'));
  await client.close();
});

test('front page shows lead, cards, roundup and tags', async () => {
  const dir = makeEditionsDir();
  const src = addImage(dir, '2026-11-06');
  const body =
    story('Lead Story', {
      featured: 'true',
      tags: 'AI, 3D',
      extra: `### About\n\n![Lead image](${src})\n\nBody.\n`,
    }) +
    story('Card One', { section: '3D & Blender' }) +
    story('Card Two', { section: 'Unity & Game Dev' }) +
    story('Roundup Only', { section: '3D Printing' });
  writeEdition(dir, '2026-11-06', body);
  const client = await makeClient(dir);
  const html = (await client.get('/')).text;
  assert.ok(html.includes('lead-figure') && html.includes('/media/2026-11-06/pic.webp'));
  assert.ok(html.includes('id="story-lead-story"'));
  assert.ok(html.includes('id="story-card-one"') && html.includes('id="story-card-two"'));
  assert.equal((html.match(/roundup-row/g) || []).length, 1); // only the story not shown above
  const roundup = roundupHtml(html);
  assert.ok(roundup.includes('Roundup Only'));
  assert.ok(!roundup.includes('Lead Story') && !roundup.includes('Card One'));
  assert.ok(html.includes('↗ Read More'));
  // TOC built from actual sections with counts, only non-empty ones
  assert.ok(html.includes('AI Tools') && html.includes('3D &amp; Blender'));
  assert.ok(html.includes('Unity &amp; Game Dev') && html.includes('3D Printing'));
  // mobile TOC present but collapsed
  assert.ok(html.includes('mobile-toc'));
  await client.close();
});

test('section counts and category targets', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('First AI', { section: 'AI Tools' }) + story('Second AI', { section: 'AI Tools' }));
  const client = await makeClient(dir);
  const html = (await client.get('/')).text;
  assert.ok(html.includes('aria-label="2 stories"'));
  await client.close();
});

test('roundup hides entirely when everything is featured', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Only One', { featured: 'true' }) + story('Only Two'));
  const client = await makeClient(dir);
  const html = (await client.get('/')).text;
  assert.ok(!html.includes('class="roundup"'));
  assert.ok(!html.includes('Roundup Index'));
  await client.close();
});

test('article page renders all sections', async () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('Full Story', {
      featured: 'true',
      extra:
        '### About the tool\n\nIt does things.\n\n' +
        '### What changed\n\nSomething changed.\n\n' +
        '### Sources\n\n- [The source](https://example.com/source)\n',
    })
  );
  const client = await makeClient(dir);
  const html = (await client.get('/issue/2026-11-06/full-story')).text;
  assert.ok(html.includes('Full Story'));
  assert.ok(html.includes('← Back to edition') && html.includes('href="/issue/2026-11-06"'));
  assert.ok(html.includes('AI Tools'));
  assert.ok(html.includes('Nov 1, 2026 · Shipped'));
  for (const heading of ['About the tool', 'What changed', 'Sources']) {
    assert.ok(html.includes(`<h3>${heading}</h3>`));
  }
  assert.ok(html.includes('href="https://example.com/source"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  await client.close();
});

test('article url survives reload and returns to its issue', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-04', story('Archived Story', { featured: 'true' }));
  writeEdition(dir, '2026-11-06', story('Newer Story', { featured: 'true' }));
  const client = await makeClient(dir);
  const first = await client.get('/issue/2026-11-04');
  assert.equal(first.status, 200);
  assert.ok(first.text.includes('Edition #001'));
  const direct = await client.get('/issue/2026-11-04/archived-story');
  assert.equal(direct.status, 200);
  assert.ok(direct.text.includes('href="/issue/2026-11-04"')); // back link tied to its own issue
  assert.ok(direct.text.includes('Edition #001'));
  assert.ok(direct.text.includes('Archived Story'));
  await client.close();
});

test('archive lists issues newest first with numbers', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-04', story('A'));
  writeEdition(dir, '2026-11-06', story('B'));
  const client = await makeClient(dir);
  const html = (await client.get('/archive')).text;
  const newerPos = html.indexOf('Fri, Nov 6, 2026');
  const olderPos = html.indexOf('Wed, Nov 4, 2026');
  assert.ok(newerPos !== -1 && olderPos !== -1);
  assert.ok(newerPos < olderPos);
  assert.ok(html.includes('Edition #002') && html.includes('Edition #001'));
  assert.ok(html.includes('Wed, Nov 4, 2026'));
  await client.close();
});

test('archive reports broken files and keeps valid readable', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Good'));
  fs.writeFileSync(path.join(dir, '2026-11-01.md'), 'garbage without frontmatter', 'utf-8');
  const client = await makeClient(dir);
  const html = (await client.get('/archive')).text;
  assert.ok(html.includes('2026-11-01.md'));
  const home = (await client.get('/')).text;
  assert.ok(home.includes('Good'));
  assert.equal((await client.get('/issue/2026-11-06')).status, 200);
  await client.close();
});

test('broken edition direct url reports filename', async () => {
  const dir = makeEditionsDir();
  fs.writeFileSync(
    path.join(dir, '2026-11-03.md'),
    '---\ntitle: "T"\nedition_date: "2026-11-04"\ncoverage_start: "2026-11-01"\ncoverage_end: "2026-11-02"\n---\n',
    'utf-8'
  );
  const client = await makeClient(dir);
  const response = await client.get('/issue/2026-11-03');
  assert.equal(response.status, 404);
  assert.ok(response.text.includes('2026-11-03.md'));
  assert.ok(response.text.includes('does not match'));
  await client.close();
});

test('empty state', async () => {
  const client = await makeClient(makeEditionsDir());
  const html = (await client.get('/')).text;
  assert.ok(html.includes("hasn't delivered yet"));
  assert.equal((await client.get('/archive')).status, 200);
  await client.close();
});

test('missing issue and story are friendly 404s', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('A'));
  const client = await makeClient(dir);
  for (const p of ['/issue/1999-01-01', '/issue/2026-11-06/not-a-story', '/issue/junk']) {
    const res = await client.get(p);
    assert.equal(res.status, 404);
    assert.ok(res.text.includes("isn't in this issue"));
  }
  await client.close();
});

test('unsafe markdown cannot execute', async () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('Evil', {
      featured: 'true',
      extra:
        '### About the tool\n\n' +
        '<script>window.evil = true</script>\n\n' +
        '[bad link](javascript:alert(1))\n\n' +
        '![bad img](javascript:alert(2))\n',
    })
  );
  const client = await makeClient(dir);
  const home = (await client.get('/')).text;
  assert.ok(!home.includes('<script>window.evil'));
  assert.ok(!home.includes('href="javascript:'));
  const article = (await client.get('/issue/2026-11-06/evil')).text;
  assert.ok(!article.includes('<script>window.evil'));
  assert.ok(article.includes('&lt;script&gt;window.evil = true&lt;/script&gt;')); // escaped, visible as text
  assert.ok(!article.includes('href="javascript:'));
  assert.ok(!article.includes('bad img')); // javascript: image dropped entirely
  assert.ok(!article.includes('src="javascript:'));
  await client.close();
});

test('media traversal and extensions blocked', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('A'));
  addImage(dir, '2026-11-06');
  const client = await makeClient(dir);
  assert.equal((await client.get('/media/2026-11-06/pic.webp')).status, 200);
  for (const p of ['/media/../run.js', '/media/2026-11-06/../../server.js', '/media/..%5C..%5Cpackage.json']) {
    assert.equal((await client.get(p)).status, 404, p);
  }
  await client.close();
});

test('images resolved relative to issue', async () => {
  const dir = makeEditionsDir();
  const src = addImage(dir, '2026-11-06');
  writeEdition(
    dir,
    '2026-11-06',
    story('Pictured', { featured: 'true', extra: `### About\n\n![Alt text here](${src})\n\nBody.\n` })
  );
  const client = await makeClient(dir);
  const html = (await client.get('/')).text;
  assert.ok(html.includes('<img src="/media/2026-11-06/pic.webp" alt="Alt text here"'));
  await client.close();
});

test('external https story image hotlinks', async () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('Remote', { featured: 'true', extra: '### About\n\n![Remote cover](https://example.com/cover.webp)\n\nBody.\n' })
  );
  const client = await makeClient(dir);
  const home = (await client.get('/')).text;
  assert.ok(home.includes('<img src="https://example.com/cover.webp" alt="Remote cover"'));
  const article = (await client.get('/issue/2026-11-06/remote')).text;
  assert.ok(article.includes('src="https://example.com/cover.webp"'));
  await client.close();
});

test('unsafe scheme story image dropped', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Sneaky', { featured: 'true', extra: '### About\n\n![bad](javascript:alert(1))\n\nBody.\n' }));
  const client = await makeClient(dir);
  const html = (await client.get('/')).text;
  assert.ok(!html.includes('src="javascript:'));
  await client.close();
});

test('story without image keeps layout', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Bare', { featured: 'true', extra: '### About\n\nNo image here.\n' }));
  const html = (await makeClient(dir).then((c) => c.get('/'))).text;
  assert.ok(html.includes('lead no-image'));
});

test('healthz', async () => {
  const client = await makeClient(makeEditionsDir());
  assert.equal((await client.get('/healthz')).text, 'ok');
  await client.close();
});

// --------------------------------------------------------------------------
// section filtering of the Roundup at a Glance
// --------------------------------------------------------------------------

test('section filter narrows roundup and highlights toc', async () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('Alpha AI', { section: 'AI Tools' }) +
      story('Beta AI', { section: 'AI Tools' }) +
      story('Gamma AI', { section: 'AI Tools' }) +
      story('Print Story', { section: '3D Printing' })
  );
  const client = await makeClient(dir);
  const html = (await client.get('/?section=3d-printing')).text;
  const roundup = roundupHtml(html);
  assert.ok(roundup.includes('Print Story'));
  for (const name of ['Alpha AI', 'Beta AI', 'Gamma AI']) {
    assert.ok(!roundup.includes(name));
  }
  assert.ok(html.includes('Showing 1 of 1 stories in') && html.includes('<strong>3D Printing</strong>'));
  assert.ok(html.includes('>Show all</a>'));
  // the active section is highlighted with a real URL on every TOC entry
  assert.ok(html.includes('aria-current="true"'));
  assert.ok(html.includes('href="/?section=3d-printing#roundup"'));
  assert.ok(html.includes('href="/?section=ai-tools#roundup"'));
  // topics only: no Top Stories / Roundup Index shortcuts in the TOC
  assert.ok(!html.includes('Top Stories'));
  assert.ok(!html.includes('Roundup Index'));
  // the filter chip inside the roundup is the reset affordance
  await client.close();
});

test('filter with everything featured shows note', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Alpha AI', { section: 'AI Tools' }) + story('Beta AI', { section: 'AI Tools' }));
  const client = await makeClient(dir);
  const html = (await client.get('/?section=ai-tools')).text;
  assert.ok(html.includes('class="roundup"'));
  assert.ok(html.includes('Everything in AI Tools is featured above.'));
  await client.close();
});

test('section filter works on issue url', async () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('AI One', { section: 'AI Tools' }) +
      story('AI Two', { section: 'AI Tools' }) +
      story('AI Three', { section: 'AI Tools' }) +
      story('Print One', { section: '3D Printing' })
  );
  const client = await makeClient(dir);
  const html = (await client.get('/issue/2026-11-06?section=3d-printing')).text;
  const roundup = roundupHtml(html);
  assert.ok(roundup.includes('Print One'));
  assert.ok(!roundup.includes('AI One') && !roundup.includes('AI Two'));
  assert.ok(html.includes('href="/issue/2026-11-06?section=ai-tools#roundup"'));
  await client.close();
});

test('unknown section shows everything', async () => {
  const dir = makeEditionsDir();
  writeEdition(dir, '2026-11-06', story('Alpha AI', { section: 'AI Tools' }));
  const client = await makeClient(dir);
  const html = (await client.get('/?section=does-not-exist')).text;
  assert.ok(html.includes('Alpha AI'));
  assert.ok(!html.includes('filter-note'));
  await client.close();
});

test('filter keeps lead and cards visible', async () => {
  const dir = makeEditionsDir();
  writeEdition(
    dir,
    '2026-11-06',
    story('Featured Print', { section: '3D Printing', featured: 'true' }) +
      story('Card AI', { section: 'AI Tools' }) +
      story('Card Print', { section: '3D Printing' }) +
      story('Extra AI', { section: 'AI Tools' })
  );
  const client = await makeClient(dir);
  const html = (await client.get('/?section=ai-tools')).text;
  assert.ok(html.includes('Featured Print') && html.includes('Card AI')); // lead + card untouched
  const roundup = roundupHtml(html);
  assert.ok(roundup.includes('Extra AI'));
  assert.ok(!roundup.includes('Featured Print') && !roundup.includes('Card AI'));
  await client.close();
});
