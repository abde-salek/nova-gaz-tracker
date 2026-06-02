'use strict';

const cron = require('node-cron');
const db = require('../db/queries');
const { sendMessage, broadcast } = require('../whatsapp/sender');
const fmt = require('../whatsapp/formatter');

/**
 * Runs every day at 22:00 Africa/Casablanca.
 * Closes any truck that had activity today but hasn't been manually closed.
 */
function startScheduler() {
  // Cron: minute hour * * *  →  0 22 * * *
  // node-cron uses the system TZ set via TZ env var (Africa/Casablanca)
  cron.schedule('0 22 * * *', autoClose, {
    timezone: 'Africa/Casablanca',
  });

  console.log('[Scheduler] Auto-close job registered — fires at 22:00 Africa/Casablanca');
}

async function autoClose() {
  console.log('[Scheduler] Running auto-close...');

  try {
    const trucks = await db.getAllActiveTrucks();
    const prices = await db.getPrices();
    const today = new Date().toISOString().slice(0, 10);

    for (const truck of trucks) {
      try {
        const [stock, todaySales] = await Promise.all([
          db.getStock(truck.id),
          db.getTodaySales(truck.id),
        ]);

        if (!stock) continue;

        // Skip trucks with zero activity today
        const totalActivity =
          Number(todaySales.total_b) +
          Number(todaySales.total_m) +
          Number(todaySales.total_s);

        if (totalActivity === 0) {
          console.log(`[Scheduler] Truck ${truck.id} — no activity, skipping.`);
          continue;
        }

        // Skip already-closed trucks
        if (stock.day_closed) {
          console.log(`[Scheduler] Truck ${truck.id} — already closed, skipping.`);
          continue;
        }

        // Close the day
        await db.closeDay(truck.id);

        const summary = fmt.daySummary(truck.id, today, todaySales, stock, prices, true);

        // Notify salesperson
        const salesperson = await db.getSalespersonByTruck(truck.id);
        if (salesperson) {
          await sendMessage(salesperson.phone, summary);
        }

        // Notify all managers
        const managers = await db.getAllManagers();
        await broadcast(managers.map(m => m.phone), summary);

        console.log(`[Scheduler] Truck ${truck.id} — closed and summaries sent.`);
      } catch (truckErr) {
        console.error(`[Scheduler] Error closing truck ${truck.id}:`, truckErr);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Auto-close failed:', err);
  }
}

module.exports = { startScheduler, autoClose };
