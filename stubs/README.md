# Stubs

Hand-written metadata for the components `machines/*.machine` refers to, written
because mechanica does not publish any of this yet and fabrica cannot be built
without it.

**These are not a workaround, they are the specification.** Every field here
exists because a machine needed it, which makes this the first draft of the
resolve payload mechanica will one day serve - written from need rather than
guessed at. When that endpoint exists, these files are deleted and the shape
they established is what the contract tests check on both sides.

So the rule while they live here: **add a field only when a machine cannot be
resolved without it.** A field added speculatively is a requirement invented,
and it will end up in an API contract nobody needed.

## What is here

Two exemplars rather than the full set, plus one file that lives elsewhere and
is listed here because it settled the same question. Each was chosen because it
taught something:

| | |
| --- | --- |
| `pulleys/timing-pulley.json` | a mechanica part that **exists today**, so it is what the API will actually have to produce |
| `brackets/motor-mount.json` | a mechanica part that **does not exist**, carrying two different interface archetypes on one bracket - the hard case |
| `../stock/extrusion-2020.json` | bought stock - not a stub, and the only thing with a **track** anchor |

`stock/` is a separate tree and stays: product data about things you buy is
fabrica's own for good, where a stub is a stand-in for something mechanica will
eventually serve. Mixing the two would have made the stubs look permanent.

The rest of what `linear-stage.machine` refers to is not written yet. Filling it
in is mechanical; these had something to teach.

## What writing them settled

**Anchors come in three kinds, not two.** A bracket's mounting face is a `face`
- a frame, full stop. An extrusion slot is a `track` - a frame that slides along
an axis, so it carries a range and a joint may pin it or consume it. A pulley's
pitch line is a `circle` - something a belt is routed *over* rather than
something that mates. The third kind was not in the design note and fell out of
the first machine.

**Clocking has to be in the interface, not implied.** A NEMA 17 face is a 31 mm
square pattern of four M3 clearance holes around a 22 mm pilot - and the holes
sit at 45 degrees to the motor's own axes. Two anchors agreeing on spacing and
count can still be a quarter turn out. `clock` is therefore a field, from the
start, rather than a convention somebody remembers.

**Made and bought is a property of the component, not of how it is used.** It
belongs in the metadata, which is the thing mechanica cannot currently say - it
has one `hardware()` bucket that conflates "bought" with "not really part of
this", and `pulleys/timing-pulley.scad` already has to declare a printable
bushing bought by painting it brass.
