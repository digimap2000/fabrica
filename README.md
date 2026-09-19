# fabrica

Parameterised machines, assembled from [mechanica](https://github.com/digimap2000/mechanica)
parts and off-the-shelf hardware. A user picks a design from a library — a bed
slinger, a moving-gantry frame, a linear stage — configures it for their
application, and leaves with a visualisation, a bill of materials, a print list
and build instructions.

Machines are written in **MachineLang**. Authors write the machines; users only
ever see labelled parameters — the same bargain mechanica makes one level down.

## The split

mechanica answers *what shape is this thing*. fabrica answers *how are these
things held together, and how do they move*. Those are different questions,
which is why fabrica needs none of mechanica's vocabulary: no extrusions, no
booleans, no fillets. Shape is delegated entirely.

The consequence worth protecting: **fabrica never builds geometry.** At design
time it works with component ids, parameter sets, declared anchors and
envelopes. Solids are fetched only to draw or to export.

A machine is a skeleton, not a solid.

## Layout

```
machines/       the machine library - one .machine each, this is the catalogue
stock/          bought items: motors, extrusion, belts, bearings, fasteners
stubs/          hand-written mechanica component metadata, until the API serves it
src/            the language, the resolver, the poses - runs in node and the browser
viewer/         the page, and the only three.js in the repository
bin/            the command line, and the viewer's server
tests/          offline, fast, no network - what fabrica is on its own
contract/       against a running mechanica release - what fabrica assumes of it
```

The two suites are separate on purpose. `tests/` proves fabrica is
self-consistent and can never tell you the service still answers the way this
code expects; `contract/` is the only thing that can, and it needs a release to
talk to. A green offline suite implying otherwise would be the dishonest kind.

`stubs/` is temporary and deliberately so. It is what fabrica needs from a
mechanica component, written by need rather than guessed at, and it is
therefore the first draft of the API schema mechanica will publish. Every field
in it is a requirement with a machine behind it.

## The language

The primitives are joints, anchors and movement limits where mechanica's are
extrusions and combiners.

| | |
| --- | --- |
| `part` | made — a mechanica component, printed, carries a fingerprint, yours |
| `stock` | bought — a catalogue product with an envelope and anchors |
| `anchor` | a named frame on a part or stock item, in three kinds: a `face` is fixed, a `track` slides along an axis and carries a position, a `circle` is something flexible stock runs over |
| `joint` | `fixed`, `prismatic`, `revolute` — connects two anchors, and says how it is held |
| `limit` | the travel or rotation a joint allows |

Instances are named, unlike PartLang's modules, because you cannot joint to
something you cannot refer to. That divergence is deliberate; see "Keeping
mechanica and fabrica apart" below.

## Why joints rather than transforms

Pose things with a transform and you have a picture. Pose them with anchors and
joints and the same declaration yields four things nobody wrote:

| | |
| --- | --- |
| **Visualisation** | walk the tree, fetch each component's mesh at its resolved parameters, apply the pose |
| **Simulation** | drive a joint through its limits and test for interference at each step |
| **BOM** | `part` is made, `stock` and fastenings are bought; group by identical parameter set and count |
| **Build instructions** | a topological order of the joint tree *is* an assembly sequence |

The last is the argument for the whole approach. "Fix the motor mount to the
left slot of the beam with four M5x10 cap screws and T-nuts, then the motor to
the mount's face" is a traversal, not prose somebody maintains against a model
that has moved on.

Simulation means **kinematic** first: sweep the joints, check clearance, report
the working envelope. Dynamics needs masses, friction and a solver, and buys
much less than it costs.

## The one hard rule: a tree, not a graph

The joint graph must be a tree. A tree resolves by walking it - pure,
one-directional, memoisable - which is the same bet mechanica makes when it says
a part is a pure function of its parameters. A cycle is a mechanism and needs a
constraint solver, and a constraint solver is the CAD package both projects
exist to avoid being.

So cycles are rejected at parse time, and the refusal names the cycle. A
four-bar linkage gets a clear no instead of a wrong answer.

**A belt is the case that tests this and does not break it.** A belt does close
a loop, and `machines/linear-stage.machine` has one. The resolution is that the
belt is not a joint: it is stock, routed through named anchors, with its length
*derived* from the geometry it is routed around. Deriving a length is directed
arithmetic. Solving for a pose is not. Anything flexible - belt, cable, chain,
tube - is expected to work this way, and if something flexible ever cannot, that
is the signal a solver is genuinely required rather than merely convenient.

## Mounting faces: archetypes, not a catalogue of standards

Exposing thousands of real standards as mating surfaces would be a mess.
Instead: a small closed set of **interface archetypes**, each parameterised - a
circular coupling flange with a bolt circle diameter, a rectangular bolt
pattern, a T-slot profile, a shaft and key. Two anchors that declare the same
archetype with agreeing dimensions can bolt together.

This is mechanica's `standard` parameter pattern pointed at interfaces rather
than at fasteners, which is why it should feel familiar rather than new.

- **Compatibility is a predicate on the numbers, not on a label.** Two parts
  mate because both declare `circular_flange(bcd=50, holes=4, screw=M5)` and the
  values agree, never because the same name was typed twice. Named standards are
  *presets* over archetypes - "NEMA 17 face" is a preset for a rectangular
  pattern at 31 mm with an M3 and a 22 mm pilot. Humans pick names; the system
  checks numbers.
- **Clocking and gender are where the mess hides.** A pair agreeing on bolt
  circle and hole count can still disagree about whether the holes sit at 0/90
  or at 45, and about which side is tapped and which is clearance. That is the
  detail to design for, not the bolt circle.

**The archetype set has to stay small.** Forty archetypes is the standards mess
rebuilt with extra steps. If the set is growing, the abstraction is wrong.

## Keeping mechanica and fabrica apart

They are peers across an API, not layers of one product, and the separation is
the point rather than an accident of history.

**fabrica's CI must obtain components from a released mechanica container over
HTTP, never from a source checkout.** Repository separation removes the easy
shortcut; that removes the clever one. If the only way to get a component is the
API, the API gets good - which is half of why fabrica exists.

**Do not extract a shared grammar library.** The two languages look alike
because both are young and both borrow OpenSCAD's flavour, and they will
diverge: PartLang has no variables by design, MachineLang must name instances in
order to joint them, and the aspect vocabulary tuned to *who decides a part's
number* will not survive contact with a machine unchanged. A shared parser turns
every divergence into a negotiation and accretes flags.

So the conventions here - the `@parameter` block, the aspect idea, `@proven` and
a ledger, a designation that says how the thing would be ordered - **were copied
from mechanica deliberately and are maintained separately on purpose.** That
sentence exists to stop the next person, or the next agent, helpfully unifying
them.

What *is* shared is a contract: a versioned schema for the resolve payload,
living in mechanica's repository, with tests on both sides. mechanica proves its
endpoint matches the published schema; fabrica proves its stubs match it, and in
CI that the live API matches what it consumes.

**Where a dimension lives.** mechanica owns dimensional standards a part is
*built against* - that is what its `reference/**/*.table.json` already is.
fabrica owns product data about things you *buy*: this motor, this winding, this
shaft, this mass. So the NEMA 17 interface is a standard, lives in mechanica, and
fabrica reads it through the API like everything else. That line is the first one
that will come under pressure, and holding it is cheaper than carving the first
exception.

**Cache the metadata, call for geometry.** fabrica is not a live client for
everything: that would couple uptime and put a chain of calls behind every
slider. Component metadata is baked into a snapshot stamped with mechanica's
kernel version and per-component source hashes - exactly as mechanica's
`previews/manifest.json` stamps its baked meshes - so staleness is a test failure
rather than a wrong answer.

## What fabrica asks of mechanica

Nothing here is a mechanica priority, and no mechanica change should be
justified by fabrica alone - the justification has to be that mechanica is
better for it on its own terms. But this is the list, generated by need:

1. **Anchors.** Named frames on a part, typed against an interface archetype so
   mating is checkable. `library/mounting.scad` already knows where a fixing
   feature is; nothing publishes it. The largest single item.
2. **Made versus bought, explicitly.** Already strained in mechanica today:
   `pulleys/timing-pulley.scad` places a printable flanged bushing as
   `hardware(material=brass)`, declaring a made part bought by painting it.
3. **Print metadata.** Which way up, whether it needs support. mechanica's own
   README names this as the gap - written in the model files as author comments
   and never reaching the user. A print list is what makes it load-bearing.
4. **Mass and material.** Partly present: the baseline fingerprint already
   carries volume, centroid and the inertia matrix.
5. **A resolve-shaped API.** `/api/part` answers a human UI - labels, notes,
   conventions. A machine wants *given these parameters, give me anchors,
   envelope, designation and exports* in one call.
6. **Refuse a parameter you do not know.** mechanica currently *ignores* one:
   `/api/mesh?id=bushings/flanged-bushing&nonsense=7` answers 200 and builds the
   part at its defaults. That is worth fixing on mechanica's own terms rather
   than fabrica's - a typo in a shared configuration link silently hands
   somebody a different part, and the link is the save. It also means a renamed
   parameter breaks nothing anywhere and produces a plausible part of the wrong
   size, which is why `contract/` checks every parameter name against the
   declared schema; that check is the only thing standing between a rename and a
   shipped bill of materials.
7. **A published mapping between a value and its standards key.** Building the
   viewer turned this from a guess into a requirement. fabrica's belt profile is
   `GT2 2 mm`, a thing a person picks and reads; mechanica's is
   `belt_profile:gt2_2`, a row in a standards table. Sending the first is a 400.
   Neither side is wrong and nothing publishes the correspondence, so every stub
   carries a hand-written `mechanica.map` - which is a translation table that
   will rot the moment a standard is renamed. `/api/part` already serves the
   options for a `standard` parameter; what it does not say is which
   user-facing name each key answers to.

## Status

The resolver works. `bin/fabrica.js` turns a `.machine` file and the catalogue
into a bill of materials, a print list and a build order, as text:

```sh
node bin/fabrica.js machines/linear-stage.machine
node bin/fabrica.js machines/linear-stage.machine --set travel=500 --bom
node --test tests/*.test.js
```

Plain ES modules, no build step, no dependencies - fabrica has no geometry to
build, so it has no native dependency, and the same code will run in the browser
beside the viewer when there is one. That is also why there is no TypeScript
here: it would buy a build step to protect a few hundred lines that the tests
already cover.

Poses are resolved too, so the numbers that were notes are numbers:

```
FLEXIBLE STOCK
  belt  cut to 816.0 mm   (400.0 mm centres, wrap 180 deg and 180 deg, 10/10 teeth in mesh)

SPACE
  at rest   450 x 120 x 58 mm
  swept     450 x 120 x 58 mm   (carriage through its limits, 9 samples)
```

**What building it settled.** The build order is a depth-first traversal from
ground and nothing more, which is the argument for joints over transforms made
concrete - a transform can place a part but cannot say what it is placed *on*,
so it could never yield this. The tree rule pays for itself the same way: the
traversal is a correct assembly sequence precisely because every part has
exactly one parent.

Placing a machine is one multiplication per joint and no iteration at all:

    pose(child) = pose(parent) . F(parent anchor) . flip . F(child anchor)^-1

That is the tree rule cashing out. A CAD package needs a solver here because it
does not know which body is the reference for which; fabrica always does,
because the joint said so. The belt length is derived the same way - measured
between things already placed, never solved for - which is what keeps a closed
loop legal under a rule that forbids them.

**The belt check found a real fault on its first run.** The drive pulley hangs
off a motor shaft and the idler sits on a spindle, so the two stack in opposite
directions, and the equal 46 mm heights that looked obviously right put the two
pitch circles 13 mm apart along their axis - a belt that climbs its flange and
shreds. The centre-distance calculation projects that offset out, which is what
makes the distance correct and is exactly what would have hidden it, so the
discarded component is now looked at rather than dropped. `stubs/brackets/
idler-block.json` carries the corrected 33 mm and why.

**What it exposed, which is the more useful half:**

- **`stock` is doing two jobs.** One declaration of a T-nut becomes eight items,
  because two joints consume four each. The resolver recognises a consumable by
  its being named in a fastening's `into` and counts it by consumption, which
  works and is the wrong shape. The language wants the two meanings separated.
- **A stub holds one parameter set, and a machine asks for several.** The stage
  wants the same pulley at two different bores; the stub can only be one of
  them, and the resolver says so rather than presenting the stub's numbers as an
  answer. That is the sharpest argument yet for the resolve-shaped API in the
  list above - it is not a convenience, the machine is wrong without it.
- **`drive` barely earns its keep.** It carries a relation nothing yet computes.
  It stays for now because steps-per-millimetre is a number a user genuinely
  wants off this machine, but it should probably become a property of the route.
- **Interference wants geometry, not boxes.** The clash check compares
  axis-aligned boxes, so it over-reports every part that is not a box. The
  direction it is sound in is the useful one - boxes that do not overlap cannot
  be parts that do - so an empty result is a real all-clear and a hit is a
  candidate to look at. It becomes an answer when there are meshes to ask.

**The viewer works, and the boundary held.**

```sh
node bin/serve.js        # http://localhost:8081
```

The page runs the same `src/` modules the command line does, unaltered - the
parser, the resolver, the pose walk and the belt arithmetic all execute in the
browser, so there is one implementation of what a machine means rather than two
that drift. That was the reason for plain ES modules and no build step, and it
paid.

What the viewport shows is worth reading rather than just looking at. A **solid**
part is geometry mechanica actually built, at the parameters this machine asked
for. A **wireframe box** is either bought stock, which fabrica holds no geometry
for and never will, or a part mechanica does not have yet. **The boxes are the
backlog, drawn to scale and in place.**

What building it exposed:

- **mechanica sends no CORS headers**, so a page on another origin cannot ask it
  for anything. The fix is a proxy on fabrica's side, in `bin/serve.js`, and
  deliberately NOT a header on mechanica: that change would have to be justified
  on mechanica's own terms and "fabrica finds it convenient" is not one. The
  boundary is unweakened - it is still HTTP to a released service.
- **The first load is several seconds of nothing**, because every made part is
  modelled from scratch and OCCT serialises behind one lock. mechanica solved
  exactly this for its own gallery by baking previews; fabrica will want the
  equivalent. Until then the page at least says what it is doing.
- **A `<canvas>` is a replaced element.** `position: absolute; inset: 0` does
  not stretch one, because `width: auto` on a replaced element resolves to its
  intrinsic size - the attributes three.js writes the drawing buffer into. The
  canvas laid itself out at twice its container, and the scene rendered
  perfectly into the quarter of it you could see. Recorded in `viewer.css`
  because the symptom looks nothing like the cause.

**The boundary is checked by something that runs.**

```sh
npm test         # offline, 49 tests, under a second
npm run contract # against a release, 8 checks, under two seconds
```

Eight checks, generated from `machines/*.machine` rather than from a list
written by hand, so a machine that starts using a new part is covered the moment
it is written. They cover: health carrying every field the viewer shows; every
stub that claims a part exists being right; **every stub that claims a part is
missing still being right**, so the backlog can only shrink; each stub's
designation matching what mechanica resolves; every query fabrica builds being
accepted and returning a decodable mesh; every parameter name being one the part
declares; the payload still being MMS2 little-endian; and 404 and 400 still
meaning what the viewer says they mean.

The shrink-only rule is borrowed from mechanica's accessibility baseline, for
the same reason: an exception that no longer reproduces has to be deleted
deliberately, or the list rots into something nobody trusts and everybody skips.
A part arriving in mechanica is good news and still fails the test.

**They were verified by being broken.** Each guard was deliberately defeated in
turn - the standards key removed so a raw value goes out, a parameter renamed, a
backlog entry pointed at a part that exists, a designation made stale - and each
failure was caught by the check meant to catch it. A contract test that has
never been seen to fail is a comment.

An unreachable service is a failure, not a skip. A safety net that can absent
itself is not one.

Next: somewhere to run `npm run contract` on a schedule, so a mechanica deploy
that changes something under fabrica is noticed by a machine rather than by
somebody opening the viewer.
