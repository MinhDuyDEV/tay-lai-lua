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
// cue ('clutch', then 'brake') in data-cue. The lag is the middle of the 100-400 ms the feel test sweeps.
const REACTION_MS = 250;
const cue = (name) => `document.querySelector('.advice')?.dataset.cue === '${name}'`;

/**
 * Bài 3 from the keyboard: gear 1, handbrake off, creep up, clutch then brake to stop inside A, hold
 * with the handbrake. Then `finish` either pulls away (handbrake method) or lets the handbrake go with
 * the clutch up and no throttle. Every key waits on the published state.
 */
async function driveHill(page, { finish, allowed }) {
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
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.log(`\n${failures} e2e check(s) failed`);
  process.exit(1);
}
