'use strict';

require('dotenv').config();
const pool = require('../src/db/pool');

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('[Migrate] Running migrations...');

    await client.query(`
      -- ── Trucks ──────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS trucks (
        id         INTEGER PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ── People ──────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS people (
        id         SERIAL PRIMARY KEY,
        phone      VARCHAR(20)  NOT NULL UNIQUE,   -- normalized: 212xxxxxxxxx
        name       VARCHAR(100) NOT NULL,
        role       VARCHAR(10)  NOT NULL CHECK (role IN ('sales', 'manager')),
        truck_id   INTEGER REFERENCES trucks(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ── Prices ──────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS prices (
        size           CHAR(1)        NOT NULL CHECK (size IN ('B', 'M', 'S')),
        price_dh       NUMERIC(10, 2) NOT NULL,
        effective_date DATE           NOT NULL DEFAULT CURRENT_DATE,
        PRIMARY KEY (size, effective_date)
      );

      -- ── Truck stock ─────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS truck_stock (
        truck_id      INTEGER PRIMARY KEY REFERENCES trucks(id),
        full_b        INTEGER NOT NULL DEFAULT 0,
        full_m        INTEGER NOT NULL DEFAULT 0,
        full_s        INTEGER NOT NULL DEFAULT 0,
        empty_b       INTEGER NOT NULL DEFAULT 0,
        empty_m       INTEGER NOT NULL DEFAULT 0,
        empty_s       INTEGER NOT NULL DEFAULT 0,
        today_money   NUMERIC(10, 2) NOT NULL DEFAULT 0,
        unpaid_total  NUMERIC(10, 2) NOT NULL DEFAULT 0,
        day_closed    BOOLEAN NOT NULL DEFAULT false,
        undo_used     BOOLEAN NOT NULL DEFAULT false,  -- UNDO boundary: one per day
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );

      -- ── Sales log ───────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS sales (
        id        SERIAL PRIMARY KEY,
        truck_id  INTEGER NOT NULL REFERENCES trucks(id),
        date      DATE    NOT NULL,
        qty_b     INTEGER NOT NULL DEFAULT 0,
        qty_m     INTEGER NOT NULL DEFAULT 0,
        qty_s     INTEGER NOT NULL DEFAULT 0,
        is_late   BOOLEAN NOT NULL DEFAULT false,  -- recorded after day close
        undone    BOOLEAN NOT NULL DEFAULT false,
        ts        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS sales_truck_date ON sales(truck_id, date);

      -- ── Payments log ────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS payments (
        id        SERIAL PRIMARY KEY,
        truck_id  INTEGER NOT NULL REFERENCES trucks(id),
        ts        TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Seed default prices (only if table is empty) ─────────────────────────
    const { rowCount } = await client.query('SELECT 1 FROM prices LIMIT 1');
    if (rowCount === 0) {
      await client.query(`
        INSERT INTO prices (size, price_dh, effective_date) VALUES
          ('B', 50, CURRENT_DATE),
          ('M', 20, CURRENT_DATE),
          ('S', 10, CURRENT_DATE)
      `);
      console.log('[Migrate] Default prices seeded: B=50 DH, M=20 DH, S=10 DH');
    }

    console.log('[Migrate] ✓ All tables ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('[Migrate] Failed:', err);
  process.exit(1);
});
