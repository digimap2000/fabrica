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

  // Stock wins a collision, because stock is fabrica's own data for good and a
  // stub is a stand-in for something mechanica will eventually serve. If the
  // two ever name the same id, the stub is the one that is wrong.
  const all = new Map([...stubs, ...stock]);
  return {
    get: (id) => all.get(id) ?? null,
    size: all.size,
    stubbed: [...stubs.keys()],
  };
}
