// Build-time read of the ruleset, shared by every exercise page. Server only: Next refuses to bundle a
// JSON module from outside `apps/web` (relative path, alias, symlink and webpack `externalDir` all
// fail on rsc/export), and copying the file into apps/web would break "import it, don't copy it". A
// build-time `fs` read keeps content/rulesets/tt108-2026.json as the single source and inlines it
// into each static page.

import fs from 'node:fs';
import path from 'node:path';
import type { Ruleset } from '../src/ruleset.ts';

const RULESET_FILE = path.join(process.cwd(), '..', '..', 'content', 'rulesets', 'tt108-2026.json');

export function readRuleset(): Ruleset {
  return JSON.parse(fs.readFileSync(RULESET_FILE, 'utf8')) as Ruleset;
}
