'use strict';

/** Shared helpers for The Dev Daily tests (port of conftest.py). */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { createApp } = require('../server/app');

// A 1x1 transparent PNG, used as a stand-in edition image.
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex'
);

const STORY_TEMPLATE = [
  '## {title}',
  '',
  '**Section:** {section}',
  '**Featured:** {featured}',
  '**News date:** {news_date}',
  '**Availability:** {availability}',
  '**Tags:** {tags}',
  '',
  '**Summary:** {summary}',
  '',
  '{extra}',
];

function story(title, options = {}) {
  const {
    section = 'AI Tools',
    featured = 'false',
    summary = 'A short summary of the story.',
    news_date = '2026-11-01',
    availability = 'Shipped',
    tags = 'AI, Testing',
    extra = '### About the tool\n\nIt does things.\n\n### Why it matters\n\nIt matters.\n',
  } = options;
  return STORY_TEMPLATE.join('\n')
    .replace('{title}', title)
    .replace('{section}', section)
    .replace('{featured}', featured)
    .replace('{news_date}', news_date)
    .replace('{availability}', availability)
    .replace('{tags}', tags)
    .replace('{summary}', summary)
    .replace('{extra}', extra);
}

function frontmatter(id, start, end) {
  // Coverage defaults to the calendar day of the edition id: hour-tagged
  // ids like `2026-11-10-02` have a date coverage window, not an id.
  const day = String(id).slice(0, 10);
  return (
    '---\n' +
    'title: "The Dev Daily"\n' +
    `edition_date: "${id}"\n` +
    `coverage_start: "${start || day}"\n` +
    `coverage_end: "${end || day}"\n` +
    '---\n'
  );
}

function writeEdition(editionsDir, date, body, options = {}) {
  const filePath = path.join(editionsDir, `${date}.md`);
  fs.writeFileSync(
    filePath,
    frontmatter(date, options.start, options.end) + '\n# The Dev Daily\n\n' + body + '\n',
    'utf-8'
  );
  return filePath;
}

function addImage(editionsDir, date, name = 'pic.webp') {
  const imgDir = path.join(editionsDir, 'images', date);
  fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, name), PNG_1PX);
  return `./images/${date}/${name}`;
}

function makeEditionsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdaily-test-'));
  const editions = path.join(root, 'editions');
  fs.mkdirSync(editions);
  return editions;
}

/**
 * Boot the app against `editionsDir` on an ephemeral port.
 * Returns an async `get(path)` -> { status, text } plus a close() fn.
 */
function makeClient(editionsDir) {
  const app = createApp(editionsDir);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      server.unref(); // never keep the test runner alive on leaked servers
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        close: () => server.close(),
        async get(pathname) {
          const res = await fetch(base + pathname);
          const text = await res.text();
          return { status: res.status, text, headers: res.headers };
        },
      });
    });
  });
}

module.exports = { PNG_1PX, story, frontmatter, writeEdition, addImage, makeEditionsDir, makeClient };
