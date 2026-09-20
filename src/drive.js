// What turning the motor does to the thing it drives.
//
// The question this answers is the one somebody actually has: how far does the
// carriage go per revolution, and what do I put in the firmware. It is
// arithmetic over things already resolved - a pitch circle and a step angle -
// and it is the last thing the `drive` declaration was written for and has not
// until now done.
//
// The mechanism it describes, because it is worth being explicit: the belt is a
// loop round two pulleys and the carriage is clamped to BOTH cut ends of it, so
// the carriage is effectively a break in one run. Turning the drive pulley
// winds belt onto one side and off the other, and the break - the carriage -
// travels. One turn of the pulley therefore moves the carriage by exactly the
// pitch circle's circumference, which for a toothed belt is teeth times pitch
// and nothing to do with the pulley's outside diameter.

import { anchorInWorld } from './pose.js';
import { WARN } from './resolve.js';

export function resolveDrives(resolved, poses) {
  const results = [];
  const diagnostics = [];

  for (const drive of resolved.drives) {
    const driver = resolved.instances.get(drive.from);
    const driven = resolved.instances.get(drive.to);
    if (!driver || !driven) {
      diagnostics.push({ severity: WARN, message: `drive: no instance called '${!driver ? drive.from : drive.to}'` });
      continue;
    }

    // The pulley the driver turns is whatever hangs off it carrying a pitch
    // circle. Found rather than named, because the machine already said which
    // motor drives what and should not have to say it twice.
    const mounted = [...resolved.instances.keys()].filter(
      (n) => resolved.tree.parentOf.get(n)?.parent === drive.from,
    );
    let pitch = null;
    for (const name of mounted) {
      const circle = anchorInWorld(resolved, poses, { instance: name, anchor: 'pitch_circle' });
      if (circle?.anchor?.interface?.diameter) { pitch = circle.anchor.interface; break; }
    }
    if (!pitch) {
      diagnostics.push({ severity: WARN, message: `drive: nothing with a pitch circle is mounted on '${drive.from}', so no ratio is derived` });
      results.push({ ...drive, perRevolution: null });
      continue;
    }

    const perRevolution = Math.PI * pitch.diameter;
    const stepAngle = driver.args.step_angle;
    const stepsPerRevolution = stepAngle ? 360 / stepAngle : null;

    results.push({
      ...drive,
      teeth: pitch.teeth ?? null,
      perRevolution,
      stepAngle: stepAngle ?? null,
      // What goes in the firmware. Quoted at a few microstep settings because
      // the number people actually want is steps per mm, and it is the one
      // nobody can do in their head.
      steps: stepsPerRevolution
        ? [1, 8, 16, 32].map((micro) => ({ micro, perMm: (stepsPerRevolution * micro) / perRevolution }))
        : null,
    });
  }
  return { drives: results, diagnostics };
}
