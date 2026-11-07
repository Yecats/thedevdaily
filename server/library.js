'use strict';

/**
 * Edition library: scans the content folder and caches parsed issues.
 *
 * The folder is rescanned on every request; unchanged files (same mtime and
 * size) are served from the parse cache, so a new YYYY-MM-DD.md file appears
 * on browser refresh without a server restart or rebuild.
 */

const fs = require('fs');
const path = require('path');
const parsing = require('./parsing');

class EditionLibrary {
  constructor(root, imagesDirname = 'images') {
    this.root = path.resolve(root);
    this.imagesRoot = path.join(this.root, imagesDirname);
    this.cache = new Map(); // filename -> { signature, parsed }
  }

  /** Valid issues newest-first, then broken files newest-first. */
  scan() {
    if (!fs.existsSync(this.root)) return [];
    let names;
    try {
      names = fs.readdirSync(this.root);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names.slice().sort().reverse()) {
      if (!parsing.EDITION_FILENAME_RE.test(name)) continue;
      const full = path.join(this.root, name);
      let stat;
      try {
        stat = fs.statSync(full, { bigint: true });
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      entries.push({ name, full, signature: `${stat.mtimeNs}:${stat.size}` });
    }

    const parsed = [];
    for (const entry of entries) {
      const cached = this.cache.get(entry.name);
      if (cached && cached.signature === entry.signature) {
        parsed.push(cached.parsed);
        continue;
      }
      const item = parsing.parseEdition(entry.full);
      this.cache.set(entry.name, { signature: entry.signature, parsed: item });
      parsed.push(item);
    }

    const valid = parsed
      .filter((item) => item.stories !== undefined)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const broken = parsed
      .filter((item) => item.reason !== undefined)
      .sort((a, b) => (a.filename < b.filename ? 1 : a.filename > b.filename ? -1 : 0));
    return [...valid, ...broken];
  }

  issues() {
    return this.scan().filter((item) => item.stories !== undefined);
  }

  broken() {
    return this.scan().filter((item) => item.reason !== undefined);
  }

  newest() {
    for (const item of this.scan()) {
      if (item.stories !== undefined) return item;
    }
    return null;
  }

  /** The issue for an ISO date, its broken file entry, or null. */
  get(isoDate) {
    const filename = `${isoDate}.md`;
    let brokenMatch = null;
    for (const item of this.scan()) {
      if (item.stories !== undefined && item.date === isoDate) return item;
      if (item.reason !== undefined && item.filename === filename) brokenMatch = item;
    }
    return brokenMatch;
  }

  /** Display-only number: the oldest published issue is #1. */
  editionNumber(issueDateIso) {
    const dates = this.issues().map((i) => i.date).sort();
    const index = dates.indexOf(issueDateIso);
    return index === -1 ? 0 : index + 1;
  }
}

module.exports = { EditionLibrary };
