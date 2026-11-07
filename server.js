'use strict';

/**
 * Start The Dev Daily: `node server.js [--editions DIR] [--host HOST] [--port PORT]`
 */

const path = require('path');
const { parseArgs } = require('node:util');

const DEFAULT_PORT = 8787;

function printHelp() {
  console.log(`Usage: node server.js [options]

Serve The Dev Daily newspaper from a folder of Markdown editions.

Options:
  --editions DIR        Editions content folder
                        (default: ./editions, or DEVDAILY_EDITIONS)
  --host HOST           Bind address
                        (default: 127.0.0.1, or DEVDAILY_HOST;
                         use 0.0.0.0 for the LAN)
  --port PORT           Port (default: ${DEFAULT_PORT}, or DEVDAILY_PORT)
  --images-dirname DIR  Subfolder of the editions folder holding images
                        (default: images, or DEVDAILY_IMAGES_DIRNAME)
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
      args,
      options: {
        editions: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        'images-dirname': { type: 'string' },
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
  const host = args.host || process.env.DEVDAILY_HOST || '127.0.0.1';
  const portRaw = args.port || process.env.DEVDAILY_PORT || String(DEFAULT_PORT);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Error: invalid port "${portRaw}"`);
    return 2;
  }
  const imagesDirname =
    args['images-dirname'] || process.env.DEVDAILY_IMAGES_DIRNAME || 'images';

  const { createApp } = require('./server/app');
  const app = createApp(editions, imagesDirname);

  const displayHost = ['127.0.0.1', '0.0.0.0', '::'].includes(host)
    ? 'localhost'
    : host;
  console.log('The Dev Daily');
  console.log(`  Reading editions from: ${editions}`);
  console.log(`  Serving at:            http://${displayHost}:${port}/`);
  if (host === '127.0.0.1') {
    console.log('  (local only - use --host 0.0.0.0 to share on your home LAN)');
  }

  app.listen(port, host);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
