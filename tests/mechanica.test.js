// The boundary, tested without crossing it.
//
// Everything here is pure: building a query, and decoding a payload. That is
// deliberate - the two things most likely to break when mechanica changes are
// also the two that can be checked in a millisecond with no network, so there
// is no excuse for finding out in a browser.
//
// What is NOT tested here is that mechanica still answers the way this expects.
// That is a contract test against a running release, it belongs in CI, and
// pretending a unit test covers it would be the dishonest kind of green.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeMesh, meshQuery } from '../src/mechanica.js';

const pulley = {
  id: 'pulleys/timing-pulley',
  args: { profile: 'GT2 2 mm', teeth: 20, bore: 5 },
  meta: {
    mechanica: { id: 'pulleys/timing-pulley', map: { profile: { 'GT2 2 mm': 'belt_profile:gt2_2' } } },
  },
};

// --- the query ---------------------------------------------------------------

test('a component with no bridge is not asked for', () => {
  // Bought stock has no mechanica geometry and never will, so the absence of a
  // bridge is the answer rather than a gap - it is what makes a thing a box.
  assert.equal(meshQuery({ id: 'nema', args: {}, meta: { designation: 'a motor' } }), null);
});

// The translation this whole file exists for. 'GT2 2 mm' is a belt somebody can
// name; 'belt_profile:gt2_2' is a row in a standards table. Sending the first
// gets a 400 from the real service, which is how this was found.
test('a value is translated into the key mechanica is actually seeded by', () => {
  const query = new URLSearchParams(meshQuery(pulley));
  assert.equal(query.get('profile'), 'belt_profile:gt2_2');
  assert.equal(query.get('teeth'), '20');
  assert.equal(query.get('bore'), '5');
  assert.equal(query.get('id'), 'pulleys/timing-pulley');
});

test('an unmapped value passes through unchanged', () => {
  const query = new URLSearchParams(meshQuery({
    ...pulley,
    args: { ...pulley.args, profile: 'HTD 3 mm' },       // no mapping for this one
  }));
  assert.equal(query.get('profile'), 'HTD 3 mm');
});

test('a parameter can be renamed as well as remapped', () => {
  const query = new URLSearchParams(meshQuery({
    id: 'hardware/cap-screw',
    args: { standard: 'M5' },
    meta: { mechanica: { id: 'hardware/cap-screw', rename: { standard: 'fastener' }, map: { standard: { M5: 'cap_screw:M5' } } } },
  }));
  assert.equal(query.get('fastener'), 'cap_screw:M5');
  assert.equal(query.get('standard'), null);
});

// Two instances of one component at different parameters must produce different
// queries, because the query is the cache key - if they collided, a machine
// would draw one pulley twice and look entirely plausible doing it.
test('different parameters give different queries, because the query is the cache key', () => {
  const other = { ...pulley, args: { ...pulley.args, bore: 8 } };
  assert.notEqual(meshQuery(pulley), meshQuery(other));
});

// --- the payload -------------------------------------------------------------

function payload({ magic = 'MMS2', positions = [], normals = [], edges = [],
                   hardware = [], truncate = 0 } = {}) {
  const tail = hardware.length
    ? 4 + hardware.reduce((n, h) => n + 16 + 8 + (h.positions.length + (h.normals ?? h.positions).length) * 4, 0)
    : 0;
  const buffer = new ArrayBuffer(16 + (positions.length + normals.length + edges.length) * 4 + tail);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(4, positions.length, true);
  view.setUint32(8, normals.length, true);
  view.setUint32(12, edges.length, true);
  let at = 16;
  for (const v of [...positions, ...normals, ...edges]) { view.setFloat32(at, v, true); at += 4; }

  if (hardware.length) {
    view.setUint32(at, hardware.length, true);
    at += 4;
    for (const piece of hardware) {
      const name = piece.material.padEnd(16, ' ');      // fixed width, space padded
      for (let k = 0; k < 16; k++) view.setUint8(at + k, name.charCodeAt(k));
      at += 16;
      const normals_ = piece.normals ?? piece.positions;
      view.setUint32(at, piece.positions.length, true);
      view.setUint32(at + 4, normals_.length, true);
      at += 8;
      for (const v of [...piece.positions, ...normals_]) { view.setFloat32(at, v, true); at += 4; }
    }
  }
  return truncate ? buffer.slice(0, buffer.byteLength - truncate) : buffer;
}

const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];

test('a mesh decodes to the floats it was given', () => {
  const mesh = decodeMesh(payload({ positions: TRIANGLE, normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] }));
  assert.deepEqual([...mesh.positions], TRIANGLE);
  assert.equal(mesh.triangles, 1);
  assert.equal(mesh.edges.length, 0);
});

// The check that earns its keep. A proxy error page, a login redirect or a 502
// all arrive as bytes, and handing those to a renderer gives a blank viewport
// and an hour spent looking at the camera.
test('anything that is not a mesh is refused by name', () => {
  assert.throws(() => decodeMesh(payload({ magic: 'HTML', positions: TRIANGLE })),
    /got 'HTML'/);
});

// Two magics, and the difference is a whole block of data. MMS2 is the three
// arrays; MMS3 carries the hardware a part is designed around, each piece with
// its material. The headers are identical, so an MMS2 reader consumes an MMS3
// payload happily and stops early - which is what fabrica did, silently, for
// every bracket it ever fetched.
test('MMS3 carries hardware and its material; MMS2 carries none', () => {
  const plain = decodeMesh(payload({ magic: 'MMS2', positions: TRIANGLE }));
  assert.equal(plain.format, 'MMS2');
  assert.deepEqual(plain.hardware, []);

  const withMotor = decodeMesh(payload({
    magic: 'MMS3', positions: TRIANGLE,
    hardware: [{ material: 'steel', positions: TRIANGLE }],
  }));
  assert.equal(withMotor.format, 'MMS3');
  assert.equal(withMotor.hardware.length, 1);
  assert.equal(withMotor.hardware[0].material, 'steel', 'trimmed of its padding');
  assert.equal(withMotor.hardware[0].triangles, 1);
});

// The check that would have caught the omission in the first place. Reading
// three arrays and stopping left 73 kB unread per bracket and nothing said so,
// because the only length check asked whether there were too FEW bytes.
test('nothing in a payload goes unread without saying so', () => {
  const m = decodeMesh(payload({
    magic: 'MMS3', positions: TRIANGLE,
    hardware: [{ material: 'brass', positions: TRIANGLE }],
  }));
  assert.equal(m.unread, 0);
});

test('a truncated payload is refused rather than half-read', () => {
  assert.throws(() => decodeMesh(payload({ positions: TRIANGLE, truncate: 8 })), /truncated/);
});

test('float counts that are not whole vertices are refused', () => {
  const buffer = payload({ positions: [1, 2, 3, 4] });     // four floats is not vertices
  assert.throws(() => decodeMesh(buffer), /multiples of three/);
});

test('something far too short to be a mesh says so', () => {
  assert.throws(() => decodeMesh(new ArrayBuffer(4)), /too short/);
});

// mechanica's payload is little-endian, and a big-endian read of it produces
// enormous coordinates rather than an error - a machine the size of a county
// with no clue as to why.
test('floats are read little-endian', () => {
  const mesh = decodeMesh(payload({ positions: [1.5, 0, 0, 0, 0, 0, 0, 0, 0] }));
  assert.equal(mesh.positions[0], 1.5);
});
