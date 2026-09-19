// Poses, and the numbers that come out of them.
//
// Geometry is the easiest thing in this repository to get plausibly wrong: a
// sign error puts a bracket through the extrusion it is bolted to and every
// number downstream still looks like a number. So these assert against
// positions worked out by hand from the stubs, not against whatever the code
// happened to print the first time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parse.js';
import { loadCatalogue } from '../src/catalogue.js';
import { resolve, ERROR } from '../src/resolve.js';
import { anchorInWorld, extent, poseTree, sweptExtent, interference } from '../src/pose.js';
import { resolveRoutes } from '../src/route.js';
import { dot, frame, invert, multiply, normalise, transformPoint } from '../src/matrix.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'machines', 'linear-stage.machine');

const catalogue = await loadCatalogue(ROOT);
const source = await readFile(STAGE, 'utf8');
const stage = (set = {}) => resolve(parse(source, STAGE), catalogue, set);

const at = (name, poses) => poses.get(name).slice(3, 4).concat(poses.get(name)[7], poses.get(name)[11]);
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const near = (got, want, tol = 1e-6) =>
  got.length === want.length && got.every((v, i) => close(v, want[i], tol));

// --- the maths itself -------------------------------------------------------

test('a rigid transform inverts to its own undo', () => {
  const f = frame([3, -4, 5], [0, 1, 1], [1, 0, 0]);
  const round = multiply(f, invert(f));
  assert.ok(near(round, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-12));
});

test('a frame is orthonormal even when the clock is not square to the normal', () => {
  // A hand-written stub will sooner or later do this, and a frame that is not
  // quite a frame skews every part downstream of it.
  const f = frame([0, 0, 0], [0, 0, 1], [1, 0, 0.3]);
  const x = [f[0], f[4], f[8]], y = [f[1], f[5], f[9]], z = [f[2], f[6], f[10]];
  for (const v of [x, y, z]) assert.ok(close(Math.hypot(...v), 1, 1e-12));
  assert.ok(close(dot(x, y), 0, 1e-12));
  assert.ok(close(dot(y, z), 0, 1e-12));
  assert.ok(close(dot(x, z), 0, 1e-12));
});

test('a clock parallel to the normal is refused, because it fixes no rotation', () => {
  assert.throws(() => frame([0, 0, 0], [0, 0, 1], [0, 0, 1]), /fixes no rotation/);
});

// --- placing the stage ------------------------------------------------------

test('ground is the origin and everything is placed from it', () => {
  const { poses, diagnostics } = poseTree(stage());
  assert.ok(near(at('beam', poses), [0, 0, 0]));
  assert.equal(diagnostics.filter((d) => d.severity === ERROR).length, 0);
});

// Worked by hand: the beam's left slot is the face at y = -10, so a bracket
// bolted to it sits there, and its 46 mm motor face is 46 further out.
test('a bracket lands on the face it is bolted to, and its far face 46 beyond', () => {
  const { poses } = poseTree(stage());
  assert.ok(near(at('mount', poses), [0, -10, 0]), JSON.stringify(at('mount', poses)));
  assert.ok(near(at('motor', poses), [0, -56, 0]), JSON.stringify(at('motor', poses)));
});

// The mating rule, asserted directly rather than through a position: two faces
// that are joined point at each other. If this ever stops holding, every
// position above is wrong in a way that still looks like a number.
test('joined faces have opposed normals and touch at a point', () => {
  const r = stage();
  const { poses } = poseTree(r);
  let checked = 0;
  for (const edge of r.tree.order) {
    const parent = anchorInWorld(r, poses, edge.joint.parent);
    const child = anchorInWorld(r, poses, edge.joint.child);
    if (!parent || !child) continue;
    checked += 1;
    const pinned = edge.joint.parent.at !== undefined || edge.joint.type === 'prismatic';
    assert.ok(close(dot(normalise(parent.axis), normalise(child.axis)), -1, 1e-9),
      `${edge.child}: normals are not opposed`);
    if (!pinned) {
      assert.ok(near(parent.point, child.point, 1e-9), `${edge.child}: faces do not touch`);
    }
  }
  // Without this the whole test passes by checking nothing the day an anchor
  // lookup starts returning null - which is exactly how a geometry suite rots.
  assert.equal(checked, r.tree.order.length, 'every joint was actually checked');
});

test('a pinned track puts the child that far along it', () => {
  const { poses } = poseTree(stage());
  // the idler block sits at travel + 100 = 400 along the beam
  assert.ok(near(at('idler_block', poses), [400, -10, 0]));
  assert.ok(near(at('idler_block', poseTree(stage({ travel: 500 })).poses), [600, -10, 0]));
});

// --- the joint that moves ---------------------------------------------------

test('a prismatic joint moves its child and everything on it', () => {
  const home = poseTree(stage()).poses;
  const out = poseTree(stage(), { carriage: 300 }).poses;
  assert.ok(near(at('carriage', home), [0, 0, 10]));
  assert.ok(near(at('carriage', out), [300, 0, 10]));
  // the clamp is bolted to the carriage, so it comes too
  assert.ok(close(at('clamp', out)[0] - at('clamp', home)[0], 300));
});

test('a joint variable defaults to its home', () => {
  const { variables } = poseTree(stage());
  assert.equal(variables.get('carriage').home, 0);
  assert.deepEqual(variables.get('carriage').limits, [0, 300]);
});

// --- the belt ---------------------------------------------------------------

// Worked by hand: two 20-tooth GT2 pulleys, pitch diameter 12.73, at 400 mm
// centres. A closed loop is 2 x 400 + pi x 12.73 = 839.99; the belt is cut
// between clamps 24 mm apart, so 816.0.
test('the belt length is derived, and it is the one worked out by hand', () => {
  const r = stage();
  const { routes } = resolveRoutes(r, poseTree(r).poses);
  assert.equal(routes.length, 1);
  assert.ok(close(routes[0].length, 816.0, 0.05), String(routes[0].length));
  assert.ok(close(routes[0].centres, 400, 1e-9));
  assert.deepEqual(routes[0].teethEngaged, [10, 10], 'half of a 20-tooth pulley');
});

test('the belt follows the travel, because the idler does', () => {
  const r = stage({ travel: 500 });
  const { routes } = resolveRoutes(r, poseTree(r).poses);
  assert.ok(close(routes[0].length, 1216.0, 0.05), String(routes[0].length));
});

// The check that found a real fault in this machine's own stubs: the drive
// pulley hangs off a motor shaft and the idler sits on a spindle, so the two
// stack in opposite directions and equal heights do NOT make them coplanar.
// Projecting the offset out is what makes the centre distance right, and is
// exactly what would have hidden this.
test('pitch circles out of plane are refused rather than projected away', async () => {
  const bent = {
    ...catalogue,
    get: (id) => {
      const record = catalogue.get(id);
      if (id !== 'brackets/idler-block') return record;
      const copy = structuredClone(record);
      copy.anchors.spindle.origin = [0, 0, 46];      // as first written, and wrong
      return copy;
    },
  };
  const r = resolve(parse(source, STAGE), bent, {});
  const { diagnostics } = resolveRoutes(r, poseTree(r).poses);
  const message = diagnostics.find((d) => /apart along the axis/.test(d.message));
  assert.ok(message, JSON.stringify(diagnostics));
  assert.equal(message.severity, ERROR);
  assert.ok(/13\.0 mm/.test(message.message), message.message);
});

// --- space ------------------------------------------------------------------

test('the swept extent contains the extent at rest', () => {
  const r = stage();
  const rest = extent(r, poseTree(r).poses);
  const { box } = sweptExtent(r, 5);
  for (const i of [0, 1, 2]) {
    assert.ok(box.min[i] <= rest.min[i] + 1e-9, `swept min ${i}`);
    assert.ok(box.max[i] >= rest.max[i] - 1e-9, `swept max ${i}`);
  }
});

// Not a collision test and it must not read as one. What it does prove is the
// direction that is sound: boxes that do not overlap cannot be parts that do.
test('things jointed together are not reported as clashing', () => {
  const r = stage();
  const clashes = interference(r, poseTree(r).poses);
  for (const { a, b } of clashes) {
    assert.notEqual(r.tree.parentOf.get(a)?.parent, b);
    assert.notEqual(r.tree.parentOf.get(b)?.parent, a);
  }
});

test('a carriage driven into the motor end is found', () => {
  const r = stage();
  const clash = interference(r, poseTree(r, { carriage: 0 }).poses);
  assert.ok(clash.some((c) => [c.a, c.b].includes('carriage') && [c.a, c.b].includes('mount')),
    'at travel 0 the carriage is on top of the motor mount');
});

test('a point transforms the same way through a frame and its parts', () => {
  const f = frame([1, 2, 3], [0, 0, 1], [1, 0, 0]);
  assert.ok(near(transformPoint(f, [0, 0, 0]), [1, 2, 3]));
  assert.ok(near(transformPoint(invert(f), [1, 2, 3]), [0, 0, 0], 1e-12));
});
