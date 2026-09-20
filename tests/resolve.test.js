// What has to hold, and why each one is here.
//
// Two kinds. The first is the real machine resolved against the real stubs,
// because a suite that only ever sees fixtures drifts away from the thing it is
// meant to protect. The second is small hand-written machines that are WRONG on
// purpose, one mistake each - those are the ones that prove a rule is enforced
// rather than merely written down in a README.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parse.js';
import { loadCatalogue } from '../src/catalogue-fs.js';
import { resolve, ERROR } from '../src/resolve.js';
import { billOfMaterials } from '../src/bom.js';
import { buildOrder } from '../src/build.js';
import { anchorInWorld, poseTree } from '../src/pose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'machines', 'linear-stage.machine');

const catalogue = await loadCatalogue(ROOT);
const stageSource = await readFile(STAGE, 'utf8');

const stage = (overrides = {}) => resolve(parse(stageSource, STAGE), catalogue, overrides);
const errors = (r) => r.diagnostics.filter((d) => d.severity === ERROR).map((d) => d.message);

// A catalogue with exactly the anchors a test needs, so a rule can be tested
// without a stub file existing for a part that may never be written.
const fake = (records) => ({
  get: (id) => records[id] ?? null,
  size: Object.keys(records).length,
  stubbed: [],
});

const RAIL = {
  id: 'rail', status: 'exists', designation: 'a rail',
  anchors: {
    track: { kind: 'track', range: [0, 100] },
    face: { kind: 'face' },
    circle: { kind: 'circle' },
  },
};
const BLOCK = { id: 'block', status: 'exists', designation: 'a block', anchors: { face: { kind: 'face' } } };

const tiny = (body) => resolve(parse(body, '<test>'), fake({ rail: RAIL, block: BLOCK }));

// --- the real machine -------------------------------------------------------

test('the stage resolves with no errors', () => {
  const r = stage();
  assert.deepEqual(errors(r), []);
  assert.equal(r.ok, true);
});

test('the designation is resolved against what is configured', () => {
  assert.equal(stage().designation, '100 mm belt-driven linear stage on 2020');
  assert.equal(stage({ travel: 150 }).designation, '150 mm belt-driven linear stage on 2020');
});

// Directed propagation, which is the whole bet. The beam is not asked for; it
// follows the travel. If this ever stops holding, something has started solving.
test('a parameter flows downward into the parts it settles', () => {
  // The beam is travel plus 150 - the carriage's length and the clearance at
  // each end that keeps it off the flanges. It is never asked for directly.
  assert.equal(stage().instances.get('beam').args.length, 250);
  assert.equal(stage({ travel: 150 }).instances.get('beam').args.length, 300);
});

// The idler hangs off the beam's far end, and that end is at `length` - a
// number the component is configured with, not one a stub can write down.
// Pinning it as a constant made this machine's headline parameter do nothing
// at all: the beam grew, the idler stayed, and the belt came out the same
// length at every travel while looking entirely correct.
test('an anchor positioned by a parameter follows it', () => {
  const far = (t) => {
    const r = stage({ travel: t });
    const w = anchorInWorld(r, poseTree(r).poses, { instance: 'beam', anchor: 'end_b' });
    return w.point[2];
  };
  assert.equal(far(50), 200);
  assert.equal(far(100), 250);
  assert.equal(far(150), 300);
});

test('a value outside the designed range is a warning, not a refusal', () => {
  const r = stage({ travel: 5000 });   // far beyond what mechanica will even model
  assert.deepEqual(errors(r), []);
  assert.ok(r.diagnostics.some((d) => /above the designed maximum/.test(d.message)));
});

test('an unknown parameter is refused rather than ignored', () => {
  assert.ok(errors(stage({ colour: 'red' })).some((m) => /not a parameter/.test(m)));
});

// --- the bill of materials --------------------------------------------------

test('fastenings are counted across every joint that uses them', () => {
  const bom = billOfMaterials(stage());
  const m5 = bom.bought.find((l) => l.id === 'hardware/cap-screw' && l.args.standard === 'M5');
  assert.equal(m5.count, 8, 'two flange joints of four screws each');
});

// A consumable is a stock declaration something fastens INTO: one line in the
// file, as many items as the joints eat. The linear stage no longer has one -
// the flange hub bolts to a bolt circle rather than into a slot - so this is a
// fixture, which is the better place for it anyway.
test('a consumable is counted by what consumes it, not as one instance', () => {
  const r = resolve(parse(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>(size=1);
    stock nut = <block>(size=2);
    ground rail;
    joint fixed rail.face -> a.face { fasten = <screw>() x6 into nut; }
  `, '<test>'), fake({ rail: RAIL, block: BLOCK }));
  // The two blocks carry different arguments on purpose: identical ones would
  // group into a single line, which would hide the very thing being counted.
  const line = billOfMaterials(r).bought.find((l) => l.args.size === 2);
  assert.ok(line, 'six nuts out of one declaration');
  assert.ok(r.consumed.has('nut'));
});

// Both pulleys are now the same part at the same numbers, which is one line of
// two rather than two lines of one - and that IS the grouping being right.
test('two instances of one part at one parameter set are a single line', () => {
  const pulleys = billOfMaterials(stage()).made.filter((l) => l.id === 'pulleys/timing-pulley');
  assert.equal(pulleys.length, 1);
  assert.equal(pulleys[0].count, 2);
});

test('parts mechanica does not have are carried, not dropped', () => {
  const made = billOfMaterials(stage()).made;
  const absent = made.filter((l) => l.status !== 'exists').map((l) => l.id).sort();
  assert.deepEqual(absent,
    ['carriages/belt-carriage', 'clamps/belt-clamp', 'idlers/idler-post']);
  assert.equal(made.length, 6, 'every made part appears whether or not it exists yet');
});

// --- the build order --------------------------------------------------------

// The invariant that makes a traversal an assembly sequence at all. Asserted
// over the order itself rather than over the prose, so rewording a step cannot
// quietly break it.
test('nothing is attached before the thing it attaches to', () => {
  const r = stage();
  const placed = new Set([r.ground]);
  for (const edge of r.tree.order) {
    assert.ok(placed.has(edge.joint.parent.instance),
      `${edge.child} is attached to ${edge.joint.parent.instance} before it is there`);
    placed.add(edge.child);
  }
  assert.equal(placed.size, r.tree.order.length + 1);
});

test('flexible stock is threaded last, because it is not on the tree', () => {
  const steps = buildOrder(stage());
  const belt = steps.findIndex((s) => /Run the synchronous-belt/.test(s.text));
  const lastJoint = steps.map((s) => !!s.joint).lastIndexOf(true);
  assert.ok(belt > lastJoint, 'the belt goes on after every body is placed');
});

// --- the rules, each broken on purpose --------------------------------------

test('a second parent is refused, because it closes a loop', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    stock b = <block>();
    ground rail;
    joint fixed rail.face -> a.face;
    joint fixed a.face -> b.face;
    joint fixed b.face -> a.face;
  `);
  assert.ok(errors(r).some((m) => /already attached to/.test(m) && /must be a tree/.test(m)), errors(r));
});

test('a thing jointed to itself is refused', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    ground rail;
    joint fixed rail.face -> rail.track;
  `);
  assert.ok(errors(r).some((m) => /jointed to itself/.test(m)), errors(r));
});

// The rule the first machine file taught: a prismatic joint consumes the
// freedom a track has, so pinning that track leaves it nothing to consume.
test('a prismatic joint may not pin the track it rides', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    ground rail;
    joint prismatic rail.track@10 -> a.face { limit = [0, 50]; }
  `);
  assert.ok(errors(r).some((m) => /no freedom left/.test(m)), errors(r));
});

test('a prismatic joint may not ride a face', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    ground rail;
    joint prismatic rail.face -> a.face { limit = [0, 50]; }
  `);
  assert.ok(errors(r).some((m) => /rides a track/.test(m)), errors(r));
});

test('only a track can be pinned with @', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    ground rail;
    joint fixed rail.face@10 -> a.face;
  `);
  assert.ok(errors(r).some((m) => /no position to pin/.test(m)), errors(r));
});

// An anchor that does not exist is the commonest mistake there is, so the
// message has to say what the part does have rather than only what it lacks.
test('an unknown anchor names the ones that exist', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    ground rail;
    joint fixed rail.slot_left -> a.face;
  `);
  const message = errors(r).find((m) => /no anchor/.test(m));
  assert.ok(message, errors(r));
  assert.ok(/track, face, circle/.test(message), message);
});

test('a machine with no ground is refused', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    joint fixed rail.face -> a.face;
  `);
  assert.ok(errors(r).some((m) => /no ground declared/.test(m)), errors(r));
});

test('something floating off the tree is reported', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    stock a = <block>();
    ground rail;
  `);
  assert.ok(r.diagnostics.some((d) => /not attached to anything/.test(d.message)));
});

// --- the parser -------------------------------------------------------------

test('a belt runs over a circle and nothing else', () => {
  const r = tiny(`
    @proven 1;
    stock rail = <rail>();
    ground rail;
    route belt = <belt>() { over = [rail.face]; anchors = [rail.track]; }
  `);
  assert.ok(errors(r).some((m) => /runs over a circle/.test(m)), errors(r));
});

test('a syntax error says which line', () => {
  assert.throws(() => parse('@proven 1;\n\nstock a = <thing>(;\n', '<test>'), /line 3/);
});

test('declaring the same name twice is refused', () => {
  assert.throws(() => parse('stock a = <x>();\nstock a = <y>();\n', '<test>'), /declared twice/);
});
