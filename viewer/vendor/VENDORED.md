# Vendored

three.js r169, from `cdn.jsdelivr.net/npm/three@0.169.0`. MIT, and the licence
header is intact at the top of the module.

- `three.module.min.js` - unmodified.
- `OrbitControls.js` - **LOCAL PATCH**, noted at the top of the file and at the
  line itself. Upstream imports the bare specifier `three`, which needs an
  import map, which needs an inline script, which a sane Content-Security-Policy
  refuses. One relative path instead.

Fetched from a CDN rather than copied out of mechanica's tree. mechanica vendors
its own three.js and the two will drift, which is correct: they are separate
products and neither should be able to break the other's renderer by upgrading
its own.

**A vendored file must never change under its own name.** Anything cached hard
by a browser that already has it will not ask again, and an in-place patch
strands every prior visitor on a stale copy. Rename on upgrade.
