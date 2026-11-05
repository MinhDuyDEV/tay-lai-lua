// End-to-end for bài 1 and bài 3 in the built site: a learner who has only a keyboard.
//
//   node e2e.mjs [--site apps/web/out] [--wasm build/sim.wasm] [--ruleset content/rulesets/tt108-2026.json]
//
// Rules this file keeps:
//  * Keyboard events only. The page is never poked: every key goes through page.keyboard.
//  * Every key press waits on the state the page publishes (data-* on #stage), never on a clock.
//    The only time limit is Playwright's own timeout on a state that never arrives, and then the
//    failure prints the whole state.
//  * Nothing is skipped. A browser or WebGL that cannot start is a failure.
//  * The page has no stand-in for the core: it loads build/sim.wasm or shows an error and no hash.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../apps/web/scripts/serve.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const here = (rel) => resolve(import.meta.dirname, rel);
const site = args.get('site') ?? here('../../apps/web/out');
const wasmB64 = readFileSync(args.get('wasm') ?? here('../../build/sim.wasm')).toString('base64');
const ruleset = JSON.parse(readFileSync(args.get('ruleset') ?? here('../../content/rulesets/tt108-2026.json'), 'utf8'));

// Software GL through ANGLE/SwiftShader: the same path on a headless Linux runner and on a Mac.
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const WAIT_MS = 45_000;
// The automatic sections' learner: the 300 ms the owner's outcome names.
const AUTO_REACTION_MS = 300;
// RMS of the analyser, full scale 1.0. The processor's peak is 0.22; anything above this is a signal.
const AUDIBLE = 0.002;

const stage = '#stage';
const readStage = (page) => page.$eval(stage, (el) => ({ ...el.dataset }));

/**
 * Wait until `cond(d)` holds, where `d` is the dataset of #stage. A penalty id outside `allowed`
 * stops the wait at once: a run that went wrong should say so, not time out.
 */
async function until(page, what, cond, allowed = []) {
  let verdict;
  try {
    const handle = await page.waitForFunction(
      ({ cond, allowed }) => {
        const d = document.querySelector('#stage')?.dataset;
        if (!d) return false;
        const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
        if (bad.length) return { bad };
        return new Function('d', `return (${cond});`)(d) ? { ok: true } : false;
      },
      { cond, allowed },
      { timeout: WAIT_MS, polling: 'raf' },
    );
    verdict = await handle.jsonValue();
  } catch (err) {
    throw new Error(`stuck waiting for: ${what}\nstate: ${JSON.stringify(await readStage(page))}\n${err.message.split('\n')[0]}`);
  }
  if (verdict.bad) {
    throw new Error(`unexpected penalty ${verdict.bad} while waiting for: ${what}\nstate: ${JSON.stringify(await readStage(page))}`);
  }
}

/**
 * Wait for the page to publish `window.__thi`. A page that never does has failed to boot, and the
 * only witness is the page itself, so on a timeout say what it printed: every console line, page
 * error and failed request since it opened, plus the stage state if there is one.
 */
async function pageReady(page) {
  try {
    await page.waitForFunction(() => Boolean(window.__thi), null, { timeout: WAIT_MS });
  } catch (err) {
    const stage = await readStage(page).then(JSON.stringify, () => 'no #stage element');
    const log = (pageLog.get(page) ?? []).join('\n') || '(the page printed nothing)';
    throw new Error(`window.__thi never appeared in ${WAIT_MS} ms (${err.message.split('\n')[0]})\nstage: ${stage}\npage log:\n${log.replace(/^/gm, '  ')}`);
  }
}

/**
 * Keep the car rolling at a gentle speed until `cond` holds: throttle down below 1.2 m/s, up again
 * at 2.2 m/s. Every switch waits on the published speed, so it is the state that decides.
 */
async function cruiseUntil(page, what, cond, allowed) {
  const holds = () => page.$eval(stage, (el, c) => new Function('d', `return (${c});`)(el.dataset), cond);
  let throttle = true;
  while (!(await holds())) {
    const flip = throttle ? `Number(d.speed) >= 2.2` : `Number(d.speed) <= 1.2`;
    await until(page, `${what} (or a speed change)`, `(${cond}) || (${flip})`, allowed);
    if (await holds()) break;
    await (throttle ? page.keyboard.up('ArrowUp') : page.keyboard.down('ArrowUp'));
    throttle = !throttle;
  }
  if (throttle) await page.keyboard.up('ArrowUp');
}

/** One whole run of bài 1 from the keyboard. `belt` false leaves the seat belt unfastened. */
async function drive(page, { belt, allowed, automatic = false, end = `d.phase === 'done'` }) {
  const key = page.keyboard;

  // The first key only enters the car (and starts the audio); it must not count as an action.
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);

  // The engine starts cold, so the speakers must be silent until the learner starts it. This only
  // means something because the idle check below hears the same output chain.
  await until(page, 'audio processor loaded', `d.audio === 'running'`, allowed);
  const cold = Number((await readStage(page)).audioLevel);
  if (cold !== 0) throw new Error(`the engine is off but the audio output level is ${cold}`);

  await key.press('KeyE');
  await until(page, 'engine on', `d.engineOn === 'yes'`, allowed);
  await until(page, 'audible engine at idle', `Number(d.audioLevel) > ${AUDIBLE}`, allowed);
  console.log(`     audio level: off ${cold}, running ${(await readStage(page)).audioLevel} (rms, 1.0 = full scale)`);
  if (belt) {
    await key.press('KeyB');
    await until(page, 'belt on', `d.belt === 'yes'`, allowed);
  }

  await key.press('Enter');
  await until(page, 'start order given', `d.ordered === 'yes'`, allowed);
  await until(page, 'a core hash on screen', `d.hash.length === 16`, allowed);

  await key.press('KeyQ');
  await until(page, 'left signal on', `d.signal === 'left'`, allowed);

  if (automatic) {
    // The checklist for an automatic: D, P, and the car creeps on its own. No clutch, no gear number,
    // and the throttle is never needed.
    await key.press('KeyD');
    await until(page, 'gear D', `d.gear === '1'`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
    await until(page, 'moving', `Number(d.speed) > 0.5`, allowed);
    await until(page, 'bumper past 4 m', `Number(d.bumper) >= 4.0`, allowed);
    // The learner reads the 5 m mark and reacts: the key lands inside the 4–6 m window.
    await page.waitForTimeout(AUTO_REACTION_MS);
    await key.press('KeyQ');
    await until(page, 'left signal off', `d.signal === 'off'`, allowed);
    await until(page, 'end of the exercise', end, allowed);
    return;
  }

  await key.down('Space');
  await until(page, 'clutch pressed down', `Number(d.clutch) > 0.95`, allowed);
  await key.press('Digit1');
  await until(page, 'gear 1', `d.gear === '1'`, allowed);
  await key.press('KeyP');
  await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);

  // Pull away: clutch up through the bite, throttle down, then hold a gentle speed.
  await key.up('Space');
  await key.down('ArrowUp');
  await until(page, 'moving', `Number(d.speed) > 0.5`, allowed);
  await cruiseUntil(page, 'bumper past 4.5 m', `Number(d.bumper) >= 4.5`, allowed);

  // The law's window for the signal is 4–6 m after the line; switch it off inside it.
  await key.press('KeyQ');
  await until(page, 'left signal off', `d.signal === 'off'`, allowed);

  await cruiseUntil(page, 'end of the exercise', end, allowed);
}

// Bài 3's learner acts on what the page tells them, a human lag later: the advice line carries the
// cue in data-cue — 'slow' when the car is too fast for the stop cue to be honest, then 'clutch' and
// 'brake'. The lag is the middle of the 100-400 ms the feel test sweeps.
const REACTION_MS = 250;
// The figures are driven at the edge of the spec: 500 ms between the line changing and the key landing.
const FIGURE_REACTION_MS = 500;
const cue = (name) => `document.querySelector('.advice')?.dataset.cue === '${name}'`;

/**
 * Wait for any cue and return its name. A cue that never appears fails with the state on screen,
 * not with a guessed key press: the whole point is that the test acts on what the page shows.
 */
async function anyCue(page, what, allowed) {
  await until(page, what, `document.querySelector('.advice')?.dataset.cue` , allowed);
  return page.$eval('.advice', (el) => el.dataset.cue);
}

/**
 * Bài 3 from the keyboard: gear 1, handbrake off, creep up, clutch then brake to stop inside A, hold
 * with the handbrake. Then `finish` either pulls away (handbrake method) or lets the handbrake go with
 * the clutch up and no throttle. Every key waits on the published state.
 */
async function driveHill(page, { finish, allowed, throttle = false, automatic = false, end = `d.phase === 'done'` }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);

  if (automatic) {
    // D and P; the car creeps to the foot of the slope by itself. The page's own automatic cues:
    // 'throttle' for the pulse up the slope, then 'brake' when the bar says the key should land.
    await key.press('KeyD');
    await until(page, 'gear D', `d.gear === '1'`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
    await until(page, 'the throttle cue at the foot of the slope', cue('throttle'), allowed);
    await page.waitForTimeout(AUTO_REACTION_MS);
    await key.down('ArrowUp');
    await until(page, 'the pulse to end', `(document.querySelector('.advice')?.dataset.cue ?? '') !== 'throttle'`, allowed);
    await page.waitForTimeout(AUTO_REACTION_MS);
    await key.up('ArrowUp');
    await until(page, 'the brake cue', cue('brake'), allowed);
    await page.waitForTimeout(AUTO_REACTION_MS);
    await key.down('ArrowDown');
    await until(page, 'stopped', `d.phase === 'stopped'`, allowed);
    if (finish === 'roll-back') {
      // The learner takes the stop, then lets the brake go and never reaches for the throttle:
      // nothing holds the car, and the grade rolls it back past the law's 500 mm.
      await key.up('ArrowDown');
      await until(page, 'suspended by the rollback', `d.disqualified === 'yes'`, allowed);
      return;
    }
    // The page's launch sentence: the brake lets go and the throttle lands with it.
    await page.waitForTimeout(AUTO_REACTION_MS);
    await key.up('ArrowDown');
    await key.down('ArrowUp');
    await until(page, 'over the stop line', end, allowed);
    await key.up('ArrowUp');
    return;
  }

  // Before the first tick the snapshot already says clutch 1.00, so wait for ticks that consumed the key.
  const tick = Number((await readStage(page)).tick);
  await key.down('Space');
  // Fully down: the gear lever only goes in with the pedal at the floor.
  await until(page, 'clutch pressed down', `Number(d.tick) > ${tick} + 5 && Number(d.clutch) > 0.99`, allowed);
  await key.press('Digit1');
  await until(page, 'gear 1', `d.gear === '1'`, allowed);
  await key.press('KeyP');
  await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
  await key.up('Space');

  // `throttle` is the learner who comes up too fast: the page must tell them so, and the test only
  // lifts off once the page says it. No other key is pressed before that cue appears.
  if (throttle) await key.down('ArrowUp');
  const first = await anyCue(page, 'the first cue on the advice line', allowed);
  if (first === 'slow') {
    await page.waitForTimeout(REACTION_MS);
    await key.up('ArrowUp');
    console.log(`     the page said "slow" at ${(await readStage(page)).speed} m/s`);
    await until(page, 'the speed advice to clear', `(document.querySelector('.advice')?.dataset.cue ?? '') !== 'slow'`, allowed);
  } else if (throttle) {
    await key.up('ArrowUp');
  }
  await until(page, 'the clutch cue', cue('clutch'), allowed);
  await page.waitForTimeout(REACTION_MS);
  await key.down('Space');
  await until(page, 'the brake cue', cue('brake'), allowed);
  await page.waitForTimeout(REACTION_MS);
  await key.down('ArrowDown');
  await until(page, 'stopped', `d.phase === 'stopped'`, allowed);
  await key.press('KeyP');
  await until(page, 'handbrake on', `d.handbrake === 'yes'`, allowed);
  await key.up('ArrowDown');

  await key.up('Space');
  if (finish === 'pull-away') {
    await key.down('ArrowUp');
    await until(page, 'clutch at the bite', `Number(d.clutch) <= 0.65`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released on the slope', `d.handbrake === 'no'`, allowed);
    await until(page, 'over the stop line', end, allowed);
    await key.up('ArrowUp');
  } else {
    await until(page, 'clutch fully up', `Number(d.clutch) <= 0.05`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released with the clutch up', `d.handbrake === 'no'`, allowed);
    await until(page, 'disqualified', `d.disqualified === 'yes'`, allowed);
  }
}

/**
 * Bài 4 and bài 6 from the keyboard, acting on what the page says.
 *
 * The learner never presses ← or → on a guess: the direction comes from `data-cue` on the advice
 * line, read every tick, and the key is held exactly as long as the line keeps naming that direction.
 * Nothing is pressed before the page asks for it, so a cue the page never shows fails here rather
 * than being papered over. `throttle` is the learner who keeps the throttle down: the line must tell
 * them so in words.
 */
async function driveFigure(page, { allowed, throttle = false, automatic = false, end = `d.phase === 'done' || d.disqualified === 'yes'` }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
  await key.press('KeyE');
  await until(page, 'engine on', `d.engineOn === 'yes'`, allowed);

  if (automatic) {
    // The automatic checklist: D, P, the car's own creep.
    await key.press('KeyD');
    await until(page, 'gear D', `d.gear === '1'`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
  } else {
    // Set-off exactly as the advice line words it: clutch to the floor, gear 1, handbrake off.
    const tick = Number((await readStage(page)).tick);
    await key.down('Space');
    await until(page, 'clutch pressed down', `Number(d.tick) > ${tick} + 5 && Number(d.clutch) > 0.99`, allowed);
    await key.press('Digit1');
    await until(page, 'gear 1', `d.gear === '1'`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
    await key.up('Space');
    if (throttle) await key.down('ArrowUp');
  }

  // Hold the arrow key the line names, and only that one. The learner polls the line, and when it
  // differs from what they last acted on they wait FIGURE_REACTION_MS and then press what *that*
  // reading said, even if the line has moved on again — the same learner as the Supervisor's hand
  // check, and the stricter one: re-reading after the wait would hide a cue that comes too late.
  let heldDir = null;
  let seen = '';
  // The manual figure is driven at the edge of its spec; the automatic section is the outcome's 300 ms.
  const reactMs = automatic ? AUTO_REACTION_MS : FIGURE_REACTION_MS;
  const finishAt = Date.now() + WAIT_MS;
  while (Date.now() < finishAt) {
    const d = await readStage(page);
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} at progress ${d.progress} m (contact ${d.contact})\nstate: ${JSON.stringify(d)}`);
    if (await page.evaluate((c) => new Function('d', `return (${c});`)(document.querySelector('#stage').dataset), end)) break;

    const name = await page.$eval('.advice', (el) => el.dataset.cue ?? '');
    if (name !== seen) {
      seen = name;
      // The advice line's own words, printed once per change: this is what the learner would read.
      console.log(`     at ${Number(d.progress).toFixed(1)} m the line says: ${(await page.$eval('.advice', (el) => el.textContent)).trim()}`);
      await page.waitForTimeout(reactMs);
      const dir = name === 'left' ? 'ArrowLeft' : name === 'right' ? 'ArrowRight' : null;
      if (dir !== heldDir) {
        if (heldDir) await key.up(heldDir);
        heldDir = dir;
        if (dir) await key.down(dir);
      }
    }
    await page.waitForTimeout(50);
  }
  if (heldDir) await key.up(heldDir);
  if (throttle) await key.up('ArrowUp');
  await until(page, 'end of the figure', end, allowed);
}


/**
 * Bài 7 / bài 8 from the keyboard, reading only the advice line: `data-cue` (the arrow), `data-pedal`
 * (the pedal word) and `data-gear-wanted` (the gear to put in). Nothing is pressed that the line did not
 * ask for. The learner polls every 50 ms and, when the reading changed, waits PARK_REACTION_MS and then
 * acts on *that* reading even if the line has moved on: a cue that comes late fails here.
 *   creep  — feet off both pedals (the clutch is up and the car moves on its own); when the line also gives a
 *            time (`data-hold-ms`) the pulse is timed: feet off, then Space and ↓ when the hold bar
 *            (`[data-aid=hold]`) says `now`, PARK_REACTION_MS after it does
 *   brake / wheel / clutch / hold — Space and ↓ together; `wheel` and the arrow together set the lock
 *   park   — P once (handbrake); enter — Enter (the finish); data-gear-wanted — 1 or R with the pedal down
 */
const PARK_REACTION_MS = 300;
async function driveParkPage(page, { allowed, until: stopWhen = `d.phase === 'done' || d.disqualified === 'yes'`, maxMs = 240_000, automatic = false }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
  await key.press('KeyE');
  await until(page, 'engine on', `d.engineOn === 'yes'`, allowed);
  // An automatic's pedal word is the brake alone; a manual's is clutch and brake together.
  const pedals = (extra = []) => new Set([...extra, ...(automatic ? ['ArrowDown'] : ['Space', 'ArrowDown'])]);
  const held = new Set();
  const hold = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await key.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await key.down(k); held.add(k); }
  };
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('.advice');
      return {
        cue: el.dataset.cue ?? '',
        pedal: el.dataset.pedal ?? '',
        gear: el.dataset.gearWanted ?? '',
        hold: Number(el.dataset.holdMs ?? 0),
        bar: document.querySelector('[data-aid=hold]')?.dataset.state ?? '',
        text: el.textContent ?? '',
      };
    });
  // A timed pulse: `counting` from the feet coming off to the bar saying `now`, then `braking` until the car has stopped.
  let pulse = 'idle';
  let pressedAt = 0;
  let seen = '';
  let lastP = -Infinity;
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const d = await readStage(page);
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} at progress ${d.progress}\nstate: ${JSON.stringify(d)}`);
    if (await page.evaluate((c) => new Function('d', `return (${c});`)(document.querySelector('#stage').dataset), stopWhen)) break;
    const r = await read();
    const steer = new Set();
    if (r.cue === 'left') steer.add('ArrowLeft');
    if (r.cue === 'right') steer.add('ArrowRight');
    if (pulse === 'counting') {
      if (r.bar === 'now') {
        await page.waitForTimeout(PARK_REACTION_MS);
        await hold(pedals(steer));
        pulse = 'braking';
        pressedAt = Date.now();
      }
      await page.waitForTimeout(50);
      continue;
    }
    if (pulse === 'braking') {
      // Pedals stay down until the car has stopped: the line asks for a wheel or a gear, or shows a time again.
      if (Date.now() - pressedAt < 700 || !(r.hold > 0 || r.pedal === 'wheel' || r.pedal === 'clutch')) {
        if (Date.now() - pressedAt > 3000) pulse = 'idle';
        await page.waitForTimeout(50);
        continue;
      }
      pulse = 'idle';
    }
    if (r.pedal === 'creep' && r.hold > 0) {
      console.log(`     the line says [${r.cue}|creep|${r.hold} ms]: ${r.text.trim().slice(0, 110)}`);
      await page.waitForTimeout(PARK_REACTION_MS);
      await hold(steer);
      pulse = 'counting';
      seen = '';
      continue;
    }
    const sig = `${r.cue}|${r.pedal}|${r.gear}`;
    if (sig !== seen) {
      seen = sig;
      console.log(`     the line says [${sig}]: ${r.text.trim().slice(0, 110)}`);
      await page.waitForTimeout(PARK_REACTION_MS);
      const want = new Set();
      if (r.cue === 'left') want.add('ArrowLeft');
      if (r.cue === 'right') want.add('ArrowRight');
      if (r.pedal !== 'creep') for (const k of pedals()) want.add(k);
      await hold(want);
      if (r.pedal === 'enter') await key.press('Enter');
    }
    // Repeated each poll: a press the core ignored (clutch not yet down) is asked for again by the same line.
    if (r.pedal === 'park' && Date.now() - lastP > 1500) { await key.press('KeyP'); lastP = Date.now(); }
    if (r.gear && d.gear !== r.gear && (automatic || Number(d.clutch) > 0.97)) {
      await key.press(r.gear === '1' ? (automatic ? 'KeyD' : 'Digit1') : 'KeyR');
    }
    await page.waitForTimeout(50);
  }
  await hold(new Set());
  await until(page, `the run to end (${stopWhen})`, stopWhen, allowed);
}

let failures = 0;
const check = async (name, fn) => {
  // `--only bài 7` runs the checks whose name contains the text, e.g. on a machine without audio.
  if (args.get('only') && !name.includes(args.get('only'))) return;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name}\n${String(err.message).replace(/^/gm, '     ')}`);
  }
};

const server = await serve(site, 0);
const origin = `http://localhost:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
} catch (err) {
  console.log(`FAIL chromium launch: ${err.message.split('\n')[0]}`);
  server.close();
  process.exit(1);
}

/** Everything a page said about itself, kept for `pageReady` to print when the page never boots. */
const pageLog = new WeakMap();

async function fresh(path = '/thi', viewport = { width: 960, height: 600 }) {
  const page = await browser.newPage({ viewport });
  const problems = [];
  const log = [];
  pageLog.set(page, log);
  page.on('pageerror', (e) => {
    problems.push(`pageerror: ${e.message}`);
    log.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    log.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => r.status() >= 400 && log.push(`http ${r.status()}: ${r.url()}`));
  await page.goto(origin + path);
  return { page, problems };
}

try {
  let clean;
  await check('bài 1 clean run: no penalty, score 100, WebGL up, audio running', async () => {
    const { page, problems } = await fresh();
    await drive(page, { belt: true, allowed: [] });
    const d = await readStage(page);
    const listed = await page.$$eval('[data-penalty]', (els) => els.map((e) => e.dataset.penalty));
    if (d.phase !== 'done' || d.score !== '100' || d.penalties !== '' || listed.length) {
      throw new Error(`not a clean finish: ${JSON.stringify(d)} listed=${listed}`);
    }
    if (d.glOk !== 'yes' || (await page.$eval('canvas', (c) => c.dataset.webgl)) !== 'yes') {
      throw new Error('the WebGL renderer was not created');
    }
    if (d.audio !== 'running') throw new Error(`AudioContext is "${d.audio}", not running`);
    // What the learner reads: every step of the checklist ticked, and the audio line says ready.
    const todo = await page.$$eval('[data-step]', (els) => els.filter((e) => e.dataset.done !== 'yes').map((e) => e.dataset.step));
    if (todo.length) throw new Error(`the checklist still shows these steps undone after a clean run: ${todo}`);
    const audioLine = await page.$eval('.audio', (e) => e.dataset.audio);
    if (audioLine !== 'running') throw new Error(`the HUD audio line says "${audioLine}", the page says running`);
    if (problems.length) throw new Error(problems.join('\n'));
    // Trace and hash read in one go: the page has stopped feeding the core, so they belong together.
    clean = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
    await page.close();
  });

  /** Replay a recorded run through the golden runner's page script; the trace header names the exercise. */
  const replays = async (run) => {
    if (!run) throw new Error('no clean run to replay');
    if (run.hash !== run.shown) throw new Error(`page hash ${run.hash} differs from data-hash ${run.shown}`);
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><title>replay</title>');
    await page.addScriptTag({ path: join(import.meta.dirname, 'page.js') });
    const replayed = await page.evaluate((a) => window.runGolden(a), { wasmB64, traceB64: run.trace });
    await page.close();
    if (replayed !== run.hash) throw new Error(`replay gave ${replayed}, the page showed ${run.hash}`);
  };

  await check('the recorded trace replays to the hash the page shows', () => replays(clean));

  await check('bài 1 without the seat belt: SH.01.DAY_AN_TOAN, score 95, quote shown', async () => {
    const { page, problems } = await fresh();
    await drive(page, { belt: false, allowed: ['SH.01.DAY_AN_TOAN'] });
    const d = await readStage(page);
    if (d.penalties !== 'SH.01.DAY_AN_TOAN' || d.score !== '95') {
      throw new Error(`expected only SH.01.DAY_AN_TOAN and 95 points: ${JSON.stringify(d)}`);
    }
    const rule = ruleset.rules.find((r) => r.id === 'SH.01.DAY_AN_TOAN');
    const shown = await page.$eval('[data-penalty="SH.01.DAY_AN_TOAN"] blockquote', (e) => e.textContent);
    if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });

  let hillClean;
  await check('bài 3 clean run: stop inside A, start on the slope, score 100, header says exercise 3', async () => {
    const { page, problems } = await fresh('/thi/3');
    await driveHill(page, { finish: 'pull-away', allowed: [] });
    const d = await readStage(page);
    if (d.exercise !== '3' || d.phase !== 'done' || d.score !== '100' || d.penalties !== '' || d.disqualified !== 'no') {
      throw new Error(`not a clean finish: ${JSON.stringify(d)}`);
    }
    console.log(`     A ${d.stopA} m of ${ruleset.hill.max_a_m} m, rollback ${d.rollback} m`);
    if (Number(d.stopA) < 0 || Number(d.stopA) > ruleset.hill.max_a_m) throw new Error(`A ${d.stopA} m is outside the window`);
    if (Number(d.rollback) > ruleset.hill.max_rollback_m) throw new Error(`rolled back ${d.rollback} m`);
    if (d.glOk !== 'yes') throw new Error('the WebGL renderer was not created');
    const todo = await page.$$eval('[data-step]', (els) => els.filter((e) => e.dataset.done !== 'yes').map((e) => e.dataset.step));
    if (todo.length) throw new Error(`the checklist still shows these steps undone after a clean run: ${todo}`);
    if (problems.length) throw new Error(problems.join('\n'));
    hillClean = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
    const exerciseId = Buffer.from(hillClean.trace, 'base64')[7];
    if (exerciseId !== 3) throw new Error(`the trace header carries exercise id ${exerciseId}, not 3`);
    await page.close();
  });

  await check('the bài 3 trace replays to the hash the page shows', () => replays(hillClean));

  await check('bài 3 handbrake released with the clutch up: SH.03.TUT_DOC, đình chỉ, quote shown', async () => {
    const { page, problems } = await fresh('/thi/3');
    // A stall can come first as the car rolls back; it is part of the same mistake.
    await driveHill(page, { finish: 'roll-back', allowed: ['SH.03.TUT_DOC', 'SH.X.CHET_MAY'] });
    const d = await readStage(page);
    if (!d.penalties.split(' ').includes('SH.03.TUT_DOC')) throw new Error(`SH.03.TUT_DOC did not fire: ${JSON.stringify(d)}`);
    const rule = ruleset.rules.find((r) => r.id === 'SH.03.TUT_DOC');
    const shown = await page.$eval('[data-penalty="SH.03.TUT_DOC"] blockquote', (e) => e.textContent);
    if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
    const points = await page.$eval('[data-penalty="SH.03.TUT_DOC"] .points', (e) => e.textContent);
    if (points !== 'Đình chỉ') throw new Error(`the HUD says "${points}", not "Đình chỉ"`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });
  await check('bài 3 coming up too fast: the page says "slow", the learner lifts off, and the stop still lands inside A', async () => {
    const { page, problems } = await fresh('/thi/3');
    await driveHill(page, { finish: 'pull-away', allowed: [], throttle: true });
    const d = await readStage(page);
    if (d.phase !== 'done' || d.score !== '100' || d.penalties !== '') {
      throw new Error(`not a clean finish: ${JSON.stringify(d)}`);
    }
    if (Number(d.stopA) < 0 || Number(d.stopA) > ruleset.hill.max_a_m) throw new Error(`A ${d.stopA} m is outside the window`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });


// ---- bài 2, bài 9 and bài 11: the straight road -----------------------------------------------
//
// These three are one manoeuvre on one scene: come up at the car's own pace, stop inside A at the
// line, then go on past it. The keys come from what the page publishes, never from a clock:
//  * the stop is the aid's countdown (`data-aid-eta-ms`): read it every 50 ms, and when it reaches 0
//    put the clutch and the brake down — the same learner the feel test models;
//  * the throttle is pulsed on `data-line-gap`, so the car keeps rolling without over-revving;
//  * bài 11 is crossed with the right signal, which the page's own legend names.
const ROAD_POLL_MS = 50;

/** Set the car going as the checklist words it: clutch, gear 1, handbrake off, clutch up; or D, P. */
async function roadSetOff(page, allowed, automatic = false) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
  if (automatic) {
    await key.press('KeyD');
    await until(page, 'gear D', `d.gear === '1'`, allowed);
    await key.press('KeyP');
    await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
    return;
  }
  const tick = Number((await readStage(page)).tick);
  await key.down('Space');
  await until(page, 'clutch pressed down', `Number(d.tick) > ${tick} + 5 && Number(d.clutch) > 0.99`, allowed);
  await key.press('Digit1');
  await until(page, 'gear 1', `d.gear === '1'`, allowed);
  await key.press('KeyP');
  await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);
  await key.up('Space');
}

/**
 * Creep up to the line and stop on the aid's countdown, then hold with the handbrake.
 * Returns the state at the stop. `pressAt` overrides the aid (a learner who brakes on a guess).
 *
 * The learner never touches the throttle: the car idles along at its own creep, which is the speed
 * the aid is built for, and the advice line's "để xe tự bò" is the instruction they followed.
 */
async function roadStop(page, { allowed, pressAt = null, automatic = false }) {
  const key = page.keyboard;
  const deadline = Date.now() + WAIT_MS;
  let pressed = false;
  while (Date.now() < deadline) {
    const d = await readStage(page);
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} while approaching: ${JSON.stringify(d)}`);
    if (d.phase === 'stopped' || d.phase === 'done' || d.disqualified === 'yes') break;
    // The automatic learner is 300 ms behind the page's *word* ("bấm ngay", `data-aid-now`), not
    // behind the bar's mark; pressing at the mark and then waiting a reaction is double-late.
    const gated =
      pressAt === null
        ? automatic
          ? d.aidNow === '1'
          : d.aidKey !== '' && d.aidEtaMs !== '' && Number(d.aidEtaMs) === 0
        : Number(d.lineGap) <= pressAt;
    if (gated && !pressed) {
      // The automatic section's learner is the 300 ms one: the bar says the key should land now, the
      // hand takes its reaction, and the converter's push is what the aid's extra lead is for.
      if (automatic) await page.waitForTimeout(AUTO_REACTION_MS);
      if (!automatic) await key.down('Space');
      await key.down('ArrowDown');
      pressed = true;
      console.log(`     the aid said now at ${d.aidGapMm} mm (gap ${d.lineGap} m, speed ${d.speed} m/s, zone ${d.zone})`);
    }
    await page.waitForTimeout(ROAD_POLL_MS);
  }
  await until(page, 'stopped at the line', `d.phase === 'stopped'`, allowed);
  // Hold the car with the handbrake, as the checklist says. The clutch stays down through the hold:
  // letting it up in gear with the handbrake on would stall the engine against a stationary car.
  await key.press('KeyP');
  await until(page, 'handbrake on', `d.handbrake === 'yes'`, allowed);
  await key.up('ArrowDown');
  return readStage(page);
}

/**
 * Drive on until `cond` holds, then stop. Works from a stop at the line (gear 1 in, clutch down, held
 * by the handbrake: handbrake off and let the pedal up) and from the start of bài 11, which has no
 * stop before its finish line.
 */
async function roadGo(page, { allowed, cond, signal = false, automatic = false, stop = true, end = `d.phase === 'done' || d.disqualified === 'yes'` }) {
  const key = page.keyboard;
  const now = await readStage(page);
  if (now.handbrake === 'yes') {
    await key.press('KeyP');
    await until(page, 'handbrake off', `d.handbrake === 'no'`, allowed);
  }
  if (!automatic && now.clutch !== '0.00') await key.up('Space');
  // From a cold start the checklist's own way: clutch, gear 1, handbrake off, clutch up; or D, P.
  if (automatic) {
    if (now.gear !== '1') {
      await key.press('KeyD');
      await until(page, 'gear D', `d.gear === '1'`, allowed);
    }
  } else if (now.gear !== '1') {
    await key.down('Space');
    await until(page, 'clutch down', `Number(d.clutch) > 0.9`, allowed);
    await key.press('Digit1');
    await until(page, 'gear 1', `d.gear === '1'`, allowed);
    if (now.handbrake === 'yes') {
      await key.press('KeyP');
      await until(page, 'handbrake off', `d.handbrake === 'no'`, allowed);
    }
    await key.up('Space');
  }
  if (signal) {
    await key.press('KeyW');
    await until(page, 'right signal on', `d.signal === 'right'`, allowed);
  }
  await until(page, 'rolling', `Number(d.speed) > 0.4`, allowed);
  await until(page, `driven on to ${cond}`, cond, allowed);
  if (!stop) {
    // A liên hoàn run swaps bài on its own: drive on to the transition and let go, so no brake
    // pressed after the end of one bài is read by the next.
    await key.up('ArrowDown');
    await key.up('Space');
    await until(page, 'the next bài', end, allowed);
    return readStage(page);
  }
  // Stop past the line: clutch and brake. A run the exercise has already ended (bài 11 ends on the
  // tick the car stops past the finish line) needs nothing more, and a handbrake press after that
  // would never be seen by the core.
  if (!automatic) await key.down('Space');
  await key.down('ArrowDown');
  await page
    .waitForFunction(() => {
      const d = document.querySelector('#stage').dataset;
      return d.phase === 'done' || d.disqualified === 'yes' || Number(d.speed) < 0.05;
    }, null, { timeout: WAIT_MS, polling: 'raf' })
    .catch(async (err) => {
      throw new Error(`stuck stopping past the line\nstate: ${JSON.stringify(await readStage(page))}\n${err.message.split('\n')[0]}`);
    });
  const atStop = await readStage(page);
  if (atStop.phase !== 'done' && atStop.disqualified !== 'yes') {
    await key.press('KeyP');
    await until(page, 'held after the line', `d.handbrake === 'yes'`, allowed);
  }
  await key.up('ArrowDown');
  await key.up('Space');
  return readStage(page);
}

let roadClean = {};
for (const lesson of [2, 9]) {
  const path = `/thi/${lesson}`;
  const figure = `bài ${lesson}`;
  await check(`${figure} clean run: stop inside A on the aid, go on past the line, score 100`, async () => {
    const { page, problems } = await fresh(path);
    await roadSetOff(page, []);
    const d = await roadStop(page, { allowed: [] });
    console.log(`     ${figure}: A ${d.stopA} m of ${ruleset.road.max_a_m} m, zone ${d.zone}`);
    if (Number(d.stopA) < 0 || Number(d.stopA) > ruleset.road.max_a_m) throw new Error(`A ${d.stopA} m is outside the window`);
    const end = await roadGo(page, { allowed: [], cond: `Number(d.bumper) > 1.2` });
    if (end.score !== '100' || end.penalties !== '') throw new Error(`not a clean finish: ${JSON.stringify(end)}`);
    if (problems.length) throw new Error(problems.join('\n'));
    roadClean[lesson] = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
    const exerciseId = Buffer.from(roadClean[lesson].trace, 'base64')[7];
    if (exerciseId !== lesson) throw new Error(`the trace header carries exercise id ${exerciseId}, not ${lesson}`);
    await page.close();
  });

  await check(`the ${figure} trace replays to the hash the page shows`, () => replays(roadClean[lesson]));

  // The learner who brakes far too early: the page must charge CHUA_DEN_VACH, name it in data-last-*,
  // and print the ruleset's own quotation. That is also the "fails visibly" run. The car starts 2 m
  // short of the line, so "far too early" is a 1.8 m gap: pressing there leaves A around 1,6 m, well
  // outside the 500 mm window.
  await check(`${figure} braking 1,5 m early: CHUA_DEN_VACH charged, named on #stage, quote shown`, async () => {
    const id = lesson === 2 ? 'SH.02.CHUA_DEN_VACH' : 'SH.DS.CHUA_DEN_VACH';
    const { page, problems } = await fresh(path);
    await roadSetOff(page, [id]);
    const d = await roadStop(page, { allowed: [id], pressAt: 1.8 });
    if (!d.penalties.split(' ').includes(id)) throw new Error(`${id} did not fire: ${JSON.stringify(d)}`);
    if (d.lastPenalty !== id) throw new Error(`data-last-penalty is "${d.lastPenalty}", not ${id}`);
    if (d.lastPenaltyPoints !== '5') throw new Error(`data-last-penalty-points is "${d.lastPenaltyPoints}", not 5`);
    const rule = ruleset.rules.find((r) => r.id === id);
    if (d.lastPenaltyQuote !== rule.source.quote) throw new Error(`data-last-penalty-quote is not the ruleset's quote`);
    const shown = await page.$eval(`[data-penalty="${id}"] blockquote`, (e) => e.textContent);
    if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
    const points = await page.$eval(`[data-penalty="${id}"] .points`, (e) => e.textContent);
    if (points !== '−5 điểm') throw new Error(`the HUD says "${points}", not "−5 điểm"`);
    console.log(`     ${figure}: ${id} at A ${d.stopA} m, ${points}`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });
}

await check('bài 11 clean run: right signal across the finish line, then a stop, score 100', async () => {
  const { page, problems } = await fresh('/thi/11');
  // No stop aid here: the line that ends bài 11 charges no distance A.
  const d0 = await readStage(page);
  if (d0.aidKey !== '') throw new Error(`bài 11 should have no stop aid, but data-aid-key is "${d0.aidKey}"`);
  await roadSetOff(page, []);
  const end = await roadGo(page, { allowed: [], cond: `Number(d.bumper) > 21.3`, signal: true });
  if (end.score !== '100' || end.penalties !== '') throw new Error(`not a clean finish: ${JSON.stringify(end)}`);
  if (end.zone !== 'past-finish') throw new Error(`zone is "${end.zone}" past the finish line`);
  console.log(`     bài 11: crossed with the right signal, zone ${end.zone}, score ${end.score}`);
  if (problems.length) throw new Error(problems.join('\n'));
  const clean = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
  const exerciseId = Buffer.from(clean.trace, 'base64')[7];
  if (exerciseId !== 11) throw new Error(`the trace header carries exercise id ${exerciseId}, not 11`);
  await page.close();
  await check('the bài 11 trace replays to the hash the page shows', () => replays(clean));
});

await check('bài 11 crossing without the right signal: SH.KT.KHONG_XI_NHAN_PHAI, −5, quote shown', async () => {
  const id = 'SH.KT.KHONG_XI_NHAN_PHAI';
  const { page, problems } = await fresh('/thi/11');
  await roadSetOff(page, [id]);
  const end = await roadGo(page, { allowed: [id], cond: `Number(d.bumper) > 21.3`, signal: false });
  if (!end.penalties.split(' ').includes(id)) throw new Error(`${id} did not fire: ${JSON.stringify(end)}`);
  if (end.lastPenalty !== id) throw new Error(`data-last-penalty is "${end.lastPenalty}", not ${id}`);
  if (end.score !== '95') throw new Error(`score ${end.score}, expected 95`);
  const rule = ruleset.rules.find((r) => r.id === id);
  const shown = await page.$eval(`[data-penalty="${id}"] blockquote`, (e) => e.textContent);
  if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
  console.log(`     bài 11: ${id} fired, ${end.lastPenaltyPoints} point(s)`);
  if (problems.length) throw new Error(problems.join('\n'));
  await page.close();
});


// ---- bài 5: the signalled junction -----------------------------------------------------------

/**
 * The seeds whose arrival at the line is red and green, at this learner's own pace.
 *
 * Not chosen by eye. The seed sets the light's phase (`phase_offset`, the seed modulo the cycle) and
 * the colour is measured on the tick the car reaches the line, in the browser, because the tick the
 * car reaches it depends on how the learner sets off. Seed 1 is red with 5.2 s left — enough for the
 * aid to count down — and seed 400 is green with 24.6 s left, so the 20 s clock is nearly all ahead of
 * the car on arrival. `driveJunction` asserts the colour it actually met, so a seed that drifts fails
 * here rather than quietly testing the wrong arrival.
 */
const JUNCTION_RED_SEED = 1;
const JUNCTION_GREEN_SEED = 400;

/** The learner's polling period on this page, ms. */
const JUNCTION_POLL_MS = 40;
/** How long the learner takes to act on a sentence they have read, ms. */
const JUNCTION_REACT_MS = 300;
/**
 * How long the same learner takes to act on the stop aid, ms — the middle of the band the aid's own
 * lead is built for (`stopAid.ts`'s `LEAD_MS`), not this file's 300 ms. A person's reaction to a bar
 * and to a sentence is the same 150–350 ms; pressing 300 ms after "bấm ngay" spends 50 ms of the slack
 * the aid keeps, and 9 mm past the line is what that costs.
 */
const JUNCTION_AID_REACT_MS = 250;

/**
 * Drive bài 5 the way the page teaches it: read the advice line and act on it, nothing else.
 *
 * This is what the Supervisor's hand check does, and it is the point of the page: there is no hidden
 * pace controller and no hidden signal press here. Every key is asked for by a sentence the learner
 * could read, and `data-cue` supplies the steering key the same way it does for bài 4 and bài 6.
 * `steerOut` is the one exception, and it is not a driver: it holds a wrong wheel on purpose, so the
 * lane-edge failure can be provoked.
 */
async function driveJunction(page, { allowed, arrive, pressAid = true, steerOut = false, automatic = false, end = `d.phase === 'done' || d.disqualified === 'yes'` }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
  if (automatic) {
    // The automatic checklist: D, then P. No clutch, no gear number.
    for (let i = 0; i < 12 && (await readStage(page)).gear !== '1'; i += 1) {
      await key.press('KeyD');
      await page.waitForTimeout(120);
    }
    await until(page, 'gear D', `d.gear === '1'`, allowed);
  } else {
    await key.down('Space');
    await until(page, 'clutch down', `Number(d.clutch) > 0.99`, allowed);
    // The core ignores a gear key on a tick when the clutch was not already fully down (`ShiftGear`
    // reads the pedal it saw last tick), so a press landing on the way down does nothing. Press, then
    // look: retrying is what a learner does when the lever does not go in the first time.
    for (let i = 0; i < 12 && (await readStage(page)).gear !== '1'; i += 1) {
      await key.press('Digit1');
      await page.waitForTimeout(120);
    }
    await until(page, 'gear 1', `d.gear === '1'`, allowed);
  }
  await key.press('KeyP');
  await until(page, 'handbrake off', `d.handbrake === 'no'`, allowed);
  await key.up('Space');

  const held = new Set();
  const down = async (code) => { if (!held.has(code)) { held.add(code); await key.down(code); } };
  const up = async (code) => { if (held.has(code)) { held.delete(code); await key.up(code); } };
  /** A key press the line asked for, made once per distinct sentence. */
  let seen = '';
  /** The line acts after REACT_MS, as a person reading it does. */
  const REACT_MS = JUNCTION_REACT_MS;
  // The bar's own countdown: the manual section's measured 250 ms band, and the 300 ms line the
  // automatic's sentences are read at (its slower car builds less speed past the bar, so the same
  // lead is a wider band here).
  const aidReact = automatic ? AUTO_REACTION_MS : JUNCTION_AID_REACT_MS;
  const pending = [];
  const later = (fn, reactMs = REACT_MS) => pending.push({ at: Date.now() + reactMs, fn });

  const deadline = Date.now() + WAIT_MS;
  let braked = false;
  let met = null;
  let heldDir = null;
  while (Date.now() < deadline) {
    const d = await readStage(page);
    const advice = (await page.$eval('.advice', (el) => el.textContent ?? '')).trim();
    const cue = await page.$eval('.advice', (el) => el.dataset.cue ?? '');
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} at zone ${d.zone}\nstate: ${JSON.stringify(d)}`);
    if (met === null && Number(d.lineGap) < 0.8) met = d.light;
    if (await page.evaluate((c) => new Function('d', `return (${c});`)(document.querySelector('#stage').dataset), end)) break;

    // The aid is the one thing that is not a sentence: the bar's own countdown, which the line tells
    // the learner to follow ("phanh khi thanh đếm ngược báo").
    if (pressAid && !braked && d.aidNow === '1') {
      later(async () => {
        await up('ArrowUp');
        if (!automatic) await down('Space');
        await down('ArrowDown');
      }, aidReact);
      braked = true;
      console.log(`     the bar said now at ${d.aidGapMm} mm (light ${d.light}, gap ${d.lineGap} m, speed ${d.speed} m/s)`);
    }

    // Everything else is the sentence. Each branch is one of the page's own instructions.
    if (advice !== seen) {
      seen = advice;
      if (advice.includes('bấm 1 để vào số')) later(async () => { await down('Space'); await key.press('Digit1'); });
      else if (advice.includes('Bấm P để nhả')) later(async () => { await key.press('KeyP'); await up('Space'); });
      else if (advice.includes('xi nhan phải (W)')) {
        if (d.signal !== 'right') later(() => key.press('KeyW'));
      } else if (advice.includes('nhả ga ↑ ra')) later(() => up('ArrowUp'));
      else if (advice.includes('Giữ ga ↑') || advice.includes('giữ ga ↑')) later(() => down('ArrowUp'));
      else if (advice.includes('phanh ↓')) later(() => down('ArrowDown'));
      if (advice.includes('nhả phanh cho xe đi')) later(async () => { await up('ArrowDown'); await up('Space'); });
      if (advice.includes('Đánh lái → sang phải')) later(() => down('ArrowRight'));
      else if (advice.includes('Trả lái ← lại')) later(async () => { await up('ArrowRight'); await down('ArrowLeft'); });
      else if (advice.includes('thả phím ← →') || advice.includes('Giữ lái cho thẳng')) later(async () => { await up('ArrowLeft'); await up('ArrowRight'); });
    }
    // The steering key is the cue, as on the figures: one key, held or let go.
    const wantDir = steerOut ? 'ArrowRight' : cue === 'left' ? 'ArrowLeft' : cue === 'right' ? 'ArrowRight' : null;
    if (wantDir !== heldDir) {
      if (heldDir) await up(heldDir);
      heldDir = wantDir;
      if (heldDir) await down(heldDir);
    }
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (Date.now() >= pending[i].at) await pending.splice(i, 1)[0].fn();
    }
    await page.waitForTimeout(JUNCTION_POLL_MS);
  }
  for (const code of [...held]) await key.up(code);
  for (const { fn } of pending.splice(0)) void fn;
  // A run that provokes the lane edge is steered off the line on purpose and may be suspended before
  // it reaches the stop line at all, so it has no arrival colour to check.
  if (!steerOut && met !== arrive) {
    throw new Error(`this seed met ${met} at the line, the run is a ${arrive} arrival\nstate: ${JSON.stringify(await readStage(page))}`);
  }
  await until(page, 'end of the junction', end, allowed);
  const endState = await readStage(page);
  return { ...endState, met };
}

let junctionRed = null;
{
  await check('bài 5 arriving on red: stop inside A, wait, go on green, signal, turn — score 100', async () => {
    const { page, problems } = await fresh(`/thi/5?seed=${JUNCTION_RED_SEED}`);
    const d = await driveJunction(page, { allowed: [], arrive: 'red' });
    console.log(`     met ${d.met}; A ${d.stopA} m, clock ${d.clockMs} ms at the end, zone ${d.zone}`);
    if (Number(d.stopA) < 0 || Number(d.stopA) > ruleset.junction.max_a_m) throw new Error(`A ${d.stopA} m is outside the window`);
    if (d.penalties !== '' || d.score !== '100' || d.disqualified !== 'no') throw new Error(`not a clean junction: ${JSON.stringify(d)}`);
    if (problems.length) throw new Error(problems.join('\n'));
    junctionRed = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
    await page.close();
  });

  await check('the bài 5 red trace replays to the hash the page shows', () => replays(junctionRed));

  await check('bài 5 arriving on green: no stop, straight into the turn — score 100', async () => {
    const { page, problems } = await fresh(`/thi/5?seed=${JUNCTION_GREEN_SEED}`);
    const d = await driveJunction(page, { allowed: [], arrive: 'green' });
    console.log(`     met ${d.met}; no stop, clock ${d.clockMs} ms, zone ${d.zone}`);
    if (d.penalties !== '' || d.score !== '100' || d.disqualified !== 'no') throw new Error(`not a clean junction: ${JSON.stringify(d)}`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });

  await check('bài 5 through the red light: SH.05.VUOT_DEN_DO, −10, quote shown', async () => {
    const { page, problems } = await fresh(`/thi/5?seed=${JUNCTION_RED_SEED}`);
    // The learner who ignores the light and drives on: the aid is never taken, so the car goes
    // through on red and the core charges it as the bumper enters the junction.
    const d = await driveJunction(page, { allowed: ['SH.05.VUOT_DEN_DO', 'SH.05.KHONG_XI_NHAN'], arrive: 'red', pressAid: false });
    if (!d.penalties.split(' ').includes('SH.05.VUOT_DEN_DO')) {
      throw new Error(`the red light was not charged: ${JSON.stringify(d)}`);
    }
    const rule = ruleset.rules.find((r) => r.id === 'SH.05.VUOT_DEN_DO');
    const shown = await page.$eval('[data-penalty="SH.05.VUOT_DEN_DO"] blockquote', (e) => e.textContent);
    if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
    const pts = await page.$eval('[data-penalty="SH.05.VUOT_DEN_DO"] .points', (e) => e.textContent);
    if (!pts.includes(String(rule.penalty.points))) throw new Error(`points shown "${pts}" for ${rule.penalty.points}`);
    if (d.lastPenalty === 'SH.05.VUOT_DEN_DO' && d.lastPenaltyQuote !== rule.source.quote) {
      throw new Error('#stage quote does not match the panel');
    }
    console.log(`     charged ${d.penalties} at zone ${d.zone}, score ${d.score}`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });

  await check('bài 5 over the lane edge: SH.05.SAI_VACH_KE, đình chỉ, quote shown', async () => {
    const { page, problems } = await fresh(`/thi/5?seed=${JUNCTION_GREEN_SEED}`);
    // The learner who steers out of the lane: past the line the wheel is held hard right through the
    // arc, which takes the outer front wheel onto the boundary line.
    const d = await driveJunction(page, { allowed: ['SH.05.SAI_VACH_KE'], arrive: 'green', steerOut: true });
    if (!d.penalties.split(' ').includes('SH.05.SAI_VACH_KE')) {
      throw new Error(`the boundary line was not charged: ${JSON.stringify(d)}`);
    }
    if (d.lastPenaltyPoints !== 'DISQUALIFY') throw new Error(`đình chỉ not shown: ${d.lastPenaltyPoints}`);
    const rule = ruleset.rules.find((r) => r.id === 'SH.05.SAI_VACH_KE');
    const shown = await page.$eval('[data-penalty="SH.05.SAI_VACH_KE"] blockquote', (e) => e.textContent);
    if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
    console.log(`     charged ${d.penalties} at zone ${d.zone}, disqualified ${d.disqualified}`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });
}

// ---- bài 10: the gear-change road ------------------------------------------------------------
// The learner reads the advice line and the cue word, and nothing else: `data-cue` says which key
// group is asked for, the sentence says which keys and what number. The reaction is a person's, and
// a press that did not take (the clutch was not down yet) is made again while the line still asks.
// `skip` is the mistake a variant makes: 'shift2' is a learner who reads the sentence's "giữ ga ↑ cho tới
// 30 km/h" but misses its "bấm 2", so the car runs the first zone in first gear at a speed the sentence
// named — wrong gear, right speed, which is SH.SO.SAI_SO and not SAI_CA_HAI. 'none' follows the words.
const GEAR_REACTION_MS = 300;
async function driveGearPage(page, { allowed, skip = 'none', maxMs = 180_000, automatic = false, end = `d.phase === 'done' || d.disqualified === 'yes'` }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
  const held = new Set();
  const hold = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await key.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await key.down(k); held.add(k); }
  };
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('.advice');
      return { cue: el.dataset.cue ?? '', text: el.textContent ?? '' };
    });
  // The keys a cue word asks for: the page's own vocabulary, read as words a learner reads. An
  // automatic's `ready` asks for D (a tap, below), and the box shifts itself, so no word asks for a
  // gear number and no word asks for a clutch.
  const keysOf = (cue) =>
    automatic
      ? cue === 'runup' || cue === 'pull' ? ['ArrowUp'] : cue === 'brake' ? ['ArrowDown'] : []
      : cue === 'runup' || cue === 'pull' ? ['ArrowUp'] : cue === 'brake' ? ['ArrowDown'] : cue === 'ready' || cue === 'shift2' || cue === 'shift1' ? ['Space'] : [];
  /** Every sentence the learner read, for the automatic's "no stall words" check. */
  const texts = [];
  let seen = '';
  let lastTap = new Map();
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const d = await readStage(page);
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} at bumper ${d.bumper}\nstate: ${JSON.stringify(d)}`);
    if (await page.evaluate((c) => new Function('d', `return (${c});`)(document.querySelector('#stage').dataset), end)) break;
    const r = await read();
    const wantGear = r.cue === 'ready' || r.cue === 'shift1' ? 1 : r.cue === 'shift2' ? 2 : 0;
    const tap = automatic ? (wantGear === 1 ? 'KeyD' : null) : wantGear === 1 ? 'Digit1' : wantGear === 2 ? 'Digit2' : null;
    // The mistake: the up-shift's gear word is read but its "bấm 2" is missed, so the car goes through
    // the first zone in first gear. The throttle is held to a speed just above the judged 24 and no
    // further — first gear's own 4 000 rpm line is 31 km/h, and a learner who did read "trên 24 km/h"
    // would sit between the two, which is what makes this a wrong-gear charge and not an over-rev.
    const blindToShift = skip === 'shift2' && r.cue === 'shift2';
    if (blindToShift) {
      if (seen !== 'blind') {
        seen = 'blind';
        console.log(`     the line says [${r.cue} (gear tap missed)] at ${d.bumper} m: ${r.text.trim().slice(0, 120)}`);
        await page.waitForTimeout(GEAR_REACTION_MS);
      }
      await hold(Number(d.speed) * 3.6 >= 27 ? new Set() : new Set(['ArrowUp']));
      await page.waitForTimeout(50);
      continue;
    }
    const asked = r.cue;
    if (asked !== seen) {
      seen = asked;
      texts.push(r.text);
      console.log(`     the line says [${asked}] at ${d.bumper} m: ${r.text.trim().slice(0, 120)}`);
      await page.waitForTimeout(GEAR_REACTION_MS);
      await hold(new Set(automatic && skip === 'throttle' ? [] : keysOf(asked)));
    }
    // The gear and the handbrake are taps, and a tap that did not take is made again one reaction on.
    if (tap && wantGear && d.gear !== String(wantGear) && (automatic || Number(d.clutch) > 0.95) && Date.now() - (lastTap.get(tap) ?? 0) > GEAR_REACTION_MS + 300) {
      lastTap.set(tap, Date.now());
      await page.waitForTimeout(GEAR_REACTION_MS);
      await key.press(tap);
    }
    if (r.cue === 'ready' && d.handbrake === 'yes' && Date.now() - (lastTap.get('KeyP') ?? 0) > GEAR_REACTION_MS + 300) {
      lastTap.set('KeyP', Date.now());
      await page.waitForTimeout(GEAR_REACTION_MS);
      await key.press('KeyP');
    }
    await page.waitForTimeout(50);
  }
  await hold(new Set());
  await until(page, 'the run to end', end, allowed);
  return { ...(await readStage(page)), texts };
}

{
  let gearClean;
  await check('bài 10 clean run from the advice line alone: gear 2 above 24 km/h at sign 2, gear 1 below 24 at sign 3, 100', async () => {
    const { page, problems } = await fresh('/thi/10');
    const d0 = await readStage(page);
    if (d0.exercise !== '10') throw new Error(`the page says exercise ${d0.exercise}`);
    if (d0.penalties !== '') throw new Error(`the page starts with penalties: ${d0.penalties}`);
    const d = await driveGearPage(page, { allowed: [] });
    if (d.phase !== 'done' || d.disqualified !== 'no' || d.score !== '100' || d.penalties !== '') {
      throw new Error(`not a clean finish: ${JSON.stringify(d)}`);
    }
    // The journey the brief names, from the page's own published numbers: the card counts down to the
    // sign the bumper is approaching, and all three are behind the car when the run ends.
    const signs = await page.evaluate(() => ({
      next: document.querySelector('#stage').dataset.nextSign,
      passed: document.querySelector('#stage').dataset.signsPassed,
    }));
    if (signs.passed !== '3') throw new Error(`${signs.passed} of the three signs were passed, not 3`);
    const card = await page.$eval('[data-cell="sign"] [data-part="limit"]', (el) => el.textContent);
    console.log(`     bài 10: score ${d.score}, 3 signs passed, card says "${card}"`);
    if (problems.length) throw new Error(problems.join('\n'));
    gearClean = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
    const exerciseId = Buffer.from(gearClean.trace, 'base64')[7];
    if (exerciseId !== 10) throw new Error(`the trace header carries exercise id ${exerciseId}, not 10`);
    await page.close();
  });

  await check('the bài 10 trace replays to the hash the page shows', () => replays(gearClean));

  // The failure path the brief names: the learner never shifts up, so the first zone is run in first
  // gear. The page must name the rule, its points and the ruleset's own quotation.
  await check('bài 10 never shifting up: SH.SO.SAI_SO at sign 2, −5, quote shown', async () => {
    const id = 'SH.SO.SAI_SO';
    const { page, problems } = await fresh('/thi/10');
    const d = await driveGearPage(page, { allowed: [id], skip: 'shift2' });
    if (!d.penalties.split(' ').includes(id)) throw new Error(`${id} did not fire: ${JSON.stringify(d)}`);
    if (d.lastPenalty !== id) throw new Error(`data-last-penalty is "${d.lastPenalty}", not ${id}`);
    if (d.lastPenaltyPoints !== '5') throw new Error(`data-last-penalty-points is "${d.lastPenaltyPoints}", not 5`);
    if (d.score !== '95') throw new Error(`score ${d.score}, expected 95`);
    const rule = ruleset.rules.find((r) => r.id === id);
    if (d.lastPenaltyQuote !== rule.source.quote) throw new Error('data-last-penalty-quote is not the ruleset\u2019s quote');
    const shown = await page.$eval(`[data-penalty="${id}"] blockquote`, (e) => e.textContent);
    if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
    const points = await page.$eval(`[data-penalty="${id}"] .points`, (e) => e.textContent);
    if (points !== '−5 điểm') throw new Error(`the HUD says "${points}", not "−5 điểm"`);
    console.log(`     bài 10 without the up-shift: ${id} at sign 2, ${points}, score ${d.score}`);
    if (problems.length) throw new Error(problems.join('\n'));
    await page.close();
  });
}

  // ---- bài 4 and bài 6: the figure pages ------------------------------------------------------
  for (const lesson of [4, 6]) {
    const page4 = `/thi/${lesson}`;
    const figure = `bài ${lesson}`;
    let figClean;
    await check(`${figure} clean run: follow the advice line, no line touched, score 100`, async () => {
      const { page, problems } = await fresh(page4);
      await driveFigure(page, { allowed: [] });
      const d = await readStage(page);
      if (d.exercise !== String(lesson)) throw new Error(`the page says exercise ${d.exercise}`);
      if (d.phase !== 'done' || d.disqualified !== 'no') throw new Error(`not finished cleanly: ${JSON.stringify(d)}`);
      if (d.score !== '100') throw new Error(`score ${d.score}, penalties ${d.penalties}`);
      if (d.contact !== '0000') throw new Error(`a wheel finished on contact ${d.contact}`);
      console.log(`     ${figure}: finished ${d.courseLen} m of figure, last lateral offset ${d.lateral} m, clock ${d.clock} s`);
      // The inset is the picture of where the wheels are; it must be on the page and painted.
      const inset = await page.$eval('canvas[data-inset]', (c) => ({ w: c.width, h: c.height }));
      if (!(inset.w > 0 && inset.h > 0)) throw new Error(`the inset canvas has no size: ${JSON.stringify(inset)}`);
      if (problems.length) throw new Error(problems.join('\n'));
      figClean = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
      const exerciseId = Buffer.from(figClean.trace, 'base64')[7];
      if (exerciseId !== lesson) throw new Error(`the trace header carries exercise id ${exerciseId}, not ${lesson}`);
      await page.close();
    });

    await check(`the ${figure} trace replays to the hash the page shows`, () => replays(figClean));

    // One failure path per figure, taken by the learner nobody told to steer: the page must name the
    // rule, its points or "Đình chỉ", and print the ruleset's own quotation.
    await check(`${figure} with nobody steering: a line is hit, the page names the code and prints the quote`, async () => {
      const { page, problems } = await fresh(page4);
      const key = page.keyboard;
      await pageReady(page);
      await key.press('KeyX');
      await until(page, 'enter the car', `d.entered === 'yes'`, []);
      await key.press('KeyE');
      await until(page, 'engine on', `d.engineOn === 'yes'`, []);
      const tick = Number((await readStage(page)).tick);
      await key.down('Space');
      await until(page, 'clutch pressed down', `Number(d.tick) > ${tick} + 5 && Number(d.clutch) > 0.99`, []);
      await key.press('Digit1');
      await until(page, 'gear 1', `d.gear === '1'`, []);
      await key.press('KeyP');
      await until(page, 'handbrake released', `d.handbrake === 'no'`, []);
      await key.up('Space');
      // Only the throttle: the wheel is never touched, which is the whole mistake.
      const code = lesson === 4 ? 'SH.04.DE_VACH' : 'SH.06.DE_VACH';
      await until(page, `${figure}: a wheel on the paint`, `d.penalties.includes('${code}')`, [code, 'SH.X.VIA_HE']);
      const d = await readStage(page);
      const rule = ruleset.rules.find((r) => r.id === code);
      const shown = await page.$eval(`[data-penalty="${code}"] blockquote`, (e) => e.textContent);
      if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
      const shownPoints = await page.$eval(`[data-penalty="${code}"] .points`, (e) => e.textContent);
      const want = `−${rule.penalty.points} điểm`;
      if (shownPoints !== want) throw new Error(`the HUD says "${shownPoints}", the ruleset says ${want}`);
      console.log(`     ${figure} without steering: ${code} (${shownPoints}) at ${d.progress} m, contact ${d.contact}`);
      if (problems.length) throw new Error(problems.join('\n'));
      await page.close();
    });
  }

  // Bài 7 and bài 8: a clean run from the advice line alone, and the core's own rule named with its quote.
  {
    for (const lesson of [7, 8]) {
      const figure = `bài ${lesson}`;
      await check(`${figure} clean run from the advice line alone: score 100 and the finish signal`, async () => {
        const { page, problems } = await fresh(`/thi/${lesson}`);
        await driveParkPage(page, { allowed: [] });
        const d = await readStage(page);
        const listed = await page.$$eval('[data-penalty]', (els) => els.map((e) => e.dataset.penalty));
        if (d.phase !== 'done' || d.score !== '100' || d.penalties !== '' || listed.length) {
          throw new Error(`not a clean finish: ${JSON.stringify(d)} listed=${listed}`);
        }
        if (problems.length) throw new Error(problems.join('\n'));
        await page.close();
      });

      await check(`${figure} with the wheel never turned: the core's own rule named with its quote (and points)`, async () => {
        const { page, problems } = await fresh(`/thi/${lesson}`);
        const key = page.keyboard;
        await pageReady(page);
        await key.press('KeyX');
        await until(page, 'enter the car', `d.entered === 'yes'`, []);
        await key.press('KeyE');
        await until(page, 'engine on', `d.engineOn === 'yes'`, []);
        const tick = Number((await readStage(page)).tick);
        await key.down('Space');
        await until(page, 'clutch pressed down', `Number(d.tick) > ${tick} + 5 && Number(d.clutch) > 0.99`, []);
        await key.press('Digit1');
        await until(page, 'gear 1', `d.gear === '1'`, []);
        await key.press('KeyP');
        await until(page, 'handbrake released', `d.handbrake === 'no'`, []);
        // Feet off: the car creeps on its own, straight on, which is where the line says to turn.
        await key.up('Space');
        // Bài 7's lane runs on past the area's far line (paint, 5 points); bài 8's leaves the area (disqualified).
        const code = lesson === 7 ? 'SH.GHEP.DE_VACH' : 'SH.GHEP.SAI_HINH';
        await until(page, `${figure}: a wheel on the paint`, `d.penalties.includes('${code}')`, [code, 'SH.GHEP.DE_VACH_KEO_DAI', 'SH.X.VIA_HE']);
        const rule = ruleset.rules.find((r) => r.id === code);
        const shown = await page.$eval(`[data-penalty="${code}"] blockquote`, (e) => e.textContent);
        if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
        if (rule.penalty.kind === 'POINTS') {
          const shownPoints = await page.$eval(`[data-penalty="${code}"] .points`, (e) => e.textContent);
          const want = `−${rule.penalty.points} điểm`;
          if (shownPoints !== want) throw new Error(`the HUD says "${shownPoints}", the ruleset says ${want}`);
        }
        if (problems.length) throw new Error(problems.join('\n'));
        await page.close();
      });
    }
  }

  // ---- số tự động: the owner's journey, all 11 bài, screen only, 300 ms late --------------------
  //
  // Every page is opened with `?so=tu-dong`, so the switch, `data-so` and `exerciseFor(lesson, true)`
  // are the page's own; #stage must say `data-so="tu-dong"` and the trace header's exercise id must be
  // the lesson, as the manual sections check. The learner is the same one the manual sections use,
  // with the automatic set-off (D, P, no clutch, no gear number) and no throttle where the car creeps.
  // The two automatic-only faults come after the clean grid: bài 3's rollback and bài 10's speed row.
  {
    const autoStage = async (page, lesson) => {
      const d = await readStage(page);
      if (d.so !== 'tu-dong') throw new Error(`data-so is "${d.so}", not "tu-dong"`);
      if (d.exercise !== String(lesson)) throw new Error(`the page says exercise ${d.exercise}, not ${lesson}`);
      if (d.score !== '100' || d.penalties !== '') throw new Error(`the page starts at score ${d.score} with [${d.penalties}]`);
      return d;
    };
    /** One clean automatic journey: `run(page)` drives it; then the page and the trace must agree. */
    const autoOne = async (lesson, run, { path = `/thi/${lesson}?so=tu-dong`, after } = {}) => {
      const { page, problems } = await fresh(path);
      await autoStage(page, lesson);
      await run(page);
      const d = await readStage(page);
      if (d.phase !== 'done' || d.disqualified !== 'no' || d.score !== '100' || d.penalties !== '') {
        throw new Error(`not a clean automatic finish: ${JSON.stringify(d)}`);
      }
      const trace = await page.evaluate(() => window.__thi.trace());
      const exerciseId = Buffer.from(trace, 'base64')[7];
      // Bài 1's seed word carries exercise id 0 (the core's "xuất phát" slot is 0, the page's lesson
      // is 1); every other lesson's byte is its own number.
      const wantId = lesson === 1 ? 0 : lesson;
      if (exerciseId !== wantId) throw new Error(`the trace header carries exercise id ${exerciseId}, not ${wantId}`);
      console.log(`     số tự động bài ${lesson}: score ${d.score}, exercise id ${exerciseId}`);
      if (after) await after(page, d);
      if (problems.length) throw new Error(problems.join('\n'));
      await page.close();
    };

    await check('số tự động bài 1: the checklist alone, 300 ms, score 100', () =>
      autoOne(1, (page) => drive(page, { belt: true, allowed: [], automatic: true }), { path: '/thi?so=tu-dong' }));

    for (const lesson of [2, 9]) {
      await check(`số tự động bài ${lesson}: stop inside A on the countdown, go on past the line, score 100`, () =>
        autoOne(lesson, async (page) => {
          await roadSetOff(page, [], true);
          const atStop = await roadStop(page, { allowed: [], automatic: true });
          if (Number(atStop.stopA) < 0 || Number(atStop.stopA) > ruleset.road.max_a_m) {
            throw new Error(`A ${atStop.stopA} m is outside the window`);
          }
          console.log(`     số tự động bài ${lesson}: A ${atStop.stopA} m of ${ruleset.road.max_a_m} m`);
          // The exercise ends at the stop line + `end_past_line_m`; the page stops stepping there, so
          // the learner watches the phase itself rather than a distance it will never reach.
          await roadGo(page, { allowed: [], cond: `d.phase === 'done'`, automatic: true });
        }));
    }

    await check('số tự động bài 3: pulse and brake from the page cues, launch with the foot brake, score 100', () =>
      autoOne(3, async (page) => {
        await driveHill(page, { finish: 'pull-away', allowed: [], automatic: true });
        const d = await readStage(page);
        if (Number(d.stopA) < 0 || Number(d.stopA) > ruleset.hill.max_a_m) throw new Error(`A ${d.stopA} m is outside the window`);
        if (Number(d.rollback) > ruleset.hill.max_rollback_m) throw new Error(`rolled back ${d.rollback} m`);
        console.log(`     số tự động bài 3: A ${d.stopA} m, rollback ${d.rollback} m`);
      }));

    for (const lesson of [4, 6]) {
      await check(`số tự động bài ${lesson}: follow the page cue 300 ms late, no line touched, score 100`, () =>
        autoOne(lesson, async (page) => {
          await driveFigure(page, { allowed: [], automatic: true });
          const d = await readStage(page);
          if (d.contact !== '0000') throw new Error(`a wheel finished on contact ${d.contact}`);
        }));
    }

    await check('số tự động bài 5: red arrival, stop inside A, wait, signal and turn, score 100', () =>
      autoOne(5, (page) => driveJunction(page, { allowed: [], arrive: 'red', automatic: true }), {
        path: `/thi/5?seed=${JUNCTION_RED_SEED}&so=tu-dong`,
      }));

    for (const lesson of [7, 8]) {
      await check(`số tự động bài ${lesson}: the advice line alone brings the car into the bay, score 100`, () =>
        autoOne(lesson, (page) => driveParkPage(page, { allowed: [], automatic: true })));
    }

    {
      // The ruleset's own assumption, which the page must show word for word: both texts disagree and
      // the learner is told which one this page follows.
      const assumption = ruleset.assumptions.find((a) => a.field === 'gear_automatic');
      if (!assumption) throw new Error('the ruleset has no assumptions.gear_automatic');
      await check('số tự động bài 10: the advice line alone scores 100; the speed-only note quotes both texts; no stall words', () =>
        autoOne(10, async (page) => {
          const run = await driveGearPage(page, { allowed: [], automatic: true });
          const d = await readStage(page);
          if (d.signsPassed !== '3') throw new Error(`${d.signsPassed} of the three signs passed`);
          const note = await page.$eval('[data-note="gear-automatic"]', (el) => el.textContent);
          if (!note.includes(assumption.value) || !note.includes(assumption.why)) {
            throw new Error('the gear-automatic note is not the ruleset\u2019s own two texts');
          }
          // The stall words are not offered: no clutch pedal, no clutch or gear-number key, and no
          // sentence in the whole run names a clutch or a stall.
          const clutchPedals = await page.$$eval('[data-pedal="clutch"]', (els) => els.length);
          if (clutchPedals) throw new Error('the automatic page draws a clutch pedal');
          const keys = await page.$$eval('.hud-keys li .key', (els) => els.map((e) => e.textContent));
          if (!keys.includes('D, N, R')) throw new Error(`the legend does not name the selector: ${keys}`);
          if (keys.some((k) => k.includes('Space') || k.includes('Côn') || k.includes('1–5'))) {
            throw new Error(`the legend offers a clutch or a gear number: ${keys}`);
          }
          const stall = run.texts.filter((t) => /côn|chết máy/i.test(t));
          if (stall.length) throw new Error(`the automatic advice offered a clutch or a stall: ${stall[0]}`);
          console.log(`     số tự động bài 10: note quotes both texts, ${run.texts.length} sentences, none about a clutch`);
        }));
    }

    // The automatic's own rollback fault: stopped inside A, the foot brake lets go and the learner
    // never reaches for the throttle. Nothing holds the car; the grade rolls it back past 500 mm.
    await check('số tự động bài 3 fault: brake let go with nothing holding the car → SH.03.TUT_DOC, đình chỉ, quote shown', async () => {
      const { page, problems } = await fresh('/thi/3?so=tu-dong');
      await autoStage(page, 3);
      await driveHill(page, { finish: 'roll-back', allowed: ['SH.03.TUT_DOC'], automatic: true });
      const d = await readStage(page);
      if (!d.penalties.split(' ').includes('SH.03.TUT_DOC')) throw new Error(`SH.03.TUT_DOC did not fire: ${JSON.stringify(d)}`);
      if (d.disqualified !== 'yes') throw new Error('the rollback did not suspend the run');
      const rule = ruleset.rules.find((r) => r.id === 'SH.03.TUT_DOC');
      const shown = await page.$eval('[data-penalty="SH.03.TUT_DOC"] blockquote', (e) => e.textContent);
      if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
      const points = await page.$eval('[data-penalty="SH.03.TUT_DOC"] .points', (e) => e.textContent);
      if (points !== 'Đình chỉ') throw new Error(`the HUD says "${points}", not "Đình chỉ"`);
      console.log(`     số tự động bài 3 fault: ${d.penalties}, rollback ${d.rollback} m`);
      if (problems.length) throw new Error(problems.join('\n'));
      await page.close();
    });

    // The automatic's own rule on bài 10: the box shifts itself, so only the speed is judged. A learner
    // who never takes the throttle creeps the whole road: SAI_TOC_DO once at sign 2, and neither of the
    // gear rows, because there is no gear for the learner to be wrong in.
    await check('số tự động bài 10 fault: no throttle → SH.SO.SAI_TOC_DO −5, and no SAI_SO / SAI_CA_HAI', async () => {
      const id = 'SH.SO.SAI_TOC_DO';
      const { page, problems } = await fresh('/thi/10?so=tu-dong');
      await autoStage(page, 10);
      const d = await driveGearPage(page, { allowed: [id], skip: 'throttle', automatic: true });
      const fired = d.penalties.split(' ').filter(Boolean);
      if (fired.length !== 1 || fired[0] !== id) throw new Error(`expected only ${id}, charged [${fired}]`);
      if (d.lastPenalty !== id) throw new Error(`data-last-penalty is "${d.lastPenalty}", not ${id}`);
      if (d.lastPenaltyPoints !== '5') throw new Error(`data-last-penalty-points is "${d.lastPenaltyPoints}", not 5`);
      if (d.score !== '95') throw new Error(`score ${d.score}, expected 95`);
      const rule = ruleset.rules.find((r) => r.id === id);
      if (d.lastPenaltyQuote !== rule.source.quote) throw new Error('data-last-penalty-quote is not the ruleset\u2019s quote');
      const shown = await page.$eval(`[data-penalty="${id}"] blockquote`, (e) => e.textContent);
      if (shown !== rule.source.quote) throw new Error(`quote shown "${shown}" is not the ruleset's "${rule.source.quote}"`);
      const points = await page.$eval(`[data-penalty="${id}"] .points`, (e) => e.textContent);
      if (points !== '−5 điểm') throw new Error(`the HUD says "${points}", not "−5 điểm"`);
      console.log(`     số tự động bài 10 fault: ${id} at sign 2, ${points}, score ${d.score}`);
      if (problems.length) throw new Error(problems.join('\n'));
      await page.close();
    });

    await check('số tự động bài 11: right signal across the finish line, then a stop, score 100', () =>
      autoOne(11, async (page) => {
        await roadSetOff(page, [], true);
        await roadGo(page, { allowed: [], cond: `Number(d.bumper) > 21.3`, signal: true, automatic: true });
        const d = await readStage(page);
        if (d.zone !== 'past-finish') throw new Error(`zone is "${d.zone}" past the finish line`);
      }));
  }


// ---- sa hình liên hoàn: the 11 bài in one run, the result screen, the replay -------------------
//
// The same screen-only learner as the per-bài sections, bài after bài: each helper ends on the
// lesson the core swapped to instead of on `phase === 'done'`, so it never presses a key into the
// next bài. Two clean runs (số sàn and số tự động) and one fault run go in parallel pages, because
// a whole run is ~165 s of play; the homepage's chip is not what is under test.

/** What the result screen says, read from its data attributes and text. */
async function readLienHoanResult(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-run-result]');
    if (!el) return null;
    return {
      score: el.dataset.score,
      verdict: el.dataset.verdict,
      disqualified: el.dataset.disqualified,
      courseTick: el.dataset.courseTick,
      passLine: document.querySelector('[data-pass-line]')?.textContent ?? '',
      quote: document.querySelector('[data-scoring-quote]')?.textContent ?? '',
      faults: [...document.querySelectorAll('[data-fault]')].map((f) => ({
        id: f.dataset.fault,
        lesson: f.dataset.faultLesson,
        tick: f.dataset.faultTick,
        where: f.querySelector('[data-fault-where]')?.textContent ?? '',
        points: f.querySelector('.points')?.textContent ?? '',
        quote: f.querySelector('blockquote')?.textContent ?? '',
      })),
    };
  });
}

/** The whole run, bài 1 to bài 11, driven only through the page. */
async function driveWholeRun(page, { automatic = false, allowed = [], belt = true } = {}) {
  await drive(page, { belt, allowed, automatic, end: `d.lesson === '2'` });
  // Bài 2: the crosswalk road. The run starts it on the step after bài 1, so the road pair is its
  // own set-off, stop and go, exactly as the per-bài section drives them.
  await roadSetOff(page, allowed, automatic);
  await roadStop(page, { allowed, automatic });
  await roadGo(page, { allowed, cond: `Number(d.bumper) > 1.2`, automatic, stop: false, end: `d.lesson === '3'` });
  await driveHill(page, { finish: 'pull-away', allowed, automatic, end: `d.lesson === '4'` });
  await driveFigure(page, { allowed, automatic, end: `d.lesson === '5'` });
  await driveJunction(page, { allowed, arrive: 'red', automatic, end: `d.lesson === '6'` });
  await driveFigure(page, { allowed, automatic, end: `d.lesson === '7'` });
  await driveParkPage(page, { allowed, automatic, until: `d.lesson === '8'` });
  await driveParkPage(page, { allowed, automatic, until: `d.lesson === '9'` });
  await roadSetOff(page, allowed, automatic);
  await roadStop(page, { allowed, automatic });
  await roadGo(page, { allowed, cond: `Number(d.bumper) > 1.2`, automatic, stop: false, end: `d.lesson === '10'` });
  await driveGearPage(page, { allowed, automatic, end: `d.lesson === '11'` });
  await roadSetOff(page, allowed, automatic);
  await roadGo(page, { allowed, cond: `Number(d.bumper) > 21.3`, signal: true, automatic });
  await until(page, 'the result screen', `d.phase === 'done'`, allowed);
  await page.waitForSelector('[data-run-result]', { timeout: WAIT_MS });
  const final = await readStage(page);
  const result = await readLienHoanResult(page);
  const hash = await page.evaluate(() => window.__thi.hash());
  return { final, result, hash };
}

/** Replay the run from its own result screen and check it lands on the same hash. */
async function replayLienHoan(page, run) {
  await page.click('[data-replay-button]');
  await until(page, 'the replay to start', `d.replay === 'running'`);
  await page.waitForSelector('[data-replay-result][data-replay-match]', { timeout: WAIT_MS });
  const replay = await page.$eval('[data-replay-result]', (el) => ({
    match: el.dataset.replayMatch,
    hash: el.querySelector('code')?.textContent ?? '',
    text: el.textContent ?? '',
  }));
  if (replay.match !== 'yes') throw new Error(`the replay did not match: ${replay.text}`);
  if (replay.hash !== run.hash) throw new Error(`the replay ended on ${replay.hash}, the run on ${run.hash}`);
  const after = await readLienHoanResult(page);
  if (!after || after.score !== run.result.score || after.verdict !== run.result.verdict) {
    throw new Error(`the replayed result screen says ${JSON.stringify(after)}, the run said ${JSON.stringify(run.result)}`);
  }
  return replay;
}

/** A clean run of all 11 bài: 100, passed, no fault, and the replay's hash is the same. */
async function cleanLienHoan(label, path, automatic) {
  // A smaller viewport is still the scene, and it leaves the machine room for the parallel page:
  // a whole run is real-time, and a late cue is a learner's key landing late, not a page fault.
  const { page, problems } = await fresh(path, { width: 640, height: 400 });
  try {
    if (automatic) await until(page, 'the automatic page', `d.so === 'tu-dong'`);
    const run = await driveWholeRun(page, { automatic, allowed: [] });
    if (run.final.score !== '100' || run.final.verdict !== 'passed' || run.final.disqualified !== 'no') {
      throw new Error(`${label}: not a clean pass: ${JSON.stringify(run.final)}`);
    }
    if (run.final.lesson !== '11') throw new Error(`${label}: the run ended on bài ${run.final.lesson}`);
    if (run.final.run !== 'yes') throw new Error(`${label}: #stage does not say it is a liên hoàn run`);
    if (run.final.so !== (automatic ? 'tu-dong' : 'san')) throw new Error(`${label}: the page says so=${run.final.so}`);
    const trace = await page.evaluate(() => window.__thi.trace());
    const exerciseId = Buffer.from(trace, 'base64')[7];
    if (exerciseId !== 12) throw new Error(`${label}: the trace header carries exercise id ${exerciseId}, not 12`);
    if (run.result.faults.length !== 0) throw new Error(`${label}: the result screen lists faults: ${JSON.stringify(run.result.faults)}`);
    if (run.result.quote !== ruleset.scoring.source.quote) {
      throw new Error(`${label}: the pass quote is not the ruleset's own: ${run.result.quote}`);
    }
    if (!run.result.passLine.includes(String(ruleset.scoring.pass))) {
      throw new Error(`${label}: the pass line does not carry the ruleset's pass mark: ${run.result.passLine}`);
    }
    if (run.result.courseTick !== run.final.courseTick) {
      throw new Error(`${label}: the result clock ${run.result.courseTick} is not the run clock ${run.final.courseTick}`);
    }
    console.log(`     ${label}: 11 bài, ${(Number(run.final.courseTick) / 60).toFixed(1)} s of run, score ${run.final.score}, hash ${run.hash}`);
    await replayLienHoan(page, run);
    console.log(`     ${label}: the replay ended on the same hash ${run.hash}`);
    if (problems.length) throw new Error(`${label}: ${problems.join('\n')}`);
    return run;
  } finally {
    await page.close();
  }
}

/** The belt mistake, then the rest of the run: the result screen must show that one fault, with
 * its code, its points, its ruleset quote, and the bài and run time it happened at. */
async function faultLienHoan() {
  const id = 'SH.01.DAY_AN_TOAN';
  const { page, problems } = await fresh('/lien-hoan', { width: 640, height: 400 });
  try {
    const run = await driveWholeRun(page, { automatic: false, allowed: [id], belt: false });
    if (run.final.score !== '95' || run.final.verdict !== 'passed' || run.final.disqualified !== 'no') {
      throw new Error(`the fault run is not a pass at 95: ${JSON.stringify(run.final)}`);
    }
    if (run.result.faults.length !== 1 || run.result.faults[0].id !== id) {
      throw new Error(`the result screen lists ${JSON.stringify(run.result.faults)}, not just ${id}`);
    }
    const fault = run.result.faults[0];
    const rule = ruleset.rules.find((r) => r.id === id);
    if (fault.lesson !== '1') throw new Error(`the fault is marked on bài ${fault.lesson}, not bài 1`);
    if (!/^\d\d:\d\d$/.test(fault.where.replace(/^Bài \d+ · /, ''))) {
      throw new Error(`the fault has no run time: ${fault.where}`);
    }
    if (fault.points !== '−5 điểm') throw new Error(`the fault shows "${fault.points}", not "−5 điểm"`);
    if (fault.quote !== rule.source.quote) throw new Error(`the fault quote is not the ruleset's own: ${fault.quote}`);
    if (run.result.quote !== ruleset.scoring.source.quote) throw new Error('the pass quote is not the ruleset\u2019s own');
    console.log(`     liên hoàn fault: ${fault.id} ${fault.points} — ${fault.where}; score ${run.final.score}, hash ${run.hash}`);
    await replayLienHoan(page, run);
    if (problems.length) throw new Error(problems.join('\n'));
  } finally {
    await page.close();
  }
}

{
  // Each run is one real-time sitting on its own page, the way the per-bài sections drive: the bay
  // and the slope cues are timed for a 250–300 ms learner, and a second live page on the same
  // machine steals enough of that band to make the fault a property of the runner, not the page.
  await check('liên hoàn số sàn: the whole run, 11 bài, 100, then replay to the same hash', () =>
    cleanLienHoan('số sàn', '/lien-hoan', false));
  await check('liên hoàn số tự động: the whole run, 11 bài, 100, then replay to the same hash', () =>
    cleanLienHoan('số tự động', '/lien-hoan?so=tu-dong', true));
  await check('liên hoàn fault: bài 1 without the belt → result screen names SH.01.DAY_AN_TOAN −5, its quote, bài 1 and the run clock', () =>
    faultLienHoan());
}

} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.log(`\n${failures} e2e check(s) failed`);
  process.exit(1);
}
