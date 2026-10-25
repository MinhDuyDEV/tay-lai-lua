// End-to-end for bài 1 in the built site: a learner who has only a keyboard.
//
//   node e2e.mjs [--site ../../apps/web/out] [--wasm ../../build/sim.wasm] [--ruleset ../../content/rulesets/tt108-2026.json]
//
// Rules this file keeps:
//  * Keyboard events only. The page is never poked: every key goes through page.keyboard.
//  * Every key press waits on the state the page publishes (data-* on #stage), never on a clock.
//    The only time limit is Playwright's own timeout on a state that never arrives, and then the
//    failure prints the whole state.
//  * Nothing is skipped. A browser or WebGL that cannot start is a failure.
//  * The page must be running the real core: data-sim="wasm". The fake stand-in fails the run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../apps/web/scripts/serve.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const site = args.get('site') ?? '../../apps/web/out';
const wasmB64 = readFileSync(args.get('wasm') ?? '../../build/sim.wasm').toString('base64');
const ruleset = JSON.parse(readFileSync(args.get('ruleset') ?? '../../content/rulesets/tt108-2026.json', 'utf8'));

// Software GL through ANGLE/SwiftShader: the same path on a headless Linux runner and on a Mac.
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const WAIT_MS = 45_000;

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

const clutchDown = (d) => Number(d.clutch) > 0.95;

/** One whole run of bài 1 from the keyboard. `belt` false leaves the seat belt unfastened. */
async function drive(page, { belt, allowed }) {
  const key = page.keyboard;

  // The first key only enters the car (and starts the audio); it must not count as an action.
  await page.waitForFunction(() => Boolean(window.__thi), null, { timeout: WAIT_MS });
  await key.press('KeyX');
  await until(page, 'enter the car', `d.entered === 'yes'`, allowed);

  await until(page, 'engine on', `d.engineOn === 'yes'`, allowed);
  if (belt) {
    await key.press('KeyB');
    await until(page, 'belt on', `d.belt === 'yes'`, allowed);
  }

  await key.press('Enter');
  await until(page, 'start order given', `d.ordered === 'yes'`, allowed);
  const sim = (await readStage(page)).sim;
  if (sim !== 'wasm') throw new Error(`the page is running sim kind "${sim}", not the real core`);

  await key.press('KeyQ');
  await until(page, 'left signal on', `d.signal === 'left'`, allowed);

  await key.down('Space');
  await until(page, 'clutch pressed down', `Number(d.clutch) > 0.95`, allowed);
  await key.press('Digit1');
  await until(page, 'gear 1', `d.gear === '1'`, allowed);
  await key.press('KeyP');
  await until(page, 'handbrake released', `d.handbrake === 'no'`, allowed);

  // Pull away: clutch up through the bite, a little throttle, then coast on what we have.
  await key.up('Space');
  await key.down('ArrowUp');
  await until(page, 'moving', `Number(d.speed) > 0.5`, allowed);
  await until(page, 'across the start line', `Number(d.bumper) >= 0`, allowed);

  // The law's window for the signal is 4–6 m after the line; switch it off inside it.
  await until(page, 'bumper past 4.5 m', `Number(d.bumper) >= 4.5`, allowed);
  await key.press('KeyQ');
  await until(page, 'left signal off', `d.signal === 'off'`, allowed);

  await until(page, 'end of the exercise', `d.phase === 'done'`, allowed);
  await key.up('ArrowUp');
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
const url = `http://localhost:${server.address().port}/thi`;
let browser;
try {
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
} catch (err) {
  console.log(`FAIL chromium launch: ${err.message.split('\n')[0]}`);
  server.close();
  process.exit(1);
}

async function fresh() {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.goto(url);
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
    if (problems.length) throw new Error(problems.join('\n'));
    // Trace and hash read in one go: the page has stopped feeding the core, so they belong together.
    clean = await page.evaluate(() => ({ trace: window.__thi.trace(), hash: window.__thi.hash(), shown: document.querySelector('#stage').dataset.hash }));
    await page.close();
  });

  await check('the recorded trace replays to the hash the page shows', async () => {
    if (!clean) throw new Error('no clean run to replay');
    if (clean.hash !== clean.shown) throw new Error(`page hash ${clean.hash} differs from data-hash ${clean.shown}`);
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><title>replay</title>');
    await page.addScriptTag({ path: join(import.meta.dirname, 'page.js') });
    const replayed = await page.evaluate((a) => window.runGolden(a), { wasmB64, traceB64: clean.trace });
    await page.close();
    if (replayed !== clean.hash) throw new Error(`replay gave ${replayed}, the page showed ${clean.hash}`);
  });

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
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.log(`\n${failures} e2e check(s) failed`);
  process.exit(1);
}
