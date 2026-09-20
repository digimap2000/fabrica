// The boundary, and the only module that knows what mechanica's API looks like.
//
// Everything above this works on a component record and a parameter set.
// Everything mechanica-shaped - the query, the payload format, the translation
// between what a user picks and what the standards library is keyed by - is in
// here, so the day the API changes there is one file to read.
//
// It runs in node and in the browser unchanged, because it is fetch and a
// DataView and nothing else.

// A value the user picks and a value mechanica is keyed by are legitimately
// different: 'GT2 2 mm' is a belt somebody can name, 'belt_profile:gt2_2' is a
// row in a standards table. Neither is wrong, and nothing publishes the mapping
// between them - so the stub carries it, and this is where it is applied.
//
// This translation is temporary in the same way the stubs are. It is also the
// clearest requirement to have come out of building the viewer, and README.md
// says so rather than leaving it as a quirk of this function.
export function meshQuery(instance, { lod = null } = {}) {
  const bridge = instance.meta?.mechanica;
  if (!bridge) return null;

  const params = new URLSearchParams();
  params.set('id', bridge.id ?? instance.id);

  for (const [key, value] of Object.entries(instance.args)) {
    const name = bridge.rename?.[key] ?? key;
    const mapped = bridge.map?.[key]?.[value];
    params.set(name, mapped ?? String(value));
  }
  // No lod at all, which asks for full detail. 'coarse' is a third the triangles
  // and strips two things fabrica wants: the feature edges that make a rendered
  // part legible, and the hardware block that carries the only materials
  // anywhere in this API. Asking for less was costing both.
  if (lod) params.set('lod', lod);
  return params.toString();
}

// mechanica's mesh payload: a four-byte magic, three u32 counts of FLOATS (not
// vertices), then that many float32s, little-endian.
//
// TWO magics, which is the thing worth knowing. MMS2 is what a reduced level of
// detail returns and is the three arrays and nothing else. MMS3 is what full
// detail returns, and carries a further block: the HARDWARE a part is designed
// around, each piece with the material it is made of. The header is identical,
// so a reader of MMS2 consumes an MMS3 payload happily and simply stops early -
// which is exactly what fabrica did, discarding 73 kB of motor per bracket
// without a word, because the length check only ever asked whether there were
// too FEW bytes.
//
// The magic is checked rather than trusted. A wrong one means the request was
// answered by something other than the API - an error page, a proxy, a login
// redirect - and handing that to a renderer gives a blank viewport and an hour
// spent looking at the camera.
const MAGICS = new Set(['MMS2', 'MMS3']);

export function decodeMesh(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16) throw new Error('mesh payload is too short to be one');

  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (!MAGICS.has(magic)) {
    throw new Error(`expected an MMS2 or MMS3 mesh, got '${magic}' - something other than the API answered`);
  }

  const vertexFloats = view.getUint32(4, true);
  const normalFloats = view.getUint32(8, true);
  const edgeFloats = view.getUint32(12, true);

  const wanted = 16 + (vertexFloats + normalFloats + edgeFloats) * 4;
  if (buffer.byteLength < wanted) {
    throw new Error(`mesh says ${wanted} bytes and ${buffer.byteLength} arrived - truncated`);
  }
  if (vertexFloats % 3 || normalFloats % 3 || edgeFloats % 3) {
    throw new Error('mesh float counts are not multiples of three');
  }

  let at = 16;
  const take = (count) => {
    // Copied rather than viewed into the response buffer: a Float32Array view
    // needs 4-byte alignment that an arbitrary offset does not guarantee, and
    // the copy is a few hundred kilobytes once.
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(at + i * 4, true);
    at += count * 4;
    return out;
  };

  const positions = take(vertexFloats);
  const normals = take(normalFloats);
  const edges = take(edgeFloats);

  // The part is followed by the HARDWARE it is designed around: the fastener or
  // the motor mechanica draws in place to show what the part is for. Each piece
  // carries the material it is made of, which is the only material anywhere in
  // this payload - the part's own body has none, because what a printed part is
  // made of is the printer's business and not the model's.
  //
  // fabrica read the three arrays and stopped, and the length check only ever
  // asked whether there were too FEW bytes - so 73 kB of motor arrived with
  // every bracket and was thrown away without a word. Reading it was one line;
  // noticing it was the work.
  const hardware = [];
  if (magic === 'MMS3' && at < buffer.byteLength) {
    const pieces = view.getUint32(at, true);
    at += 4;
    for (let i = 0; i < pieces && at + 24 <= buffer.byteLength; i++) {
      // Sixteen bytes, space padded. Fixed width rather than length-prefixed,
      // which is why it is trimmed rather than sliced to a count.
      let material = '';
      for (let k = 0; k < 16; k++) material += String.fromCharCode(view.getUint8(at + k));
      at += 16;
      const pieceVertices = view.getUint32(at, true);
      const pieceNormals = view.getUint32(at + 4, true);
      at += 8;
      hardware.push({
        material: material.trim(),
        positions: take(pieceVertices),
        normals: take(pieceNormals),
        triangles: pieceVertices / 9,
      });
    }
  }

  return {
    format: magic,
    positions,
    normals,
    edges,
    hardware,
    triangles: vertexFloats / 9,
    // What was in the response and not understood. Zero is the expected answer
    // and anything else means the format has moved, which is worth knowing
    // rather than silently tolerating a second time.
    unread: buffer.byteLength - at,
  };
}

// One request, one component. The base is passed in rather than baked here
// because a browser goes through fabrica's own origin - mechanica sends no
// CORS headers, so the page cannot ask it directly - and node goes straight at
// the service. Same code, two callers, and the difference stated where it is.
export async function fetchMesh(base, instance, options = {}) {
  const query = meshQuery(instance, options);
  if (!query) return null;

  const response = await fetch(`${base}/api/mesh?${query}`, options.init);
  if (!response.ok) {
    let why = `HTTP ${response.status}`;
    try { why = (await response.json()).error ?? why; } catch { /* not JSON, keep the status */ }
    throw new Error(why);
  }
  return decodeMesh(await response.arrayBuffer());
}

export async function health(base) {
  const response = await fetch(`${base}/api/health`);
  if (!response.ok) throw new Error(`mechanica answered ${response.status}`);
  return response.json();
}
