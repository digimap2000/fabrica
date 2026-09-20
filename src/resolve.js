// A parsed machine plus a catalogue, turned into something that can be counted
// and ordered.
//
// Everything this module does is directed: parameters flow downward into
// instance arguments, and poses flow outward from ground along the joints.
// Nothing is solved for. That is the whole bet - it is what lets a machine be a
// pure function of its parameters, the way a mechanica part is, and it is why
// the tree check below is a hard failure rather than a warning. The day this
// module needs to iterate towards an answer is the day fabrica has quietly
// become a CAD package.

const ERROR = 'error';
const WARN = 'warning';

// --- expressions ------------------------------------------------------------
// Numbers and strings, parameter reads, and four operators. Deliberately not
// more: an assembly's arithmetic is 'the beam follows the travel', and a
// machine file that needs a function is a machine file describing something
// that should have been a part.

function evaluate(node, params, where) {
  switch (node.node) {
    case 'number':
    case 'string':
      return node.value;
    case 'neg':
      return 0 - evaluate(node.operand, params, where);
    case 'ref': {
      if (!(node.name in params)) {
        throw new Error(`${where}: '${node.name}' is not a parameter of this machine`);
      }
      return params[node.name];
    }
    case 'binary': {
      const a = evaluate(node.left, params, where);
      const b = evaluate(node.right, params, where);
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new Error(`${where}: '${node.op}' needs numbers`);
      }
      return { '+': a + b, '-': a - b, '*': a * b, '/': a / b }[node.op];
    }
    case 'anchor':
      throw new Error(`${where}: an anchor is not a value`);
    default:
      throw new Error(`${where}: cannot evaluate ${node.node}`);
  }
}

// --- parameters -------------------------------------------------------------

function bindParameters(machine, overrides, diagnostics) {
  const values = {};
  for (const [name, spec] of Object.entries(machine.parameters)) {
    const given = overrides[name];
    let value = given === undefined
      ? (spec.default === undefined ? undefined : evaluate(spec.default, {}, `parameter '${name}'`))
      : given;

    if (value === undefined) {
      diagnostics.push({ severity: ERROR, message: `parameter '${name}' has no default and was not given` });
      continue;
    }

    // A range is a claim about what the machine was designed to do, so going
    // outside it is worth saying out loud even when the arithmetic still works.
    if (typeof value === 'number') {
      const min = spec.min === undefined ? null : evaluate(spec.min, {}, name);
      const max = spec.max === undefined ? null : evaluate(spec.max, {}, name);
      if (min !== null && value < min) diagnostics.push({ severity: WARN, message: `${name}=${value} is below the designed minimum of ${min}` });
      if (max !== null && value > max) diagnostics.push({ severity: WARN, message: `${name}=${value} is above the designed maximum of ${max}` });
    }
    values[name] = value;
  }
  return values;
}

// The designation is the machine's headline the way a part's is: how you would
// ask for this thing. Resolved against what is configured, so it can never
// disagree with the BOM underneath it.
function resolveDesignation(template, params) {
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    (name in params ? String(params[name]) : whole));
}

// --- instances --------------------------------------------------------------

function resolveInstances(machine, params, catalogue, diagnostics) {
  const instances = new Map();

  const build = ({ name, kind, of }) => {
    const args = {};
    for (const [key, node] of Object.entries(of.args)) {
      args[key] = evaluate(node, params, `${name}.${key}`);
    }

    const meta = catalogue.get(of.id);
    if (!meta) {
      // Not a failure. A machine that cannot be assembled without a part is
      // evidence of demand, and printing it is more useful than refusing to
      // continue - so the resolver carries on and the report names it.
      diagnostics.push({ severity: WARN, message: `no metadata for '${of.id}' (needed by '${name}')`, missing: of.id });
    } else if (meta.status === 'does-not-exist') {
      diagnostics.push({ severity: WARN, message: `'${of.id}' does not exist in mechanica yet (needed by '${name}')`, missing: of.id });
    }

    // The stub holds one parameter set; the machine may ask for another. Until
    // there is an API that actually resolves parameters, say so rather than
    // quietly presenting the stub's numbers as though they were the answer.
    //
    // But only for parameters the stub's geometry does not already FOLLOW. An
    // anchor or an envelope may name a parameter instead of pinning a number,
    // and where it does the stub is right at any value - so warning about it
    // was a claim that had stopped being true, and a warning nobody can act on
    // is how the ones that matter get skipped.
    if (meta?.parameters) {
      const followed = new Set(
        JSON.stringify([meta.anchors ?? {}, meta.envelope ?? {}]).match(/"[a-z_]+"/g)
          ?.map((s) => s.slice(1, -1)) ?? [],
      );
      const differing = Object.keys(args).filter(
        (k) => k in meta.parameters && meta.parameters[k] !== args[k] && !followed.has(k),
      );
      if (differing.length) {
        diagnostics.push({
          severity: WARN,
          message: `'${name}' asks ${of.id} for ${differing.map((k) => `${k}=${args[k]}`).join(', ')}, `
                 + `but the stub holds ${differing.map((k) => `${k}=${meta.parameters[k]}`).join(', ')} `
                 + `- its anchors are the stub's, not this configuration's`,
        });
      }
    }

    instances.set(name, { name, kind, id: of.id, args, meta });
  };

  for (const declared of Object.values(machine.instances)) build(declared);
  for (const route of machine.routes) {
    build({ name: route.name, kind: 'stock', of: route.of });
  }
  return instances;
}

// --- the tree ---------------------------------------------------------------
// The rule the whole design rests on. A tree resolves by walking it; a cycle is
// a mechanism and needs a solver. So this is checked, named and refused rather
// than being a convention somebody remembers.

// A stock instance named by a fastening's 'into' is not a body on the tree, it
// is a KIND being consumed - eight T-nuts out of one declaration. That is a
// wrinkle in the language rather than in this code: 'stock' currently means
// both 'a thing at a place' and 'a thing you use some of'. Recorded in
// machines/linear-stage.machine; until it is split, consumables are recognised
// here so the tree check does not report them as floating.
function consumables(machine) {
  const names = new Set();
  for (const joint of machine.joints) {
    if (joint.fasten?.into?.node === 'ref') names.add(joint.fasten.into.name);
  }
  return names;
}

function buildTree(machine, instances, diagnostics, consumed) {
  const parentOf = new Map();
  const children = new Map([...instances.keys()].map((name) => [name, []]));

  const known = (ref, where) => {
    if (!instances.has(ref.instance)) {
      diagnostics.push({ severity: ERROR, message: `${where}: no instance called '${ref.instance}'` });
      return false;
    }
    return true;
  };

  for (const joint of machine.joints) {
    const where = `joint at line ${joint.line}`;
    if (!known(joint.parent, where) || !known(joint.child, where)) continue;

    const parent = joint.parent.instance;
    const child = joint.child.instance;

    if (parent === child) {
      diagnostics.push({ severity: ERROR, message: `${where}: '${parent}' is jointed to itself` });
      continue;
    }
    if (parentOf.has(child)) {
      // Two parents is how a cycle arrives in practice, and naming both is more
      // use than naming the cycle after the fact.
      diagnostics.push({
        severity: ERROR,
        message: `${where}: '${child}' is already attached to '${parentOf.get(child).parent}' - `
               + 'the joint graph must be a tree, and a second parent closes a loop',
      });
      continue;
    }
    parentOf.set(child, { parent, joint });
    children.get(parent).push({ child, joint });
    checkAnchors(joint, instances, diagnostics, where);
  }

  if (!machine.ground) {
    diagnostics.push({ severity: ERROR, message: 'no ground declared - a machine needs something to hang off' });
    return { order: [], children, parentOf };
  }
  if (!instances.has(machine.ground)) {
    diagnostics.push({ severity: ERROR, message: `ground '${machine.ground}' is not an instance` });
    return { order: [], children, parentOf };
  }

  // Depth first from ground, which is both the reachability check and the build
  // order: you cannot attach a thing before the thing it attaches to.
  const order = [];
  const seen = new Set([machine.ground]);
  (function walk(name) {
    for (const edge of children.get(name) ?? []) {
      if (seen.has(edge.child)) continue;
      seen.add(edge.child);
      order.push(edge);
      walk(edge.child);
    }
  })(machine.ground);

  for (const name of instances.keys()) {
    if (seen.has(name)) continue;
    const instance = instances.get(name);
    // A route is flexible stock threaded through anchors, not a jointed body,
    // so it is expected to be off the tree. Anything else floating is a mistake.
    const jointable = Object.keys(instance.meta?.anchors ?? {}).length > 0;
    const floating = machine.routes.some((r) => r.name === name) || consumed.has(name) || !jointable;
    if (!floating) {
      diagnostics.push({
        severity: WARN,
        message: `'${name}' (${instance.id}) is not attached to anything reachable from ground`,
      });
    }
  }

  return { order, children, parentOf };
}

// Anchors have kinds and the kinds mean something. A prismatic joint has to
// ride a track and must not pin it, because pinning is exactly the freedom the
// joint exists to consume. This is the rule the first machine file taught, and
// checking it is most of why anchors carry a kind at all.
function checkAnchors(joint, instances, diagnostics, where) {
  for (const [role, ref] of [['parent', joint.parent], ['child', joint.child]]) {
    const meta = instances.get(ref.instance)?.meta;
    if (!meta?.anchors) continue;              // unknown component, already reported
    const anchor = meta.anchors[ref.anchor];
    if (!anchor) {
      diagnostics.push({
        severity: ERROR,
        message: `${where}: '${ref.instance}' has no anchor '${ref.anchor}' `
               + `- it has ${Object.keys(meta.anchors).join(', ')}`,
      });
      continue;
    }
    if (ref.at !== undefined && anchor.kind !== 'track') {
      diagnostics.push({ severity: ERROR, message: `${where}: '${ref.instance}.${ref.anchor}' is a ${anchor.kind}, which has no position to pin with @` });
    }
    if (joint.type === 'prismatic' && role === 'parent') {
      if (anchor.kind !== 'track') {
        diagnostics.push({ severity: ERROR, message: `${where}: a prismatic joint rides a track, and '${ref.instance}.${ref.anchor}' is a ${anchor.kind}` });
      } else if (ref.at !== undefined) {
        diagnostics.push({ severity: ERROR, message: `${where}: '${ref.instance}.${ref.anchor}' is pinned with @, so there is no freedom left for the joint to use` });
      }
    }
  }
}

// --- routes -----------------------------------------------------------------

// Only the shape of a route is checked here. Its length is derived in route.js,
// once poses exist - this module deliberately knows nothing about where
// anything is.
function checkRoutes(machine, instances, params, diagnostics) {
  for (const route of machine.routes) {
    const refs = [...(route.over?.items ?? []), ...(route.anchors?.items ?? [])];
    for (const ref of refs) {
      if (ref.node !== 'anchor') {
        diagnostics.push({ severity: ERROR, message: `route '${route.name}': expected an anchor` });
        continue;
      }
      const meta = instances.get(ref.instance)?.meta;
      if (!meta?.anchors) continue;
      const anchor = meta.anchors[ref.anchor];
      if (!anchor) {
        diagnostics.push({ severity: ERROR, message: `route '${route.name}': '${ref.instance}' has no anchor '${ref.anchor}'` });
      } else if (route.over?.items?.includes(ref) && anchor.kind !== 'circle') {
        diagnostics.push({ severity: ERROR, message: `route '${route.name}': a belt runs over a circle, and '${ref.instance}.${ref.anchor}' is a ${anchor.kind}` });
      }
    }
  }
}

// --- the whole thing --------------------------------------------------------

export function resolve(machine, catalogue, overrides = {}) {
  const diagnostics = [];

  for (const name of Object.keys(overrides)) {
    if (!(name in machine.parameters)) {
      diagnostics.push({ severity: ERROR, message: `'${name}' is not a parameter of this machine` });
    }
  }

  const params = bindParameters(machine, overrides, diagnostics);
  const instances = resolveInstances(machine, params, catalogue, diagnostics);
  const consumed = consumables(machine);
  const tree = buildTree(machine, instances, diagnostics, consumed);
  checkRoutes(machine, instances, params, diagnostics);

  return {
    origin: machine.origin,
    proven: machine.proven,
    ground: machine.ground,
    catalogue,
    designation: resolveDesignation(machine.designation, params),
    parameters: params,
    parameterSpecs: machine.parameters,
    instances,
    joints: machine.joints,
    routes: machine.routes,
    drives: machine.drives,
    tree,
    consumed,
    diagnostics,
    evaluate: (node) => evaluate(node, params, 'expression'),
    ok: !diagnostics.some((d) => d.severity === ERROR),
  };
}

export { ERROR, WARN, evaluate };
