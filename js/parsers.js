// Format detection + normalization of raw CSV records into the canonical
// transaction model shared by the whole app.
//
// Canonical transaction:
//   { id, source, sourceFile, date, postedDate, description, merchant,
//     merchantKey, rawMerchant, sourceCategory, autoCategory, type, amount,
//     card, person, city, state }
// amount is signed: positive = charge/spend, negative = payment/refund.
(function (SV) {
  'use strict';

  const APPLE_HEADER = ['Transaction Date', 'Clearing Date', 'Description', 'Merchant', 'Category', 'Type', 'Amount (USD)', 'Purchased By'];
  const CARD_HEADER = ['Transaction Date', 'Posted Date', 'Description', 'Amount', 'Card Last 4', 'Name on Card', 'Raw Merchant Name'];

  SV.SOURCES = {
    'apple-card': { label: 'Apple Card export', header: APPLE_HEADER },
    'card-export': { label: 'Card transaction export', header: CARD_HEADER },
  };

  SV.detectFormat = function (header) {
    const h = header.map((x) => x.toLowerCase());
    const has = (name) => h.includes(name.toLowerCase());
    if (has('Merchant') && has('Amount (USD)')) return 'apple-card';
    if (has('Raw Merchant Name') && has('Card Last 4')) return 'card-export';
    return null;
  };

  function usToISO(s) { // 'MM/DD/YYYY' -> 'YYYY-MM-DD'
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  function anyToISO(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return usToISO(s);
  }

  // best-effort location from Apple Card descriptions, which end in
  // "... CITY 90011 CA USA" (city and zip are sometimes run together).
  function parseLocation(desc) {
    const m = desc.match(/(?:\s|^)((?:[A-Z][A-Z.'-]*\s){0,3}[A-Z][A-Z.'-]*?)\s*(\d{5}(?:-\d{4})?)\s+([A-Z]{2})\s+(?:USA|US)\s*$/);
    if (!m) return { city: null, state: null };
    let city = m[1].replace(/\d+$/, '').trim();
    if (/^(STE|SUITE|BLVD|AVE|ST|RD|DR|LN|WAY|HWY|CT|PKWY|PLZ)$/.test(city)) city = null;
    return { city: city || null, state: m[3] };
  }

  // keyword auto-categorization for sources without a category column;
  // user overrides always win over this.
  const AUTO_RULES = [
    [/airline|airways|\bair\b|southwes|alaska a|american\b|delta|united air|jetblue/i, 'Airlines'],
    [/hotel|lodge|suites|resort|\binn\b|hilton|marriott|renaissance|hyatt|priceline|expedia|booking|airbnb/i, 'Hotels'],
    [/car rental|rent-?a-?car|budget\.com|hertz|avis\b|enterprise rent|truck rental/i, 'Car-rentals'],
    [/shell|chevron|exxon|mobil\b|\bfuel\b|\bgas\b|arco\b|sunoco/i, 'Gas'],
    [/uber(?!\s*\*?eats)|lyft|waymo|taxi|transit|rideshare|metro\b|amtrak/i, 'Transportation'],
    [/\btoll\b|sunpass|ezpass|e-zpass/i, 'Tolls'],
    [/parking|flowbird|meter\b/i, 'Govt-services-parking'],
    [/pharmacy|\bcvs\b|walgreens|clinic|medical|dental|hospital|retina|health/i, 'Medical'],
    [/insurance|allianz/i, 'Insurance'],
    [/netflix|hulu|spotify|audible|kindle|cinema|theatre|theater|\bamc\b|classpass|arcade|bike|lime\*|bird\b|golf|museum/i, 'Entertainment'],
    [/grocer|market\b|supermarket|foods\b|trader joe|whole foods|publix|safeway|kroger|aldi\b|costco|creamery/i, 'Grocery'],
    [/tst\*|tst\s|sq \*|restaurant|cafe|caffe|coffee|pizza|sushi|ramen|grill|diner|\bbar\b|taco|burger|kitchen|bbq|deli|bakery|donut|doughnut|juice|shack|eats|chipotle|starbucks|noodle|brewing|brewery|steak|oyster|ristorante|cantina|shake/i, 'Restaurants'],
    [/amazon|amzn|walmart|target\b|\bross\b|zara\b|h&m|outlet|depot\b|mart\b|clothing|apparel/i, 'Shopping'],
    [/apple\.com|itunes|anthropic|openai|cloud|\bsaas\b|\bpro\b/i, 'Other'],
  ];
  SV.autoCategory = function (text) {
    for (const [re, cat] of AUTO_RULES) if (re.test(text)) return cat;
    return null;
  };

  const CARD_TYPE_RULES = [
    [/balance transfer/i, 'Balance Transfer'],
    [/interest/i, 'Interest'],
    [/\bfee\b/i, 'Fee'],
    [/payment/i, 'Payment'],
  ];

  let nextId = 1;

  function normalizeApple(rec, file) {
    const date = anyToISO(rec['Transaction Date']);
    const amount = parseFloat(rec['Amount (USD)']);
    if (!date || !isFinite(amount)) return null;
    const desc = rec['Description'] || '';
    const merchant = rec['Merchant'] || desc || '(unknown)';
    const loc = parseLocation(desc);
    const type = rec['Type'] || 'Other';
    return {
      id: nextId++, source: 'apple-card', sourceFile: file,
      date, postedDate: anyToISO(rec['Clearing Date']),
      description: desc, merchant, merchantKey: merchant.toLowerCase(),
      rawMerchant: desc,
      sourceCategory: rec['Category'] || null,
      autoCategory: null,
      type, amount,
      card: null, person: rec['Purchased By'] || null,
      city: loc.city, state: loc.state,
    };
  }

  function normalizeCard(rec, file) {
    const date = anyToISO(rec['Transaction Date']);
    const amount = parseFloat(rec['Amount']);
    if (!date || !isFinite(amount)) return null;
    const desc = rec['Description'] || '';
    const card = rec['Card Last 4'] || null;
    let type = 'Purchase';
    if (!card) {
      type = 'Other';
      for (const [re, t] of CARD_TYPE_RULES) if (re.test(desc)) { type = t; break; }
    } else if (amount < 0) {
      type = 'Credit';
    }
    const merchant = desc || '(unknown)';
    const searchText = `${desc} ${rec['Raw Merchant Name'] || ''}`;
    let autoCategory = null;
    if (type === 'Purchase' || type === 'Credit') autoCategory = SV.autoCategory(searchText);
    else if (type === 'Payment') autoCategory = 'Payment';
    else if (type === 'Interest' || type === 'Fee') autoCategory = 'Fees & interest';
    else if (type === 'Balance Transfer') autoCategory = 'Balance transfer';
    return {
      id: nextId++, source: 'card-export', sourceFile: file,
      date, postedDate: anyToISO(rec['Posted Date']),
      description: desc, merchant, merchantKey: merchant.toLowerCase(),
      rawMerchant: rec['Raw Merchant Name'] || null,
      sourceCategory: null,
      autoCategory,
      type, amount,
      card, person: rec['Name on Card'] || null,
      city: null, state: null,
    };
  }

  // Parse one CSV text into { source, transactions, header } or throw with a
  // readable message.
  SV.parseTransactionsCSV = function (text, fileName) {
    const rows = SV.parseCSV(text);
    if (!rows.length) throw new Error(`${fileName}: file is empty`);
    const { header, records } = SV.csvToObjects(rows);
    const source = SV.detectFormat(header);
    if (!source) {
      throw new Error(`${fileName}: unrecognized columns [${header.join(', ')}]. Expected an Apple Card export or a card export with "Raw Merchant Name".`);
    }
    const normalize = source === 'apple-card' ? normalizeApple : normalizeCard;
    const transactions = [];
    let skipped = 0;
    for (const rec of records) {
      const t = normalize(rec, fileName);
      if (t) transactions.push(t); else skipped++;
    }
    return { source, transactions, header, skipped };
  };
})(window.SV);
