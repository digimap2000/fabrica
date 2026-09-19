# Working on fabrica

Parameterised machines, assembled from mechanica parts and off-the-shelf
hardware. Machines are written in **MachineLang**, whose primitives are joints,
anchors and movement limits. `README.md` holds the design rationale — the split
with mechanica, why joints rather than transforms, the tree rule, the interface
archetypes. Read it before proposing architecture; this file is only the
operating rules.

## Reach for a skill

There are none yet. Write one when a workflow has been done twice and got wrong
once — that is what mechanica's skills are, and they earned their place that
way. The likely first two are authoring a machine, and shipping.

When the first is written, `skills/` at the root is the plugin's home and
`.claude/skills` is a symlink to it. **One symlink at the root, never one per
skill** — skill discovery follows a symlinked directory being scanned but skips
symlinked entries inside one. That was measured in mechanica, not assumed, and
the per-skill arrangement silently finds nothing.

## Invariants

**Verify; do not assume.** Every claim here is meant to be backed by something
that runs. If you assert a machine resolves, resolve it and show the output. If
you assert a suite passes, run it and read the result. A confident sentence is
not evidence.

**Never chain a test run into a commit.** `ctest ... && git commit && git push`
has already shipped a broken tree in the sibling repository. Run the suites,
read the result, then commit as a separate command.

**The joint graph is a tree.** A cycle is a mechanism and needs a constraint
solver, which is the thing both projects exist not to be. Reject cycles at parse
time and name the cycle. Anything flexible — belt, cable, chain — is routed
stock with a derived length, never a joint.

**mechanica is reached only over HTTP, from a released container.** Never a
source checkout, never a relative path, never a shared build. If something is
awkward to get through the API, that is a finding to record and take to
mechanica, not a reason to reach across. This is the whole point of the
separation.

**The conventions copied from mechanica are maintained separately on purpose.**
The `@parameter` block, the aspect idea, `@proven` and a ledger, the designation
discipline — all deliberately copied, none shared. Do not extract a common
grammar library, however tempting the duplication looks. The two languages will
diverge; MachineLang already names instances where PartLang forbids variables.

**MachineLang is not PartLang.** Do not carry assumptions across. Where the two
differ, the difference is usually deliberate and written down.

**Nothing here is a reason to change mechanica.** fabrica generates requirements
and they are valuable, but each one has to be justified on mechanica's own terms
before it is built. fabrica must never become a blocker on mechanica's MVP.

## Commands

Run from the repository root. Node 20 or later; no dependencies, no build step.

```sh
node bin/fabrica.js machines/linear-stage.machine     # BOM, print list, build order
node bin/fabrica.js <machine> --where                 # poses, extent, swept extent
node bin/fabrica.js <machine> --at carriage=300       # put a moving joint somewhere
node bin/fabrica.js <machine> --set travel=500 --bom  # configure and narrow
node bin/fabrica.js <machine> --json                  # for a caller, not a reader
node bin/serve.js                                     # the viewer, on :8081
node --test tests/*.test.js                           # 49 tests, under a second
```

`src/` runs in **both** node and the browser, and must keep doing so. A module
that imports `node:` anything cannot be imported by the viewer - which is why
`catalogue.js` holds no imports at all and `catalogue-fs.js` sits beside it. A
module does not get to be half portable.

**Geometry is the easiest thing here to get plausibly wrong.** A sign error puts
a bracket through the extrusion it is bolted to and every number downstream
still looks like a number, so a pose test asserts a position worked out by hand
from the stubs - never whatever the code printed the first time. And a geometry
test that skips on missing data passes by checking nothing; count what you
checked and assert the count.

There is no linter yet. When one is wanted it should be core ESLint with no
plugins, for mechanica's stated reason: catch what a runtime would catch and
hold no opinion about how the code looks.

## Prose

Comments and docs explain the *reason*, not the mechanism, and are honest about
trade-offs and about what was got wrong. That voice is load-bearing: it is how
the design survives being handed on. Write the sentence that stops the next
person making the mistake, and if you removed a claim because it turned out to
be untrue, say that rather than quietly rewording it.

Two conventions carried from mechanica, where they were measured rather than
asserted. **Source comments and machine files use a spaced hyphen, not an em
dash.** Markdown is the opposite and uses em dashes freely. **Prose is British**
— `centre`, not `center`, except in API names where the American spelling is
required.
