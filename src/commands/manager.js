'use strict';

const db = require('../db/queries');
const { sendMessage } = require('../whatsapp/sender');
const fmt = require('../whatsapp/formatter');

/**
 * Handle a message from a registered manager.
 * @param {object} person  - Row from people table
 * @param {string} text    - Raw message text (already trimmed/uppercased)
 * @param {string} from    - Sender phone
 */
async function handleManager(person, text, from) {
  // ── SET TRUCK n B20 M15 S30 ──────────────────────────────────────────────
  const setMatch = text.match(/^SET TRUCK (\d+)\s+B(\d+)\s+M(\d+)\s+S(\d+)$/);
  if (setMatch) return handleSetTruck(from, setMatch);

  // ── STATUS TRUCK n ───────────────────────────────────────────────────────
  const statusMatch = text.match(/^STATUS TRUCK (\d+)$/);
  if (statusMatch) return handleStatusTruck(from, parseInt(statusMatch[1], 10));

  // ── PAID TRUCK n ─────────────────────────────────────────────────────────
  const paidMatch = text.match(/^PAID TRUCK (\d+)$/);
  if (paidMatch) return handlePaidTruck(from, parseInt(paidMatch[1], 10));

  // ── EMPTY DONE TRUCK n ───────────────────────────────────────────────────
  const emptyMatch = text.match(/^EMPTY DONE TRUCK (\d+)$/);
  if (emptyMatch) return handleEmptyDone(from, parseInt(emptyMatch[1], 10));

  // ── ADD MANAGER phone name ───────────────────────────────────────────────
  const addManagerMatch = text.match(/^ADD MANAGER (\S+)\s+(.+)$/);
  if (addManagerMatch) return handleAddManager(from, addManagerMatch);

  // ── ADD SALES phone name TRUCK n ─────────────────────────────────────────
  const addSalesMatch = text.match(/^ADD SALES (\S+)\s+(.+?)\s+TRUCK (\d+)$/);
  if (addSalesMatch) return handleAddSales(from, addSalesMatch);

  // ── REMOVE PERSON phone ──────────────────────────────────────────────────
  const removeMatch = text.match(/^REMOVE PERSON (\S+)$/);
  if (removeMatch) return handleRemovePerson(from, removeMatch[1]);

  // ── SET PRICE B|M|S amount ──────────────────────────────────────────────
  const priceMatch = text.match(/^SET PRICE (B|M|S)\s+(\d+([.,]\d+)?)$/);
  if (priceMatch) return handleSetPrice(from, priceMatch);

  // ── Unknown command ──────────────────────────────────────────────────────
  return sendMessage(from, managerHelp());
}

// ─── SET TRUCK ────────────────────────────────────────────────────────────────

async function handleSetTruck(from, match) {
  const truckId = parseInt(match[1], 10);
  const b = parseInt(match[2], 10);
  const m = parseInt(match[3], 10);
  const s = parseInt(match[4], 10);

  await db.upsertTruck(truckId);
  await db.setFullStock(truckId, b, m, s);

  return sendMessage(from,
    `✓ Truck ${truckId} stock set: ${b}B ${m}M ${s}S\nDay reset and ready.`
  );
}

// ─── STATUS TRUCK ─────────────────────────────────────────────────────────────

async function handleStatusTruck(from, truckId) {
  const [stock, todaySales, prices] = await Promise.all([
    db.getStock(truckId),
    db.getTodaySales(truckId),
    db.getPrices(),
  ]);

  if (!stock) {
    return sendMessage(from, `✗ Truck ${truckId} not found or not initialized.`);
  }

  return sendMessage(from, fmt.truckStatus(truckId, stock, todaySales, prices));
}

// ─── PAID TRUCK ───────────────────────────────────────────────────────────────

async function handlePaidTruck(from, truckId) {
  const stock = await db.getStock(truckId);
  if (!stock) return sendMessage(from, `✗ Truck ${truckId} not found.`);

  const prev = stock.unpaid_total;
  await db.resetPaidTotal(truckId);

  return sendMessage(from,
    `✓ Truck ${truckId} — unpaid total cleared (was ${prev} DH). Now 0 DH.`
  );
}

// ─── EMPTY DONE TRUCK ─────────────────────────────────────────────────────────

async function handleEmptyDone(from, truckId) {
  const stock = await db.getStock(truckId);
  if (!stock) return sendMessage(from, `✗ Truck ${truckId} not found.`);

  const prev = `${stock.empty_b}B ${stock.empty_m}M ${stock.empty_s}S`;
  await db.resetEmpties(truckId);

  return sendMessage(from,
    `✓ Truck ${truckId} — empties reset to 0 (were ${prev}).`
  );
}

// ─── ADD MANAGER ──────────────────────────────────────────────────────────────

const WELCOME_MANAGER =
  `Welcome to Nova Gaz Tracker! You are registered as a manager.\n\n` +
  `Commands:\n` +
  `SET TRUCK n B20 M15 S30\n` +
  `STATUS TRUCK n\n` +
  `PAID TRUCK n\n` +
  `EMPTY DONE TRUCK n\n` +
  `SET PRICE <B/M/S> <price>\n` +
  `ADD SALES 06xxxxxxxx Name TRUCK n\n` +
  `ADD MANAGER 06xxxxxxxx Name\n` +
  `REMOVE PERSON 06xxxxxxxx`;

const WELCOME_SALES = (name, truckId) =>
  `Welcome ${name} to Nova Gaz Tracker! You are assigned to Truck ${truckId}.\n\n` +
  `Commands:\n` +
  `B 3   — sell 3 big\n` +
  `M 2   — sell 2 medium\n` +
  `S 5   — sell 5 small\n` +
  `B 3 \ M 2 — multi-line sale\n` +
  `TODAY — see today's totals\n` +
  `DONE  — close the day\n` +
  `UNDO  — cancel last entry`;

async function handleAddManager(from, match) {
  const phone = match[1];
  const name  = match[2].trim();

  const person = await db.addPerson({ phone, name, role: 'manager' });

  // Send welcome to the new manager
  await sendMessage(person.phone, WELCOME_MANAGER);

  return sendMessage(from,
    `✓ Manager added: ${name} (${person.phone})`
  );
}

// ─── ADD SALES ────────────────────────────────────────────────────────────────

async function handleAddSales(from, match) {
  const phone   = match[1];
  const name    = match[2].trim();
  const truckId = parseInt(match[3], 10);

  // Ensure truck exists
  await db.upsertTruck(truckId);
  const person = await db.addPerson({ phone, name, role: 'sales', truckId });

  // Send welcome to the new salesperson
  await sendMessage(person.phone, WELCOME_SALES(name, truckId));

  return sendMessage(from,
    `✓ Salesperson added: ${name} (${person.phone}) → Truck ${truckId}`
  );
}

// ─── REMOVE PERSON ────────────────────────────────────────────────────────────

async function handleRemovePerson(from, phone) {
  const removed = await db.removePerson(phone);

  if (!removed) {
    return sendMessage(from, `✗ No person found with number ${phone}.`);
  }

  return sendMessage(from, `✓ Removed person with number ${phone}.`);
}

// ─── SET PRICE ─────────────────────────────────────────────────────────────────

async function handleSetPrice(from, match) {
  const size  = match[1].toUpperCase();
  const price = parseFloat(match[2].replace(',', '.'));

  await db.setPrice(size, price);

  return sendMessage(from,
    `✓ Price set: ${size} = ${price.toFixed(2)} DH`
  );
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function managerHelp() {
  return (
    `Manager commands:\n` +
    `SET TRUCK n B20 M15 S30\n` +
    `STATUS TRUCK n\n` +
    `PAID TRUCK n\n` +
    `EMPTY DONE TRUCK n\n` +
    `SET PRICE <B/M/S> <amount>\n` +
    `ADD MANAGER 06xxxxxxxx Name\n` +
    `ADD SALES 06xxxxxxxx Name TRUCK n\n` +
    `REMOVE PERSON 06xxxxxxxx`
  );
}

module.exports = { handleManager };
