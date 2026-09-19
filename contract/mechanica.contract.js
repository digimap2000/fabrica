// What fabrica assumes about mechanica, checked against a mechanica that is
// actually running.
//
// These are not unit tests and they are kept out of tests/ on purpose. The
// offline suite proves fabrica is self-consistent; nothing in it can tell you
// that the service still answers the way this code expects, and a green suite
// that implies otherwise is the dishonest kind. So: `npm test` is offline and
// fast, `npm run contract` needs a network and a release.
//
// The subject is a RELEASED mechanica over HTTP, never a source checkout. That
// is the rule the whole separation rests on, and a contract test that reached
// into a sibling directory would quietly repeal it.
//
//   MECHANICA_URL=http://localhost:8790 npm run contract
//
// The cases are generated from machines/*.machine rather than from a list
// written here, so a machine that starts using a new part is covered the moment
// it is written, and a list cannot fall behind the library it describes.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parse.js';
import { loadCatalogue } from '../src/catalogue-fs.js';
import { resolve } from '../src/resolve.js';
import { decodeMesh, meshQuery } from '../src/mechanica.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MECHANICA = process.env.MECHANICA_URL ?? 'https://mechanica-web-lxmj26goiq-nw.a.run.app';

const catalogue = await loadCatalogue(ROOT);

// Every made component any machine in the library actually asks for, with the
// machine that asks recorded so a failure says where to look.
const wanted = new Map();
for (const file of (await readdir(join(ROOT, 'machines'))).filter((f) => f.endsWith('.machine'))) {
  const text = await readFile(join(ROOT, 'machines', file), 'utf8');
  const resolved = resolve(parse(text, file), catalogue, {});
  for (const instance of resolved.instances.values()) {
    if (instance.kind !== 'part') continue;
    const query = meshQuery(instance);
    if (!query) continue;                 // no bridge: nothing claims mechanica has it
    wanted.set(query, { instance, machine: file });
  }
}

let index = null;

// Reached once, and a failure here fails everything after it rather than
// producing forty confusing failures that all mean 'the service is down'.
before(async () => {
  let health;
  try {
    const response = await fetch(`${MECHANICA}/api/health`);
    assert.equal(response.status, 200, `${MECHANICA}/api/health answered ${response.status}`);
    health = await response.json();
  } catch (error) {
    assert.fail(`cannot reach mechanica at ${MECHANICA}: ${error.message}\n`
      + '  These tests need a running release. Set MECHANICA_URL to point elsewhere,\n'
      + '  or run the offline suite with `npm test`.');
  }
  index = new Map((await (await fetch(`${MECHANICA}/api/parts`)).json()).map((p) => [p.id, p]));
  process.stdout.write(`  ${MECHANICA}\n  release ${health.release} (${health.version}), kernel ${health.kernel}`
    + `, ${index.size} parts, ${wanted.size} queries to check\n`);
});

// --- the service itself ------------------------------------------------------

test('health carries every field the viewer puts on screen', async () => {
  const health = await (await fetch(`${MECHANICA}/api/health`)).json();
  for (const field of ['status', 'release', 'version', 'kernel']) {
    assert.ok(health[field] !== undefined, `health is missing '${field}', which the viewer's header shows`);
  }
  assert.equal(health.status, 'ok');
  assert.equal(typeof health.kernel, 'number');
});

// --- what the stubs claim ----------------------------------------------------

test('every component a stub says exists, exists', () => {
  const missing = catalogue.records()
    .filter((r) => r.source === 'mechanica' && r.status === 'exists' && !index.has(r.mechanica?.id ?? r.id))
    .map((r) => r.id);
  assert.deepEqual(missing, [],
    'These stubs claim mechanica has the part and it does not. Either the id is\n'
    + '  wrong or the part was removed; the stub has to say which.');
});

// The backlog can only shrink. Borrowed from mechanica's accessibility baseline,
// for the same reason: an exception that no longer reproduces has to be deleted
// deliberately, or the list rots into something nobody trusts and everybody
// skips. A part arriving in mechanica is good news and should still fail this.
test('every component a stub says is missing, is still missing', () => {
  const arrived = catalogue.records()
    .filter((r) => r.source === 'mechanica' && r.status === 'does-not-exist' && index.has(r.id))
    .map((r) => r.id);
  assert.deepEqual(arrived, [],
    'mechanica has grown these parts. Update their stubs from the real schema,\n'
    + '  set status to "exists", and the viewer stops drawing them as boxes.');
});

// There was a designation check here, comparing each stub's prose against what
// mechanica resolves. It has been removed, and the reason is worth keeping.
//
// It was the only check in this file about a part CHANGING rather than about
// fabrica being wrong today, and detecting change is not a problem to solve with
// string comparisons a year before it bites. It belongs in versioning, and both
// halves of that already exist in outline: mechanica has @proven and the
// baseline ledger, and fabrica's side is the stamped metadata snapshot described
// in README.md - kernel version and per-component source hashes, where going
// stale is a test failure rather than a wrong picture.
//
// So: nothing here watches for drift. These checks ask whether the hand-written
// stubs are right NOW, which at this stage of the project is the question that
// has actually been answered wrongly - twice.

// --- the queries fabrica actually sends --------------------------------------

// THE test, and the one that would have caught the break that started all this:
// fabrica sent 'GT2 2 mm' where mechanica is keyed by 'belt_profile:gt2_2', and
// nothing offline could have known.
test('every query fabrica builds is accepted and returns a real mesh', async () => {
  for (const [query, { instance, machine }] of wanted) {
    const response = await fetch(`${MECHANICA}/api/mesh?${query}`);
    const where = `${machine} -> ${instance.name} (${instance.id})`;

    if (!response.ok) {
      let why = `HTTP ${response.status}`;
      try { why = (await response.json()).error ?? why; } catch { /* keep the status */ }
      assert.fail(`${where}\n  ?${query}\n  ${why}`);
    }

    const mesh = decodeMesh(await response.arrayBuffer());
    assert.ok(mesh.triangles > 0, `${where}: mechanica returned a mesh with no triangles`);
    assert.equal(mesh.positions.length % 9, 0, `${where}: positions are not whole triangles`);
  }
});

// Unknown parameters are IGNORED by mechanica, not refused - measured, not
// assumed: a mesh request carrying nonsense=7 answers 200 and builds the part at
// its defaults. So a renamed parameter does not fail anywhere. It produces a
// plausible part of the wrong size, in a machine whose numbers all still add up.
// This is the only thing standing between that and a shipped BOM.
test('every parameter fabrica sends is one the part declares', async () => {
  const strangers = [];
  for (const [query, { instance, machine }] of wanted) {
    const sent = new URLSearchParams(query);
    const id = sent.get('id');
    sent.delete('id');
    sent.delete('lod');

    const part = await (await fetch(`${MECHANICA}/api/part?id=${encodeURIComponent(id)}`)).json();
    const declared = new Set(part.parameters.map((p) => p.name));
    for (const name of sent.keys()) {
      if (!declared.has(name)) {
        strangers.push(`${machine} -> ${instance.name}: '${name}' is not a parameter of ${id}`
          + ` (it has ${[...declared].join(', ')})`);
      }
    }
  }
  assert.deepEqual(strangers, [],
    'mechanica ignores a parameter it does not know rather than refusing it, so\n'
    + '  nothing else will ever catch this - it would just build at the default.');
});

// --- the format ---------------------------------------------------------------

test('the mesh payload is still MMS2 little-endian', async () => {
  const [query] = [...wanted.keys()];
  const buffer = await (await fetch(`${MECHANICA}/api/mesh?${query}`)).arrayBuffer();
  const view = new DataView(buffer);
  assert.equal(String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(i))), 'MMS2');

  // Read big-endian, the float count would be an absurd number. This is a cheap
  // check that the endianness has not flipped under us, which would otherwise
  // show up as a machine the size of a county.
  assert.ok(view.getUint32(4, true) < view.getUint32(4, false), 'counts are not little-endian');
});

test('an unknown part is a 404 and a bad value is a 400', async () => {
  // fabrica's error handling distinguishes these, and the viewer says different
  // things about them, so the distinction is part of the contract.
  assert.equal((await fetch(`${MECHANICA}/api/mesh?id=nope/nothing`)).status, 404);
  assert.equal((await fetch(`${MECHANICA}/api/mesh?id=bushings/flanged-bushing&bore=99999`)).status, 400);
});
