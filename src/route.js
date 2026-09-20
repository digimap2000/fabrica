// How long the belt is.
//
// This is the number the design note promised and the first resolver could only
// apologise for. It is worth being clear about what makes it legitimate: the
// belt closes a loop, and a closed loop is what the tree rule forbids - but
// nothing here is solved. The poses were already settled by the tree walk, and
// this measures the path between things that are already placed. Deriving a
// length from known positions is arithmetic; finding positions that satisfy a
// length would be a solver, and that is the line.
//
// The geometry is the standard two-pulley open belt, and it is exact rather
// than approximate as long as the two axes are parallel - which is checked,
// because two pulleys whose axes have drifted apart is a real mistake and the
// formula would quietly return a plausible number for it.

import { anchorInWorld, boxInWorld, envelopeOf } from './pose.js';
import { add, cross, distance, dot, length, normalise, origin, scale } from './matrix.js';
import { ERROR, WARN } from './resolve.js';

// How much room a belt wants beside whatever it runs past. Two millimetres is
// not a calculation, it is a number small enough to be free and large enough
// that a print tolerance and a bit of flex do not close it. A machine may say
// otherwise per route.
const DEFAULT_CLEARANCE = 2;

const radiusOf = (anchor) => {
  const face = anchor.interface ?? {};
  if (face.diameter !== undefined) return face.diameter / 2;
  if (face.radius !== undefined) return face.radius;
  return null;
};

// How far a point is from a box: positive outside, negative inside. Outside is
// the usual clamped distance; inside is how far it would have to move to get
// out through the nearest face.
function pointToBox(p, box) {
  const outside = [0, 1, 2].map((i) => Math.max(box.min[i] - p[i], 0, p[i] - box.max[i]));
  const d = Math.hypot(...outside);
  if (d > 0) return d;
  return 0 - Math.min(...[0, 1, 2].map((i) => Math.min(p[i] - box.min[i], box.max[i] - p[i])));
}

// The nearest the segment gets to the box. Outside a convex body that distance
// is convex along the segment, so a ternary search converges on it exactly
// rather than approximately - which matters, because this number is the
// difference between a belt that runs and a belt that rubs.
function segmentToBox(from, to, box) {
  const at = (s) => pointToBox([0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * s), box);
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (at(a) < at(b)) hi = b; else lo = a;
  }
  return Math.min(at((lo + hi) / 2), at(0), at(1));
}

// How far a segment reaches inside a box, or null if it misses. The slab method,
// and the depth is what makes the message useful: 'by 0.3 mm' is a clearance to
// open up and 'by 14 mm' is a part in the wrong place.
function segmentMeetsBox(from, to, box) {
  const d = [0, 1, 2].map((i) => to[i] - from[i]);
  let lo = 0, hi = 1;
  for (const i of [0, 1, 2]) {
    if (Math.abs(d[i]) < 1e-9) {
      if (from[i] < box.min[i] || from[i] > box.max[i]) return null;
      continue;
    }
    let t0 = (box.min[i] - from[i]) / d[i];
    let t1 = (box.max[i] - from[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    if (lo > hi) return null;
  }
  // The shallowest face it would have to be pulled out through.
  const mid = [0, 1, 2].map((i) => from[i] + d[i] * ((lo + hi) / 2));
  return Math.min(...[0, 1, 2].map((i) => Math.min(mid[i] - box.min[i], box.max[i] - mid[i])));
}

export function resolveRoutes(resolved, poses) {
  const results = [];
  const diagnostics = [];

  // Every posed body's world box, computed once for the clearance check below.
  const boxes = new Map();
  for (const [name, instance] of resolved.instances) {
    const box = boxInWorld(envelopeOf(instance), poses.get(name));
    if (box) boxes.set(name, box);
  }

  for (const route of resolved.routes) {
    const overRefs = route.over?.items ?? [];
    const endRefs = route.anchors?.items ?? [];

    const over = overRefs.map((ref) => {
      const world = anchorInWorld(resolved, poses, ref);
      return world && { ref, ...world, radius: radiusOf(world.anchor) };
    });
    const ends = endRefs.map((ref) => anchorInWorld(resolved, poses, ref));

    const name = route.name;
    if (over.some((o) => !o) || ends.some((e) => !e)) {
      diagnostics.push({ severity: WARN, message: `route '${name}': not every anchor is placed, so no length is derived` });
      results.push({ name, id: route.of.id, length: null });
      continue;
    }
    if (over.length !== 2) {
      // Three or more pulleys is a real arrangement - an idler tensioning a
      // long run - and the path is then a convex hull rather than one pair of
      // tangents. Refused rather than approximated, because a wrong belt is
      // bought and cut before anybody notices.
      diagnostics.push({ severity: ERROR, message: `route '${name}': ${over.length} pulleys, and only the two-pulley path is derived so far` });
      results.push({ name, id: route.of.id, length: null });
      continue;
    }
    if (over.some((o) => o.radius === null)) {
      diagnostics.push({ severity: ERROR, message: `route '${name}': a pitch circle with no diameter in its interface` });
      results.push({ name, id: route.of.id, length: null });
      continue;
    }

    const [a, b] = over;
    const skew = length(cross(normalise(a.axis), normalise(b.axis)));
    if (skew > 1e-6) {
      diagnostics.push({
        severity: ERROR,
        message: `route '${name}': the two pulley axes are ${(Math.asin(Math.min(1, skew)) * 180 / Math.PI).toFixed(1)} degrees apart, `
               + 'so the belt does not lie in a plane and this length would be wrong',
      });
      results.push({ name, id: route.of.id, length: null });
      continue;
    }

    // Centre distance measured in the plane of the belt, which is the distance
    // between the axes rather than between the two origins - they are the same
    // here only because the pulleys are level with each other, and will not be
    // the day somebody staggers them.
    const between = [a.point[0] - b.point[0], a.point[1] - b.point[1], a.point[2] - b.point[2]];
    const along = dot(between, normalise(a.axis));
    const centres = Math.sqrt(Math.max(0, dot(between, between) - along * along));

    const dr = a.radius - b.radius;
    if (centres <= Math.abs(dr)) {
      diagnostics.push({ severity: ERROR, message: `route '${name}': the pulleys overlap, so no belt path exists` });
      results.push({ name, id: route.of.id, length: null });
      continue;
    }

    // The component the centre distance threw away. Projecting it out is what
    // makes the distance right, and it is also what would hide a pair of
    // pulleys that are level but not in the same plane - a belt running 13 mm
    // out over 400 will climb its flange and shred. So the number that was
    // discarded gets looked at rather than dropped.
    if (Math.abs(along) > 0.5) {
      diagnostics.push({
        severity: ERROR,
        message: `route '${name}': the two pitch circles are ${Math.abs(along).toFixed(1)} mm apart along the axis, `
               + 'so the belt does not run true - they have to be coplanar',
      });
    }

    const tangent = Math.sqrt(centres * centres - dr * dr);
    const alpha = Math.asin(dr / centres);
    const wrapA = Math.PI + 2 * alpha;
    const wrapB = Math.PI - 2 * alpha;
    const closed = 2 * tangent + a.radius * wrapA + b.radius * wrapB;

    // The check this machine's first version needed and did not have. Everything
    // above proves the belt is a sensible loop; none of it asks whether the
    // things gripping it are anywhere near it. The first linear stage clamped
    // air 37.5 mm from the run and reported a confident 816 mm, because every
    // number in that calculation was correct and the only wrong thing was the
    // arrangement.
    //
    // A run is a line parallel to the centre line, offset by one radius
    // perpendicular to both it and the axis. Both cut ends belong on the SAME
    // run - a loop cut once gives two ends side by side, not one on each side.
    const centreLine = normalise([-between[0], -between[1], -between[2]]);
    const across = normalise(cross(normalise(a.axis), centreLine));
    const offsets = ends.map((e) => {
      const d = [e.point[0] - a.point[0], e.point[1] - a.point[1], e.point[2] - a.point[2]];
      return { plane: dot(d, normalise(a.axis)), side: dot(d, across) };
    });

    const strays = offsets
      .map((o, i) => ({ o, ref: endRefs[i] }))
      .filter(({ o }) => Math.abs(Math.abs(o.side) - a.radius) > 0.5 || Math.abs(o.plane) > 0.5);

    if (strays.length) {
      diagnostics.push({
        severity: ERROR,
        message: `route '${name}': ${strays.map(({ ref, o }) =>
          `${ref.instance}.${ref.anchor} is ${Math.abs(Math.abs(o.side) - a.radius).toFixed(1)} mm off the run`
          + (Math.abs(o.plane) > 0.5 ? ` and ${Math.abs(o.plane).toFixed(1)} mm out of its plane` : '')).join(', ')}`
          + ' - a clamp that is not on the belt grips air, whatever length this reports',
      });
    } else if (offsets.length === 2 && offsets[0].side * offsets[1].side < 0) {
      diagnostics.push({
        severity: ERROR,
        message: `route '${name}': the two ends are clamped to opposite runs. `
               + 'A loop cut once gives two ends side by side on one run.',
      });
    }

    // An open belt clamped at both ends follows the closed path and is then cut
    // between the clamps, so the gap between them comes off. Two ends is the
    // only case this handles, and anything else is refused above.
    const gap = ends.length === 2 ? distance(ends[0].point, ends[1].point) : 0;
    if (ends.length !== 2) {
      diagnostics.push({ severity: WARN, message: `route '${name}': ${ends.length} clamped ends, so the cut is not subtracted` });
    }

    // A belt is not just a length, it is a path through a machine full of other
    // things - and nothing so far asked whether that path is CLEAR. It checked
    // that the pulleys were parallel, that they were coplanar, and that the
    // clamps were on the run, and then happily reported a belt threaded straight
    // through a bracket.
    //
    // Boxes again, with the same honesty as the clash check: what does not
    // overlap a box certainly does not overlap the part, so an empty result is a
    // real all-clear. The pulleys the belt wraps and the clamps that grip it are
    // exempt, because touching those is the belt's job.
    // The pulleys the belt wraps and the clamps that grip it are exempt, because
    // touching those is the belt's job - and so is whatever a pulley is THREADED
    // ONTO. A motor's envelope is a NEMA square that includes its 5 mm shaft, so
    // a belt on a pulley on that shaft is inside the motor's box by construction
    // and always will be; the same goes for the bush and the post at the other
    // end. Reporting it every time is how a check teaches people to ignore it.
    //
    // The walk stops at the first joint that is a FACE rather than a shaft, a
    // spindle or a bore - which is the point where a thing stops carrying the
    // pulley and starts merely being nearby. That is what keeps the brackets and
    // the flanges in scope, and they are the ones the belt was actually cutting
    // through.
    const threaded = (name) => {
      const seen = [name];
      for (let at = name; ;) {
        const up = resolved.tree.parentOf.get(at);
        if (!up) break;
        const anchor = resolved.instances.get(up.parent)?.meta?.anchors?.[up.joint.parent.anchor];
        const carries = anchor?.kind === 'track' || anchor?.interface?.archetype === 'bore';
        if (!carries) break;
        seen.push(up.parent);
        at = up.parent;
      }
      return seen;
    };
    const exempt = new Set([...overRefs, ...endRefs].flatMap((r) => threaded(r.instance)));
    const runs = [1, -1].map((side) => [
      add(a.point, scale(across, side * a.radius)),
      add(b.point, scale(across, side * b.radius)),
    ]);
    // Not touching is not the same as having room. A belt that clears a bracket
    // by nothing rubs on it the first time anything flexes, and a machine whose
    // numbers all worked out is exactly where that goes unnoticed - so what is
    // required is a clearance rather than an absence of contact.
    const wanted = route.clearance === undefined ? DEFAULT_CLEARANCE : resolved.evaluate(route.clearance);
    let nearest = { gap: Infinity, what: null };
    const tight = new Map();
    for (const [instance, box] of boxes ?? []) {
      if (exempt.has(instance)) continue;
      for (const [from, to] of runs) {
        const gap = segmentToBox(from, to, box);
        if (gap < nearest.gap) nearest = { gap, what: instance };
        if (gap < wanted) tight.set(instance, Math.min(tight.get(instance) ?? Infinity, gap));
      }
    }
    if (tight.size) {
      const through = [...tight].filter(([, g]) => g < 0);
      diagnostics.push({
        severity: ERROR,
        message: `route '${name}': ${through.length ? 'its run passes through' : 'its run has under ' + wanted + ' mm of clearance to'} `
               + [...tight].map(([n, g]) => `${n} (${g < 0 ? 'by ' + (0 - g).toFixed(1) : g.toFixed(1) + ' mm'})`).join(', ')
               + (through.length ? ' - the belt has to have somewhere to go'
                                 : ' - a belt that clears by nothing rubs the first time anything flexes'),
      });
    }

    results.push({
      name,
      id: route.of.id,
      length: closed - gap,
      runs,
      clearance: nearest.gap === Infinity ? null : nearest.gap,
      nearest: nearest.what,
      closed,
      gap,
      centres,
      wrap: [wrapA, wrapB].map((w) => (w * 180) / Math.PI),
      teethEngaged: engagement(resolved, over, [wrapA, wrapB]),
    });
  }

  return { routes: results, diagnostics };
}

// How many teeth are actually in mesh, which is the number that decides whether
// a belt skips under load. Derived from the wrap and the tooth count the
// interface already carries, so it costs nothing to say.
function engagement(resolved, over, wraps) {
  return over.map((o, i) => {
    const teeth = o.anchor.interface?.teeth;
    if (!teeth) return null;
    return Math.round((wraps[i] / (2 * Math.PI)) * teeth);
  });
}

export { origin };
