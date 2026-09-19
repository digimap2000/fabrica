// Just enough 3D to place a rigid body.
//
// Rigid transforms only - rotation and translation, never scale or shear -
// because that is all an assembly of manufactured parts can be. Keeping the set
// that narrow is what lets invert() be a transpose and three lines rather than a
// general routine, and it means a bug can never silently squash a part.
//
// Row-major, sixteen numbers, laid out the way it reads on paper:
//
//   [ xx yx zx ox ]     the columns are the frame's axes, and the last
//   [ xy yy zy oy ]     column is where its origin sits
//   [ xz yz zz oz ]
//   [  0  0  0  1 ]

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a) => Math.sqrt(dot(a, a));
export const distance = (a, b) => length(sub(a, b));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalise(a) {
  const n = length(a);
  if (n < 1e-12) throw new Error('cannot normalise a zero-length vector');
  return scale(a, 1 / n);
}

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

// A direction ignores the translation, which is the whole difference between
// asking 'where is this anchor' and 'which way is it facing'.
export function transformDirection(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
}

export const origin = (m) => [m[3], m[7], m[11]];
export const axisZ = (m) => [m[2], m[6], m[10]];
export const axisX = (m) => [m[0], m[4], m[8]];

// An anchor gives a point, a normal and a clock direction. The clock is
// orthogonalised against the normal rather than trusted: a stub written by hand
// will sooner or later give two directions that are not quite square, and
// quietly fixing it here beats a frame that is subtly not a frame.
export function frame(o, z, x) {
  const zz = normalise(z);
  const projected = sub(x, scale(zz, dot(x, zz)));
  if (length(projected) < 1e-9) {
    throw new Error('an anchor\'s clock direction is parallel to its normal, so it fixes no rotation');
  }
  const xx = normalise(projected);
  const yy = cross(zz, xx);
  return [
    xx[0], yy[0], zz[0], o[0],
    xx[1], yy[1], zz[1], o[1],
    xx[2], yy[2], zz[2], o[2],
    0, 0, 0, 1,
  ];
}

// Rotation is a transpose and the translation moves with it. True only for a
// rigid transform, which is the reason this module refuses to build any other
// kind.
export function invert(m) {
  const t = [m[3], m[7], m[11]];
  const r = [
    m[0], m[4], m[8],
    m[1], m[5], m[9],
    m[2], m[6], m[10],
  ];
  const back = [
    -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
    -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
    -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]),
  ];
  return [
    r[0], r[1], r[2], back[0],
    r[3], r[4], r[5], back[1],
    r[6], r[7], r[8], back[2],
    0, 0, 0, 1,
  ];
}

export function translation(v) {
  return [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];
}

export function rotationZ(radians) {
  const c = Math.cos(radians), s = Math.sin(radians);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// Half a turn about x, which is how two faces meet: it sends z to -z, so the
// two anchors' normals end up pointing at each other, which is what touching
// means. Every fixed joint is this and nothing else.
export const FLIP = Object.freeze([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
