// Runs every golden trace through sim.wasm in Chromium, Firefox and WebKit and fails
// unless each engine prints the committed expected hash. Also runs the negative control:
// one flipped input bit must change the hash, so the check cannot pass by hashing nothing.
//
// No bundler and no server: the .wasm bytes and the trace go into the page as base64 and
// the engine instantiates them itself (page.js). A browser that cannot launch is a
// failure, never a skip.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const wasmPath = args.get('wasm') ?? '../../build/sim.wasm';
const goldenDir = args.get('golden') ?? '../../golden';

const wasmB64 = readFileSync(wasmPath).toString('base64');
const traces = loadTraces(goldenDir);

let failed = 0;
for (const [name, type] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  failed += await runEngine(name, type);
}

if (failed > 0) {
  console.log(`\n${failed} of ${3 * 2 * traces.length} checks failed`);
  process.exit(1);
}

async function runEngine(name, type) {
  let browser;
  try {
    browser = await type.launch();
  } catch (err) {
    console.log(`FAIL engine=${name} launch: ${err.message.split('\n')[0]}`);
    return traces.length * 2;
  }
  let localFailed = 0;
  try {
    for (const tr of traces) {
      // A fresh page per trace: no engine state survives between traces.
      const page = await browser.newPage();
      try {
        await page.setContent('<!doctype html><meta charset="utf-8"><title>golden</title>');
        await page.addScriptTag({ path: join(import.meta.dirname, 'page.js') });

        const got = await page.evaluate((a) => window.runGolden(a), { wasmB64, traceB64: tr.b64 });
        const flipped = await page.evaluate((a) => window.runGolden(a), {
          wasmB64,
          traceB64: tr.b64,
          flip: true,
        });
        switch (true) {
          case got !== tr.want:
            console.log(`FAIL engine=${name} trace=${tr.name} want=${tr.want} got=${got}`);
            localFailed++;
            break;
          case flipped === tr.want:
            console.log(
              `FAIL engine=${name} trace=${tr.name} negative-control: one flipped input bit still gave the golden hash ${flipped}, so this trace would pass while hashing nothing`,
            );
            localFailed++;
            break;
          default:
            console.log(
              `ok   engine=${name} trace=${tr.name} hash=${got} negative-control=${flipped}`,
            );
        }
      } catch (err) {
        console.log(`FAIL engine=${name} trace=${tr.name} ${err.message.split('\n')[0]}`);
        localFailed += 2;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return localFailed;
}

function loadTraces(dir) {
  const names = readdirSync(dir).filter((f) => f.endsWith('.trace'));
  if (names.length === 0) {
    console.log(`FAIL no golden traces in ${dir}: a check that runs nothing proves nothing`);
    process.exit(1);
  }
  return names.sort().map((file) => {
    const stem = basename(file, '.trace');
    const b64 = readFileSync(join(dir, file)).toString('base64');
    // 8-byte seed then 8-byte TickInput records (crates/sim-core/src/lib.rs).
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length <= 8 || (bytes.length - 8) % 8 !== 0) {
      console.log(`FAIL ${file}: want an 8-byte seed then at least one 8-byte record, got ${bytes.length} bytes`);
      process.exit(1);
    }
    const want = readFileSync(join(dir, `${stem}.hash`), 'utf8').trim();
    if (!/^[0-9a-f]{16}$/.test(want)) {
      console.log(`FAIL ${stem}.hash: want 16 lowercase hex digits, got ${JSON.stringify(want)}`);
      process.exit(1);
    }
    return { name: stem, b64, want };
  });
}
