'use strict';

/**
 * All outbound message templates.
 * Keeping them here makes it easy to translate or tweak wording later.
 */

function stockLine(stock) {
  return `${stock.full_b}B ${stock.full_m}M ${stock.full_s}S`;
}

function emptiesLine(stock) {
  return `${stock.empty_b}B ${stock.empty_m}M ${stock.empty_s}S`;
}

function moneyBreakdown(todayB, todayM, todayS, prices) {
  const parts = [];
  if (todayB > 0) parts.push(`${todayB}×${prices.B}`);
  if (todayM > 0) parts.push(`${todayM}×${prices.M}`);
  if (todayS > 0) parts.push(`${todayS}×${prices.S}`);
  return parts.join(' + ');
}

function saleConfirm(label, qty, todaySales, stock, lowStock) {
  const warn = lowStock ? ` (⚠ stock was low, now ${lowStock} — check with manager)` : '';
  const todayStr = formatSold(todaySales);
  return (
    `✓ ${qty} ${label} sold.${warn}\n` +
    `Today: ${todayStr}\n` +
    `Remaining: ${stockLine(stock)}`
  );
}

function multiSaleConfirm(lines, todaySales, stock, warnings) {
  const warnStr = warnings.length
    ? '\n' + warnings.map(w => `⚠ ${w}`).join('\n')
    : '';
  return (
    `✓ Recorded ${lines} sale(s).${warnStr}\n` +
    `Today: ${formatSold(todaySales)}\n` +
    `Remaining: ${stockLine(stock)}`
  );
}

function todayStatus(todaySales, stock, prices) {
  const money =
    todaySales.total_b * prices.B +
    todaySales.total_m * prices.M +
    todaySales.total_s * prices.S;
  return (
    `Today: ${formatSold(todaySales)}\n` +
    `Today's money: ${money} DH\n` +
    `Remaining: ${stockLine(stock)}`
  );
}

function daySummary(truckId, date, todaySales, stock, prices, isAuto = false) {
  const b = Number(todaySales.total_b);
  const m = Number(todaySales.total_m);
  const s = Number(todaySales.total_s);
  const money = b * prices.B + m * prices.M + s * prices.S;
  const trigger = isAuto ? '(auto-close 22:00)' : '';

  return (
    `Truck ${truckId} — Day summary ${date} ${trigger}\n` +
    `Sold:   ${formatSoldRaw(b, m, s)}\n` +
    `Today's money: ${moneyBreakdown(b, m, s, prices)} = ${money} DH\n` +
    `Unpaid total:  ${Number(stock.unpaid_total) + money} DH\n` +
    `Full remaining: ${stockLine(stock)}\n` +
    `Empties on truck: ${emptiesLine(stock)}`
  );
}

function truckStatus(truckId, stock, todaySales, prices) {
  const b = Number(todaySales.total_b);
  const m = Number(todaySales.total_m);
  const s = Number(todaySales.total_s);
  const todayMoney = b * prices.B + m * prices.M + s * prices.S;

  return (
    `Truck ${truckId} status:\n` +
    `Full:    ${stockLine(stock)}\n` +
    `Empties: ${emptiesLine(stock)}\n` +
    `Today's money: ${todayMoney} DH\n` +
    `Unpaid total:  ${stock.unpaid_total} DH\n` +
    `Day closed: ${stock.day_closed ? 'Yes' : 'No'}`
  );
}

function undoConfirm(sale) {
  const desc = formatSoldRaw(sale.qty_b, sale.qty_m, sale.qty_s);
  return `✓ Last entry undone (${desc}). UNDO used for today — no further undos until tomorrow.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSold(todaySales) {
  return formatSoldRaw(
    Number(todaySales.total_b),
    Number(todaySales.total_m),
    Number(todaySales.total_s)
  );
}

function formatSoldRaw(b, m, s) {
  const parts = [];
  if (b > 0) parts.push(`${b}B`);
  if (m > 0) parts.push(`${m}M`);
  if (s > 0) parts.push(`${s}S`);
  return parts.length ? parts.join(' ') : '0 sales';
}

module.exports = {
  saleConfirm,
  multiSaleConfirm,
  todayStatus,
  daySummary,
  truckStatus,
  undoConfirm,
  stockLine,
};
