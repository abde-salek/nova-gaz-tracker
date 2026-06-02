'use strict';

require('dotenv').config();
const pool = require('../src/db/pool');

/**
 * Dev-only seed: inserts a test manager and a test truck.
 * Run with: npm run db:seed
 * Safe to run multiple times (uses ON CONFLICT DO NOTHING).
 */
async function seed() {
  const client = await pool.connect();

  try {
    console.log('[Seed] Seeding dev data...');

    // Test truck
    await client.query(`
      INSERT INTO trucks (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);

    // Test manager (phone normalized: 212 + 0612345678 without leading 0)
    await client.query(`
      INSERT INTO people (phone, name, role)
      VALUES ('212600000001', 'Manager Test', 'manager')
      ON CONFLICT (phone) DO NOTHING
    `);

    // Test salesperson assigned to truck 1
    await client.query(`
      INSERT INTO people (phone, name, role, truck_id)
      VALUES ('212600000002', 'Sales Test', 'sales', 1)
      ON CONFLICT (phone) DO NOTHING
    `);

    // Test stock for truck 1
    await client.query(`
      INSERT INTO truck_stock (truck_id, full_b, full_m, full_s)
      VALUES (1, 20, 15, 30)
      ON CONFLICT (truck_id) DO NOTHING
    `);

    console.log('[Seed] ✓ Dev data inserted.');
    console.log('  Manager  → 0600000001');
    console.log('  Sales    → 0600000002  (Truck 1)');
    console.log('  Stock    → 20B 15M 30S');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
