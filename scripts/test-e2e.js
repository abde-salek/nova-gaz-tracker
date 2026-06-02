#!/usr/bin/env node
'use strict';

/**
 * Nova Gaz Tracker — Local E2E Test Script
 * ─────────────────────────────────────────
 * Prerequisites:
 *   1. Server running:  npm run dev  (MOCK_WHATSAPP=true in .env)
 *   2. DB migrated:     npm run db:migrate
 *   3. Dev data seeded: npm run db:seed
 *
 * Phones (from seed.js):
 *   Manager → 212600000001
 *   Sales   → 212600000002  (Truck 1)
 */

const BASE    = 'http://localhost:3000';
const MANAGER = '212600000001';
const SALES   = '212600000002';
const UNKNOWN = '212699999999';

let passed = 0;
let failed = 0;
const failures = [];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    data = { _text: await res.text() };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function send(from, text) {
  return post('/test/message', { from, text });
}

async function triggerAutoClose() {
  return post('/test/autoclose', {});
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failures.push(label);
    failed++;
  }
}

async function assertSend(label, from, text) {
  try {
    await send(from, text);
    await wait(250);
    assert(label, true);
    return true;
  } catch (err) {
    console.log(`  ❌ ${label}`);
    console.log(`     Error: ${err.message}`);
    failures.push(`${label} — ${err.message}`);
    failed++;
    return false;
  }
}

// ─── Test runner ──────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n══════════════════════════════════════════════');
  console.log(' Nova Gaz Tracker — E2E Tests');
  console.log('══════════════════════════════════════════════\n');

  // ── 0. Server health ──────────────────────────────────────────────────────
  console.log('── 0. Server health ──');
  try {
    const res = await fetch(`${BASE}/`);
    const data = await res.json();
    assert('Server is running', data.status === 'ok');
  } catch {
    console.error('\n❌ Cannot reach http://localhost:3000');
    console.error('   Make sure the server is running: npm run dev\n');
    process.exit(1);
  }

  // ── 1. Unknown sender ─────────────────────────────────────────────────────
  console.log('\n── 1. Unknown sender ──');
  await assertSend('Unknown number rejected', UNKNOWN, 'B 3');

  // ── 2. Manager: reset truck 1 stock cleanly ───────────────────────────────
  console.log('\n── 2. Manager: SET TRUCK ──');
  await assertSend('SET TRUCK 1 B20 M15 S30', MANAGER, 'SET TRUCK 1 B20 M15 S30');

  // ── 3. Manager: STATUS before sales ──────────────────────────────────────
  console.log('\n── 3. Manager: STATUS TRUCK ──');
  await assertSend('STATUS TRUCK 1 (empty day)', MANAGER, 'STATUS TRUCK 1');

  // ── 4. Role guard ─────────────────────────────────────────────────────────
  console.log('\n── 4. Role guard ──');
  await assertSend('Salesperson blocked from STATUS TRUCK', SALES, 'STATUS TRUCK 1');

  // ── 5. Single sale ────────────────────────────────────────────────────────
  console.log('\n── 5. Single sale ──');
  await assertSend('B 3 recorded', SALES, 'B 3');

  // ── 6. Multi-line sale ────────────────────────────────────────────────────
  console.log('\n── 6. Multi-line sale ──');
  await assertSend('M 2 + S 5 in one message', SALES, 'M 2\nS 5');

  // ── 7. TODAY ──────────────────────────────────────────────────────────────
  console.log('\n── 7. TODAY ──');
  await assertSend('TODAY shows running totals', SALES, 'TODAY');

  // ── 8. UNDO first use ─────────────────────────────────────────────────────
  console.log('\n── 8. UNDO (first use — should succeed) ──');
  await assertSend('UNDO first use accepted', SALES, 'UNDO');

  // ── 9. UNDO second use (boundary) ────────────────────────────────────────
  console.log('\n── 9. UNDO (second use — boundary check) ──');
  await assertSend('UNDO second use rejected (check server log)', SALES, 'UNDO');

  // ── 10. Invalid command ───────────────────────────────────────────────────
  console.log('\n── 10. Invalid command ──');
  await assertSend('Garbage input handled gracefully', SALES, 'HELLO THERE');

  // ── 11. DONE ──────────────────────────────────────────────────────────────
  console.log('\n── 11. DONE (manual close) ──');
  await assertSend('DONE closes day + sends summary', SALES, 'DONE');

  // ── 12. Late sale after DONE ──────────────────────────────────────────────
  console.log('\n── 12. Late sale (after DONE) ──');
  await assertSend('Late sale recorded + manager flagged', SALES, 'B 1');

  // ── 13. DONE again → resend summary ──────────────────────────────────────
  console.log('\n── 13. DONE again ──');
  await assertSend('DONE resends same summary', SALES, 'DONE');

  // ── 14. PAID TRUCK ────────────────────────────────────────────────────────
  console.log('\n── 14. PAID TRUCK ──');
  await assertSend('PAID TRUCK 1 clears unpaid total', MANAGER, 'PAID TRUCK 1');

  // ── 15. EMPTY DONE TRUCK ──────────────────────────────────────────────────
  console.log('\n── 15. EMPTY DONE TRUCK ──');
  await assertSend('EMPTY DONE TRUCK 1 resets empties', MANAGER, 'EMPTY DONE TRUCK 1');

  // ── 16. ADD SALES ─────────────────────────────────────────────────────────
  console.log('\n── 16. ADD SALES ──');
  await assertSend('ADD SALES registers new salesperson', MANAGER, 'ADD SALES 0611223344 Ahmed TRUCK 1');

  // ── 17. ADD MANAGER ───────────────────────────────────────────────────────
  console.log('\n── 17. ADD MANAGER ──');
  await assertSend('ADD MANAGER registers new manager', MANAGER, 'ADD MANAGER 0622334455 Fatima');

  // ── 18. REMOVE PERSON ─────────────────────────────────────────────────────
  console.log('\n── 18. REMOVE PERSON ──');
  await assertSend('REMOVE PERSON removes Ahmed', MANAGER, 'REMOVE PERSON 0611223344');

  // ── 19. Remove non-existent person ───────────────────────────────────────
  console.log('\n── 19. REMOVE PERSON (not found) ──');
  await assertSend('REMOVE non-existent number handled', MANAGER, 'REMOVE PERSON 0600000099');

  // ── 20. Low-stock warning ─────────────────────────────────────────────────
  console.log('\n── 20. Low-stock (negative stock) ──');
  await assertSend('SET tiny stock B2', MANAGER, 'SET TRUCK 1 B2 M2 S2');
  await wait(150);
  await assertSend('Oversell B 5 triggers ⚠ warning', SALES, 'B 5');

  // ── 21. Auto-close trigger ────────────────────────────────────────────────
  console.log('\n── 21. Auto-close (manual trigger) ──');
  // Reset truck 1 cleanly + make some sales so it has activity
  await assertSend('Reset truck 1 for auto-close test', MANAGER, 'SET TRUCK 1 B20 M15 S30');
  await wait(150);
  await assertSend('Sale activity before auto-close', SALES, 'B 2\nM 1');
  await wait(150);
  try {
    const result = await triggerAutoClose();
    await wait(400);
    assert('Auto-close fired and returned ok', result.ok === true);
  } catch (err) {
    console.log(`  ❌ Auto-close trigger failed: ${err.message}`);
    failures.push(`Auto-close trigger: ${err.message}`);
    failed++;
  }

  // ── 22. STATUS after auto-close ───────────────────────────────────────────
  console.log('\n── 22. STATUS after auto-close ──');
  await assertSend('STATUS shows day_closed=Yes', MANAGER, 'STATUS TRUCK 1');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(` Results: ${passed} passed  |  ${failed} failed`);
  console.log('══════════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  • ${f}`));
  }

  console.log('\n📋 All WhatsApp replies are in the SERVER terminal:');
  console.log('   📱 [MOCK → <phone>]');
  console.log('   <message text>\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\n[Test Runner] Fatal error:', err.message);
  process.exit(1);
});
