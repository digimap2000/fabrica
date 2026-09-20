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
import { loadCatalogue } from '../src/catalogue-fs.js';
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

// The hub, end to end. The flange swallows the beam's end so its socket floor
// sits at the beam's zero and its plate 6 mm beyond; the bracket bolts to that
// plate; the motor bolts to the bracket. Worked by hand from the flange's own
// 6 mm thickness, not read off the output.
test('the flange chain lands where the flange thickness says it does', () => {
  const { poses } = poseTree(stage());
  assert.ok(near(at('motor_flange', poses), [0, 0, -6]), JSON.stringify(at('motor_flange', poses)));
  assert.ok(near(at('drive_pulley', poses), [-38, 0, -41]), JSON.stringify(at('drive_pulley', poses)));

  // The motor hangs off the INSIDE of its leg, so its body sits over the
  // bracket at +x rather than out in space at -x, while the shaft still comes
  // out on the belt side. That is the whole point of the reverse mount.
  assert.ok(at('motor', poses)[0] > 0, 'motor body on the far side of the leg');
  assert.ok(at('drive_pulley', poses)[0] < 0, 'and the pulley still on the belt side');
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

// A pulley slides onto a shaft and a grub screw decides where, so the shaft is
// a track and the joint pins it. 8 mm along a shaft whose face is at x = -30
// puts the pulley at -22.
test('a pinned track puts the child that far along it', () => {
  const { poses } = poseTree(stage());
  assert.ok(near(at('drive_pulley', poses), [-38, 0, -41]), JSON.stringify(at('drive_pulley', poses)));
});

// --- the joint that moves ---------------------------------------------------

test('a prismatic joint moves its child and everything on it', () => {
  const home = poseTree(stage()).poses;
  const out = poseTree(stage(), { carriage: 160 }).poses;
  assert.ok(near(at('carriage', home), [-10, 0, 60]), JSON.stringify(at('carriage', home)));
  assert.ok(near(at('carriage', out), [-10, 0, 160]));
  // the clamp is bolted to the carriage, so it comes too
  assert.ok(close(at('clamp', out)[2] - at('clamp', home)[2], 100));
});

// The stroke starts 60 mm in because the motor flange is 60 across and reaches
// into the path of anything riding the slot. Home is that start, not zero.
test('a joint variable defaults to its home', () => {
  const { variables } = poseTree(stage());
  assert.equal(variables.get('carriage').home, 60);
  assert.deepEqual(variables.get('carriage').limits, [60, 160]);
});

// --- the belt ---------------------------------------------------------------

// Worked by hand: two 20-tooth GT2 pulleys, pitch diameter 12.73, at 332 mm
// centres. A closed loop is 2 x 332 + pi x 12.73 = 703.99; the belt is cut
// between clamps 24 mm apart, so 680.0.
test('the belt length is derived, and it is the one worked out by hand', () => {
  const r = stage();
  const { routes } = resolveRoutes(r, poseTree(r).poses);
  assert.equal(routes.length, 1);
  assert.ok(close(routes[0].length, 680.0, 0.05), String(routes[0].length));
  assert.ok(close(routes[0].centres, 332, 1e-9));
  assert.deepEqual(routes[0].teethEngaged, [10, 10], 'half of a 20-tooth pulley');
});

test('the belt follows the travel, because the idler does', () => {
  const r = stage({ travel: 150 });
  const { routes } = resolveRoutes(r, poseTree(r).poses);
  assert.ok(close(routes[0].length, 780.0, 0.05), String(routes[0].length));
});

// The two ends now agree by construction - the same bracket, and a post shaped
// like the motor it replaces, so equal positions along the two give coplanar
// pulleys without anybody working it out. It took three wrong pairs to get
// there, each caught by this check, so what is asserted now is that moving
// ONE of them still fails: the agreement has to be real, not assumed.
test('pitch circles out of plane are refused rather than projected away', () => {
  const r = resolve(parse(source.replace('idler_post.spindle@14', 'idler_post.spindle@8'), STAGE), catalogue, {});
  const { diagnostics } = resolveRoutes(r, poseTree(r).poses);
  const message = diagnostics.find((d) => /apart along the axis/.test(d.message));
  assert.ok(message, JSON.stringify(diagnostics));
  assert.equal(message.severity, ERROR);
  assert.ok(/6\.0 mm/.test(message.message), message.message);
});

// The fouling that was pointed out rather than found: the belt ran straight
// through both end flanges and both brackets, and every other check passed. A
// belt is a path through a machine full of other things, and nothing asked
// whether the path was clear.
test('a belt threaded through the machine is refused', () => {
  const r = resolve(parse(source.replace('motor.shaft@14', 'motor.shaft@8')
                                .replace('idler_post.spindle@14', 'idler_post.spindle@8'), STAGE),
                    catalogue, {});
  const { diagnostics } = resolveRoutes(r, poseTree(r).poses);
  const message = diagnostics.find((d) => /passes through/.test(d.message));
  assert.ok(message, JSON.stringify(diagnostics));
  assert.equal(message.severity, ERROR);
  assert.ok(/flange/.test(message.message), message.message);
});

// And what it must NOT report: a motor's envelope is a NEMA square that
// includes its 5 mm shaft, so a belt on a pulley on that shaft is inside the
// motor's box by construction. Naming it every time is how a check teaches
// people to ignore it.
test('what a pulley is threaded onto is not reported as fouling', () => {
  const r = stage();
  const { diagnostics } = resolveRoutes(r, poseTree(r).poses);
  const message = diagnostics.find((d) => /passes through/.test(d.message));
  assert.equal(message, undefined, message?.message);
});

// The check this machine's first version needed and did not have. It reported a
// confident 816 mm of belt while the clamps hung 37.5 mm from the run, because
// every number in that calculation was correct and only the arrangement was
// wrong. Here the clamp is pulled back off the run and the build is refused.
test('a clamp that does not reach the belt is refused, whatever length it reports', () => {
  const shallow = {
    ...catalogue,
    get: (id) => {
      const record = catalogue.get(id);
      if (id !== 'clamps/belt-clamp') return record;
      const copy = structuredClone(record);
      copy.anchors.belt_a.origin[2] = 4;        // as first written: short of the pitch plane
      copy.anchors.belt_b.origin[2] = 4;
      return copy;
    },
  };
  const r = resolve(parse(source, STAGE), shallow, {});
  const { diagnostics } = resolveRoutes(r, poseTree(r).poses);
  const message = diagnostics.find((d) => /out of its plane/.test(d.message));
  assert.ok(message, JSON.stringify(diagnostics));
  assert.equal(message.severity, ERROR);
  assert.ok(/grips air/.test(message.message), message.message);
});

test('both cut ends must be clamped to the same run', () => {
  const split = {
    ...catalogue,
    get: (id) => {
      const record = catalogue.get(id);
      if (id !== 'clamps/belt-clamp') return record;
      const copy = structuredClone(record);
      copy.anchors.belt_b.origin[0] = 0 - copy.anchors.belt_b.origin[0];   // onto the other run
      return copy;
    },
  };
  const r = resolve(parse(source, STAGE), split, {});
  const { diagnostics } = resolveRoutes(r, poseTree(r).poses);
  assert.ok(diagnostics.some((d) => /opposite runs/.test(d.message)), JSON.stringify(diagnostics));
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

// Turned round from how it started. The clash check found the carriage sitting
// astride the motor flange at the bottom of its stroke, and the fix was to
// start the stroke 60 mm in - so what is worth asserting now is that the limit
// is doing that work: clear everywhere it is allowed to go, and fouling the
// flange the moment it is driven below it.
test('the stroke is clear of the motor end, and would not be without its limit', () => {
  const r = stage();
  const { variables } = poseTree(r);
  const [lo, hi] = variables.get('carriage').limits;
  const fouls = (at) => interference(r, poseTree(r, { carriage: at }).poses)
    .some((c) => [c.a, c.b].includes('carriage') && [c.a, c.b].includes('motor_flange'));

  assert.equal(fouls(lo), false, 'clear at the bottom of the stroke');
  assert.equal(fouls(hi), false, 'clear at the top of the stroke');
  assert.equal(fouls(0), true, 'and would foul the flange if the limit let it down there');
});

test('a point transforms the same way through a frame and its parts', () => {
  const f = frame([1, 2, 3], [0, 0, 1], [1, 0, 0]);
  assert.ok(near(transformPoint(f, [0, 0, 0]), [1, 2, 3]));
  assert.ok(near(transformPoint(invert(f), [1, 2, 3]), [0, 0, 0], 1e-12));
});
