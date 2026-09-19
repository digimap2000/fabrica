// MachineLang, from text to a tree of declarations.
//
// Hand-written rather than generated, for the same reason mechanica's is: the
// grammar is small, the error messages are most of the value, and a generator
// would put a build step between an author and a syntax error.
//
// This parser deliberately understands SHAPE and not MEANING. It will happily
// accept a joint between two things that do not exist and a limit that is not a
// pair - resolve.js is where that is caught, because a message about a missing
// anchor is worth more when it can name what anchors the part does have.

const KEYWORDS = new Set(['stock', 'part', 'ground', 'joint', 'route', 'drive', 'into', 'via']);

class SyntaxError_ extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

// --- lexer ------------------------------------------------------------------
// Comments are stripped here rather than in the parser so that every later
// stage can assume they are gone. A machine file's comments carry the reasoning
// and are meant to be read in the file, not by a tool.

function tokenise(text) {
  const tokens = [];
  let at = 0;
  let line = 1;

  const push = (kind, value) => tokens.push({ kind, value, line });

  while (at < text.length) {
    const c = text[at];

    if (c === '\n') { line += 1; at += 1; continue; }
    if (/\s/.test(c)) { at += 1; continue; }

    if (c === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at += 1;
      continue;
    }

    if (c === '"') {
      const end = text.indexOf('"', at + 1);
      if (end < 0) throw new SyntaxError_('unterminated string', line);
      push('string', text.slice(at + 1, end));
      at = end + 1;
      continue;
    }

    const number = /^\d+(\.\d+)?/.exec(text.slice(at));
    if (number) { push('number', Number(number[0])); at += number[0].length; continue; }

    const word = /^[A-Za-z_][\w-]*/.exec(text.slice(at));
    if (word) {
      push(KEYWORDS.has(word[0]) ? word[0] : 'ident', word[0]);
      at += word[0].length;
      continue;
    }

    if (text.startsWith('->', at)) { push('->'); at += 2; continue; }

    // '@' is two different things: it starts an annotation at the top level and
    // pins a track anchor inside a joint. One token, told apart by where it is.
    if ('@:;=,.{}[]()<>+-*/'.includes(c)) { push(c); at += 1; continue; }

    throw new SyntaxError_(`unexpected character '${c}'`, line);
  }

  push('eof');
  return tokens;
}

// --- parser -----------------------------------------------------------------

export function parse(text, origin = '<machine>') {
  const tokens = tokenise(text);
  let at = 0;

  const peek = (ahead = 0) => tokens[Math.min(at + ahead, tokens.length - 1)];
  const fail = (message) => { throw new SyntaxError_(`${message} (in ${origin})`, peek().line); };
  const take = (kind) => {
    if (peek().kind !== kind) fail(`expected ${kind}, found ${peek().kind}`);
    return tokens[at++];
  };
  const accept = (kind) => (peek().kind === kind ? tokens[at++] : null);

  // An identifier in a value position is one of two things, told apart by the
  // dot: 'travel' reads a parameter, 'beam.slot_top' names an anchor. Keeping
  // them distinct here means resolve.js never has to guess.
  function identOrAnchor() {
    const name = take('ident').value;
    if (!accept('.')) return { node: 'ref', name };
    const anchor = take('ident').value;
    const ref = { node: 'anchor', instance: name, anchor };
    if (accept('@')) {
      ref.at = accept('(') ? (() => { const e = expression(); take(')'); return e; })() : primary();
    }
    return ref;
  }

  function primary() {
    if (peek().kind === 'number') return { node: 'number', value: take('number').value };
    if (peek().kind === 'string') return { node: 'string', value: take('string').value };
    if (accept('(')) { const e = expression(); take(')'); return e; }
    if (accept('-')) return { node: 'neg', operand: primary() };
    if (peek().kind === 'ident') return identOrAnchor();
    return fail(`expected a value, found ${peek().kind}`);
  }

  function binary(next, operators) {
    let left = next();
    for (;;) {
      const op = operators.find((o) => peek().kind === o);
      if (!op) return left;
      take(op);
      left = { node: 'binary', op, left, right: next() };
    }
  }

  const product = () => binary(primary, ['*', '/']);
  const expression = () => binary(product, ['+', '-']);

  function array() {
    take('[');
    const items = [];
    if (peek().kind !== ']') {
      do { items.push(value()); } while (accept(','));
    }
    take(']');
    return { node: 'array', items };
  }

  // A fastening is a value with its own small grammar, and it earns the special
  // case: it is the one place a count and a mating part belong to the thing
  // being written rather than to a separate statement. 'x4' is a count, not a
  // multiplication, which is why this is parsed here and not by expression().
  function fastening() {
    if (peek().kind === 'ident') return { node: 'fasten', method: take('ident').value };
    const with_ = component();
    let count = 1;
    if (peek().kind === 'ident' && /^x\d+$/.test(peek().value)) count = Number(take('ident').value.slice(1));
    let into = null;
    if (accept('into')) into = peek().kind === '<' ? component() : identOrAnchor();
    return { node: 'fasten', with: with_, count, into };
  }

  function value() {
    if (peek().kind === '[') return array();
    if (peek().kind === '<') return component();
    return expression();
  }

  function component() {
    take('<');
    let id = take('ident').value;
    while (accept('/')) id += '/' + take('ident').value;
    take('>');
    const args = {};
    take('(');
    if (peek().kind !== ')') {
      do {
        const name = take('ident').value;
        take('=');
        args[name] = expression();
      } while (accept(','));
    }
    take(')');
    return { node: 'component', id, args };
  }

  function block(specials = {}) {
    const entries = {};
    take('{');
    while (peek().kind !== '}') {
      const key = take('ident').value;
      take('=');
      entries[key] = specials[key] ? specials[key]() : value();
      take(';');
    }
    take('}');
    return entries;
  }

  // --- declarations ---------------------------------------------------------
  const machine = { origin, proven: null, designation: null, parameters: {}, instances: {}, ground: null, joints: [], routes: [], drives: [] };

  function annotation() {
    take('@');
    const what = take('ident').value;
    if (what === 'proven') { machine.proven = take('number').value; take(';'); return; }
    if (what === 'machine') { machine.designation = take('string').value; take(';'); return; }
    if (what === 'parameter') {
      const name = take('ident').value;
      take(':');
      const type = take('ident').value;
      if (machine.parameters[name]) fail(`parameter '${name}' declared twice`);
      machine.parameters[name] = { name, type, ...block(), line: peek().line };
      return;
    }
    fail(`unknown annotation '@${what}'`);
  }

  function instance(kind) {
    take(kind);
    const name = take('ident').value;
    take('=');
    const of = component();
    if (machine.instances[name]) fail(`'${name}' declared twice`);
    machine.instances[name] = { name, kind, of, line: peek().line };
    take(';');
  }

  while (peek().kind !== 'eof') {
    const kind = peek().kind;

    if (kind === '@') { annotation(); continue; }
    if (kind === 'stock' || kind === 'part') { instance(kind); continue; }

    if (kind === 'ground') {
      take('ground');
      machine.ground = take('ident').value;
      take(';');
      continue;
    }

    if (kind === 'joint') {
      take('joint');
      const type = take('ident').value;
      const parent = identOrAnchor();
      take('->');
      const child = identOrAnchor();
      const line = peek().line;
      const body = peek().kind === '{' ? block({ fasten: fastening }) : {};
      accept(';');
      machine.joints.push({ type, parent, child, ...body, line });
      continue;
    }

    if (kind === 'route') {
      take('route');
      const name = take('ident').value;
      take('=');
      const of = component();
      const line = peek().line;
      machine.routes.push({ name, of, ...block(), line });
      continue;
    }

    if (kind === 'drive') {
      take('drive');
      const from = take('ident').value;
      take('->');
      const to = take('ident').value;
      take('via');
      const via = take('ident').value;
      take(';');
      machine.drives.push({ from, to, via });
      continue;
    }

    fail(`unexpected ${kind}`);
  }

  return machine;
}
