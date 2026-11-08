'use strict';

/**
 * Build The Dev Daily as a static site: `node build.js [--editions DIR] [--out DIR]`
 *
 * Renders the exact pages the Express preview serves (server/routes.js) into
 * plain files, reusing the same parsing, rendering, and template modules, so
 * `npm start` and `npm run build` produce identical HTML for the same
 * content. The output is swapped into place atomically, so a running web
 * server never sees a half-written folder.
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');
const nunjucks = require('nunjucks');

const { EditionLibrary } = require('./server/library');
const { frontContext, articleContext, archiveRows } = require('./server/routes');

function printHelp() {
  console.log(`Usage: node build.js [options]

Build The Dev Daily into a folder of static files (default: ./dist) that any
web server can serve. The Express preview (npm start) renders the same
content per request and needs no build.

Options:
  --editions DIR        Editions content folder
                        (default: ./editions, or DEVDAILY_EDITIONS)
  --out DIR             Output folder, replaced on every build
                        (default: ./dist, or DEVDAILY_OUT)
  --images-dirname DIR  Subfolder of the editions folder holding images
                        (default: images, or DEVDAILY_IMAGES_DIRNAME)
  --site-base PATH      URL path prefix when the site is hosted in a
                        subfolder, e.g. --site-base TheDevDaily serves
                        everything under /TheDevDaily/
                        (default: none, or DEVDAILY_SITE_BASE)
  -h, --help            Show this help
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }

  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        editions: { type: 'string' },
        out: { type: 'string' },
        'images-dirname': { type: 'string' },
        'site-base': { type: 'string' },
      },
    }));
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    printHelp();
    return 2;
  }

  const editions = path.resolve(
    args.editions || process.env.DEVDAILY_EDITIONS || 'editions'
  );
  const out = path.resolve(args.out || process.env.DEVDAILY_OUT || 'dist');
  const imagesDirname =
    args['images-dirname'] || process.env.DEVDAILY_IMAGES_DIRNAME || 'images';

  if (out === path.resolve(process.cwd())) {
    console.error('Error: refusing to clean the working directory; pass --out DIR');
    return 2;
  }

  // Hosted in a subfolder (e.g. nginx location /TheDevDaily/): normalize the
  // user input to a single leading slash, no trailing slash, or empty.
  const rawBase = args['site-base'] || process.env.DEVDAILY_SITE_BASE || '';
  const siteBase = rawBase ? `/${rawBase.replace(/^\/+|\/+$/g, '')}` : '';

  const library = new EditionLibrary(editions, imagesDirname);
  const root = library.root;
  const imagesRoot = library.imagesRoot;

  // Same template configuration as the live app (server/app.js).
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(path.join(__dirname, 'server', 'templates')),
    { autoescape: true }
  );

  const issues = library.issues();
  const broken = library.broken();
  for (const item of broken) {
    console.warn(`  Skipping ${item.filename}: ${item.reason}`);
  }
  if (!issues.length && !broken.length) {
    console.warn(`  No editions found in ${editions}`);
  }

  // Build into a staging folder, then swap it in, so a server pointed at
  // dist/ never serves a half-written site during a rebuild.
  const staging = `${out}.staging`;
  fs.rmSync(staging, { recursive: true, force: true });

  try {
    const files = [];
    function write(relPath, content) {
      const target = path.join(staging, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // The templates emit root-absolute URLs (/static/..., /issue/...);
      // when the site lives in a subfolder, prefix them all at write time.
      // External hotlinks (https://) never match, and (?!\/) leaves
      // protocol-relative URLs alone.
      if (siteBase && relPath.endsWith('.html')) {
        content = content.replace(/((?:href|src)=")\/(?!\/)/g, `$1${siteBase}/`);
      }
      fs.writeFileSync(target, content);
      files.push(relPath);
    }

    // Static assets: CSS/fonts/artwork copied verbatim, exactly as
    // express.static served them; the editions images tree becomes /media.
    fs.cpSync(path.join(__dirname, 'server', 'static'), path.join(staging, 'static'), {
      recursive: true,
    });
    if (fs.existsSync(imagesRoot)) {
      fs.cpSync(imagesRoot, path.join(staging, 'media'), { recursive: true });
    }

    // Per-section front pages keep the Roundup filter working without query
    // strings, which a static file server would ignore. Every page of an
    // issue links its TOC at those pre-built pages.
    const sectionUrlFor = (issueDate) => (slug) => `/issue/${issueDate}/section/${slug}/`;

    // Home page: the newest issue, TOC linking into its section pages.
    const newest = library.newest();
    if (newest === null) {
      write('index.html', env.render('empty.njk', { broken }));
    } else {
      write(
        'index.html',
        env.render(
          'front.njk',
          frontContext(newest, library, root, imagesRoot, '/', null, sectionUrlFor(newest.date))
        )
      );
    }

    // One front page per issue, plus one section page per (issue, section).
    let sectionPages = 0;
    for (const item of issues) {
      const baseUrl = `/issue/${item.date}/`;
      const sectionUrl = sectionUrlFor(item.date);
      const ctx = frontContext(item, library, root, imagesRoot, baseUrl, null, sectionUrl);
      write(`issue/${item.date}/index.html`, env.render('front.njk', ctx));
      for (const entry of ctx.toc) {
        const sectionCtx = frontContext(
          item,
          library,
          root,
          imagesRoot,
          baseUrl,
          entry.slug,
          sectionUrl
        );
        write(
          `issue/${item.date}/section/${entry.slug}/index.html`,
          env.render('front.njk', sectionCtx)
        );
        sectionPages += 1;
      }
    }

    // One article page per story, slugs already deduped by the parser.
    let articlePages = 0;
    for (const item of issues) {
      for (const story of item.stories) {
        write(
          `issue/${item.date}/${story.slug}/index.html`,
          env.render('article.njk', articleContext(item, story, root, imagesRoot, library))
        );
        articlePages += 1;
      }
    }

    write('archive/index.html', env.render('archive.njk', { rows: archiveRows(library), broken }));

    // Friendly 404 for the web server's error_page, and the healthcheck file.
    write('404.html', env.render('missing.njk', {}));
    write('healthz', 'ok');

    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(staging, out);

    console.log('The Dev Daily — static build');
    console.log(`  Editions:   ${issues.length}`);
    console.log(
      `  Pages:      ${files.length} files (${articlePages} articles, ${sectionPages} section views)`
    );
    console.log(`  Output:     ${out}`);
    return 0;
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

module.exports = { main };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}
