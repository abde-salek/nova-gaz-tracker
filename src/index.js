'use strict';

require('dotenv').config();

const express = require('express');
const { routeMessage } = require('./whatsapp/router');
const { startScheduler, autoClose } = require('./scheduler/autoClose');
const pool = require('./db/pool');

const app = express();
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Nova Gaz Tracker' });
});

// ─── Local test helpers (only available when MOCK_WHATSAPP=true) ──────────────

if (process.env.MOCK_WHATSAPP === 'true') {

  /**
   * POST /test/message
   * Body: { "from": "212600000002", "text": "B 3" }
   * Always returns 200 — errors are logged server-side, not thrown to client.
   */
  app.post('/test/message', async (req, res) => {
    const { from, text } = req.body;
    if (!from || !text) {
      return res.status(400).json({ error: 'Body must have "from" and "text"' });
    }
    // Respond immediately — same pattern as the real webhook
    res.json({ ok: true, from, text });
    // Process in background
    routeMessage(from, text).catch(err => {
      console.error(`[Test] routeMessage error for ${from}:`, err.message);
    });
  });

  /**
   * POST /test/autoclose
   * Manually triggers the 22:00 auto-close job.
   */
  app.post('/test/autoclose', async (req, res) => {
    // Respond immediately, run in background
    res.json({ ok: true, message: 'Auto-close triggered' });
    autoClose().catch(err => {
      console.error('[Test] Auto-close error:', err.message);
    });
  });

  console.log('[Dev] Test endpoints active:');
  console.log('      POST /test/message   { "from": "212...", "text": "B 3" }');
  console.log('      POST /test/autoclose');
}

// ─── WhatsApp webhook verification (GET) ─────────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verified by Meta.');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed — token mismatch.');
  res.sendStatus(403);
});

// ─── WhatsApp webhook receiver (POST) ────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Meta requires 200 within 20 s

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        for (const msg of (change.value?.messages || [])) {
          if (msg.type !== 'text') continue;
          const from = msg.from;
          const text = msg.text?.body || '';
          console.log(`[Webhook] from=${from} text=${text.slice(0, 80)}`);
          routeMessage(from, text).catch(err =>
            console.error(`[Router] error for ${from}:`, err.message)
          );
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] payload error:', err.message);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function start() {
  // Quick DB connectivity check before accepting traffic
  try {
    await pool.query('SELECT 1');
    console.log('[DB] Connected successfully.');
  } catch (err) {
    console.error('[DB] Cannot connect to database:', err.message);
    console.error('     Check DATABASE_URL in your .env file.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n[Nova Gaz Tracker] Listening on port ${PORT}`);
    startScheduler();
  });
}

start();
