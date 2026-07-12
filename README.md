# Nova Gaz Tracker 🛢️

WhatsApp-based gas canister sales tracker for Morocco.  
No app. No dashboard. Everything in chat.

---

## Stack

| Layer     | Choice                        |
|-----------|-------------------------------|
| Messaging | WhatsApp Business Cloud API   |
| Backend   | Node.js 20 + Express          |
| Database  | PostgreSQL via Supabase        |
| Scheduler | node-cron (22:00 auto-close)  |
| Deploy    | Docker → GCP Cloud Run        |

---

## Quick start (local dev)

```bash
# 1. Clone and install
git clone <your-repo>
cd nova-gaz-tracker
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your real values (see Environment section below)

# 3. Run migrations (creates all tables + seeds default prices)
npm run db:migrate

# 4. (Optional) Insert dev test data
npm run db:seed

# 5. Start server
npm run dev        # nodemon — restarts on file changes
# or
npm start
```

The server listens on `http://localhost:3000`.  
Use [ngrok](https://ngrok.com/) to expose it for WhatsApp webhook testing:
```bash
ngrok http 3000
# Copy the https URL → use as webhook in Meta dashboard
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable                | Description                                      |
|-------------------------|--------------------------------------------------|
| `WHATSAPP_TOKEN`        | Access token from Meta Business Suite  |
| `WHATSAPP_PHONE_ID`     | Phone Number ID from the WhatsApp app dashboard  |
| `WHATSAPP_VERIFY_TOKEN` | Any random string — must match Meta webhook config |
| `DATABASE_URL`          | Supabase connection string (Settings → Database) |
| `PORT`                  | Server port (default 3000; Cloud Run uses 8080)  |
| `TZ`                    | `Africa/Casablanca` (already in .env.example)    |

---

## Deploy to GCP Cloud Run

```bash
# 1. Build and push image
gcloud builds submit --tag gcr.io/YOUR_PROJECT/nova-gaz-tracker

# 2. Deploy
gcloud run deploy nova-gaz-tracker \
  --image gcr.io/YOUR_PROJECT/nova-gaz-tracker \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars WHATSAPP_TOKEN=xxx,WHATSAPP_PHONE_ID=yyy,WHATSAPP_VERIFY_TOKEN=zzz,DATABASE_URL=postgresql://...

# 3. Copy the service URL → set as webhook in Meta dashboard
#    URL: https://<service-url>/webhook
```

> **Important:** WhatsApp Business Cloud API requires a verified Meta business
> and an approved phone number. Start the approval process on day one —
> it is the most common cause of launch delays.

---

## WhatsApp webhook setup (Meta)

1. Go to [developers.facebook.com](https://developers.facebook.com) → your app → WhatsApp → Configuration
2. Webhook URL: `https://your-service-url/webhook`
3. Verify token: same value as `WHATSAPP_VERIFY_TOKEN` in your `.env`
4. Subscribe to the `messages` field

---

## Command reference

### Salesperson commands

| Command      | Description                    |
|--------------|--------------------------------|
| `B 3`        | Sold 3 big canisters           |
| `M 2`        | Sold 2 medium canisters        |
| `S 5`        | Sold 5 small canisters         |
| `B 3\nM 2`   | Multi-line: sold 3B and 2M     |
| `TODAY`      | Show running totals + stock    |
| `DONE`       | Close the day manually         |
| `UNDO`       | Cancel last entry *(once/day)* |

**UNDO boundary:** one undo per day only. Once used, it resets at the next day close.

**Low stock:** if a sale pushes stock negative, it is recorded with a ⚠ warning — no blocking.

**Late sales:** if sent after day close (DONE or auto-close), the sale is recorded,
the day is reopened, and all managers are notified.

### Manager commands

| Command                        | Description                              |
|--------------------------------|------------------------------------------|
| `SET TRUCK 12 B20 M15 S30`     | Initialize / override full stock         |
| `STATUS TRUCK 12`              | Full + empties + today + unpaid          |
| `PAID TRUCK 12`                | Clear unpaid total (debt paid)           |
| `EMPTY DONE TRUCK 12`          | Empties returned to depot → reset to 0  |
| `ADD MANAGER 0622445566 Name`  | Register a new manager                   |
| `ADD SALES 0698765432 Name TRUCK 3` | Register salesperson on truck 3   |
| `REMOVE PERSON 0698765432`     | Remove a person from the system          |

### Auto-close
Every day at **22:00 Africa/Casablanca**, trucks with activity that haven't
sent DONE are closed automatically. Trucks with zero sales that day are skipped.

---

## Prices (v1, fixed)

| Size   | Code | Price  |
|--------|------|--------|
| Big    | B    | 50 DH  |
| Medium | M    | 20 DH  |
| Small  | S    | 10 DH  |

Prices are stored in the `prices` table and can be updated without code changes.

---

## Database schema

```
trucks        id, created_at
people        id, phone, name, role, truck_id
prices        size, price_dh, effective_date
truck_stock   truck_id, full_b/m/s, empty_b/m/s,
              today_money, unpaid_total, day_closed,
              undo_used, updated_at
sales         id, truck_id, date, qty_b/m/s, is_late, undone, ts
payments      id, truck_id, ts
```

---

## Project structure

```
nova-gaz-tracker/
├── src/
│   ├── index.js                  # Express server + webhook endpoints
│   ├── commands/
│   │   ├── salesperson.js        # B/M/S sales, TODAY, DONE, UNDO
│   │   └── manager.js            # SET/STATUS/PAID/EMPTY DONE/ADD/REMOVE
│   ├── db/
│   │   ├── pool.js               # pg connection pool
│   │   └── queries.js            # all DB functions
│   ├── scheduler/
│   │   └── autoClose.js          # 22:00 cron job
│   └── whatsapp/
│       ├── router.js             # identifies sender, routes to handler
│       ├── sender.js             # sendMessage / broadcast helpers
│       └── formatter.js          # all reply message templates
├── scripts/
│   ├── migrate.js                # npm run db:migrate
│   └── seed.js                   # npm run db:seed (dev only)
├── .env.example
├── Dockerfile
└── package.json
```
