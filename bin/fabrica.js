#!/usr/bin/env node
// The resolver on the command line.
//
// Text out, no geometry, no viewer - which is the whole point of doing it this
// way round. If the bill of materials and the build order are right from the
// declarations alone, the concept holds, and everything after this is
// presentation. If they are not, no amount of three.js would have saved it.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parse.js';
import { loadCatalogue } from '../src/catalogue.js';
import { resolve, ERROR } from '../src/resolve.js';
import { billOfMaterials, printList } from '../src/bom.js';
import { buildOrder } from '../src/build.js';
import { extent, interference, poseTree, sweptExtent } from '../src/pose.js';
import { resolveRoutes } from '../src/route.js';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `usage: fabrica <machine.machine> [options]

  --set <name>=<value>   configure a parameter; may be repeated
  --at <joint>=<value>   put a moving joint somewhere; named by its child
  --bom                  bill of materials only
  --build                build order only
  --where                poses only
  --json                 machine-readable, for a caller rather than a reader
`;

function parseArguments(argv) {
  const options = { file: null, set: {}, at: {}, only: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--set') {
      const [name, ...rest] = (argv[++i] ?? '').split('=');
      if (!name || !rest.length) throw new Error('--set wants <name>=<value>');
      const raw = rest.join('=');
      options.set[name] = Number.isNaN(Number(raw)) || raw === '' ? raw : Number(raw);
    } else if (arg === '--at') {
      const [name, ...rest] = (argv[++i] ?? '').split('=');
      if (!name || !rest.length) throw new Error('--at wants <joint>=<value>');
      options.at[name] = Number(rest.join('='));
      if (Number.isNaN(options.at[name])) throw new Error('--at wants a number');
    } else if (arg === '--bom') options.only = 'bom';
    else if (arg === '--where') options.only = 'where';
    else if (arg === '--build') options.only = 'build';
    else if (arg === '--json') options.json = true;
    else if (arg === '-h' || arg === '--help') { process.stdout.write(USAGE); process.exit(0); }
    else if (arg.startsWith('-')) throw new Error(`unknown option '${arg}'`);
    else if (!options.file) options.file = arg;
    else throw new Error('one machine at a time');
  }
  if (!options.file) throw new Error('no machine file given');
  return options;
}

const pad = (s, n) => String(s).padEnd(n);

function printBom(bom) {
  const show = (title, lines) => {
    process.stdout.write(`\n${title}\n`);
    if (!lines.length) { process.stdout.write('  (nothing)\n'); return; }
    const width = Math.max(...lines.map((l) => l.id.length));
    for (const line of lines) {
      const args = Object.entries(line.args).map(([k, v]) => `${k}=${v}`).join(' ');
      const mark = line.status === 'does-not-exist' ? '  <- not in mechanica yet'
                 : line.status === 'no-metadata' ? '  <- no metadata'
                 : '';
      const count = String(line.count).padStart(3);
      const note = line.note ? `  [${line.note}]` : '';
      process.stdout.write(`  ${count}  ${pad(line.id, width)}  ${args}${note}${mark}\n`);
    }
  };
  show('MADE - printed by you', bom.made);
  show('BOUGHT - off the shelf', bom.bought);
}

function printSteps(steps) {
  process.stdout.write('\nBUILD ORDER\n');
  for (const step of steps) {
    const n = String(step.n).padStart(3);
    process.stdout.write(`  ${n}. ${wrap(step.text, 4)}\n`);
  }
}

function wrap(text, indent) {
  const width = 74 - indent;
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > width) { out.push(line.trim()); line = ''; }
    line += ' ' + word;
  }
  if (line.trim()) out.push(line.trim());
  return out.join('\n' + ' '.repeat(indent + 3));
}

const mm = (v) => (Math.round(v * 10) / 10).toFixed(1).padStart(8);
const size = (box) => [0, 1, 2].map((i) => box.max[i] - box.min[i]);

function printWhere(resolved, poses, variables) {
  process.stdout.write('\nWHERE THINGS ARE - millimetres from the origin of ground\n');
  const width = Math.max(...[...resolved.instances.keys()].map((n) => n.length));
  const routed = new Set(resolved.routes.map((r) => r.name));
  for (const [name] of resolved.instances) {
    const pose = poses.get(name);
    if (!pose) {
      // Three different absences, and lumping them together would read as three
      // failures when two are the design working as intended.
      const why = resolved.consumed.has(name) ? '(consumable - counted, not placed)'
                : routed.has(name) ? '(flexible - routed, not placed)'
                : '(unplaced)';
      process.stdout.write(`  ${pad(name, width)}   ${why}\n`);
      continue;
    }
    const variable = variables.get(name);
    const note = variable ? `   ${variable.type} at ${variable.value}` : '';
    process.stdout.write(`  ${pad(name, width)}  ${mm(pose[3])}${mm(pose[7])}${mm(pose[11])}${note}\n`);
  }
}

function printSpace(box, swept, clashes) {
  if (box) {
    const [x, y, z] = size(box);
    process.stdout.write(`\nSPACE\n  at rest   ${x.toFixed(0)} x ${y.toFixed(0)} x ${z.toFixed(0)} mm\n`);
  }
  if (swept?.box) {
    const [x, y, z] = size(swept.box);
    process.stdout.write(`  swept     ${x.toFixed(0)} x ${y.toFixed(0)} x ${z.toFixed(0)} mm`
      + `   (${swept.moving?.join(', ') ?? ''} through its limits, ${swept.samples} samples)\n`);
  }
  if (clashes?.length) {
    process.stdout.write('  clashes   ' + clashes.map((c) => `${c.a}/${c.b}`).join(', ')
      + '\n            bounding boxes only - a candidate to look at, not a collision\n');
  }
}

function printRoutes(routes) {
  const measured = routes.filter((r) => r.length != null);
  if (!measured.length) return;
  process.stdout.write('\nFLEXIBLE STOCK\n');
  for (const r of measured) {
    process.stdout.write(`  ${r.name}  cut to ${r.length.toFixed(1)} mm`
      + `   (${r.centres.toFixed(1)} mm centres, wrap ${r.wrap.map((w) => w.toFixed(0) + ' deg').join(' and ')}`
      + (r.teethEngaged?.every((t) => t) ? `, ${r.teethEngaged.join('/')} teeth in mesh` : '') + ')\n');
  }
}

function printDiagnostics(diagnostics) {
  if (!diagnostics.length) return;
  process.stdout.write('\nDIAGNOSTICS\n');
  for (const d of diagnostics) {
    process.stdout.write(`  ${d.severity === ERROR ? 'error  ' : 'warning'}  ${wrap(d.message, 11)}\n`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const text = await readFile(options.file, 'utf8');
  const machine = parse(text, options.file);
  const catalogue = await loadCatalogue(ROOT);
  const resolved = resolve(machine, catalogue, options.set);

  const placed = poseTree(resolved, options.at);
  const routed = resolveRoutes(resolved, placed.poses);
  resolved.diagnostics.push(...placed.diagnostics, ...routed.diagnostics);

  const bom = billOfMaterials(resolved, routed.routes);
  const steps = buildOrder(resolved, routed.routes);
  const box = extent(resolved, placed.poses);
  const swept = Object.keys(options.at).length ? null : sweptExtent(resolved);
  const clashes = interference(resolved, placed.poses);

  if (options.json) {
    process.stdout.write(JSON.stringify({
      designation: resolved.designation,
      parameters: resolved.parameters,
      bom,
      prints: printList(bom),
      steps: steps.map(({ n, text: t }) => ({ n, text: t })),
      poses: Object.fromEntries([...placed.poses].map(([n, m]) => [n, m])),
      routes: routed.routes,
      extent: box,
      swept: swept?.box ?? null,
      clashes,
      diagnostics: resolved.diagnostics,
      ok: resolved.ok,
    }, null, 2) + '\n');
    return resolved.ok ? 0 : 1;
  }

  if (!options.only) {
    process.stdout.write(`\n${resolved.designation ?? '(no designation)'}\n`);
    const params = Object.entries(resolved.parameters).map(([k, v]) => `${k}=${v}`).join('  ');
    process.stdout.write(`${params}\n`);
  }
  if (options.only === 'where') {
    printWhere(resolved, placed.poses, placed.variables);
    printSpace(box, swept, clashes);
  } else {
    if (options.only !== 'build') printBom(bom);
    if (options.only !== 'bom') printSteps(steps);
    if (!options.only) { printRoutes(routed.routes); printSpace(box, swept, clashes); }
  }
  printDiagnostics(resolved.diagnostics);
  process.stdout.write('\n');

  return resolved.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => { process.stderr.write(`fabrica: ${error.message}\n`); process.exit(2); },
);
