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
export function meshQuery(instance, { lod = 'coarse' } = {}) {
  const bridge = instance.meta?.mechanica;
  if (!bridge) return null;

  const params = new URLSearchParams();
  params.set('id', bridge.id ?? instance.id);

  for (const [key, value] of Object.entries(instance.args)) {
    const name = bridge.rename?.[key] ?? key;
    const mapped = bridge.map?.[key]?.[value];
    params.set(name, mapped ?? String(value));
  }
  if (lod) params.set('lod', lod);
  return params.toString();
}

// mechanica's mesh payload, as its README documents it: the magic "MMS2", three
// u32 counts of FLOATS (not vertices), then that many float32s, little-endian.
//
// Checked rather than trusted. A wrong magic here means the request was answered
// by something other than the API - an error page, a proxy, a login redirect -
// and silently handing that to a renderer produces a blank viewport and an hour
// of looking in the wrong place.
export function decodeMesh(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16) throw new Error('mesh payload is too short to be one');

  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'MMS2') {
    throw new Error(`expected an MMS2 mesh, got '${magic}' - something other than the API answered`);
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

  return {
    positions: take(vertexFloats),
    normals: take(normalFloats),
    edges: take(edgeFloats),
    triangles: vertexFloats / 9,
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
