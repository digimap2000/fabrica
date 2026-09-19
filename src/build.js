// How you put one together, in an order that works.
//
// Nobody writes this. It is a traversal of the joint tree from ground outward,
// which is a correct build order for the reason the tree rule exists: you
// cannot attach a thing before the thing it attaches to, and a tree guarantees
// there is exactly one such thing. That is the argument for joints over
// transforms in one sentence - a transform can place a part but cannot say what
// it is placed ON, so it can never yield this.
//
// What it cannot yet do is tell you which way to face a part before you start,
// or warn that a screw is unreachable once the next thing is on. Both need
// poses, which need geometry. The order is correct without them; it is the
// prose that is thinner than it will be.

const ROLE = {
  fixed: 'so it cannot move',
  prismatic: 'so it slides',
  revolute: 'so it turns freely',
};

function nameOf(instance) {
  if (!instance) return 'something missing';
  const what = instance.meta?.designation ?? instance.id;
  return `the ${what} (${instance.name})`;
}

function fasteningClause(fasten, resolved) {
  if (!fasten) return '';
  if (fasten.method) return `, held by a ${fasten.method} screw`;

  const screw = fasten.with ? describe(fasten.with, resolved) : 'a fastening';
  const n = fasten.count;
  let clause = `, with ${n} x ${screw}`;

  if (fasten.into?.node === 'component') clause += ` into ${describe(fasten.into, resolved)}`;
  else if (fasten.into?.node === 'ref') {
    const into = resolved.instances.get(fasten.into.name);
    clause += ` into ${into?.meta?.designation ?? fasten.into.name}`;
  }
  return clause;
}

function describe(component, resolved) {
  const meta = resolved.catalogue.get(component.id);
  if (meta?.designation) return meta.designation;
  const args = Object.entries(component.args)
    .map(([k, node]) => `${k}=${resolved.evaluate(node)}`)
    .join(', ');
  const leaf = component.id.split('/').pop();
  return args ? `${leaf} (${args})` : leaf;
}

export function buildOrder(resolved) {
  const steps = [];
  const ground = resolved.instances.get(resolved.ground);

  if (ground) {
    steps.push({
      n: 1,
      text: `Start with ${nameOf(ground)}. Everything else hangs off it.`,
      joint: null,
    });
  }

  for (const edge of resolved.tree.order) {
    const joint = edge.joint;
    const parent = resolved.instances.get(joint.parent.instance);
    const child = resolved.instances.get(joint.child.instance);

    let where = `at its ${readable(joint.parent.anchor)}`;
    if (joint.parent.at !== undefined) {
      where += `, ${resolved.evaluate(joint.parent.at)} mm along`;
    }

    let text = `Attach ${nameOf(child)} to ${nameOf(parent)} ${where}`
             + `${fasteningClause(joint.fasten, resolved)}, ${ROLE[joint.type] ?? ''}.`;

    if (joint.type === 'prismatic' && joint.limit?.items?.length === 2) {
      const [a, b] = joint.limit.items.map((node) => resolved.evaluate(node));
      text += ` It should run freely from ${a} to ${b} mm.`;
    }

    steps.push({ n: steps.length + 1, text: text.replace(/\s+/g, ' '), joint });
  }

  // A route is threaded through the machine once the bodies are on it, which is
  // why it comes last rather than in tree order - it has no place in the tree
  // at all, by the argument in README.md about flexible stock.
  for (const route of resolved.routes) {
    const over = (route.over?.items ?? []).map((r) => nameOf(resolved.instances.get(r.instance)));
    const ends = (route.anchors?.items ?? []).map((r) => readable(r.anchor));
    steps.push({
      n: steps.length + 1,
      text: `Run the ${route.of.id.split('/').pop()} over ${list(over)}, and clamp both ends at ${list(ends)}. `
          + 'Cut it to the length the machine resolves to once poses are computed.',
      joint: null,
    });
  }

  for (const drive of resolved.drives) {
    steps.push({
      n: steps.length + 1,
      text: `${cap(nameOf(resolved.instances.get(drive.from)))} drives `
          + `${nameOf(resolved.instances.get(drive.to))} through ${drive.via}. `
          + 'Steps per millimetre follows from the pulley, and is not computed yet.',
      joint: null,
    });
  }

  return steps;
}

const readable = (anchor) => anchor.replace(/_/g, ' ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (items) =>
  items.length <= 1 ? (items[0] ?? 'nothing')
    : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
