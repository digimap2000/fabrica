// Where everything actually is.
//
// One walk of the tree from ground outward, and the rule at each step is the
// same one sentence: a joint makes two anchors touch, so the child's body is
// wherever it has to be for its anchor to sit on the parent's, facing back at
// it. That is a multiplication, not a solve, and it is the reason poses are
// cheap here where a CAD package needs a solver - the tree already said which
// body is the reference for which, so nothing has to be worked out.
//
//     pose(child) = pose(parent) . F(parent anchor) . flip . F(child anchor)^-1
//
// A moving joint adds exactly one term to the middle: a track's frame slides
// along its own axis, a revolute turns about z. The joint variable is a number
// somebody chooses - the carriage's position - and everything downstream of it
// moves because the walk carries it.

import {
  FLIP, IDENTITY, add, axisZ, frame, invert, multiply, normalise, origin,
  rotationZ, scale, transformPoint, translation,
} from './matrix.js';
import { WARN, ERROR } from './resolve.js';

// An anchor may be positioned by one of its component's own parameters, and it
// has to be: an extrusion's far end is at `length`, not at any number a stub
// could write down. Pinning it as a constant made the linear stage's headline
// parameter do nothing at all - the beam grew and the idler stayed where it
// was, so the belt came out the same 540 mm at every travel and looked right.
//
// So a coordinate may be a string naming a parameter instead of a number. That
// is the smallest thing that expresses what is true, and it is deliberately not
// a little expression language: if an anchor ever needs arithmetic, that is
// mechanica's to publish rather than fabrica's to invent.
function valueOf(v, args, where) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const found = args?.[v];
    if (typeof found !== 'number') {
      throw new Error(`${where}: anchor refers to '${v}', which is not a number this component was given`);
    }
    return found;
  }
  throw new Error(`${where}: an anchor coordinate must be a number or a parameter name`);
}

export function resolveAnchor(anchor, args, where = 'anchor') {
  if (!anchor) return anchor;
  const fix = (a) => (Array.isArray(a) ? a.map((v) => valueOf(v, args, where)) : a);
  return { ...anchor, origin: fix(anchor.origin), axis: fix(anchor.axis), range: fix(anchor.range) };
}

// An anchor's frame on its own body. A track takes a position along its axis;
// everything else ignores it.
export function anchorFrame(anchor, at = 0) {
  const base = anchor.origin ?? [0, 0, 0];
  const o = anchor.kind === 'track' && at
    ? add(base, scale(normalise(anchor.axis ?? [1, 0, 0]), at))
    : base;
  return frame(o, anchor.normal ?? [0, 0, 1], anchor.clock ?? [1, 0, 0]);
}

// The clocking an interface asks for, in radians. This is the field that exists
// because a NEMA face's holes sit at 45 degrees to the motor's own axes, and two
// anchors agreeing on spacing and count can still be a quarter turn out.
//
// And then the joint's own, which is a different thing and is why both exist. A
// four-hole bolt circle has FOUR valid mountings, ninety degrees apart, all of
// them correct and all of them putting the motor somewhere different. The
// interface clock says what the pattern demands; the joint's says which of the
// positions the pattern permits was actually wanted. Without it fabrica picked
// one silently and a reasonable person expected another.
function clockingOf(parentAnchor, childAnchor, joint, resolved) {
  const a = parentAnchor.interface?.clock ?? 0;
  const b = childAnchor.interface?.clock ?? 0;
  const chosen = joint?.clock === undefined ? 0 : resolved.evaluate(joint.clock);
  return ((a - b + chosen) * Math.PI) / 180;
}

// The one rule, written once.
function mate(parentPose, parentAnchor, at, childAnchor, extra) {
  return multiply(
    multiply(
      multiply(multiply(parentPose, anchorFrame(parentAnchor, at)), FLIP),
      extra,
    ),
    invert(anchorFrame(childAnchor)),
  );
}

// The variable a moving joint carries. Named by its child, because a joint has
// no name of its own and the child is unique in a tree - which is a small proof
// that the tree rule earns more than it costs.
export function jointVariables(resolved, chosen = {}) {
  const variables = new Map();
  for (const edge of resolved.tree.order) {
    const joint = edge.joint;
    if (joint.type === 'fixed') continue;
    const limits = joint.limit?.items?.map((n) => resolved.evaluate(n));
    const home = joint.home === undefined ? (limits?.[0] ?? 0) : resolved.evaluate(joint.home);
    const value = chosen[edge.child] === undefined ? home : chosen[edge.child];
    variables.set(edge.child, { value, home, limits: limits ?? null, type: joint.type });
  }
  return variables;
}

export function poseTree(resolved, chosen = {}) {
  const poses = new Map();
  const diagnostics = [];
  const variables = jointVariables(resolved, chosen);

  if (!resolved.ground) return { poses, variables, diagnostics };
  poses.set(resolved.ground, IDENTITY);

  for (const edge of resolved.tree.order) {
    const joint = edge.joint;
    const parentPose = poses.get(joint.parent.instance);
    if (!parentPose) continue;                 // parent unplaced, already reported

    const parentOf = resolved.instances.get(joint.parent.instance);
    const childOf = resolved.instances.get(joint.child.instance);
    const parentAnchor = resolveAnchor(parentOf?.meta?.anchors?.[joint.parent.anchor],
                                       parentOf?.args, `${joint.parent.instance}.${joint.parent.anchor}`);
    const childAnchor = resolveAnchor(childOf?.meta?.anchors?.[joint.child.anchor],
                                      childOf?.args, `${joint.child.instance}.${joint.child.anchor}`);
    if (!parentAnchor || !childAnchor) {
      diagnostics.push({
        severity: WARN,
        message: `'${edge.child}' cannot be placed: ${!parentAnchor ? joint.parent.instance : joint.child.instance}`
               + ' has no metadata for its anchor, so everything attached to it is unplaced too',
      });
      continue;
    }

    const variable = variables.get(edge.child);
    let at = joint.parent.at === undefined ? 0 : resolved.evaluate(joint.parent.at);
    let extra = rotationZ(clockingOf(parentAnchor, childAnchor, joint, resolved));

    if (joint.type === 'prismatic') at = variable.value;
    if (joint.type === 'revolute') extra = multiply(extra, rotationZ(variable.value));

    try {
      poses.set(edge.child, mate(parentPose, parentAnchor, at, childAnchor, extra));
    } catch (e) {
      diagnostics.push({ severity: ERROR, message: `'${edge.child}': ${e.message}` });
    }
  }

  // Everything on the tree that could not be placed, said once rather than per
  // joint - a missing bracket otherwise reports its whole subtree.
  const unplaced = resolved.tree.order.map((e) => e.child).filter((n) => !poses.has(n));
  if (unplaced.length) {
    diagnostics.push({ severity: WARN, message: `unplaced: ${unplaced.join(', ')}` });
  }

  return { poses, variables, diagnostics };
}

// Where an anchor ends up in the world, which is what a belt and an interference
// check both actually want.
export function anchorInWorld(resolved, poses, ref) {
  const instance = resolved.instances.get(ref.instance);
  const anchor = resolveAnchor(instance?.meta?.anchors?.[ref.anchor], instance?.args,
                               `${ref.instance}.${ref.anchor}`);
  const pose = poses.get(ref.instance);
  if (!anchor || !pose) return null;
  const at = ref.at === undefined ? 0 : resolved.evaluate(ref.at);
  const world = multiply(pose, anchorFrame(anchor, at));
  return { frame: world, point: origin(world), axis: axisZ(world), anchor };
}

// --- extent -----------------------------------------------------------------
// An axis-aligned box around a posed body. Honest about what it is: a component
// is not a box, so this OVER-states every part that is not one. It is the right
// tool for 'how much bench does this need' and the wrong one for 'do these two
// touch' - see interference() below, which says so too.

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

export function boxInWorld(envelope, pose) {
  if (!envelope || !pose) return null;
  const { min, max } = envelope;
  let lo = null, hi = null;
  for (const corner of CORNERS) {
    const local = [
      corner[0] ? max[0] : min[0],
      corner[1] ? max[1] : min[1],
      corner[2] ? max[2] : min[2],
    ];
    const p = transformPoint(pose, local);
    lo = lo ? lo.map((v, i) => Math.min(v, p[i])) : p.slice();
    hi = hi ? hi.map((v, i) => Math.max(v, p[i])) : p.slice();
  }
  return { min: lo, max: hi };
}

export const unionBox = (a, b) =>
  !a ? b : !b ? a : {
    min: a.min.map((v, i) => Math.min(v, b.min[i])),
    max: a.max.map((v, i) => Math.max(v, b.max[i])),
  };

export function extent(resolved, poses) {
  let box = null;
  for (const [name, instance] of resolved.instances) {
    box = unionBox(box, boxInWorld(instance.meta?.envelope, poses.get(name)));
  }
  return box;
}

// The working envelope: the space the machine needs with everything moved
// everywhere it is allowed to go. Sampled rather than solved, because a sampled
// sweep of a rigid tree is exact at the ends and the ends are where a linear
// axis reaches furthest - and because the alternative is a swept-volume
// computation that needs the geometry fabrica deliberately does not hold.
export function sweptExtent(resolved, steps = 9) {
  const moving = [...jointVariables(resolved).entries()].filter(([, v]) => v.limits);
  if (!moving.length) return { box: extent(resolved, poseTree(resolved).poses), samples: 1 };

  let box = null;
  let samples = 0;
  const walk = (index, chosen) => {
    if (index === moving.length) {
      box = unionBox(box, extent(resolved, poseTree(resolved, chosen).poses));
      samples += 1;
      return;
    }
    const [name, variable] = moving[index];
    const [lo, hi] = variable.limits;
    for (let i = 0; i < steps; i++) {
      walk(index + 1, { ...chosen, [name]: lo + ((hi - lo) * i) / (steps - 1 || 1) });
    }
  };
  walk(0, {});
  return { box, samples, moving: moving.map(([n]) => n) };
}

// --- interference -----------------------------------------------------------
// Boxes overlapping is not parts touching, and this says candidate rather than
// collision for that reason. It is still worth having: an empty result is a
// real all-clear, because two things that do not overlap as boxes certainly do
// not overlap as solids. A non-empty one is a list to look at, and it becomes a
// real answer when there are meshes to ask.

const overlaps = (a, b, slack) =>
  a && b && [0, 1, 2].every((i) => a.min[i] < b.max[i] - slack && b.min[i] < a.max[i] - slack);

export function interference(resolved, poses, slack = 0.5) {
  const boxes = [];
  for (const [name, instance] of resolved.instances) {
    const box = boxInWorld(instance.meta?.envelope, poses.get(name));
    if (box) boxes.push({ name, box });
  }

  // Things that are jointed together are MEANT to touch, and so are two things
  // on the same parent that share a mounting face. Reporting those would bury
  // the one pair that matters.
  const related = (a, b) =>
    resolved.tree.parentOf.get(a)?.parent === b || resolved.tree.parentOf.get(b)?.parent === a;

  const found = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (related(boxes[i].name, boxes[j].name)) continue;
      if (overlaps(boxes[i].box, boxes[j].box, slack)) {
        found.push({ a: boxes[i].name, b: boxes[j].name });
      }
    }
  }
  return found;
}

export { origin, distance } from './matrix.js';
