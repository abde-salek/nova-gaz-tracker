# Gas Canister Sales Tracker — Project Plan (v1)

A WhatsApp-based system to track gas canister sales, empties, and money owed
per truck. No app, no dashboard, no QR codes in v1 — everything happens in chat.

Location: Morocco · Currency: DH · Channel: WhatsApp only · Replies: English

---

## 1. The idea in one paragraph

Each truck has a responsible salesperson with their own WhatsApp chat with the
system. The manager initializes each truck's stock (full canisters by size). As
the salesperson sells, they text the system; full counts go down, empty counts
go up by the same amount (a full is swapped for an empty). At the end of the day
— on `DONE` or auto-close after 20:00 — the system reports sales, money, and
remaining stock to both the salesperson and the manager. The manager can query
any truck with `STATUS TRUCK n`, clear paid debt, and reset returned empties.

---

## 2. Prices (v1, fixed — stored in DB so they can change later)

| Size   | Code | Price |
|--------|------|-------|
| Small  | S    | 10 DH |
| Medium | M    | 20 DH |
| Big    | B    | 50 DH |

---

## 3. Roles

- **Salesperson (truck responsible):** one chat. Reports sales, sends DONE.
- **Manager:** one chat. Initializes stock, queries trucks, clears money when
  paid, resets empties when returned to depot, receives end-of-day summaries.

---

## 4. MVP command set (deliberately small)

### Salesperson chat

| Command | Meaning                | System reply (example)                                |
|---------|------------------------|-------------------------------------------------------|
| `B 3`   | Sold 3 big             | ✓ 3 big sold. Today: 3B. Remaining: 17B 15M 30S.      |
| `M 2`   | Sold 2 medium          | ✓ 2 medium sold. Today: 3B 2M. Remaining: 17B 13M 30S.|
| `S 5`   | Sold 5 small           | ✓ 5 small sold. ...                                   |
| `UNDO`  | Cancel last entry      | ✓ Removed last entry (5 small).                       |
| `TODAY` | Show running totals    | Today: 3B 2M 5S. Today's money: 240 DH.               |
| `DONE`  | Close the day          | (sends day summary — see §6)                          |

Sales can be sent across the day, one per message or several lines in one.

### Manager chat

| Command                    | Meaning                                       |
|----------------------------|-----------------------------------------------|
| `SET TRUCK 12 B20 M15 S30` | Initialize / override FULL stock for truck 12 |
| `STATUS TRUCK 12`          | Full + empty + today's money + unpaid total   |
| `PAID TRUCK 12`            | Reset unpaid total for truck 12 to 0          |
| `EMPTY DONE TRUCK 12`      | Empties returned to depot → reset empties to 0|

> **Deferred to later versions:** the `TRUCK n` button menu (EMPTY/FULL/MONEY/
> WORKERS), WORKERS feature, blocking stock confirmations, CORRECT command,
> SMS fallback, exports, web dashboard, QR codes, local-language replies.

---

## 5. The running-count logic

State held per truck (carries night to night until the manager updates it):

- `full_B`, `full_M`, `full_S` — full canisters on truck
- `empty_B`, `empty_M`, `empty_S` — empties on truck
- `today_money` — money from today's sales (resets at day close)
- `unpaid_total` — accumulated debt not yet paid (carries over)
- today's sale counters per size (reset at day close)

On each sale of quantity `q`, size `X`:

```
full_X       -= q
empty_X      += q          (full swapped for empty)
today_money  += q * price_X
today_sales_X += q
```

At day close (`DONE` or 21:00):

```
unpaid_total += today_money
today_money   = 0
today_sales   = 0
```

Manager actions:

```
PAID TRUCK n        →  unpaid_total = 0
EMPTY DONE TRUCK n  →  empty_B = empty_M = empty_S = 0
SET TRUCK n ...     →  overrides full stock (and resets day if needed)
```

### Money model — why it's split

`today_money` is what was sold today. `unpaid_total` is the running debt. They
are kept separate so that `PAID TRUCK n` makes sense even when yesterday's debt
is still outstanding. `STATUS` always shows both lines distinctly.

### Low-stock handling (soft warning, v1)

If a sale would push stock negative, the system records it anyway and flags it:

```
✓ 3 big sold (⚠ stock was 2, now -1 — check with manager).
```

Negative stock is the signal that the morning count was off. A blocking YES/NO
confirmation can be added in a later version once the core loop is proven.

---

## 6. End-of-day summary (sent to salesperson AND manager)

Triggered by `DONE`, or auto-close at 20:00 if no DONE received.

```
Truck 12 — Day summary (2026-06-01)
Sold:   3 big, 2 medium, 5 small
Today's money: 3×50 + 2×20 + 5×10 = 240 DH
Unpaid total:  240 DH
Full remaining: 17B 13M 25S
Empties on truck: 5B 2M 5S
```

After close, today's counters reset; full stock, empties, and unpaid total carry.

---

## 7. Architecture

| Layer     | Choice                             | Notes                                       |
|-----------|------------------------------------|---------------------------------------------|
| Messaging | WhatsApp Business Cloud API (Meta) | Official, scales to 10–50 trucks            |
| Backend   | Node.js or Python (FastAPI)        | Webhook receives messages, parses, replies  |
| Parser    | Keyword/regex (no AI needed)       | `B 3`, `DONE`, `SET TRUCK ...`              |
| Database  | PostgreSQL                         | trucks, people, prices, stock, sales, pays  |
| Scheduler | Cron / scheduled job               | 20:00 auto-close                            |

### Data model (rough)

- **trucks**: id, label
- **people**: id, phone, name, role (sales/manager), assigned_truck
- **prices**: size, price_dh, effective_date
- **truck_stock**: truck_id, full_B/M/S, empty_B/M/S, today_money, unpaid_total, updated_at
- **sales**: id, truck_id, date, size, qty, ts
- **payments**: id, truck_id, amount, ts (records each PAID reset)

---

## 8. Build phases

**Phase 1 — Foundations (week 1–2)**
WhatsApp Cloud API setup + verified business number, webhook backend, DB schema,
parser. One test truck. Goal: `B 3` gets stored and confirmed.

**Phase 2 — Full sales flow (week 3–4)**
Multi-size reporting, running totals, UNDO, TODAY, soft low-stock warning,
DONE + 20:00 auto-close, end-of-day summary to salesperson and manager.

**Phase 3 — Manager controls (week 5)**
SET TRUCK, STATUS TRUCK (full/empty/today/unpaid), PAID, EMPTY DONE.

**Phase 4 — Hardening (week 6)**
Error handling (typos, malformed input), onboarding salespeople, price-in-DB,
edge cases. Prove the daily loop is reliable before expanding.

---

## 9. Deferred to v2+ (explicitly out of scope now)

QR codes · web dashboard · `TRUCK n` interactive button menu ·
WORKERS / multiple workers per truck · blocking stock confirmation ·
CORRECT command · SMS fallback · French/Darija replies · exports.

---

## 10. Critical setup note

The WhatsApp Business Cloud API requires a verified business and a Meta-approved
phone number. Approval takes time and is the most common cause of launch delays
— start it on day one of Phase 1.
