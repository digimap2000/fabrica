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

---

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

## 1. `brackets/motor-mount`

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

## 2. `brackets/idler-block`

The other end. A block that bolts to the same beam and presents a plain spindle
for an idler pulley to turn on, coaxial with the motor's shaft.

**Designation:** `"{profile} idler block, {spindle} mm spindle"` → `2020 idler
block, 5 mm spindle`

**Parameters**

| Name | Type | Aspect | Notes |
| --- | --- | --- | --- |
| `profile` | `standard` | form | family `t_slot` |
| `spindle` | `distance` | form | settled by the bushing that runs on it |
| `axis_height` | `distance` | size | must match the motor mount's, and the machine file makes them match |
| `spindle_length` | `distance` | size | enough for the bushing plus a retaining washer |
| `plate` | `distance` | size | |
| `fixings` | `count` | mounting | |

**Interface fabrica needs**

| Anchor | Where | Carries |
| --- | --- | --- |
| `rail_face` | origin, normal `-z` | T-slot pattern, as above |
| `spindle` | axis parallel to the motor's, at `axis_height`, on the centre plane | `archetype: bore`, diameter `spindle`, gender `shaft` |

**The thing that went wrong once already, in fabrica, and is worth knowing:**
the drive pulley hangs off a motor shaft and the idler sits on this spindle, so
the two stack in **opposite directions**. Equal heights do not make the pulleys
coplanar; they put them two pulley-thicknesses apart. `axis_height` is measured
to the *axis*, and what has to match is where the pitch circle lands. fabrica
now checks this and will fail the contract if it drifts.

---

## 3. `carriages/belt-carriage`

What rides the beam. A block that captures the top slot, slides freely along it,
and presents a flat face on top for a belt clamp.

**Designation:** `"{profile} belt carriage"`

**Parameters**

| Name | Type | Aspect | Notes |
| --- | --- | --- | --- |
| `profile` | `standard` | form | family `t_slot` |
| `length` | `distance` | size | along travel; longer is less prone to racking |
| `height` | `distance` | size | sets the belt line, so it matters to the machine |
| `fit` | `distance` | mounting | slot clearance. A printed part's running fit, and the one number that decides whether this works at all |
| `chamfer` | `distance` | finish | `d=`, and it is `d=` not `r=` |

**Interface fabrica needs**

| Anchor | Where | Carries |
| --- | --- | --- |
| `rail_face` | origin, normal `-z` | `archetype: t_slot`, gender `rider` - this one **slides**, it is not bolted, and fabrica mates a prismatic joint to it |
| `belt_face` | `[0, 0, height]`, normal `+z` | two M3 clearance holes for the clamp, spacing in the interface |

`fit` deserves a real `convention` tag. Every printer produces a different one
and the honest thing is to say how to find yours, not to pick a number and hope.

---

## 4. `clamps/belt-clamp`

Grips both cut ends of the belt and bolts to the carriage. Small, and the part
that decides whether the stage holds position.

**Designation:** `"{profile} belt clamp"` → `GT2 belt clamp`

**Parameters**

| Name | Type | Aspect | Notes |
| --- | --- | --- | --- |
| `profile` | `standard` | form | family `belt_profile` - **this table exists**, `belts/tooth-profiles.table.json` |
| `width` | `distance` | form | belt width, 6 or 9 for GT2 |
| `grip` | `distance` | size | how much belt is held; too little and it walks |
| `spacing` | `distance` | size | between the two belt ends. fabrica subtracts exactly this from the loop to get the cut length, so it is not cosmetic |
| `screws` | `count` | mounting | |

The gripping face should be **toothed to the belt profile**, not flat - a flat
clamp on a toothed belt relies on friction and creeps. The profile table already
has the tooth geometry, so this is reading a table rather than inventing a
shape.

**Interface fabrica needs**

| Anchor | Where | Carries |
| --- | --- | --- |
| `carriage_face` | origin, normal `-z` | the M3 pattern matching the carriage's `belt_face` |
| `belt_a` | `[-spacing/2, 0, groove]` | `archetype: belt_end`, gender `clamp` |
| `belt_b` | `[+spacing/2, 0, groove]` | same |

**Both belt anchors must lie on the belt's run** - same `z`, on the centre
plane, separated by `spacing` along travel. That is the whole correction at the
top of this document, expressed as two coordinates.

---

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
