'use strict';
/*
 * End-to-end browser checks for Diagnostic Scan Diff.
 *
 * Run:
 *   npm ci
 *   npm run test:browser
 *
 * Browser selection (optional env):
 *   PW_CHANNEL=chrome    use the locally installed Chrome (default on dev machines)
 *   PW_CHANNEL=msedge    use the locally installed Edge
 *   PW_CHANNEL=bundled   force the Playwright-bundled Chromium
 *   unset + CI=true      bundled Chromium (CI: npx playwright install chromium)
 *
 * Every check runs in its own isolated browser context. The app is opened both
 * via file:// (primary usage) and through a loopback-only static server that
 * serves a fixed allowlist of files (hosted-compatibility check). Each context
 * asserts that no request leaves file:// or the loopback origin. All fixtures
 * are synthetic and labeled as such.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const ARTIFACTS = path.join(ROOT, 'test-results');
const FILE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SERVE_ALLOWLIST = ['index.html', 'style.css', 'scan.js'];
const TEST_TIMEOUT_MS = 60_000;

function launchOptions() {
  const channel = process.env.PW_CHANNEL;
  if (channel === 'bundled' || channel === '') return {};
  if (channel) return { channel };
  return process.env.CI ? {} : { channel: 'chrome' };
}

async function launchBrowser() {
  const { chromium } = require('playwright');
  return chromium.launch(launchOptions());
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
    };
    const server = http.createServer((req, res) => {
      let name;
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      } catch {
        res.writeHead(400); res.end('bad request'); return;
      }
      if (name === 'favicon.ico') { res.writeHead(204); res.end(); return; } // browsers auto-request this; the app ships none
      if (!SERVE_ALLOWLIST.includes(name)) { res.writeHead(404); res.end('not found'); return; }
      try {
        const body = fs.readFileSync(path.join(ROOT, name));
        res.writeHead(200, {
          'content-type': types[path.extname(name)] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(500); res.end('error');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function trackOffsiteRequests(context, allowedPrefixes) {
  const offsite = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!allowedPrefixes.some((prefix) => url.startsWith(prefix))) offsite.push(url);
  });
  return offsite;
}

function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  return errors;
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${TEST_TIMEOUT_MS} ms`)), TEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/*
 * setInputFiles dispatches change without waiting for async handlers, so wait
 * for the app's own end state (loaded textarea) before asserting — no
 * arbitrary sleeps.
 */
const waitForValue = (page, selector, needle) =>
  page.waitForFunction(
    ([sel, text]) => document.querySelector(sel).value.includes(text),
    [selector, needle],
    { timeout: 10_000 },
  );

async function compareAndReadResult(page) {
  await page.click('#compare');
  const badges = await page.locator('#result .badge').allTextContents();
  return badges;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('file:// load: export disabled, empty results, no off-site requests', async (context) => {
  const offsite = trackOffsiteRequests(context, ['file://', 'blob:', 'data:']);
  const page = await context.newPage();
  const errors = trackPageErrors(page);
  await page.goto(FILE_URL);
  assert.equal(await page.locator('#export').isDisabled(), true);
  assert.equal((await page.locator('#result').textContent()).trim(), '');
  assert.match(await page.locator('#message').textContent(), /Files are parsed locally/);
  await page.screenshot({ path: path.join(ARTIFACTS, 'scan-diff-file.png'), fullPage: true });
  assert.deepEqual(offsite, [], 'no requests outside file://');
  assert.deepEqual(errors, [], 'no page or console errors');
});

test('fictional sample compare yields 1 new, 2 absent, 1 persisting', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.click('#sample');
  assert.match(await page.locator('#message').textContent(), /Fictional example loaded/);
  const badges = await compareAndReadResult(page);
  assert.deepEqual(badges, ['1', '2', '1']);
  const resultText = await page.locator('#result').textContent();
  assert.ok(resultText.includes('Newly observed') && resultText.includes('Absent from later scan') && resultText.includes('Persisting'));
  assert.ok(resultText.includes('P0300'), 'new code shown');
  assert.ok(resultText.includes('P0101') && resultText.includes('01234'), 'absent codes shown');
  assert.ok(resultText.includes('000123'), 'persisting code shown');
  assert.match(await page.locator('#message').textContent(), /Compared 3 before and 2 after fault entries/);
  assert.equal(await page.locator('#export').isDisabled(), false);
});

test('text fixtures load redacted (VIN, plate) and compare as synthetic', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.setInputFiles('#before-file', path.join(FIXTURES, 'before.txt'));
  await waitForValue(page, '#before', 'SYNTHETIC FIXTURE');
  await page.setInputFiles('#after-file', path.join(FIXTURES, 'after.txt'));
  await waitForValue(page, '#after', 'SYNTHETIC FIXTURE');
  const beforeText = await page.inputValue('#before');
  assert.ok(beforeText.includes('SYNTHETIC FIXTURE'), 'synthetic label kept');
  assert.ok(!beforeText.includes('WVWZZZ1KZ6W000001'), 'VIN removed from loaded text');
  assert.ok(beforeText.includes('VIN: [REDACTED]'), 'VIN line redacted');
  assert.ok(!beforeText.includes('SYNTH-000'), 'plate removed from loaded text');
  assert.ok(beforeText.includes('License Plate: [REDACTED]'), 'plate line redacted');
  const badges = await compareAndReadResult(page);
  assert.deepEqual(badges, ['1', '2', '1']);
  const resultText = await page.locator('#result').textContent();
  assert.ok(resultText.includes('P0300') && resultText.includes('P0101') && resultText.includes('01234') && resultText.includes('000123'));
});

test('JSON fixtures (array and {faults}) compare as synthetic', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.setInputFiles('#before-file', path.join(FIXTURES, 'before.json'));
  await waitForValue(page, '#before', 'Synthetic fixture');
  await page.setInputFiles('#after-file', path.join(FIXTURES, 'after.json'));
  await waitForValue(page, '#after', 'Synthetic fixture');
  const badges = await compareAndReadResult(page);
  assert.deepEqual(badges, ['1', '2', '1']);
  const resultText = await page.locator('#result').textContent();
  assert.ok(resultText.includes('Synthetic fixture'), 'synthetic descriptions shown');
  assert.ok(resultText.includes('P0300') && resultText.includes('P0101') && resultText.includes('01234') && resultText.includes('000123'));
});

test('editing inputs disables export; malformed compare keeps it disabled (regression)', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.click('#sample');
  await page.click('#compare');
  assert.equal(await page.locator('#export').isDisabled(), false, 'export enabled after a successful compare');
  // Editing either input must invalidate the previous result: stale bytes must not be exportable.
  await page.fill('#before', 'Address 01: Engine\n000123 - Synthetic sensor fault\nP0300 - Synthetic new code');
  assert.equal(await page.locator('#export').isDisabled(), true, 'export disabled after editing an input');
  await page.fill('#before', '{"faults": [ not valid json');
  await page.click('#compare');
  assert.match(await page.locator('#message').textContent(), /Unexpected|JSON|token/i);
  assert.equal(await page.locator('#export').isDisabled(), true, 'export stays disabled after a failed compare');
  // A fresh successful compare re-enables export, and the downloaded bytes match it.
  await page.click('#sample');
  await page.click('#compare');
  assert.equal(await page.locator('#export').isDisabled(), false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  assert.equal(download.suggestedFilename(), 'scan-comparison.json');
  const body = JSON.parse((await readDownload(download)).toString('utf8'));
  assert.deepEqual(body.new.map((fault) => fault.code), ['P0300']);
  assert.deepEqual(body.absent.map((fault) => fault.code), ['P0101', '01234']);
  assert.deepEqual(body.persisting.map((fault) => fault.code), ['000123']);
  assert.ok(!Number.isNaN(Date.parse(body.generatedAt)), 'generatedAt is a timestamp');
  assert.equal(body.interpretation, 'Absence is not proof of repair.');
});

test('JSON fixture with labeled identifiers loads redacted and stays valid JSON (regression)', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.setInputFiles('#before-file', path.join(FIXTURES, 'before-labeled.json'));
  await waitForValue(page, '#before', 'VIN: [REDACTED]');
  await page.setInputFiles('#after-file', path.join(FIXTURES, 'after.json'));
  await waitForValue(page, '#after', 'Synthetic fixture');
  const beforeText = await page.inputValue('#before');
  assert.ok(!beforeText.includes('WVWZZZ1KZ6W000001'), 'VIN removed from loaded JSON text');
  assert.ok(!beforeText.includes('SYNTH-000'), 'plate removed from loaded JSON text');
  assert.ok(beforeText.includes('VIN: [REDACTED]'), 'VIN label redacted inside a JSON string value');
  assert.ok(beforeText.includes('License Plate: [REDACTED]'), 'plate label redacted inside a JSON string value');
  assert.doesNotThrow(() => JSON.parse(beforeText), 'loaded JSON text is still valid JSON');
  assert.equal(JSON.parse(beforeText).faults.length, 3, 'fault structure preserved');
  const badges = await compareAndReadResult(page);
  assert.deepEqual(badges, ['1', '2', '1']);
  const resultText = await page.locator('#result').textContent();
  assert.ok(resultText.includes('VIN: [REDACTED]'), 'redacted description shown in results');
  assert.ok(resultText.includes('P0300') && resultText.includes('P0101') && resultText.includes('01234') && resultText.includes('000123'));
});

test('editing or failed loads keep message and result state consistent (regression)', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.click('#sample');
  await page.click('#compare');
  assert.equal(await page.locator('#export').isDisabled(), false, 'export enabled after a successful compare');
  assert.match(await page.locator('#message').textContent(), /Compared 3 before and 2 after fault entries/);
  // Editing an input invalidates the result; the message must not keep describing it.
  await page.fill('#after', `Address 01: Engine
000123 - Synthetic sensor fault`);
  assert.equal(await page.locator('#export').isDisabled(), true);
  assert.doesNotMatch(await page.locator('#message').textContent(), /Compared/, 'stale comparison message cleared after an edit');
  // An oversize file must not leave stale results visible or exportable behind an error.
  await page.click('#sample');
  await page.click('#compare');
  assert.equal(await page.locator('#export').isDisabled(), false);
  await page.setInputFiles('#before-file', { name: 'oversize-scan.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 65) });
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('File exceeds 5 MB'));
  assert.equal(await page.locator('#export').isDisabled(), true, 'export disabled after a failed file load');
  assert.equal((await page.locator('#result').textContent()).trim(), '', 'stale results cleared after a failed file load');
  // A later successful load clears the stale error message.
  await page.setInputFiles('#before-file', path.join(FIXTURES, 'before.txt'));
  await waitForValue(page, '#before', 'SYNTHETIC FIXTURE');
  assert.doesNotMatch(await page.locator('#message').textContent(), /File exceeds/, 'stale error cleared after a successful load');
});

test('exported JSON contains no VIN even when pasted directly', async (context) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.fill('#before', 'VIN: WVWZZZ1KZ6W000001\nAddress 01: Engine\nP0101 - Synthetic code');
  await page.fill('#after', 'Address 01: Engine\nP0101 - Synthetic code\nP0300 - Synthetic new code');
  await page.click('#compare');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const raw = (await readDownload(download)).toString('utf8');
  assert.ok(!raw.includes('WVWZZZ'), 'no VIN in exported bytes');
  const body = JSON.parse(raw);
  assert.deepEqual(body.new.map((fault) => fault.code), ['P0300']);
});

test('hosted compatibility: loopback server serves only fixed files', async (context) => {
  const { server, origin } = await startStaticServer();
  try {
    const offsite = trackOffsiteRequests(context, [`${origin}/`, 'blob:', 'data:']);
    const page = await context.newPage();
    const errors = trackPageErrors(page);
    await page.goto(`${origin}/`);
    await page.click('#sample');
    const badges = await compareAndReadResult(page);
    assert.deepEqual(badges, ['1', '2', '1']);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
    const body = JSON.parse((await readDownload(download)).toString('utf8'));
    assert.deepEqual(body.persisting.map((fault) => fault.code), ['000123']);
    for (const probe of ['/package.json', '/tests/scan.test.cjs', '/%2e%2e/package.json', '/..%2fpackage.json']) {
      const response = await context.request.get(`${origin}${probe}`);
      assert.equal(response.status(), 404, `expected 404 for ${probe}`);
    }
    assert.deepEqual(offsite, [], 'no requests outside the loopback origin');
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function runTests() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await launchBrowser();
  let failures = 0;
  for (const { name, fn } of tests) {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    try {
      await withTimeout(fn(context), name);
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL - ${name}`);
      console.error(error && error.stack ? error.stack : error);
    } finally {
      await context.close();
    }
  }
  await browser.close();
  console.log(`${tests.length - failures}/${tests.length} browser checks passed`);
  process.exit(failures ? 1 : 0);
}

module.exports = { launchBrowser, startStaticServer };

if (require.main === module) {
  runTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
