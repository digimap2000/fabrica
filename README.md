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
```

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
| `anchor` | a named frame on a part or a stock item; `face` is fixed, `track` slides along an axis |
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

## Status

Nothing is built. `machines/linear-stage.machine` is written by hand, before any
code, because it is the cheapest possible test of whether joints, anchors and
limits are the right primitives - and it found the belt question above on the
first pass, which is what writing it first was for.

The next step is the smallest thing that turns a `.machine` file and the stubs
into a bill of materials and a build order. Text output, no geometry, no viewer.
That proves the concept end to end before anything renders.
