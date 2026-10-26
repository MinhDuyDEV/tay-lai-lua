// Build-time read of the ruleset, shared by every exercise page. Server only: Next refuses to bundle a
// JSON module from outside `apps/web` (relative path, alias, symlink and webpack `externalDir` all
// fail on rsc/export), and copying the file into apps/web would break "import it, don't copy it". A
// build-time `fs` read keeps content/rulesets/tt108-2026.json as the single source and inlines it
// into each static page.

import fs from 'node:fs';
import path from 'node:path';
import type { Ruleset } from '../src/ruleset.ts';
import { FEEL } from '../input/driver.ts';

const RULESET_FILE = path.join(process.cwd(), '..', '..', 'content', 'rulesets', 'tt108-2026.json');

export function readRuleset(): Ruleset {
  const data = JSON.parse(fs.readFileSync(RULESET_FILE, 'utf8')) as Omit<Ruleset, 'steer'>;
  // The keyboard's steering model lives in the run loop, which is the one place it should live; the
  // ruleset carries it so the advice line's speed bound is computed from the same numbers.
  return {
    ...data,
    steer: {
      speedScaleMps: FEEL.steer.speedScaleMps,
      minLock: FEEL.steer.minLock,
      centre: FEEL.steer.centre,
    },
  };
}
