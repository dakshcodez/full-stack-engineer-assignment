import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
const consoleLogs = [];
const wsEvents = [];

page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => consoleLogs.push(`[ERR] ${err.message}`));
page.on('websocket', ws => {
  wsEvents.push(`OPEN ${ws.url()}`);
  ws.on('framereceived', f => wsEvents.push(`← ${f.payload.toString().slice(0,80)}`));
  ws.on('framesent', f => wsEvents.push(`→ ${f.payload.toString().slice(0,80)}`));
  ws.on('close', () => wsEvents.push(`CLOSE ${ws.url()}`));
  ws.on('socketerror', e => wsEvents.push(`ERR ${String(e)}`));
});

console.log('Loading app...');
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

// Wait for WS to establish
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/ss-01-loaded.png', fullPage: true });

// Check connection status
const statusText = await page.locator('[role="status"]').textContent().catch(() => null);
console.log('Connection status:', statusText ?? 'none (connected)');

// Show WS events so far
const agentWsEvents = wsEvents.filter(e => e.includes('4747'));
console.log('\nAgent WS events:', agentWsEvents.slice(0, 5));

// ── Test 1: hello ──────────────────────────────────────────
console.log('\n=== Test 1: hello ===');
await page.locator('textarea').fill('hello');
await page.locator('button', { hasText: 'Send' }).click();

// Wait for streaming response
await page.waitForFunction(
  () => document.querySelector('.max-w-\\[85\\%\\]')?.textContent?.includes('Hello'),
  { timeout: 20000 }
).catch(() => console.log('Timed out waiting for hello response'));

await page.screenshot({ path: '/tmp/ss-02-hello.png', fullPage: true });
const helloText = await page.locator('.max-w-\\[85\\%\\]').first().textContent().catch(() => '');
console.log('Response:', helloText?.slice(0, 100));

// Check timeline
const timelineCount = await page.locator('text=events').textContent().catch(() => '');
console.log('Timeline:', timelineCount);

// ── Test 2: report (tool call) ─────────────────────────────
console.log('\n=== Test 2: report summary (tool call) ===');
await page.locator('textarea').fill('summarize the report');
await page.locator('button', { hasText: 'Send' }).click();

// Wait for tool call card
await page.waitForSelector('text=lookup_metric', { timeout: 25000 })
  .then(() => console.log('✓ TOOL_CALL card rendered'))
  .catch(() => console.log('✗ TOOL_CALL card not found'));

await page.screenshot({ path: '/tmp/ss-03-toolcall.png', fullPage: true });

// Wait for tool result  
await page.waitForSelector('text=23.4%', { timeout: 15000 })
  .then(() => console.log('✓ TOOL_RESULT rendered (23.4% visible)'))
  .catch(() => console.log('✗ TOOL_RESULT not visible'));

// Wait for stream to finish
await page.waitForFunction(
  () => !document.querySelector('[class*="animate-pulse"]'),
  { timeout: 30000 }
).catch(() => {});

await page.screenshot({ path: '/tmp/ss-04-report-done.png', fullPage: true });

// ── Test 3: context inspector ──────────────────────────────
console.log('\n=== Test 3: context inspector ===');
const ctxSize = await page.locator('text=KB').first().textContent().catch(() => null);
console.log('Context size shown:', ctxSize);
const ctxTree = await page.locator('text=Context Inspector').count();
console.log('Context panel visible:', ctxTree > 0);

// ── Protocol compliance ─────────────────────────────────────
console.log('\n=== Protocol compliance (/log) ===');
const logResp = await page.request.get('http://localhost:4747/log');
const log = await logResp.json();
const pongs = log.filter(e => e.type === 'PONG' && e.verdict === 'ok');
const acks = log.filter(e => e.type === 'TOOL_ACK' && e.verdict === 'ok');
const violations = log.filter(e => e.verdict === 'violation');
console.log(`PONGs ok: ${pongs.length}`);
console.log(`TOOL_ACKs ok: ${acks.length}`);
console.log(`Violations: ${violations.length}`);
if (violations.length > 0) {
  violations.forEach(v => console.log('  violation:', v.type, v.data));
}

// Show any page errors
if (consoleLogs.filter(l => l.startsWith('[ERR]')).length > 0) {
  console.log('\nPage errors:');
  consoleLogs.filter(l => l.startsWith('[ERR]')).forEach(l => console.log(' ', l));
}

await browser.close();
console.log('\nDone.');
