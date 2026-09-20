# Parts wanted

Four components `machines/linear-stage.machine` cannot be assembled without, and
one standards table they all depend on. Written by fabrica, for implementation
in mechanica.

**This is a request, not an instruction.** Each part has to earn its place in
mechanica's catalogue on mechanica's own terms - `maintain-part-portfolio` is
the judge of that, and "fabrica needs it" is evidence of demand rather than a
decision. What this document is for is making the demand precise: the interface
fabrica has already committed to in `stubs/`, so that when the part is built the
two agree rather than nearly agreeing.

Read `authoring-a-part` before starting. Everything below assumes it.

**Status, 2026-09-20.** mechanica has answered part of this and answered it
better than it was asked. T-slot extrusion, NEMA frames, a motor, a T-slot nut,
an end cap, an end flange and a NEMA L bracket all exist at kernel 14 and are
deployed. **Part 1 below is withdrawn** - see the note in its place. Parts 2, 3
and 4 stand, and the prerequisite table is done.

---

## The belt plane: fixed, and what it took

`machines/linear-stage.machine` has been rewritten around the belt plane rather
than around its parts, and `src/route.js` now refuses a route whose clamped ends
do not lie on its run - the check that was missing when the fault below went
unnoticed. What follows is left as written because it is the record of how the
fault was found; the arrangement it describes has been superseded by the flange
hub, but the reasoning has not.

Three more faults of the same family surfaced during the rewrite, each caught by
a check rather than by eye: the pitch circles 5 mm apart because a shaft and a
spindle stack in opposite directions, the clamp 5.5 mm short of the pitch plane,
and the carriage sitting astride the motor flange at the bottom of its stroke.

### The original fault, as found

## Read this first: the stage's belt plane is wrong

Before any of these are built, the machine they serve has a geometric fault, and
a mount designed against the current frame would bake it into hardware.

```
belt plane   drive pitch [0, -37.5, 0]   idler pitch [400, -37.5, 0]
belt ends    clamp.belt_a [-12, 0, 32.5]  clamp.belt_b [12, 0, 32.5]
```

The motor hangs off the beam's **left slot**, so the belt runs down that face at
`y = -37.5`, `z ≈ 0`. The carriage rides the **top slot**, so its clamp sits at
`y = 0`, `z = 32.5`. The belt is 37.5 mm out of plane and 32.5 mm below the
thing it is supposed to drive. **It cannot reach.**

The 816 mm the resolver reports is arithmetically correct for the loop and
meaningless as a cut length, because the 24 mm it subtracts is the gap between
two clamps that are not on the belt path. Nothing caught it: the poses are
right, the tree is right, the belt maths is right, and no check asks whether the
thing being clamped is where the clamp is. That check is fabrica's to add and is
not in this document.

**The corrected arrangement**, which the frames below assume:

- The beam runs along **+x**, 20 x 20 centred on the axis, so `y, z` span -10 to
  +10. The carriage rides the **top** slot at `z = +10`.
- The belt runs in the beam's **centre plane, `y = 0`**, in the x-z plane above
  the beam, so a clamp on top of the carriage grips it directly.
- Both pulley axes are **parallel to y**, at the same height, in that centre
  plane. The carriage clamps the belt's **lower** run.
- One number ties it together: the **belt line**, the height of the clamped run.
  It follows from the carriage and clamp stack, and the two brackets take an
  `axis_height` that the machine file computes as `belt line + pitch radius`.
  That arithmetic is `teeth * pitch / 6.283185307`, which MachineLang can do -
  it is directed propagation, not a solve.

So the motor mount and the idler block both bolt to the beam and present a
rotation axis **above** it on the centre plane, not out to one side.

---

## Frame convention, and why it is not negotiable

fabrica places a part by making two faces touch. Its stubs already encode where
each face is, so the built part must agree or every pose downstream is wrong in
a way that still looks like a number.

**Every part below: origin on its principal mounting face, body extending to
+z, that face's normal pointing -z** - away from its own body, which is what
"outward" means for every anchor. A joint rotates the part into place; the part
itself never needs to know which way up the machine is.

Where a second face matters, its position is given **relative to the origin and
in terms of a parameter**, never as a fixed number, so the stub can follow the
part as it is configured.

mechanica has no `@anchor` syntax yet - that is item 1 on fabrica's list in
`README.md` and is not asked for here. Until it exists, fabrica keeps these
positions by hand in `stubs/`, and this document is the agreement they are kept
against.

---

## Prerequisite: a T-slot extrusion standard

All four parts mate to aluminium T-slot extrusion, and mechanica has no such
family. `sections/square-hollow-sections.table.json` is hollow tube for the
connectors - a different thing with a different interior.

See `standards-tables`. What is wanted:

| | |
| --- | --- |
| **File** | `app/reference/sections/t-slot-extrusion.table.json` |
| **Family** | `t_slot` |
| **Rows** | at least `2020`; `2040`, `3030`, `4040` if the data is to hand |
| **Columns** | `size` (20), `slot` (the 6 mm opening), `throat` (the wider interior the T-nut sits in), `depth` (opening face to throat floor), `bore` (the central hole), `corner` (the outside radius) |

The designation should read as people order it - `2020`, not `20 x 20 x 6`.
The union-and-zero-fill contract matters here: a part offering `t_slot` must
still build if a row omits `bore`, because not every profile has one.

Worth checking before writing it whether this belongs as a *chapter* in the
reference handbook too. A printed part that fits extrusion is a thing people get
wrong, and the clearances are the interesting part.

---

## 1. `brackets/motor-mount` - WITHDRAWN

I asked for a plate that bolts to a T-slot beam and carries a stepper. mechanica
built something better and the request should not survive it.

What I specified was one part that knew about both a T-slot profile and a NEMA
frame. That is one of n times m parts, and the second one written is already a
worse idea than the first. What exists instead is a hub: `extrusions/end-flange`
turns the end of any profile into a bolt circle, and `brackets/nema-l-bracket`
takes a bolt circle on one leg and a NEMA frame on the other. Neither has heard
of the other. Four holes on a 44 pitch circle **is** a NEMA 17 mount and the
catalogue never has to know it.

`machines/flange-end.machine` is the proof and exists for no other reason. It
assembles true: every joint closes to a gap of 0.000 mm with normals exactly
opposed, and the motor shaft lands 0.000 mm off the bracket's bore axis.

The convention that makes it work is the flange bolt circle at **45, 135, 225
and 315** rather than on the axes, and it is stated in mechanica as the
catalogue's convention rather than one part's preference. That is the clocking
trap this repository's README warns about, met and caught with a protractor -
two parts agreeing on hole count and pitch circle and still not going together,
both building clean, neither wrong on its own.

Everything below is left as written, because what it got wrong is the
interesting part.

### The original request, superseded

A plate that bolts to a T-slot beam and carries a stepper with its shaft across
the beam, on the centre plane, at a chosen height - so a pulley on that shaft
runs a belt along the beam.

**Designation:** `"{frame} motor mount for {profile}"` → `NEMA 17 motor mount
for 2020`

**Parameters**

| Name | Type | Aspect | Notes |
| --- | --- | --- | --- |
| `profile` | `standard` | form | family `t_slot`, default `2020` |
| `frame` | `standard` | form | the NEMA frame. **There is no NEMA table either** - it is wanted, or the pattern becomes three `distance` parameters, which is worse |
| `axis_height` | `distance` | see below | shaft axis above the mounting face |
| `plate` | `distance` | size | material thickness; the print's strength |
| `fixings` | `count` | mounting | T-slot bolts, 2 or 4 |
| `fillet` | `distance` | finish | the web fillet - `r=`, and it is `r=` not `d=` |

**The judgement call to review:** `axis_height` is a number the user types, which
reads like *size*; but in a machine it is settled entirely by what the part
mates with, which reads like *form* - the bushing precedent in `README.md` says
a dimension settled by a mating part is form even though you type it. I lean
**size**, because standing alone in the catalogue it is a free choice, and the
bushing's bore is not. Argue with me; I would rather this is decided than
assumed.

**Interface fabrica needs**

| Anchor | Where | Carries |
| --- | --- | --- |
| `rail_face` | origin, normal `-z` | the T-slot bolt pattern, `fixings` holes, gender `clearance` |
| `motor_face` | normal **horizontal** (perpendicular to `rail_face`), positioned so a motor bolted to it has its shaft axis at `axis_height` above the rail face and its shaft reaching the machine's centre plane | the NEMA face: 31 mm square for a 17, four M3 clearance, 22 mm pilot, **clocked 45°** |

The clocking is not decoration. A NEMA face's holes sit at 45° to the motor's
own axes, and two faces agreeing on spacing and count can still be a quarter
turn out.

**Use** `library/mounting.scad`'s `cap_screw_mount` for both patterns rather
than cutting holes by hand - it owns the clearances and lead-in chamfers that
make a printed fixing work.

**Printing:** it wants to print with the rail face on the bed. Say so in the
file; part-level print advice reaching the user is a known gap in mechanica's
own README and the print list is what will make it load-bearing.

---

## 2. `idlers/idler-post` - BUILT, as `motors/nema-idler-shaft`

Done, and better than asked. It is a printed block that clamps a **steel rod**
with a grub screw and presents a NEMA face - so the rod is bought stock rather
than printed plastic, which is the right way round for a shaft something turns
on, and was not in the request.

It carries the one property the ask leant on: the face at `body_length` with the
shaft beyond it, exactly as `motors/nema-motor` does. The proof is that swapping
the stand-in for the real part **changed no number in the machine at all** -
`shaft@18` was right before and after. Every previous version of the idler end
needed its position retuned on any edit that touched either end.

One thing it turned up. mechanica draws the rod as **hardware**, and fabrica
does not render another part's hardware because it places its own components -
so the rod would have been left out of the bill of materials entirely. It is
declared as stock in the machine to put it back. That is a general problem
rather than this part's: **anything mechanica models as hardware is invisible to
a BOM built from fabrica's own instances**, and a bill that omits a thing you
must order is simply wrong. Worth a rule rather than a patch per part.

## 3. `carriages/belt-carriage`

**Reframed.** It rides the beam's **side** slot and hangs outboard, not the top
- the belt runs alongside that face and the carriage has to reach it.

**Designation:** `"{profile} belt carriage"`

| Name | Type | Aspect | Notes |
| --- | --- | --- | --- |
| `profile` | `standard` | form | family `t_slot_extrusion` |
| `length` | `distance` | size | along travel; longer racks less. 60 in the stage, and it sets how far the stroke must start from each flange |
| `height` | `distance` | size | how far it stands off the slot face. 8, and with the clamp's 9.5 it is what puts the grip on the belt |
| `fit` | `distance` | mounting | the running clearance, and the one number that decides whether this works at all |
| `chamfer` | `distance` | finish | `d=`, not `r=` |

**Interface:** `rail_face` is a **rider** on the slot - fabrica mates a prismatic
joint to it, so it slides rather than bolts. `belt_face` at `[0, 0, height]`
carries two M3 clearance holes for the clamp.

`fit` deserves a real `convention` tag. Every printer gives a different one, and
the honest thing is to say how to find yours.

## 4. `clamps/belt-clamp`

**Reframed**, and two of its numbers are settled by the belt rather than chosen.

**Designation:** `"{profile} belt clamp"`

| Name | Type | Aspect | Notes |
| --- | --- | --- | --- |
| `profile` | `standard` | form | family `belt_profile` - the table exists |
| `width` | `distance` | form | belt width, 6 or 9 for GT2 |
| `grip` | `distance` | size | how much belt is held; too little and it walks |
| `spacing` | `distance` | size | between the two ends. fabrica subtracts exactly this from the loop, so it is not cosmetic |
| `reach` | `distance` | form | **the pulleys' pitch radius.** The belt's runs are one radius either side of the axis, so a clamp anywhere else grips air |
| `groove` | `distance` | form | **how far the grip line stands off the carriage.** It must reach the *pitch circle's* plane, which sits 5.5 mm into the pulley from its bore face - not flush with it |

`reach` and `groove` are marked form rather than size because neither is a
preference: both are settled by the pulley the belt goes round. They were
arrived at by fabrica refusing the build until they were right, which is what
that check exists for.

**Interface:** `carriage_face` matching the carriage's `belt_face`; `belt_a` and
`belt_b` at `[reach, -spacing/2, groove]` and `[reach, +spacing/2, groove]`.

**Both ends grip the same run.** A loop cut once gives two ends side by side,
not one on each side, and fabrica refuses the other arrangement.

The gripping face should be **toothed to the belt profile**, not flat - a flat
clamp on a toothed belt relies on friction and creeps. `belts/tooth-profiles`
already has the geometry.

## Found while wiring the new parts up

Two things for mechanica, and one that was fabrica's own fault.

**`extrusions/t-slot-extrusion` caps `length` at 300 mm.** A 300 mm-travel stage
needs a 420 mm beam, so the machine this whole document serves cannot be drawn.
Worth raising on mechanica's own terms rather than fabrica's: extrusion is sold
by the metre, and a model of stock that cannot represent a metre of it cannot
show what most parts actually bolt to. `flange-end.machine` is limited to 300 mm
because of it, and says so in its parameter's `convention`.

**Anchors are no longer a nice-to-have, and they need to be functions of
parameters.** Six frames were reverse-engineered for this session by fetching
each part's mesh, varying one parameter at a time and watching which dimension
of the bounding box moved. That works and it is absurd. Worse, it cannot express
what is actually true: the extrusion's far end is at `length`, so its anchor
moves when the part is configured. The stub pins it at 200 mm and is simply
wrong at any other length. A published anchor has to carry an expression, not a
constant.

**fabrica was drawing geometry it already had.** The viewer asked mechanica for
a mesh only when a component was `part` - made. But made-and-bought is a bill of
materials distinction, about who prints a thing and who buys it, and says
nothing about who holds its geometry. mechanica models an extrusion and a motor
precisely so a part can show what it bolts to, and both are bought. Fixed: a
component is asked for whenever it carries a bridge.

## What happens next

Implement in mechanica, in its own session, against `authoring-a-part` and
`components/REVIEW.md`. Then I review, and what I will check is:

1. **It builds and is watertight.** `debugging-geometry` - measured, not assumed.
2. **The frames agree with `stubs/`.** I will update the stubs from the real
   part and re-run `npm run contract`, which checks every parameter fabrica
   sends is one the part declares. mechanica *ignores* a parameter it does not
   know, so a name that does not match fails silently everywhere else.
3. **The aspects survive reading.** Particularly `axis_height`, which I have
   guessed at above and flagged as a call to make deliberately.
4. **The designation reads like an order.** No `finish` parameter in it.
5. **It assembles.** The real test: put it in the stage and see whether the belt
   plane, the pulley planes and the clamp line up - which is the fault this
   document opens with, and the reason none of these should be built against the
   current machine file.

A part that builds beautifully and puts the belt 37.5 mm from the clamp has not
been got right, and only assembling it says so.
