// /thi — the only route. A server component on purpose: it runs at BUILD time, and that is where
// the ruleset JSON is read. Next refuses to bundle a JSON module from outside `apps/web`
// (relative path, alias, symlink and webpack `externalDir` all fail on rsc/export), and copying the
// file into apps/web would break the brief's "import it, don't copy it". A build-time `fs` read
// keeps content/rulesets/tt108-2026.json as the single source and inlines it into the static page.
//
// Everything interactive is a child client component; this file has no state and no three.js.

import fs from 'node:fs';
import path from 'node:path';
import Stage from '../../src/Stage.tsx';
import type { Ruleset } from '../../src/ruleset.ts';

const RULESET_FILE = path.join(process.cwd(), '..', '..', 'content', 'rulesets', 'tt108-2026.json');

function readRuleset(): Ruleset {
  const text = fs.readFileSync(RULESET_FILE, 'utf8');
  return JSON.parse(text) as Ruleset;
}

export default function Page() {
  const ruleset = readRuleset();
  return <Stage ruleset={ruleset} wasmUrl="/sim.wasm" />;
}
