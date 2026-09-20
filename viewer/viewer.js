// The viewer: the same resolver the command line uses, with a scene attached.
//
// Nothing in src/ was changed to make this work, which was the point of writing
// it as plain modules with no build step. The parser, the resolver, the pose
// walk and the belt arithmetic all run unaltered in the browser, so there is one
// implementation of what a machine means rather than two that drift.
//
// What the viewport shows, and why it is worth reading rather than just
// looking at: a SOLID part is geometry mechanica actually built, at the
// parameters this machine asked for. A WIREFRAME BOX is either bought stock,
// which fabrica holds no geometry for and never will, or a part mechanica does
// not have yet. So the boxes are the backlog, drawn to scale and in place.

import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';

import { parse } from '../src/parse.js';
import { catalogueFrom } from '../src/catalogue.js';
import { resolve, ERROR } from '../src/resolve.js';
import { poseTree, extent, interference, anchorInWorld, envelopeOf } from '../src/pose.js';
import { resolveRoutes } from '../src/route.js';
import { resolveDrives } from '../src/drive.js';
import { billOfMaterials } from '../src/bom.js';
import { fetchMesh, meshQuery, health } from '../src/mechanica.js';

const MACHINE = new URLSearchParams(location.search).get('machine') ?? 'linear-stage';
const UPSTREAM = '/mechanica';

const el = (id) => document.getElementById(id);
const say = (message, bad = false) => {
  const status = el('status');
  status.textContent = message ?? '';
  status.classList.toggle('showing', !!message);
  status.classList.toggle('bad', bad);
};

// --- the scene ---------------------------------------------------------------

const canvas = el('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17181b);

// Z up, because that is what a mechanica part is modelled in - a cube stands on
// its base - and a viewer that quietly rotated the world would make every
// coordinate printed by the command line disagree with what is on screen.
const camera = new THREE.PerspectiveCamera(42, 1, 1, 8000);
camera.up.set(0, 0, 1);
camera.position.set(520, -620, 420);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x20242a, 2.1));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(1, -1.4, 1.6);
scene.add(key);

// What things are made of.
//
// fabrica's own, not mechanica's. The only material in that payload belongs to
// HARDWARE - the fastener a part is drawn around - and a part's own body has
// none, correctly: what a printed part is made of is the printer's business and
// what a bought one is made of is the supplier's. Both are fabrica's to know,
// and both are in the stubs.
//
// The names match mechanica's where they overlap, because two vocabularies for
// the same metal is how they drift apart.
const MATERIALS = {
  aluminium: { color: 0xb9c0c8, metalness: 0.80, roughness: 0.34 },
  steel:     { color: 0x8a9099, metalness: 0.88, roughness: 0.30 },
  brass:     { color: 0xc2a044, metalness: 0.85, roughness: 0.32 },
  rubber:    { color: 0x2c2e33, metalness: 0.00, roughness: 0.92 },
  printed:   { color: 0x7fb2e8, metalness: 0.04, roughness: 0.62 },
};
const UNKNOWN = { color: 0x9aa1ab, metalness: 0.2, roughness: 0.7 };

const surfaces = new Map();
function surfaceFor(name) {
  const key = name ?? 'printed';
  if (!surfaces.has(key)) {
    surfaces.set(key, new THREE.MeshStandardMaterial({ ...(MATERIALS[key] ?? UNKNOWN), flatShading: false }));
  }
  return surfaces.get(key);
}

// A feature edge reads as a darker version of what it is drawn on rather than
// as one colour over everything, or steel gets blue creases.
const edges = new Map();
function edgeFor(name) {
  const key = name ?? 'printed';
  if (!edges.has(key)) {
    const base = new THREE.Color((MATERIALS[key] ?? UNKNOWN).color);
    edges.set(key, new THREE.LineBasicMaterial({ color: base.multiplyScalar(0.45) }));
  }
  return edges.get(key);
}

// The belt was never drawn, and that is why a clearance nobody could see went
// unnoticed until somebody looked at the pulley and inferred it. A length in a
// table is not a thing you can judge by eye; the path is.
function beltPath(route) {
  if (!route.runs) return null;
  const [runA, runB] = route.runs;
  const V = (a) => new THREE.Vector3(...a);

  // The two ends of each run are the tangent points at each pulley, so the
  // centres are their midpoints and the bulge direction is from one CENTRE to
  // the other - along the belt, not across it.
  //
  // It was across it. runA[0] minus runB[0] is the two runs' own offset, which
  // is perpendicular to the length, so each half turn swept the wrong way and
  // the loop came out as a lens a pitch radius too wide. It drew a belt-coloured
  // line in roughly the right place, which is how it passed a glance.
  const p1 = V(runA[0]).add(V(runB[0])).multiplyScalar(0.5);
  const p2 = V(runA[1]).add(V(runB[1])).multiplyScalar(0.5);
  const along = V(p2).sub(p1).normalize();

  const points = [];
  const arc = (from, centre, away) => {
    const out = V(from).sub(centre);
    const side = away.clone().multiplyScalar(out.length());
    for (let i = 1; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      points.push(centre.clone()
        .add(out.clone().multiplyScalar(Math.cos(a)))
        .add(side.clone().multiplyScalar(Math.sin(a))));
    }
  };

  points.push(V(runA[0]), V(runA[1]));
  arc(runA[1], p2, along);                      // round the far pulley
  points.push(V(runB[0]));
  arc(runB[0], p1, along.clone().negate());     // and back round the near one
  return points;
}

const BOXED = new THREE.LineBasicMaterial({ color: 0x6d7480 });
const BOXED_ABSENT = new THREE.LineBasicMaterial({ color: 0xd59356 });

const assembly = new THREE.Group();
scene.add(assembly);

// Observe the PARENT, never the canvas. setSize writes the canvas's backing
// store, the canvas's layout follows its backing store whenever CSS has not
// pinned it, and a ResizeObserver on the canvas therefore feeds itself: it
// doubled to 2^24 pixels a side in about a second, which renders as an empty
// viewport rather than as an error. The parent is a grid cell with a size of
// its own and cannot be pushed around by what is drawn inside it.
function resize() {
  const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);

(function draw() {
  requestAnimationFrame(draw);
  controls.update();
  renderer.render(scene, camera);
})();

// --- geometry ----------------------------------------------------------------
// Keyed by the query that produced it, so dragging a slider that does not
// change a component does not refetch it. The pulley is built once however far
// the carriage travels, which is the same memoisation argument mechanica makes
// for a module's shape depending only on its arguments.

const meshes = new Map();

function geometryFrom(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.normals.length === mesh.positions.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  return geometry;
}

async function geometryFor(instance) {
  const query = meshQuery(instance);
  if (!query) return null;                      // nothing says how to ask for it
  if (meshes.has(query)) return meshes.get(query);

  const pending = fetchMesh(UPSTREAM, instance).then(
    (mesh) => ({
      solid: geometryFrom(mesh),
      edges: mesh.edges.length
        ? new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3))
        : null,
      triangles: mesh.triangles,
    }),
    (error) => {
      // Kept as a failure rather than retried on every slider drag. The reason
      // is shown on the part's own line in the parts list, because 'why is that
      // one a box' is the question somebody will actually ask.
      meshes.set(query, { error: error.message });
      return { error: error.message };
    },
  );
  meshes.set(query, pending);
  return pending;
}

function boxFor(envelope, absent) {
  if (!envelope) return null;
  const size = [0, 1, 2].map((i) => envelope.max[i] - envelope.min[i]);
  const centre = [0, 1, 2].map((i) => (envelope.max[i] + envelope.min[i]) / 2);
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(...centre);
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), absent ? BOXED_ABSENT : BOXED);
  geometry.dispose();
  return lines;
}

const matrixOf = (pose) => new THREE.Matrix4().set(...pose);

// --- the machine -------------------------------------------------------------

let source = null;
let catalogue = null;
let parameters = {};
let jointValues = {};

async function render() {
  const machine = parse(source, MACHINE);
  const resolved = resolve(machine, catalogue, parameters);
  const placed = poseTree(resolved, jointValues);
  const routed = resolveRoutes(resolved, placed.poses);
  const driven = resolveDrives(resolved, placed.poses);
  const bom = billOfMaterials(resolved, routed.routes);

  el('designation').textContent = resolved.designation ?? '';

  assembly.clear();
  const notes = new Map();
  const shown = new Map();          // material -> how many parts are wearing it

  // The first load asks mechanica to model every made part from scratch, and
  // OCCT serialises that behind one lock - so several seconds of apparently
  // nothing is the NORMAL case, not a fault. Saying so is the difference
  // between waiting and reloading. mechanica solved the same problem for its
  // own gallery by baking previews; fabrica will want the equivalent, and until
  // then it can at least admit what it is doing.
  const building = [...resolved.instances.values()]
    .filter((i) => meshQuery(i) && !meshes.has(meshQuery(i)));
  if (building.length) say(`Building ${building.length} part${building.length > 1 ? 's' : ''} on mechanica…`);

  await Promise.all([...resolved.instances].map(async ([name, instance]) => {
    const pose = placed.poses.get(name);
    if (!pose) return;

    // Made and bought is a BOM distinction - who prints it, who buys it - and
    // says nothing about who holds the geometry. mechanica models a T-slot
    // extrusion and a NEMA motor precisely so that a part can show what it
    // bolts to, and both of those are bought. Anything with a bridge gets
    // asked; gating this on 'part' drew them as boxes with their meshes one
    // request away.
    const built = await geometryFor(instance);
    const node = new THREE.Group();
    node.matrixAutoUpdate = false;
    node.matrix.copy(matrixOf(pose));

    if (built && !built.error) {
      const material = instance.meta?.material;
      shown.set(material ?? 'printed', (shown.get(material ?? 'printed') ?? 0) + 1);
      node.add(new THREE.Mesh(built.solid, surfaceFor(material)));
      if (built.edges) node.add(new THREE.LineSegments(built.edges, edgeFor(material)));
    } else {
      if (built?.error) notes.set(instance.id, built.error);
      // Orange means mechanica has no geometry for this, which is a question
      // about the component's status and not about who pays for it.
      const box = boxFor(envelopeOf(instance), instance.meta?.status === 'does-not-exist');
      if (box) node.add(box);
    }
    assembly.add(node);
  }));

  // Flexible stock is not on the tree and has no pose, so it is drawn from the
  // path the route resolved to rather than from a placed body.
  for (const route of routed.routes) {
    const points = beltPath(route);
    if (!points) continue;
    const instance = resolved.instances.get(route.name);
    const material = instance?.meta?.material ?? 'rubber';
    shown.set(material, (shown.get(material) ?? 0) + 1);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    assembly.add(new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({
      color: (MATERIALS[material] ?? UNKNOWN).color,
    })));
  }

  showParameters(resolved);
  showJoints(placed);
  showDerived(resolved, placed, routed, driven);
  showLegend(shown, [...resolved.instances.values()].some((i) => i.meta?.status === 'does-not-exist'));
  showBom(bom, notes);

  const errors = resolved.diagnostics.concat(placed.diagnostics, routed.diagnostics)
    .filter((d) => d.severity === ERROR);
  say(errors.length ? errors[0].message : null, errors.length > 0);
}

let framed = false;
function frameOnce(resolved, placed) {
  if (framed) return;
  const box = extent(resolved, placed.poses);
  if (!box) return;
  framed = true;

  const centre = new THREE.Vector3(...[0, 1, 2].map((i) => (box.max[i] + box.min[i]) / 2));
  const radius = new THREE.Vector3(...[0, 1, 2].map((i) => box.max[i] - box.min[i])).length() / 2;

  // Far enough back that the bounding sphere fits the narrower of the two
  // fields of view - which on a wide pane is the vertical one and on a narrow
  // one is not, so both are asked rather than assumed.
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.08;

  controls.target.copy(centre);
  camera.position.copy(centre).add(
    new THREE.Vector3(0.45, -0.82, 0.36).normalize().multiplyScalar(distance),
  );
  camera.near = Math.max(1, distance / 400);
  camera.far = distance * 12;
  camera.updateProjectionMatrix();
  controls.update();
}

// --- the controls ------------------------------------------------------------

function showParameters(resolved) {
  const host = el('parameters');
  if (host.dataset.built) return;               // rebuilt only when the machine changes
  host.dataset.built = '1';

  for (const [name, spec] of Object.entries(resolved.parameterSpecs)) {
    const value = resolved.parameters[name];
    const field = document.createElement('div');
    field.className = 'field';

    const label = document.createElement('label');
    const title = document.createElement('span');
    title.className = 'name';
    title.textContent = spec.label?.value ?? name;
    const readout = document.createElement('span');
    readout.className = 'value';
    readout.textContent = String(value);
    label.append(title, readout);
    field.append(label);

    if (typeof value === 'number') {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = resolved.evaluate(spec.min ?? { node: 'number', value: 0 });
      slider.max = resolved.evaluate(spec.max ?? { node: 'number', value: value * 2 });
      slider.step = 1;
      slider.value = value;
      slider.addEventListener('input', () => {
        readout.textContent = slider.value;
        parameters[name] = Number(slider.value);
        // A parameter can move a joint's limit out from under its value, so the
        // joint choices are dropped and re-homed rather than clamped: a
        // carriage at 300 on a 200 mm stage is not a thing to keep.
        jointValues = {};
        schedule();
      });
      field.append(slider);
    } else {
      const readonly = document.createElement('div');
      readonly.className = 'note';
      readonly.textContent = 'Set in the machine file - a standards pick needs a list the API does not serve yet.';
      field.append(readonly);
    }

    if (spec.summary) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = spec.summary.value ?? '';
      field.append(note);
    }
    host.append(field);
  }
}

function showJoints(placed) {
  const host = el('joints');
  const moving = [...placed.variables].filter(([, v]) => v.limits);
  el('joints-section').hidden = !moving.length;
  if (host.dataset.built) return;
  host.dataset.built = '1';

  for (const [name, variable] of moving) {
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.className = 'name';
    title.textContent = name;
    const readout = document.createElement('span');
    readout.className = 'value';
    readout.textContent = `${variable.value} mm`;
    label.append(title, readout);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = variable.limits[0];
    slider.max = variable.limits[1];
    slider.step = 1;
    slider.value = variable.value;
    slider.addEventListener('input', () => {
      readout.textContent = `${slider.value} mm`;
      jointValues[name] = Number(slider.value);
      schedule();
    });
    field.append(label, slider);
    host.append(field);
  }
}

function showDerived(resolved, placed, routed, driven) {
  const host = el('derived');
  host.textContent = '';
  const row = (term, value, warn = false) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (warn) dd.className = 'warn';
    host.append(dt, dd);
  };

  const box = extent(resolved, placed.poses);
  if (box) {
    const [x, y, z] = [0, 1, 2].map((i) => Math.round(box.max[i] - box.min[i]));
    row('Space', `${x} x ${y} x ${z} mm`);
  }
  for (const route of routed.routes) {
    row(route.name, route.length == null ? 'not derived' : `${route.length.toFixed(1)} mm`, route.length == null);
    // The number the eye cannot judge even once the belt is drawn.
    if (route.clearance != null) {
      row('  clearance', `${route.clearance.toFixed(1)} mm to ${route.nearest}`, route.clearance < 2);
    }
  }
  for (const d of driven?.drives ?? []) {
    if (d.perRevolution == null) continue;
    row('Per turn', `${d.perRevolution.toFixed(1)} mm`);
    const sixteen = d.steps?.find((s) => s.micro === 16);
    if (sixteen) row('Steps/mm', `${sixteen.perMm.toFixed(1)} at 16x`);
  }
  const clashes = interference(resolved, placed.poses);
  row('Clashes', clashes.length
    ? clashes.map((c) => `${c.a}/${c.b} ${c.depth.toFixed(1)}mm`).join(', ') : 'none', clashes.length > 0);
  frameOnce(resolved, placed);
}

// Built from what is actually on screen rather than written in the markup, so
// it cannot describe a material no part is wearing.
function showLegend(shown, anyAbsent) {
  const host = el('legend');
  host.textContent = '';
  const row = (swatch, text) => {
    const p = document.createElement('p');
    const s = document.createElement('span');
    s.className = 'swatch';
    if (swatch === null) s.classList.add('boxed');
    else if (swatch === 'absent') s.classList.add('absent');
    else s.style.background = '#' + new THREE.Color((MATERIALS[swatch] ?? UNKNOWN).color).getHexString();
    p.append(s, document.createTextNode(text));
    host.append(p);
  };
  for (const [material, count] of [...shown].sort()) row(material, `${material} (${count})`);
  row(null, 'bought, drawn as its envelope');
  if (anyAbsent) row('absent', 'not in mechanica yet');
}

function showBom(bom, notes) {
  const host = el('bom');
  host.textContent = '';
  for (const line of [...bom.made, ...bom.bought]) {
    const row = document.createElement('div');
    row.className = 'line' + (line.status === 'does-not-exist' ? ' absent' : '');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = line.quantity === 'length' ? '1' : String(line.count);
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = (line.designation ?? line.id) + (line.note ? `, ${line.note}` : '');
    row.append(n, what);
    const why = notes.get(line.id);
    if (why) row.title = why;
    host.append(row);
  }
}

// One render per frame however many slider events arrive, which matters because
// a drag fires far faster than a re-resolve completes.
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(async () => {
    queued = false;
    try { await render(); } catch (error) { say(error.message, true); }
  });
}

// --- start -------------------------------------------------------------------

async function boot() {
  // Which mechanica is answering, said before anything is drawn. If this fails
  // the viewport will be all boxes, and the reason should be on screen rather
  // than inferred from it.
  health(UPSTREAM).then(
    (h) => { el('upstream').textContent = `mechanica ${h.release} (${h.version}), kernel ${h.kernel}`; },
    (e) => {
      el('upstream').textContent = 'mechanica unreachable';
      el('upstream').classList.add('bad');
      say(`No geometry: ${e.message}. Everything is drawn as its envelope.`, true);
    },
  );

  const [records, text] = await Promise.all([
    fetch('/catalogue.json').then((r) => r.json()),
    fetch(`/machines/${MACHINE}.machine`).then((r) => {
      if (!r.ok) throw new Error(`no machine called '${MACHINE}'`);
      return r.text();
    }),
  ]);

  source = text;
  catalogue = catalogueFrom(new Map(records.map((r) => [r.id, r])), new Map());
  // Layout first: framing divides by the aspect ratio, and on the very first
  // paint the canvas has not been given one yet.
  await new Promise((done) => requestAnimationFrame(done));
  resize();
  await render();
}

boot().catch((error) => say(error.message, true));

// A handle on the scene, for tuning from the console. mechanica does the same
// and for the same reason: the alternative is adding a console.log, reloading,
// and having lost the state you were looking at. It is unguarded here because
// fabrica has no roles and nothing on this page is anybody's but yours.
window.__fab = {
  scene, camera, controls, renderer, assembly, meshes,
  render,
  reframe: () => { framed = false; schedule(); },
  look: () => ({
    camera: camera.position.toArray().map((v) => Math.round(v)),
    target: controls.target.toArray().map((v) => Math.round(v)),
    aspect: camera.aspect,
    children: assembly.children.length,
    box: (() => {
      const b = new THREE.Box3().setFromObject(assembly);
      return b.isEmpty() ? null : { min: b.min.toArray().map(Math.round), max: b.max.toArray().map(Math.round) };
    })(),
  }),
};
