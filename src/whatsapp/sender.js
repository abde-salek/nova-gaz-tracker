const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
const MOCK = process.env.MOCK_WHATSAPP === 'true';

/**
 * Send a plain text WhatsApp message.
 * When MOCK_WHATSAPP=true, prints to console instead of calling Meta.
 * @param {string} to   - Recipient phone (e.g. "212612345678")
 * @param {string} text - Message body
 */
async function sendMessage(to, text) {
  if (MOCK) {
    console.log(`\n📱 [MOCK → ${to}]\n${text}\n${'─'.repeat(50)}`);
    return;
  }

  try {
    await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WhatsApp] Failed to send to ${to}:`, JSON.stringify(detail));
  }
}

/**
 * Send the same message to multiple recipients.
 * @param {string[]} phones
 * @param {string}   text
 */
async function broadcast(phones, text) {
  await Promise.all(phones.map(p => sendMessage(p, text)));
}

module.exports = { sendMessage, broadcast };
