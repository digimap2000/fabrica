// Reading a catalogue off the disk, for the command line.
//
// The one place that will change when mechanica publishes an API: today stubs/
// and stock/ are JSON files, tomorrow the made half is fetched from a release
// and cached against its kernel version. Everything above works on the returned
// record and does not know which happened, which is why the lookup went behind
// a function on day one.

// Where component metadata comes from, and the one place that will change when
// mechanica publishes an API.
//
// Today: JSON off the disk from stubs/ and stock/. Tomorrow: stubs/ is deleted
// and made components are fetched from a mechanica release, cached against its
// kernel version. Everything above this module works on the returned record and
// does not know or care which happened - which is the point of putting the
// lookup behind a function on day one rather than reading files inline.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { catalogueFrom } from './catalogue.js';

async function loadTree(root) {
  const found = new Map();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch {
    return found;                       // an absent tree is empty, not an error
  }
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== '.json') continue;
    const path = join(entry.parentPath ?? entry.path ?? root, entry.name);
    const record = JSON.parse(await readFile(path, 'utf8'));
    if (!record.id) continue;
    found.set(record.id, { ...record, from: path });
  }
  return found;
}

export async function loadCatalogue(base) {
  const [stubs, stock] = await Promise.all([
    loadTree(join(base, 'stubs')),
    loadTree(join(base, 'stock')),
  ]);
  return catalogueFrom(stubs, stock);
}
