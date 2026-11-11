'use strict';

/** HTTP routes for The Dev Daily. */

const express = require('express');
const fs = require('fs');
const path = require('path');

const { slugify, EDITION_ID_RE } = require('./parsing');
const {
  formatEditionLabel,
  formatCoverage,
  formatNewsDate,
  renderBlock,
  renderInline,
  resolveMedia,
  sanitizeFragment,
  externalHttpUrl,
  IMAGE_EXTENSIONS,
} = require('./rendering');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// One consistent glyph for every section entry — the sparkle from the AI
// Tools icon in the reference design.
const SECTION_ICON = '✧';

function sectionIcon() {
  return SECTION_ICON;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function articleUrl(story, issueId) {
  return `/issue/${issueId}/${story.slug}`;
}

function storyImage(story, root, imagesRoot) {
  if (!story.image_src) return null;
  const external = externalHttpUrl(story.image_src);
  if (external !== null) return external; // hotlinked announcement image
  return resolveMedia(story.image_src, root, imagesRoot);
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** A URL segment addresses an edition by its full id: date, or date + 00–23 hour. */
function isValidEditionId(value) {
  const match = EDITION_ID_RE.exec(value);
  if (!match) return false;
  if (!isValidDate(match[1])) return false;
  return match[2] === undefined || Number(match[2]) <= 23;
}

/**
 * View-model for the newspaper front page of one issue.
 *
 * `sectionFilter` (a section slug from ?section=) narrows the Roundup at a
 * Glance to that section's stories; the TOC links carry the filter as real
 * URLs so it works without JavaScript and is shareable.
 *
 * `sectionUrl` is optional and used by the static build (build.js): when it
 * is a function, TOC links point at pre-built per-section pages
 * (`/issue/<id>/section/<slug>/`) instead of `?section=` query URLs,
 * which a static file server would ignore.
 */
function frontContext(
  issue,
  library,
  root,
  imagesRoot,
  baseUrl = '/',
  sectionFilter = null,
  sectionUrl = null
) {
  const featured = issue.featured;
  const secondary = issue.stories.filter((s) => s !== featured).slice(0, 2);

  // The Roundup at a Glance indexes the rest of the paper: stories not
  // already shown as the lead or the two secondary cards above it.
  const shownIds = new Set(secondary);
  if (featured) shownIds.add(featured);

  let activeSlug = null;
  let activeLabel = '';
  if (sectionFilter) {
    for (const story of issue.stories) {
      if (slugify(story.section) === sectionFilter) {
        activeSlug = sectionFilter;
        activeLabel = story.section;
        break;
      }
    }
  }

  const sections = [];
  const index = new Map();
  for (const story of issue.stories) {
    const slug = slugify(story.section);
    let entry = index.get(slug);
    if (!entry) {
      entry = {
        label: story.section,
        slug,
        icon: sectionIcon(),
        url: `${sectionUrl ? sectionUrl(slug) : `${baseUrl}?section=${slug}`}#roundup`,
        count: 0,
        active: slug === activeSlug,
      };
      index.set(slug, entry);
      sections.push(entry);
    }
    entry.count += 1;
  }

  // The In-this-edition list is topics only: one entry per section that has
  // stories, in story order. (Top Stories / Roundup Index shortcuts were
  // dropped; the roundup's filter chip resets any section filter.)
  const toc = sections;

  const roundupAll = issue.stories.filter((s) => !shownIds.has(s));
  const roundupStories = activeSlug
    ? roundupAll.filter((s) => slugify(s.section) === activeSlug)
    : roundupAll;

  const storyView = (story) => ({
    story,
    url: articleUrl(story, issue.id),
    image: storyImage(story, root, imagesRoot),
    icon: sectionIcon(),
  });

  const editionNumber = library.editionNumber(issue.id);

  return {
    issue,
    edition_number: editionNumber,
    edition_number_padded: String(editionNumber).padStart(3, '0'),
    date_long: formatEditionLabel(issue.id),
    date_iso: issue.date,
    featured: featured ? storyView(featured) : null,
    secondary: secondary.map(storyView),
    roundup: roundupStories.map(storyView),
    toc,
    base_url: baseUrl,
    filter_note: activeSlug
      ? { label: activeLabel, count: roundupStories.length, total: roundupAll.length }
      : null,
    coverage: `${formatCoverage(issue.coverage_start)} – ${formatCoverage(issue.coverage_end)}`,
  };
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

/**
 * View-model for one story's article page. Shared by the live route and the
 * static build so both produce identical HTML.
 */
function articleContext(item, story, root, imagesRoot, library) {
  const sections = story.sections.map((section) => ({
    heading: section.heading,
    html: sanitizeFragment(renderBlock(section.content), root, imagesRoot),
  }));
  const creditHtml = story.credit
    ? sanitizeFragment(renderInline(`*${story.credit}*`), root, imagesRoot)
    : null;
  const preambleHtml = story.preamble
    ? sanitizeFragment(renderBlock(story.preamble), root, imagesRoot)
    : null;

  const editionNumber = library.editionNumber(item.id);
  return {
    // The issue itself carries .id (full stem), .date (calendar day) and
    // .hour; templates link back through .id so each edition of a day
    // returns to its own front page.
    issue: item,
    story,
    article_url: articleUrl(story, item.id),
    image: storyImage(story, root, imagesRoot),
    icon: sectionIcon(),
    news_date: formatNewsDate(story.news_date),
    sections,
    credit_html: creditHtml,
    preamble_html: preambleHtml,
    edition_number_padded: String(editionNumber).padStart(3, '0'),
    date_long: formatEditionLabel(item.id),
    date_iso: item.date,
  };
}

/** Row view-models for the archive page, newest first. */
function archiveRows(library) {
  return library.issues().map((issue) => {
    const number = library.editionNumber(issue.id);
    return {
      issue,
      url: `/issue/${issue.id}`,
      label: formatEditionLabel(issue.id),
      number,
      number_padded: String(number).padStart(3, '0'),
      story_count: issue.stories.length,
    };
  });
}

function createRouter(library, root, imagesRoot) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const issue = library.newest();
    if (issue === null) {
      return res.render('empty.njk', { broken: library.broken() });
    }
    const section = (req.query.section || '').trim().toLowerCase() || null;
    return res.render(
      'front.njk',
      frontContext(issue, library, root, imagesRoot, '/', section)
    );
  });

  r.get('/issue/:id', (req, res) => {
    const id = req.params.id;
    if (!isValidEditionId(id)) {
      return res.status(404).render('missing.njk');
    }
    const item = library.get(id);
    if (item === null) {
      return res.status(404).render('missing.njk');
    }
    if (item.reason !== undefined) {
      return res.status(404).render('broken_edition.njk', { item });
    }
    const section = (req.query.section || '').trim().toLowerCase() || null;
    return res.render(
      'front.njk',
      frontContext(item, library, root, imagesRoot, `/issue/${item.id}`, section)
    );
  });

  r.get('/issue/:id/:slug', (req, res) => {
    const id = req.params.id;
    if (!isValidEditionId(id)) {
      return res.status(404).render('missing.njk');
    }
    const item = library.get(id);
    if (item === null) {
      return res.status(404).render('missing.njk');
    }
    if (item.reason !== undefined) {
      return res.status(404).render('broken_edition.njk', { item });
    }
    const story = item.stories.find((s) => s.slug === req.params.slug);
    if (!story) {
      return res.status(404).render('missing.njk');
    }

    return res.render('article.njk', articleContext(item, story, root, imagesRoot, library));
  });

  r.get('/archive', (req, res) => {
    return res.render('archive.njk', { rows: archiveRows(library), broken: library.broken() });
  });

  r.get('/media/*', (req, res) => {
    const relpath = req.params[0] || '';
    if (relpath.includes('\\') || relpath.split('/').some((part) => part === '..')) {
      return res.status(404).end();
    }
    let target;
    try {
      target = path.resolve(imagesRoot, relpath);
      target = fs.realpathSync(target); // resolves symlinks; throws if missing
    } catch {
      return res.status(404).end();
    }
    const base = path.resolve(imagesRoot);
    const rel = path.relative(base, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(404).end(); // symlink or path escaped the images tree
    }
    if (!fs.statSync(target).isFile() || !IMAGE_EXTENSIONS.has(path.extname(target).toLowerCase())) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.sendFile(target, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  r.get('/healthz', (req, res) => {
    res.type('text').send('ok');
  });

  return r;
}

module.exports = {
  createRouter,
  frontContext,
  articleContext,
  archiveRows,
  sectionIcon,
  isValidDate,
  isValidEditionId,
};
