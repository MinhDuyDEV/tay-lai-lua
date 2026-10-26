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
async function drive(page, { belt, allowed }) {
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

  await cruiseUntil(page, 'end of the exercise', `d.phase === 'done'`, allowed);
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
async function driveHill(page, { finish, allowed, throttle = false }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);

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
    await until(page, 'over the stop line', `d.phase === 'done'`, allowed);
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
async function driveFigure(page, { allowed, throttle = false }) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
  await key.press('KeyE');
  await until(page, 'engine on', `d.engineOn === 'yes'`, allowed);

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

  // Hold the arrow key the line names, and only that one. The learner polls the line, and when it
  // differs from what they last acted on they wait FIGURE_REACTION_MS and then press what *that*
  // reading said, even if the line has moved on again — the same learner as the Supervisor's hand
  // check, and the stricter one: re-reading after the wait would hide a cue that comes too late.
  let heldDir = null;
  let seen = '';
  const finishAt = Date.now() + WAIT_MS;
  while (Date.now() < finishAt) {
    const d = await readStage(page);
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} at progress ${d.progress} m (contact ${d.contact})\nstate: ${JSON.stringify(d)}`);
    if (d.phase === 'done' || d.disqualified === 'yes') break;

    const name = await page.$eval('.advice', (el) => el.dataset.cue ?? '');
    if (name !== seen) {
      seen = name;
      // The advice line's own words, printed once per change: this is what the learner would read.
      console.log(`     at ${Number(d.progress).toFixed(1)} m the line says: ${(await page.$eval('.advice', (el) => el.textContent)).trim()}`);
      await page.waitForTimeout(FIGURE_REACTION_MS);
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
  await until(page, 'end of the figure', `d.phase === 'done' || d.disqualified === 'yes'`, allowed);
}

let failures = 0;
const check = async (name, fn) => {
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

async function fresh(path = '/thi') {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
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

/** Set the car going as the checklist words it: clutch, gear 1, handbrake off, clutch up. */
async function roadSetOff(page, allowed) {
  const key = page.keyboard;
  await pageReady(page);
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);
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
async function roadStop(page, { allowed, pressAt = null }) {
  const key = page.keyboard;
  const deadline = Date.now() + WAIT_MS;
  let pressed = false;
  while (Date.now() < deadline) {
    const d = await readStage(page);
    const bad = d.penalties.split(' ').filter((id) => id && !allowed.includes(id));
    if (bad.length) throw new Error(`unexpected penalty ${bad} while approaching: ${JSON.stringify(d)}`);
    if (d.phase === 'stopped' || d.phase === 'done' || d.disqualified === 'yes') break;
    const gated = pressAt === null ? d.aidKey !== '' && d.aidEtaMs !== '' && Number(d.aidEtaMs) === 0 : Number(d.lineGap) <= pressAt;
    if (gated && !pressed) {
      await key.down('Space');
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
async function roadGo(page, { allowed, cond, signal = false }) {
  const key = page.keyboard;
  const now = await readStage(page);
  if (now.handbrake === 'yes') {
    await key.press('KeyP');
    await until(page, 'handbrake off', `d.handbrake === 'no'`, allowed);
  }
  if (now.clutch !== '0.00') await key.up('Space');
  // From a cold start the checklist's own way: clutch, gear 1, handbrake off, clutch up.
  if (now.gear !== '1') {
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
  // Stop past the line: clutch and brake. A run the exercise has already ended (bài 11 ends on the
  // tick the car stops past the finish line) needs nothing more, and a handbrake press after that
  // would never be seen by the core.
  await key.down('Space');
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

} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.log(`\n${failures} e2e check(s) failed`);
  process.exit(1);
}
