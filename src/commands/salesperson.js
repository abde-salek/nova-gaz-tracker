'use strict';

const db = require('../db/queries');
const { sendMessage, broadcast } = require('../whatsapp/sender');
const fmt = require('../whatsapp/formatter');

/**
 * Handle a message from a registered salesperson.
 * @param {object} person  - Row from people table
 * @param {string} text    - Raw message text (already trimmed/uppercased)
 * @param {string} from    - Sender phone
 */
async function handleSalesperson(person, text, from) {
  const truckId = person.truck_id;

  if (!truckId) {
    return sendMessage(from, '⚠ You are not assigned to a truck. Contact your manager.');
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Single-keyword commands ──────────────────────────────────────────────

  if (lines.length === 1) {
    const cmd = lines[0];

    if (cmd === 'TODAY') return handleToday(person, from, truckId);
    if (cmd === 'DONE')  return handleDone(person, from, truckId);
    if (cmd === 'UNDO')  return handleUndo(person, from, truckId);
  }

  // ── Sale lines (one or many) ─────────────────────────────────────────────

  return handleSaleLines(person, from, truckId, lines);
}

// ─── TODAY ────────────────────────────────────────────────────────────────────

async function handleToday(person, from, truckId) {
  const [stock, todaySales, prices] = await Promise.all([
    db.getStock(truckId),
    db.getTodaySales(truckId),
    db.getPrices(),
  ]);

  if (!stock) return sendMessage(from, '⚠ No stock initialized for your truck. Contact your manager.');

  return sendMessage(from, fmt.todayStatus(todaySales, stock, prices));
}

// ─── DONE ─────────────────────────────────────────────────────────────────────

async function handleDone(person, from, truckId) {
  const [stock, todaySales, prices] = await Promise.all([
    db.getStock(truckId),
    db.getTodaySales(truckId),
    db.getPrices(),
  ]);

  if (!stock) return sendMessage(from, '⚠ No stock initialized for your truck. Contact your manager.');

  const today = new Date().toISOString().slice(0, 10);
  const summary = fmt.daySummary(truckId, today, todaySales, stock, prices, false);

  if (stock.day_closed) {
    // Day already auto-closed — just resend the summary
    return sendMessage(from, summary);
  }

  // Close the day
  await db.closeDay(truckId);

  // Send to salesperson
  await sendMessage(from, summary);

  // Send to all managers
  const managers = await db.getAllManagers();
  await broadcast(managers.map(m => m.phone), summary);
}

// ─── UNDO ─────────────────────────────────────────────────────────────────────

async function handleUndo(person, from, truckId) {
  const stock = await db.getStock(truckId);

  if (!stock) return sendMessage(from, '⚠ No stock initialized for your truck.');

  if (stock.day_closed) {
    return sendMessage(from, '✗ Day is already closed. UNDO is not available.');
  }

  const sale = await db.undoLastSale(truckId);

  if (!sale) {
    return sendMessage(from, '✗ No sales to undo today.');
  }

  return sendMessage(from, fmt.undoConfirm(sale));
}

// ─── SALE LINES ───────────────────────────────────────────────────────────────

async function handleSaleLines(person, from, truckId, lines) {
  const stock = await db.getStock(truckId);

  if (!stock) return sendMessage(from, '⚠ No stock initialized for your truck. Contact your manager.');

  // Parse all lines
  const parsed = [];
  const invalid = [];

  for (const line of lines) {
    const match = line.match(/^(B|M|S)\s+(\d+)$/i);
    if (match) {
      parsed.push({ size: match[1].toUpperCase(), qty: parseInt(match[2], 10) });
    } else {
      invalid.push(line);
    }
  }

  if (parsed.length === 0) {
    return sendMessage(from,
      `✗ Could not understand: "${lines.join(', ')}"\n` +
      `Use: B 3   M 2   S 5\n` +
      `Or commands: TODAY · DONE · UNDO`
    );
  }

  // Aggregate by size
  const totals = { B: 0, M: 0, S: 0 };
  parsed.forEach(({ size, qty }) => { totals[size] += qty; });

  const isLate = stock.day_closed;

  // Detect late sales (after day close)
  if (isLate) {
    // Allow but flag — reopen day first
    await db.reopenDay(truckId);
  }

  // Apply stock
  const updatedStock = await db.applyStockSale(truckId, {
    qtyB: totals.B,
    qtyM: totals.M,
    qtyS: totals.S,
  });

  // Record in sales log
  await db.recordSale(truckId, { qtyB: totals.B, qtyM: totals.M, qtyS: totals.S }, isLate);

  // Low-stock warnings
  const warnings = [];
  if (updatedStock.full_b < 0) warnings.push(`Big stock now ${updatedStock.full_b}`);
  if (updatedStock.full_m < 0) warnings.push(`Medium stock now ${updatedStock.full_m}`);
  if (updatedStock.full_s < 0) warnings.push(`Small stock now ${updatedStock.full_s}`);

  const [todaySales] = await Promise.all([db.getTodaySales(truckId)]);

  const reply = fmt.multiSaleConfirm(parsed.length, todaySales, updatedStock, warnings);
  await sendMessage(from, reply);

  // If late sale — notify all managers
  if (isLate) {
    const managers = await db.getAllManagers();
    const lateLine =
      `⚠ Late sale on Truck ${truckId} (after day close)\n` +
      `Recorded: ${totals.B > 0 ? totals.B + 'B ' : ''}${totals.M > 0 ? totals.M + 'M ' : ''}${totals.S > 0 ? totals.S + 'S' : ''}`.trim();
    await broadcast(managers.map(m => m.phone), lateLine);
  }

  // Warn invalid lines if any
  if (invalid.length > 0) {
    await sendMessage(from,
      `⚠ These lines were not understood and skipped: ${invalid.join(', ')}`
    );
  }
}

module.exports = { handleSalesperson };
