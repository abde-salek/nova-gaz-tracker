'use strict';

const db = require('../db/queries');
const { sendMessage } = require('../whatsapp/sender');
const { handleSalesperson } = require('../commands/salesperson');
const { handleManager } = require('../commands/manager');

/**
 * Entry point for every inbound WhatsApp message.
 * Identifies the sender role and routes accordingly.
 */
async function routeMessage(from, rawText) {
  if (!rawText || !rawText.trim()) return;

  const text = rawText.trim().toUpperCase();
  const person = await db.getPersonByPhone(from);

  // Unknown sender
  if (!person) {
    return sendMessage(from, '✗ Unknown number. Contact your manager to be registered.');
  }

  // Role-based routing
  if (person.role === 'manager') {
    return handleManager(person, text, from);
  }

  if (person.role === 'sales') {
    // Guard: salesperson trying a manager command
    if (isManagerCommand(text)) {
      return sendMessage(from, '✗ Command not allowed for your role.');
    }
    return handleSalesperson(person, text, from);
  }

  return sendMessage(from, '✗ Unknown role. Contact your manager.');
}

/**
 * Detect if a message looks like a manager-only command.
 */
function isManagerCommand(text) {
  return (
    text.startsWith('SET TRUCK') ||
    text.startsWith('STATUS TRUCK') ||
    text.startsWith('PAID TRUCK') ||
    text.startsWith('EMPTY DONE TRUCK') ||
    text.startsWith('ADD MANAGER') ||
    text.startsWith('ADD SALES') ||
    text.startsWith('REMOVE PERSON')
  );
}

module.exports = { routeMessage };
