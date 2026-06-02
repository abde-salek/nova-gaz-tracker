const pool = require('./pool');

// ─── People ──────────────────────────────────────────────────────────────────

async function getPersonByPhone(phone) {
  const { rows } = await pool.query(
    'SELECT * FROM people WHERE phone = $1',
    [normalizePhone(phone)]
  );
  return rows[0] || null;
}

async function addPerson({ phone, name, role, truckId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO people (phone, name, role, truck_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (phone) DO UPDATE SET name = $2, role = $3, truck_id = $4
     RETURNING *`,
    [normalizePhone(phone), name, role, truckId]
  );
  return rows[0];
}

async function removePerson(phone) {
  const { rowCount } = await pool.query(
    'DELETE FROM people WHERE phone = $1',
    [normalizePhone(phone)]
  );
  return rowCount > 0;
}

// ─── Trucks ──────────────────────────────────────────────────────────────────

async function getTruck(truckId) {
  const { rows } = await pool.query(
    'SELECT * FROM trucks WHERE id = $1',
    [truckId]
  );
  return rows[0] || null;
}

async function getAllActiveTrucks() {
  const { rows } = await pool.query('SELECT * FROM trucks ORDER BY id');
  return rows;
}

async function upsertTruck(truckId) {
  const { rows } = await pool.query(
    `INSERT INTO trucks (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [truckId]
  );
  return rows[0];
}

// ─── Truck Stock ─────────────────────────────────────────────────────────────

async function getStock(truckId) {
  const { rows } = await pool.query(
    'SELECT * FROM truck_stock WHERE truck_id = $1',
    [truckId]
  );
  return rows[0] || null;
}

async function setFullStock(truckId, fullB, fullM, fullS) {
  const { rows } = await pool.query(
    `INSERT INTO truck_stock
       (truck_id, full_b, full_m, full_s, empty_b, empty_m, empty_s,
        today_money, unpaid_total, day_closed, undo_used, updated_at)
     VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, false, false, NOW())
     ON CONFLICT (truck_id) DO UPDATE SET
       full_b = $2, full_m = $3, full_s = $4,
       day_closed = false, undo_used = false,
       updated_at = NOW()
     RETURNING *`,
    [truckId, fullB, fullM, fullS]
  );
  return rows[0];
}

async function applyStockSale(truckId, { qtyB = 0, qtyM = 0, qtyS = 0 }) {
  const prices = await getPrices();
  const deltaB = qtyB * prices.B;
  const deltaM = qtyM * prices.M;
  const deltaS = qtyS * prices.S;
  const deltaMoney = deltaB + deltaM + deltaS;

  const { rows } = await pool.query(
    `UPDATE truck_stock SET
       full_b       = full_b - $2,
       full_m       = full_m - $3,
       full_s       = full_s - $4,
       empty_b      = empty_b + $2,
       empty_m      = empty_m + $3,
       empty_s      = empty_s + $4,
       today_money  = today_money + $5,
       updated_at   = NOW()
     WHERE truck_id = $1
     RETURNING *`,
    [truckId, qtyB, qtyM, qtyS, deltaMoney]
  );
  return rows[0];
}

async function undoLastSale(truckId) {
  // Get last sale of today that hasn't been undone
  const { rows: saleRows } = await pool.query(
    `SELECT * FROM sales
     WHERE truck_id = $1
       AND undone = false
       AND date = CURRENT_DATE AT TIME ZONE 'Africa/Casablanca'
     ORDER BY ts DESC
     LIMIT 1`,
    [truckId]
  );
  if (!saleRows.length) return null;

  const sale = saleRows[0];
  const prices = await getPrices();
  const refund =
    sale.qty_b * prices.B + sale.qty_m * prices.M + sale.qty_s * prices.S;

  // Reverse the stock change
  await pool.query(
    `UPDATE truck_stock SET
       full_b      = full_b + $2,
       full_m      = full_m + $3,
       full_s      = full_s + $4,
       empty_b     = empty_b - $2,
       empty_m     = empty_m - $3,
       empty_s     = empty_s - $4,
       today_money = today_money - $5,
       undo_used   = true,
       updated_at  = NOW()
     WHERE truck_id = $1`,
    [truckId, sale.qty_b, sale.qty_m, sale.qty_s, refund]
  );

  // Mark sale as undone
  await pool.query(
    'UPDATE sales SET undone = true WHERE id = $1',
    [sale.id]
  );

  return sale;
}

async function markUndoUsed(truckId) {
  await pool.query(
    'UPDATE truck_stock SET undo_used = true WHERE truck_id = $1',
    [truckId]
  );
}

async function resetPaidTotal(truckId) {
  const { rows } = await pool.query(
    `UPDATE truck_stock SET unpaid_total = 0, updated_at = NOW()
     WHERE truck_id = $1 RETURNING *`,
    [truckId]
  );
  // Record payment
  await pool.query(
    'INSERT INTO payments (truck_id, ts) VALUES ($1, NOW())',
    [truckId]
  );
  return rows[0];
}

async function resetEmpties(truckId) {
  const { rows } = await pool.query(
    `UPDATE truck_stock SET
       empty_b = 0, empty_m = 0, empty_s = 0, updated_at = NOW()
     WHERE truck_id = $1 RETURNING *`,
    [truckId]
  );
  return rows[0];
}

async function closeDay(truckId) {
  const { rows } = await pool.query(
    `UPDATE truck_stock SET
       unpaid_total = unpaid_total + today_money,
       today_money  = 0,
       day_closed   = true,
       undo_used    = false,
       updated_at   = NOW()
     WHERE truck_id = $1
     RETURNING *`,
    [truckId]
  );
  return rows[0];
}

async function reopenDay(truckId) {
  await pool.query(
    `UPDATE truck_stock SET day_closed = false, updated_at = NOW()
     WHERE truck_id = $1`,
    [truckId]
  );
}

// ─── Sales ───────────────────────────────────────────────────────────────────

async function recordSale(truckId, { qtyB = 0, qtyM = 0, qtyS = 0 }, isLate = false) {
  const { rows } = await pool.query(
    `INSERT INTO sales (truck_id, date, qty_b, qty_m, qty_s, is_late, undone, ts)
     VALUES ($1, CURRENT_DATE AT TIME ZONE 'Africa/Casablanca', $2, $3, $4, $5, false, NOW())
     RETURNING *`,
    [truckId, qtyB, qtyM, qtyS, isLate]
  );
  return rows[0];
}

async function getTodaySales(truckId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(qty_b),0) AS total_b,
            COALESCE(SUM(qty_m),0) AS total_m,
            COALESCE(SUM(qty_s),0) AS total_s
     FROM sales
     WHERE truck_id = $1
       AND date = CURRENT_DATE AT TIME ZONE 'Africa/Casablanca'
       AND undone = false`,
    [truckId]
  );
  return rows[0];
}

// ─── Prices ──────────────────────────────────────────────────────────────────

async function getPrices() {
  const { rows } = await pool.query(
    `SELECT size, price_dh FROM prices
     WHERE effective_date = (SELECT MAX(effective_date) FROM prices)`
  );
  const map = {};
  rows.forEach(r => { map[r.size] = Number(r.price_dh); });
  return map; // { B: 50, M: 20, S: 10 }
}

// ─── Salesperson for truck ────────────────────────────────────────────────────

async function getSalespersonByTruck(truckId) {
  const { rows } = await pool.query(
    `SELECT * FROM people WHERE truck_id = $1 AND role = 'sales' LIMIT 1`,
    [truckId]
  );
  return rows[0] || null;
}

async function getAllManagers() {
  const { rows } = await pool.query(
    `SELECT * FROM people WHERE role = 'manager'`
  );
  return rows;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize Moroccan phone numbers to a consistent format.
 * Accepts: 0612345678, 212612345678, +212612345678
 * Stores as: 212612345678 (without +)
 */
function normalizePhone(phone) {
  let p = String(phone).replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '212' + p.slice(1);
  return p;
}

module.exports = {
  getPersonByPhone,
  addPerson,
  removePerson,
  getTruck,
  getAllActiveTrucks,
  upsertTruck,
  getStock,
  setFullStock,
  applyStockSale,
  undoLastSale,
  markUndoUsed,
  resetPaidTotal,
  resetEmpties,
  closeDay,
  reopenDay,
  recordSale,
  getTodaySales,
  getPrices,
  getSalespersonByTruck,
  getAllManagers,
  normalizePhone,
};
