// What turning the motor does, and the one number a user leaves with.
//
// Worked by hand rather than read off the output: a 20-tooth GT2 2 mm pulley
// has a pitch circumference of 20 x 2 = 40 mm, so one revolution moves the
// carriage 40 mm. A 1.8 degree stepper is 200 full steps, so 200/40 = 5 steps
// per mm, and 80 at the sixteenth-stepping most boards ship with.
//
// The point of checking it is that none of those numbers is the pulley's
// OUTSIDE diameter, which is what somebody measuring a pulley with calipers
// would reach for and is about 12.2 rather than 12.73.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parse.js';
import { loadCatalogue } from '../src/catalogue-fs.js';
import { resolve } from '../src/resolve.js';
import { poseTree } from '../src/pose.js';
import { resolveDrives } from '../src/drive.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'machines', 'linear-stage.machine');
const catalogue = await loadCatalogue(ROOT);
const source = await readFile(STAGE, 'utf8');
const stage = () => resolve(parse(source, STAGE), catalogue, {});

test('one turn of the pulley is one pitch circumference of travel', () => {
  const r = stage();
  const { drives } = resolveDrives(r, poseTree(r).poses);
  assert.equal(drives.length, 1);
  assert.equal(drives[0].teeth, 20);
  assert.ok(Math.abs(drives[0].perRevolution - 40) < 0.05, String(drives[0].perRevolution));
});

test('steps per millimetre is what goes in the firmware', () => {
  const r = stage();
  const { drives } = resolveDrives(r, poseTree(r).poses);
  const at = (micro) => drives[0].steps.find((s) => s.micro === micro).perMm;
  assert.ok(Math.abs(at(1) - 5) < 0.01, String(at(1)));
  assert.ok(Math.abs(at(16) - 80) < 0.02, String(at(16)));
});

// The ratio is the belt's, not the motor's, so changing the travel must not
// touch it - a longer stage moves the same distance per turn and simply takes
// more turns.
test('travel does not change the ratio', () => {
  const long = resolve(parse(source, STAGE), catalogue, { travel: 150 });
  const { drives } = resolveDrives(long, poseTree(long).poses);
  assert.ok(Math.abs(drives[0].perRevolution - 40) < 0.05);
});

// Without a step angle there is no steps-per-mm to give, and inventing 1.8
// would be guessing at a bought part on the user's behalf.
test('a motor with no step angle still gives millimetres per turn', () => {
  const r = resolve(parse(source.replace('step_angle=1.8', 'step_angle=0'), STAGE), catalogue, {});
  const { drives } = resolveDrives(r, poseTree(r).poses);
  assert.ok(Math.abs(drives[0].perRevolution - 40) < 0.05);
  assert.equal(drives[0].steps, null);
});
