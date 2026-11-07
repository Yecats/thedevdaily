'use strict';

/** Application factory: an Express app serving one editions folder. */

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');

const { EditionLibrary } = require('./library');
const { createRouter } = require('./routes');

function createApp(editionsDir, imagesDirname = 'images') {
  const root = path.resolve(editionsDir);
  const app = express();
  const library = new EditionLibrary(root, imagesDirname);
  const imagesRoot = library.imagesRoot;

  const env = nunjucks.configure(path.join(__dirname, 'templates'), {
    autoescape: true,
    express: app,
    noCache: false,
  });
  app.set('view engine', 'njk');

  app.use('/static', express.static(path.join(__dirname, 'static')));
  app.use(createRouter(library, root, imagesRoot));

  // Friendly styled pages for everything that falls through.
  app.use((req, res) => {
    res.status(404).render('missing.njk');
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).render('error.njk');
  });

  app.locals.library = library;
  return app;
}

module.exports = { createApp };
