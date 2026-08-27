#!/usr/bin/env node
/**
 * Deterministic mock-data generator for Spending View.
 *
 * Emits:
 *   data/mock-apple-card.csv          - Apple Card export format
 *   data/mock-card-transactions.csv   - generic card export format
 *   js/mock-data.js                   - the same two CSVs embedded as JS strings
 *
 * All merchants, people, and card numbers are fictional. Run with:
 *   node scripts/generate-mock-data.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- seeded PRNG (mulberry32) so output is stable across runs ---------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260827);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);

// --- fictional merchant catalog ---------------------------------------------
// weight = relative likelihood per day; range = typical charge size.
const MERCHANTS = [
  { name: "Greenfield Market",   cat: 'Grocery',        range: [8, 140],  weight: 30, addr: '1200 ORCHARD AVE SPRINGFIELD 90011 CA' },
  { name: 'Corner Grocer',       cat: 'Grocery',        range: [4, 45],   weight: 14, addr: '77 ELM ST SPRINGFIELD 90012 CA' },
  { name: 'Harvest Foods',       cat: 'Grocery',        range: [15, 110], weight: 10, addr: '450 MEADOW LN RIVERTON 90210 CA' },
  { name: 'Blue Door Cafe',      cat: 'Restaurants',    range: [6, 38],   weight: 20, addr: '18 MAIN ST SPRINGFIELD 90011 CA', tst: true },
  { name: 'Noodle Junction',     cat: 'Restaurants',    range: [12, 55],  weight: 12, addr: '901 CANAL ST SPRINGFIELD 90013 CA', tst: true },
  { name: 'Taco Verde',          cat: 'Restaurants',    range: [9, 40],   weight: 14, addr: '2400 SUNSET BLVD RIVERTON 90210 CA' },
  { name: 'Sunrise Diner',       cat: 'Restaurants',    range: [11, 48],  weight: 8,  addr: '5 HARBOR RD BAYSIDE 90501 CA' },
  { name: 'Pizza Piazza',        cat: 'Restaurants',    range: [14, 62],  weight: 8,  addr: '333 OAK AVE SPRINGFIELD 90011 CA' },
  { name: 'Sushi Grove',         cat: 'Restaurants',    range: [22, 95],  weight: 6,  addr: '840 GARDEN WAY RIVERTON 90210 CA', tst: true },
  { name: 'Coffee Collective',   cat: 'Restaurants',    range: [4, 16],   weight: 24, addr: '61 STATION PLZ SPRINGFIELD 90012 CA', sq: true },
  { name: 'Burger Barn',         cat: 'Restaurants',    range: [8, 30],   weight: 10, addr: '710 RANCH RD MESQUITE FLATS 85300 AZ' },
  { name: 'Roadstar Fuel',       cat: 'Gas',            range: [22, 68],  weight: 8,  addr: '1500 HIGHWAY 9 SPRINGFIELD 90014 CA' },
  { name: 'Metro Gas',           cat: 'Gas',            range: [18, 60],  weight: 5,  addr: '210 DEPOT ST RIVERTON 90210 CA' },
  { name: 'City Rideshare',      cat: 'Transportation', range: [7, 42],   weight: 12, addr: '400 TECH PARK DR METROPOLIS 94100 CA' },
  { name: 'Metro Transit',       cat: 'Transportation', range: [2.5, 12], weight: 8,  addr: '1 TRANSIT WAY METROPOLIS 94101 CA' },
  { name: 'Cinema Plaza',        cat: 'Entertainment',  range: [12, 46],  weight: 4,  addr: '95 PROMENADE SPRINGFIELD 90011 CA' },
  { name: 'Fun Zone Arcade',     cat: 'Entertainment',  range: [10, 55],  weight: 3,  addr: '22 PIER AVE BAYSIDE 90501 CA' },
  { name: 'City Bike Share',     cat: 'Entertainment',  range: [4, 18],   weight: 8,  addr: '600 GREENWAY METROPOLIS 94102 CA' },
  { name: 'MegaMart Online',     cat: 'Shopping',       range: [9, 180],  weight: 16, addr: '1 FULFILLMENT RD COMMERCE 98100 WA' },
  { name: 'Style Outlet',        cat: 'Shopping',       range: [20, 160], weight: 5,  addr: '78 FASHION SQ RIVERTON 90210 CA' },
  { name: 'Gadget Depot',        cat: 'Shopping',       range: [15, 320], weight: 4,  addr: '512 CIRCUIT DR METROPOLIS 94103 CA' },
  { name: 'Harborview Hotel',    cat: 'Hotels',         range: [120, 420],weight: 1.2,addr: '2 SEASIDE BLVD BAYSIDE 90501 CA' },
  { name: 'Summit Lodge',        cat: 'Hotels',         range: [140, 380],weight: 0.8,addr: '9000 ALPINE RD SUMMIT VALE 80400 CO' },
  { name: 'Pacific Air',         cat: 'Airlines',       range: [140, 520],weight: 1.1, addr: '100 SKYWAY METROPOLIS 94104 CA' },
  { name: 'Blue Sky Airlines',   cat: 'Airlines',       range: [120, 480],weight: 0.9, addr: '200 AIRPORT LOOP MESQUITE FLATS 85301 AZ' },
  { name: 'Downtown Clinic',     cat: 'Medical',        range: [25, 220], weight: 1,  addr: '30 WELLNESS CT SPRINGFIELD 90015 CA' },
  { name: 'City Pharmacy',       cat: 'Medical',        range: [6, 55],   weight: 3,  addr: '88 MAIN ST SPRINGFIELD 90011 CA' },
  { name: 'Parking Plus',        cat: 'Other',          range: [3, 24],   weight: 7,  addr: '450 GARAGE WAY METROPOLIS 94105 CA' },
  { name: 'Quick Print Shop',    cat: 'Other',          range: [5, 40],   weight: 2,  addr: '12 COPY LN SPRINGFIELD 90012 CA' },
  { name: 'Speedy Car Rental',   cat: 'Car-rentals',    range: [60, 240], weight: 0.6,addr: '300 AIRPORT LOOP MESQUITE FLATS 85301 AZ' },
  { name: 'Vine & Barrel',       cat: 'Alcohol',        range: [14, 85],  weight: 2,  addr: '17 CELLAR ROW RIVERTON 90210 CA' },
  { name: 'Express Toll',        cat: 'Tolls',          range: [2, 14],   weight: 1.5,addr: 'PO BOX 100 METROPOLIS 94106 CA' },
  { name: 'City Parking Meters', cat: 'Govt-services-parking', range: [1.5, 9], weight: 2, addr: 'CITY HALL SPRINGFIELD 90011 CA' },
  { name: 'Shield Insurance',    cat: 'Insurance',      range: [95, 130], weight: 0.3,addr: '700 SECURE BLVD COMMERCE 98101 WA' },
];
const SUBSCRIPTIONS = [
  { name: 'StreamFlex',     cat: 'Entertainment', amount: 15.99, day: 3,  addr: '500 MEDIA WAY METROPOLIS 94107 CA' },
  { name: 'CloudNote Pro',  cat: 'Other',         amount: 9.99,  day: 12, addr: '25 SAAS ST METROPOLIS 94108 CA' },
  { name: 'FitPass Gym',    cat: 'Entertainment', amount: 39.0,  day: 18, addr: '340 MUSCLE AVE SPRINGFIELD 90016 CA' },
];
const PERSON = 'Sample User';
const totalWeight = MERCHANTS.reduce((s, m) => s + m.weight, 0);
function weightedMerchant() {
  let r = rand() * totalWeight;
  for (const m of MERCHANTS) { r -= m.weight; if (r <= 0) return m; }
  return MERCHANTS[0];
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const usDate = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const money = (n) => n.toFixed(2);
const csvField = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const csvRow = (cells) => cells.map(csvField).join(',');

function rawDescriptor(m) {
  let prefix = '';
  if (m.tst) prefix = 'TST*';
  else if (m.sq) prefix = 'SQ *';
  const upper = m.name.toUpperCase().replace(/[^A-Z0-9& ]/g, '');
  return `${prefix}${upper}`.slice(0, 22);
}

// ---------------------------------------------------------------------------
// 1) Apple Card format: Jan 2024 -> Aug 2026
// ---------------------------------------------------------------------------
const appleRows = [];
const START = new Date(Date.UTC(2024, 0, 1));
const END = new Date(Date.UTC(2026, 7, 27));
let monthlySpend = new Map(); // 'YYYY-MM' -> spend total, to size payments

for (let d = new Date(START); d <= END; d = addDays(d, 1)) {
  const dow = d.getUTCDay();
  const seasonal = 1 + 0.25 * Math.sin((d.getUTCMonth() + 1) / 12 * Math.PI * 2);
  const weekendBoost = (dow === 0 || dow === 6) ? 1.6 : 1;
  let n = 0;
  const expected = 1.15 * seasonal * weekendBoost;
  let acc = expected;
  while (acc > 0) { if (rand() < Math.min(acc, 1)) n++; acc -= 1; }

  for (let i = 0; i < n; i++) {
    const m = weightedMerchant();
    const amt = between(m.range[0], m.range[1]);
    const clearing = addDays(d, 1 + Math.floor(rand() * 2));
    const desc = `${rawDescriptor(m)} ${m.addr} USA`;
    appleRows.push({
      date: new Date(d), row: [usDate(d), usDate(clearing), desc, m.name, m.cat, 'Purchase', money(amt), PERSON],
    });
    const mk = iso(d).slice(0, 7);
    monthlySpend.set(mk, (monthlySpend.get(mk) || 0) + amt);
  }

  // monthly subscriptions
  for (const s of SUBSCRIPTIONS) {
    if (d.getUTCDate() === s.day) {
      const desc = `${s.name.toUpperCase()} ${s.addr} USA`;
      appleRows.push({ date: new Date(d), row: [usDate(d), usDate(addDays(d, 1)), desc, s.name, s.cat, 'Purchase', money(s.amount), PERSON] });
      const mk = iso(d).slice(0, 7);
      monthlySpend.set(mk, (monthlySpend.get(mk) || 0) + s.amount);
    }
  }

  // occasional refund (Credit)
  if (rand() < 0.012) {
    const m = pick(MERCHANTS.filter((x) => ['Shopping', 'Airlines', 'Hotels'].includes(x.cat)));
    const amt = -between(m.range[0], m.range[1] * 0.6);
    appleRows.push({ date: new Date(d), row: [usDate(d), usDate(addDays(d, 1)), `${rawDescriptor(m)} ${m.addr} USA`, m.name, 'Credit', 'Credit', money(amt), PERSON] });
  }

  // rare Daily Cash adjustment (Debit)
  if (rand() < 0.004) {
    const amt = between(0.3, 6);
    appleRows.push({ date: new Date(d), row: [usDate(d), usDate(d), 'DAILY CASH ADJUSTMENT', 'Daily Cash Adjustment', 'Debit', 'Debit', money(amt), PERSON] });
  }

  // monthly installment + payment on the 5th
  if (d.getUTCDate() === 5) {
    appleRows.push({ date: new Date(d), row: [usDate(d), usDate(d), 'GADGET DEPOT MONTHLY INSTALLMENT', 'Gadget Depot Installments', 'Installment', 'Installment', money(41.62), PERSON] });
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15));
    const owed = monthlySpend.get(iso(prev).slice(0, 7)) || 0;
    if (owed > 0) {
      const payment = -(Math.round(owed / 10) * 10);
      appleRows.push({ date: new Date(d), row: [usDate(d), usDate(d), 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1122', 'Ach Deposit Internet Transfer From Account Ending In 1122', 'Payment', 'Payment', money(payment), PERSON] });
    }
  }
}
appleRows.sort((a, b) => b.date - a.date);
const APPLE_HEADER = 'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By';
const appleCsv = [APPLE_HEADER, ...appleRows.map((r) => csvRow(r.row))].join('\n') + '\n';

// ---------------------------------------------------------------------------
// 2) Generic card format: Feb 2026 -> Aug 2026, two cards
// ---------------------------------------------------------------------------
const cardRows = [];
const C_START = new Date(Date.UTC(2026, 1, 10));
const C_END = new Date(Date.UTC(2026, 7, 26));
const CARDS = ['1122', '3344'];

for (let d = new Date(C_START); d <= C_END; d = addDays(d, 1)) {
  const n = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0;
  for (let i = 0; i < n; i++) {
    const m = weightedMerchant();
    const amt = between(m.range[0], m.range[1]);
    const posted = addDays(d, 1 + Math.floor(rand() * 2));
    const card = rand() < 0.8 ? CARDS[0] : CARDS[1];
    cardRows.push({ date: new Date(d), row: [iso(d), iso(posted), m.name, money(amt), card, PERSON, `${rawDescriptor(m)}`] });
  }
  if (d.getUTCDate() === 10) {
    cardRows.push({ date: new Date(d), row: [iso(d), iso(d), 'Payment', money(-between(300, 900)), '', '', ''] });
  }
}
// special rows: refund pair, autopay, interest, late fee, balance transfer
cardRows.push({ date: new Date(Date.UTC(2026, 5, 18)), row: ['2026-06-18', '2026-06-18', 'Pacific Air', money(-262.4), '1122', PERSON, 'PACIFIC AIR'] });
cardRows.push({ date: new Date(Date.UTC(2026, 3, 4)), row: ['2026-04-04', '2026-04-04', 'Autopay Payment', money(-1), '', '', ''] });
cardRows.push({ date: new Date(Date.UTC(2026, 6, 14)), row: ['2026-07-14', '2026-07-14', 'Interest Charge', money(1.42), '', '', ''] });
cardRows.push({ date: new Date(Date.UTC(2026, 6, 9)), row: ['2026-07-09', '2026-07-09', 'Late payment fee', money(30), '', '', ''] });
cardRows.push({ date: new Date(Date.UTC(2026, 1, 19)), row: ['2026-02-19', '2026-02-19', 'Balance Transfer', money(52.75), '', '', ''] });
cardRows.sort((a, b) => b.date - a.date);
const CARD_HEADER = 'Transaction Date,Posted Date,Description,Amount,Card Last 4,Name on Card,Raw Merchant Name';
const cardCsv = [CARD_HEADER, ...cardRows.map((r) => csvRow(r.row))].join('\n') + '\n';

// ---------------------------------------------------------------------------
mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(join(ROOT, 'js'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'mock-apple-card.csv'), appleCsv);
writeFileSync(join(ROOT, 'data', 'mock-card-transactions.csv'), cardCsv);

const js = `// GENERATED by scripts/generate-mock-data.mjs - do not edit by hand.
// Mock transaction data (fictional merchants/people) embedded so the sample
// dataset loads even when index.html is opened directly from disk.
window.SV = window.SV || {};
window.SV.MOCK_DATA = {
  'mock-apple-card.csv': ${JSON.stringify(appleCsv)},
  'mock-card-transactions.csv': ${JSON.stringify(cardCsv)}
};
`;
writeFileSync(join(ROOT, 'js', 'mock-data.js'), js);

console.log(`apple rows: ${appleRows.length}, card rows: ${cardRows.length}`);
console.log('wrote data/mock-apple-card.csv, data/mock-card-transactions.csv, js/mock-data.js');
