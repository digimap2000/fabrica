#!/usr/bin/env node
// The viewer's server, and fabrica's side of the boundary.
//
// Two jobs, and the second is the interesting one.
//
// It serves the page, the machine files and the catalogue - the catalogue as
// one JSON document rather than a directory the browser has to guess at, so
// there is no manifest to drift out of step with the files.
//
// And it proxies /mechanica/* to a mechanica release. That is here because
// mechanica sends no CORS headers, so a page on this origin cannot ask it
// directly - and the right answer to that is a proxy on fabrica's side rather
// than a change to mechanica's. Adding a header there would have to be
// justified on mechanica's own terms, and "fabrica finds it convenient" is not
// one. Nothing about the boundary is weakened by this: it is still HTTP to a
// released service, and nothing here reads mechanica's source.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue-fs.js';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8081);
const MECHANICA = process.env.MECHANICA_URL ?? 'https://mechanica-web-lxmj26goiq-nw.a.run.app';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.machine': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Only these three trees are servable, and a path is resolved and then checked
// to be inside one of them. Not because this is exposed to anything, but
// because a dev server that will serve any file on the disk is a habit rather
// than a decision, and the check is two lines.
const SERVABLE = ['viewer', 'machines', 'src'].map((d) => join(ROOT, d));

function fail(res, status, message) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message + '\n');
}

async function serveStatic(res, urlPath) {
  const path = join(ROOT, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!SERVABLE.some((dir) => path === dir || path.startsWith(dir + '/'))) {
    return fail(res, 403, 'outside the servable trees');
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    fail(res, 404, `no such file: ${urlPath}`);
  }
}

// Streamed straight through, headers and body, with nothing added and nothing
// interpreted. A proxy that starts understanding the payload is a proxy that
// will one day disagree with the service it stands in front of.
async function proxy(req, res, rest) {
  const target = `${MECHANICA}${rest}`;
  try {
    const upstream = await fetch(target, { headers: { accept: req.headers.accept ?? '*/*' } });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    // Said plainly, because 'the viewer is blank' has a dozen causes and this
    // is the one nobody thinks of first.
    fail(res, 502, `could not reach mechanica at ${MECHANICA}: ${error.message}`);
  }
}

const catalogue = await loadCatalogue(ROOT);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  if (path === '/') return serveStatic(res, '/viewer/index.html');
  if (path === '/catalogue.json') {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-cache' });
    return res.end(JSON.stringify(catalogue.records()));
  }
  if (path.startsWith('/mechanica/')) return proxy(req, res, url.href.slice(url.origin.length + '/mechanica'.length));
  return serveStatic(res, path);
});

server.listen(PORT, () => {
  process.stdout.write(`fabrica viewer on http://localhost:${PORT}\n`);
  process.stdout.write(`  catalogue: ${catalogue.size} components\n`);
  process.stdout.write(`  mechanica: ${MECHANICA}\n`);
});
