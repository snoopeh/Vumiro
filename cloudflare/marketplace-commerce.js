// Sandbox commerce boundary. Production requires a separately reviewed implementation.
import { recordMarketplaceMetric } from './marketplace-metrics.js';
export const COMMERCE_TERMS_VERSION = '2026-11-11-sandbox-v1';
export const STRIPE_API_VERSION = '2026-10-28.endive';
const PREFIX = '/api/v1/marketplace';
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
const minor = value => { if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) fail(422, 'Invalid provider amount'); return value; };
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
const first = (db, sql, ...args) => statement(db, sql, ...args).first();
async function metricOnce(db, orderId, event, itemId) {
  try {
    const result = await statement(db, 'INSERT OR IGNORE INTO marketplace_commerce_metric_events(order_id,event) VALUES(?,?)', orderId, event).run();
    if (result.meta?.changes === 1) await recordMarketplaceMetric(db, event, itemId);
  } catch { /* Aggregate telemetry must never block commerce. */ }
}
function sandbox(env) {
  if (env.MARKETPLACE_COMMERCE_MODE !== 'sandbox' || !/^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY || '')) fail(503, 'Paid commerce requires configured sandbox credentials; production is unavailable');
}
function returnUrl(env) {
  let url; try { url = new URL(env.MARKETPLACE_RETURN_URL); } catch { fail(503, 'Operator must configure the browser return URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail(503, 'Invalid return URL');
  return url.href;
}
function hostedUrl(value, hostname) {
  let url; try { url = new URL(value); } catch { fail(502, 'Provider omitted hosted URL'); }
  if (url.protocol !== 'https:' || url.hostname !== hostname || url.username || url.password) fail(502, 'Untrusted provider URL');
  return url.href;
}
async function stripe(env, path, fields, key) {
  sandbox(env);
  if (!/^\/[a-z0-9_/]+$/.test(path)) fail(502, 'Invalid provider path');
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_API_VERSION };
  let url = `https://api.stripe.com/v1${path}`;
  const options = { method: fields ? 'POST' : 'GET', headers, redirect: 'error' };
  if (fields) { options.body = new URLSearchParams(fields).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (key) headers['Idempotency-Key'] = key;
  if (!fields && path.startsWith('/checkout/sessions/')) url += '?expand[]=payment_intent.latest_charge.balance_transaction';
  const response = await (env.STRIPE_FETCH || fetch)(url, options);
  if (!response.ok) fail(502, 'Payment provider request failed');
  const result = await response.json();
  if (result.livemode === true) fail(502, 'Live provider response refused');
  return result;
}
function providerId(id, prefix) { if (typeof id !== 'string' || id.length>255 || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(id)) fail(502, 'Invalid provider identifier'); return id; }
function verifiedAccount(account) {
  return account.charges_enabled === true && account.payouts_enabled === true && account.details_submitted === true && account.capabilities?.transfers === 'active' && !(account.requirements?.currently_due?.length) && !(account.requirements?.past_due?.length) && !account.requirements?.disabled_reason;
}
/** Provider boundary: hosted pages, verified events and canonical payment state only.
 * Provider implementations are selected in source, never from browser input or a production env toggle.
 */
export class StripeSandboxProvider {
  constructor(env) { sandbox(env); this.env = env; this.name = 'stripe'; this.mode = 'sandbox'; }
  verifyEvent(request) { return signature(request, this.env); }
  retrieveAccount(id) { return stripe(this.env, `/accounts/${providerId(id, 'acct')}`); }
  createAccount(accountId) { return stripe(this.env, '/accounts', { type: 'express', 'capabilities[transfers][requested]': 'true', 'capabilities[card_payments][requested]': 'true', 'metadata[marketplace_account_id]': accountId }, `onboard-${accountId}`); }
  createOnboardingLink(accountId, redirect) { return stripe(this.env, '/account_links', { account: accountId, refresh_url: redirect, return_url: redirect, type: 'account_onboarding' }); }
  createCheckout(order, redirect) {
    return stripe(this.env, '/checkout/sessions', {
      mode: 'payment', 'payment_method_types[0]': 'card', success_url: redirect, cancel_url: redirect,
      client_reference_id: order.id, 'metadata[order_id]': order.id, 'payment_intent_data[metadata][order_id]': order.id,
      'payment_intent_data[transfer_group]': order.id, 'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': order.currency, 'line_items[0][price_data][unit_amount]': String(order.price_minor),
      'line_items[0][price_data][product_data][name]': order.title, 'automatic_tax[enabled]': 'false'
    }, `checkout-${order.id}`);
  }
  retrieveCheckout(id) { return stripe(this.env, `/checkout/sessions/${providerId(id, 'cs')}`); }
  async retrievePayment(sessionId) {
    const session = await this.retrieveCheckout(sessionId);
    const charge = session.payment_intent?.latest_charge;
    const balance = charge && typeof charge === 'object' ? charge.balance_transaction : null;
    return { sessionId: session.id, orderId: session.metadata?.order_id, currency: session.currency,
      paid: session.payment_status === 'paid', chargePaid: charge?.paid === true,
      chargeId: charge?.id, chargeCurrency: charge?.currency, paymentId: session.payment_intent?.id,
      grossMinor: charge?.amount, sessionTotalMinor: session.amount_total, taxMinor: session.total_details?.amount_tax || 0,
      refundedMinor: charge?.amount_refunded || 0, processingMinor: balance?.fee,
      feeKnown: !!balance && typeof balance === 'object' && Number.isSafeInteger(balance.fee),
      settlementCurrency: balance?.currency, settled: balance?.status === 'available', hasDispute: charge?.disputed === true };
  }
  retrieveDispute(id) { return stripe(this.env, `/disputes/${providerId(id, '(?:dp|du)')}`); }
  retrieveTransfer(id) { return stripe(this.env, `/transfers/${providerId(id, 'tr')}`); }
  createTransfer(payload, idempotencyKey) { return stripe(this.env, '/transfers', payload, idempotencyKey); }
  reverseTransfer(id, amount, orderId, idempotencyKey) { return stripe(this.env, `/transfers/${providerId(id, 'tr')}/reversals`, { amount: String(amount), 'metadata[order_id]': orderId }, idempotencyKey); }
  createRefund(order) { return stripe(this.env, '/refunds', { payment_intent: order.payment_intent_id, 'metadata[order_id]': order.id }, `refund-${order.id}`); }
}
const providerFor = env => new StripeSandboxProvider(env);
export async function assertCreatorCanSell(db, accountId) {
  const account = await first(db, 'SELECT verified FROM marketplace_provider_accounts WHERE account_id=? AND mode=?', accountId, 'sandbox');
  return account?.verified === 1;
}
async function refreshAccount(env, db, accountId) {
  const stored = await first(db, 'SELECT * FROM marketplace_provider_accounts WHERE account_id=?', accountId);
  if (!stored) fail(409, 'Creator must complete hosted provider onboarding before paid sales');
  const account = await providerFor(env).retrieveAccount(stored.provider_account_id);
  const verified = verifiedAccount(account);
  await statement(db, 'UPDATE marketplace_provider_accounts SET verified=?,updated_at=? WHERE account_id=?', verified ? 1 : 0, Date.now(), accountId).run();
  if (!verified) fail(409, 'Creator provider verification is incomplete');
  return stored;
}
async function readBounded(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail(413, 'Request is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(400, 'Invalid UTF-8'); }
}
async function body(request) {
  const raw = await readBounded(request, 16384);
  try { const data = JSON.parse(raw); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; } catch { fail(400, 'Invalid JSON'); }
}
async function signature(request, env) {
  sandbox(env);
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) fail(503, 'Webhook signing secret is unavailable');
  const raw = await readBounded(request, 1048576);
  const parts = (request.headers.get('stripe-signature') || '').split(',');
  const times = parts.filter(x => x.startsWith('t=')); const signatures = parts.filter(x => /^v1=[a-f0-9]{64}$/.test(x)).map(x => x.slice(3));
  if (times.length !== 1) fail(400, 'Invalid webhook signature');
  const timestamp = Number(times[0].slice(2));
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) fail(400, 'Invalid webhook timestamp');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let valid = false;
  for (const hex of signatures) {
    const bytes = Uint8Array.from(hex.match(/../g), x => parseInt(x, 16));
    valid = await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`${timestamp}.${raw}`)) || valid;
  }
  if (!valid) fail(400, 'Invalid webhook signature');
  let event; try { event = JSON.parse(raw); } catch { fail(400, 'Invalid webhook payload'); }
  if (!event.id || typeof event.id !== 'string' || event.id.length > 255 || event.livemode !== false || !event.data?.object) fail(400, 'Only sandbox snapshot events are accepted');
  return event;
}
function ledgerDelta(db, orderId, kind, expression, reference, now) {
  // Read the target and previous sum INSIDE the atomic batch, never from an earlier JS snapshot.
  return statement(db, `INSERT INTO marketplace_ledger(id,order_id,kind,amount_minor,currency,provider_reference,created_at)
    SELECT ?,id,?,(${expression})-COALESCE((SELECT SUM(amount_minor) FROM marketplace_ledger WHERE order_id=o.id AND kind=?),0),currency,?,?
    FROM marketplace_orders o WHERE id=? AND (${expression})!=COALESCE((SELECT SUM(amount_minor) FROM marketplace_ledger WHERE order_id=o.id AND kind=?),0)`, crypto.randomUUID(), kind, kind, reference, now, orderId, kind);
}
async function completeTransferOperation(env, db, operation) {
  if (Date.now() - operation.created_at > 20 * 3600000) fail(409, 'Money operation requires operator provider reconciliation');
  const payload = JSON.parse(operation.payload);
  // The frozen HTTP payload is authoritative for an uncertain already-sent mutation.
  // This also recovers receipts produced by the old mismatched-column race.
  const expected = minor(Number(payload.amount));
  const result = await providerFor(env).createTransfer(payload, operation.id);
  if (!expected || minor(result.amount) !== expected) fail(502, 'Transfer amount mismatch');
  providerId(result.id, 'tr');
  await db.batch([
    statement(db, 'UPDATE marketplace_orders SET transfer_id=?,transferred_minor=?,payout_status=? WHERE id=? AND transfer_id IS NULL', result.id, expected, 'transferred_to_provider', operation.order_id),
    ledgerDelta(db, operation.order_id, 'creator_transfer', '-transferred_minor', result.id, Date.now()),
    statement(db, "UPDATE marketplace_provider_operations SET status='completed',provider_reference=?,amount_minor=?,target_minor=? WHERE id=?", result.id, expected, expected, operation.id)
  ]);
  return result;
}
async function syncProviderTransfer(env, db, orderId, suppliedId) {
  let order = await first(db, 'SELECT * FROM marketplace_orders WHERE id=?', orderId);
  if (!order?.transfer_id) { if (suppliedId) fail(409, 'Transfer receipt is not available yet; retry'); return order; }
  if (suppliedId && suppliedId !== order.transfer_id) fail(422, 'Provider transfer mismatch');
  const transfer = await providerFor(env).retrieveTransfer(order.transfer_id);
  const reversed = minor(transfer.amount_reversed || 0);
  if (order.transfer_id !== transfer.id || transfer.metadata?.order_id !== orderId || minor(transfer.amount) !== order.transferred_minor || reversed > order.transferred_minor) fail(422, 'Provider transfer mismatch');
  await db.batch([
    statement(db, "UPDATE marketplace_orders SET recovered_minor=MAX(recovered_minor,?),payout_status=CASE WHEN ?>0 THEN 'recovered' ELSE payout_status END WHERE id=?", reversed, reversed, orderId),
    ledgerDelta(db, orderId, 'transfer_recovery', 'recovered_minor', transfer.id, Date.now())
  ]);
  return first(db, 'SELECT * FROM marketplace_orders WHERE id=?', orderId);
}
async function recoverTransfer(env, db, orderId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const uncertainTransfer = await first(db, "SELECT * FROM marketplace_provider_operations WHERE order_id=? AND kind='transfer' AND status='processing'", orderId);
    if (uncertainTransfer) await completeTransferOperation(env, db, uncertainTransfer);
    const order = await syncProviderTransfer(env, db, orderId);
    if (!order.transfer_id) return;
    const target = order.disputed ? order.transferred_minor : Math.max(0, order.transferred_minor - order.creator_minor);
    let operation = await first(db, "SELECT * FROM marketplace_provider_operations WHERE order_id=? AND status='processing'", orderId);
    if (target <= order.recovered_minor) {
      if (operation?.kind === 'recovery' && operation.target_minor <= order.recovered_minor) await statement(db, "UPDATE marketplace_provider_operations SET status='completed',provider_reference=? WHERE id=?", `canonical:${order.transfer_id}`, operation.id).run();
      return;
    }
    if (operation?.kind === 'recovery' && operation.target_minor > order.recovered_minor && operation.amount_minor > order.transferred_minor - order.recovered_minor) {
      // With monotonic amount_reversed below this operation's target, an amount
      // exceeding the remaining transfer cannot already have succeeded. Retire it
      // without changing/replaying its parameters, then use a distinct key.
      await statement(db, "UPDATE marketplace_provider_operations SET status='completed',provider_reference=? WHERE id=? AND status='processing'", `superseded:${order.transfer_id}:${order.recovered_minor}`, operation.id).run();
      operation = null;
    }
    const id = `recovery-${order.id}-${target}-from-${order.recovered_minor}`;
    await statement(db, `INSERT OR IGNORE INTO marketplace_provider_operations(id,order_id,kind,target_minor,amount_minor,payload,status,created_at)
      SELECT ?,id,'recovery',?,?-recovered_minor,json_object('transferId',transfer_id,'baseRecoveredMinor',recovered_minor),'processing',? FROM marketplace_orders
      WHERE id=? AND recovered_minor=? AND recovered_minor<? AND NOT EXISTS(SELECT 1 FROM marketplace_provider_operations WHERE order_id=? AND status='processing')`, id, target, target, Date.now(), orderId, order.recovered_minor, target, orderId).run();
    operation = await first(db, "SELECT * FROM marketplace_provider_operations WHERE order_id=? AND status='processing'", orderId);
    if (!operation) continue;
    if (operation.kind !== 'recovery') fail(409, 'Another money operation is pending; retry');
    if (Date.now() - operation.created_at > 20 * 3600000) fail(409, 'Money operation requires operator provider reconciliation');
    const payload = JSON.parse(operation.payload);
    const baseRecovered = payload.baseRecoveredMinor ?? operation.target_minor - operation.amount_minor;
    if (baseRecovered !== order.recovered_minor) fail(409, 'Concurrent provider reversal requires operator reconciliation');
    const result = await providerFor(env).reverseTransfer(payload.transferId, operation.amount_minor, order.id, operation.id);
    if (minor(result.amount) !== operation.amount_minor) fail(502, 'Provider reversal amount mismatch');
    await syncProviderTransfer(env, db, orderId);
    await statement(db, "UPDATE marketplace_provider_operations SET status='completed',provider_reference=? WHERE id=?", result.id, operation.id).run();
  }
  fail(409, 'Recovery advanced concurrently; retry');
}
async function reconcile(env, db, orderId, event) {
  const order = await first(db, 'SELECT * FROM marketplace_orders WHERE id=?', orderId);
  if (!order?.session_id) fail(409, 'Order is not ready; retry webhook');
  const provider = providerFor(env);
  const payment = await provider.retrievePayment(order.session_id);
  if (payment.sessionId !== order.session_id || payment.orderId !== order.id || payment.currency !== order.currency) fail(422, 'Provider order mismatch');
  if (!payment.paid) return;
  if (!payment.chargePaid || payment.chargeCurrency !== order.currency) fail(409, 'Charge details are not ready');
  const gross = minor(payment.grossMinor), tax = minor(payment.taxMinor), refund = minor(payment.refundedMinor);
  if (gross !== minor(payment.sessionTotalMinor) || gross !== order.price_minor + tax || refund > gross) fail(422, 'Provider pricing does not match order snapshot');
  // Settlement and distribution remain blocked until the actual processor fee is known.
  const feeKnown = payment.feeKnown;
  if (feeKnown && payment.settlementCurrency !== order.currency) fail(422, 'Settlement currency conversion requires operator reconciliation');
  const fee = feeKnown ? minor(payment.processingMinor) : 0;
  const disputeId = event?.type?.startsWith('charge.dispute.') ? providerId(event.data.object.id, '(?:dp|du)') : order.dispute_id;
  let disputeStatus = payment.hasDispute ? 'open' : 'none';
  if (disputeId) {
    const dispute = await provider.retrieveDispute(disputeId);
    if ((typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id) !== payment.chargeId) fail(422, 'Dispute charge mismatch');
    disputeStatus = dispute.status === 'lost' ? 'lost' : ['won', 'warning_closed'].includes(dispute.status) ? 'won' : 'open';
  }
  const disputed = disputeStatus === 'lost' ? 1 : 0;
  const now = Date.now();
  const statements = [
    statement(db, `UPDATE marketplace_orders SET payment_intent_id=?,charge_id=?,gross_minor=MAX(gross_minor,?),tax_minor=MAX(tax_minor,?),
      refund_minor=MAX(refund_minor,?),processing_minor=MAX(processing_minor,?),disputed=MAX(disputed,?),dispute_id=COALESCE(?,dispute_id),dispute_status=?,settled=?,updated_at=? WHERE id=?`,
      payment.paymentId, providerId(payment.chargeId, 'ch'), gross, tax, refund, fee, disputed, disputeId || null, disputeStatus, feeKnown && payment.settled && disputeStatus !== 'open' ? 1 : 0, now, orderId),
    statement(db, `UPDATE marketplace_orders SET status=CASE WHEN disputed=1 THEN 'disputed' WHEN refund_minor>0 THEN 'refunded' ELSE 'paid' END,
      creator_minor=CASE WHEN disputed=1 THEN 0 ELSE CAST(MAX(0,gross_minor-tax_minor-refund_minor-processing_minor)*85/100 AS INTEGER) END,
      vumiro_minor=CASE WHEN disputed=1 THEN 0 ELSE MAX(0,gross_minor-tax_minor-refund_minor-processing_minor)-CAST(MAX(0,gross_minor-tax_minor-refund_minor-processing_minor)*85/100 AS INTEGER) END,
      payout_status=CASE WHEN disputed=1 OR refund_minor>0 THEN 'recovery_required' WHEN dispute_status='open' THEN 'dispute_hold' WHEN recovered_minor>0 THEN 'recovered' WHEN transfer_id IS NOT NULL THEN 'transferred_to_provider' WHEN settled=1 THEN 'ready' ELSE 'pending' END WHERE id=?`, orderId)
  ];
  for (const [kind, expression] of Object.entries({ gross: 'gross_minor', tax: '-tax_minor', refund: '-refund_minor', processing_cost: '-processing_minor', creator_earnings: 'creator_minor', vumiro_earnings: 'vumiro_minor' })) statements.push(ledgerDelta(db, orderId, kind, expression, event?.id || 'reconcile', now));
  statements.push(
    statement(db, `INSERT INTO marketplace_entitlements(id,account_id,item_id,status,source,created_at,revoked_at,order_id)
      SELECT ?,account_id,item_id,'active','purchase',?,NULL,id FROM marketplace_orders WHERE id=? AND status='paid'
      ON CONFLICT(account_id,item_id) DO UPDATE SET status='active',source='purchase',revoked_at=NULL,order_id=excluded.order_id
      WHERE marketplace_entitlements.status='revoked' AND COALESCE(marketplace_entitlements.order_id,'')!=excluded.order_id`, crypto.randomUUID(), now, orderId),
    statement(db, `UPDATE marketplace_entitlements SET status='revoked',revoked_at=? WHERE account_id=? AND item_id=? AND order_id=?
      AND EXISTS(SELECT 1 FROM marketplace_orders WHERE id=? AND status IN ('refunded','disputed'))`, now, order.account_id, order.item_id, orderId, orderId),
    statement(db, `UPDATE marketplace_grants SET status='revoked',grace_until=NULL,updated_at=? WHERE account_id=? AND item_id=?
      AND EXISTS(SELECT 1 FROM marketplace_entitlements WHERE account_id=? AND item_id=? AND order_id=? AND status='revoked')`, now, order.account_id, order.item_id, order.account_id, order.item_id, orderId)
  );
  await db.batch(statements);
  await metricOnce(db, orderId, 'acquisition', order.item_id);
  if (refund > 0) await metricOnce(db, orderId, 'refund', order.item_id);
  if (disputeStatus !== 'none') await metricOnce(db, orderId, 'dispute', order.item_id);
  await recoverTransfer(env, db, orderId);
}
async function webhook(request, env, db) {
  const event = await providerFor(env).verifyEvent(request);
  const prior = await first(db, 'SELECT status FROM marketplace_payment_events WHERE provider=? AND event_id=?', 'stripe', event.id);
  if (prior?.status === 'processed' || prior?.status === 'ignored') return json({ received: true, duplicate: true });
  const object = event.data.object;
  let orderId = object.metadata?.order_id;
  if (!orderId && object.payment_intent) orderId = (await first(db, 'SELECT id FROM marketplace_orders WHERE payment_intent_id=?', typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent.id))?.id;
  if (!orderId && object.charge) orderId = (await first(db, 'SELECT id FROM marketplace_orders WHERE charge_id=?', typeof object.charge === 'string' ? object.charge : object.charge.id))?.id;
  if (!orderId && event.type?.startsWith('checkout.session.')) orderId = (await first(db, 'SELECT id FROM marketplace_orders WHERE session_id=?', object.id))?.id;
  if (!orderId && event.type?.startsWith('transfer.')) orderId = (await first(db, 'SELECT id FROM marketplace_orders WHERE transfer_id=?', object.id))?.id;
  const supported = /^(checkout\.session\.(completed|async_payment_succeeded)|payment_intent\.succeeded|charge\.(succeeded|updated|refunded|dispute\.[a-z_]+)|refund\.(created|updated)|transfer\.(created|updated|reversed))$/.test(event.type);
  // Unknown order events are retried: a refund may precede the initial success delivery.
  if (supported && !orderId) fail(409, 'Related order is not available yet; retry delivery');
  const now = Date.now();
  await statement(db, 'INSERT OR IGNORE INTO marketplace_payment_events(provider,event_id,event_type,order_id,status,created_at) VALUES(?,?,?,?,?,?)', 'stripe', event.id, event.type || 'unknown', orderId || null, 'processing', now).run();
  if (supported) {
    try {
      if (event.type.startsWith('transfer.')) await syncProviderTransfer(env, db, orderId, object.id);
      await reconcile(env, db, orderId, event);
    }
    catch (error) {
      const order = await first(db, 'SELECT item_id FROM marketplace_orders WHERE id=?', orderId);
      if (order) await metricOnce(db, orderId, 'reconciliation-failure', order.item_id);
      throw error;
    }
  }
  await statement(db, 'UPDATE marketplace_payment_events SET status=?,processed_at=? WHERE provider=? AND event_id=?', supported ? 'processed' : 'ignored', Date.now(), 'stripe', event.id).run();
  return json({ received: true });
}
async function checkout(request, env, db, accountId) {
  const data = await body(request);
  const listing = await first(db, "SELECT * FROM marketplace_listings WHERE id=? AND status='published'", String(data.itemId || ''));
  if (!listing) fail(404, 'Published item not found');
  if (listing.creator_id === accountId) fail(409, 'Creator already owns this item');
  const existing = await first(db, "SELECT id FROM marketplace_entitlements WHERE account_id=? AND item_id=? AND status='active'", accountId, listing.id);
  if (existing) return json({ owned: true, entitlementId: existing.id });
  const now = Date.now();
  if (listing.price_minor === 0) {
    const id = crypto.randomUUID();
    await statement(db, `INSERT INTO marketplace_entitlements(id,account_id,item_id,status,source,created_at,revoked_at) VALUES(?,?,?,'active','free',?,NULL)
      ON CONFLICT(account_id,item_id) DO UPDATE SET status='active',source='free',revoked_at=NULL,order_id=NULL`, id, accountId, listing.id, now).run();
    return json({ free: true, owned: true });
  }
  sandbox(env); returnUrl(env);
  if (data.termsAccepted !== true) fail(422, 'Accept marketplace purchase terms');
  minor(listing.price_minor);
  const currency = String(listing.currency || '').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency) || !listing.latest_version_id) fail(409, 'Listing pricing or version is invalid');
  await refreshAccount(env, db, listing.creator_id);
  // Reuse the sole pending order to make retried checkout safe and keep its exact pricing snapshot.
  let order = await first(db, "SELECT * FROM marketplace_orders WHERE account_id=? AND item_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1", accountId, listing.id);
  if (!order) {
    const id = crypto.randomUUID();
    await statement(db, `INSERT OR IGNORE INTO marketplace_orders(id,account_id,item_id,creator_id,version_id,title,price_minor,currency,terms_version,terms_accepted_at,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'sandbox',?,?)`, id, accountId, listing.id, listing.creator_id, listing.latest_version_id, listing.title, listing.price_minor, currency, COMMERCE_TERMS_VERSION, now, now, now).run();
    order = await first(db, "SELECT * FROM marketplace_orders WHERE account_id=? AND item_id=? AND status='pending'", accountId, listing.id);
    if (!order) fail(409, 'Checkout state changed; retry');
  }
  if (!order.session_id && Date.now()-order.created_at>20*3600000) fail(409,'Uncertain checkout requires operator provider reconciliation');
  const session = order.session_id ? await providerFor(env).retrieveCheckout(order.session_id) : await providerFor(env).createCheckout(order, returnUrl(env));
  if (session.status === 'expired') fail(409, 'Checkout expired; operator reconciliation is required before replacing it');
  if (session.payment_status === 'paid') return json({orderId:order.id,mode:'sandbox',status:'awaiting_verified_webhook'});
  providerId(session.id, 'cs');
  await statement(db, 'UPDATE marketplace_orders SET session_id=?,updated_at=? WHERE id=?', session.id, now, order.id).run();
  return json({ orderId: order.id, url: hostedUrl(session.url, 'checkout.stripe.com'), mode: 'sandbox', termsVersion: order.terms_version });
}
async function onboarding(env, db, accountId) {
  sandbox(env); const redirect = returnUrl(env);
  let stored = await first(db, 'SELECT * FROM marketplace_provider_accounts WHERE account_id=?', accountId);
  if (!stored) {
    const account = await providerFor(env).createAccount(accountId);
    providerId(account.id, 'acct');
    await statement(db, 'INSERT OR IGNORE INTO marketplace_provider_accounts(account_id,provider_account_id,verified,mode,updated_at) VALUES(?,?,0,?,?)', accountId, account.id, 'sandbox', Date.now()).run();
    stored = await first(db, 'SELECT * FROM marketplace_provider_accounts WHERE account_id=?', accountId);
  }
  const account = await providerFor(env).retrieveAccount(stored.provider_account_id);
  await statement(db, 'UPDATE marketplace_provider_accounts SET verified=?,updated_at=? WHERE account_id=?', verifiedAccount(account) ? 1 : 0, Date.now(), accountId).run();
  const link = await providerFor(env).createOnboardingLink(stored.provider_account_id, redirect);
  return json({ mode: 'sandbox', verified: verifiedAccount(account), url: hostedUrl(link.url, 'connect.stripe.com') });
}
async function transfer(env, db, orderId) {
  let order = await first(db, 'SELECT * FROM marketplace_orders WHERE id=?', orderId);
  if (!order) fail(404, 'Order not found');
  if (order.transfer_id) return json({ orderId, transferId: order.transfer_id, status: order.payout_status });
  await reconcile(env, db, orderId);
  order = await first(db, 'SELECT * FROM marketplace_orders WHERE id=?', orderId);
  if (order.status !== 'paid' || !order.settled || !order.creator_minor) fail(409, 'Only settled undisputed earnings can transfer');
  const account = await refreshAccount(env, db, order.creator_id);
  await statement(db, `INSERT OR IGNORE INTO marketplace_provider_operations(id,order_id,kind,target_minor,amount_minor,payload,status,created_at)
    SELECT ?,id,'transfer',creator_minor,creator_minor,
    json_object('amount',CAST(creator_minor AS TEXT),'currency',currency,'destination',?,'source_transaction',charge_id,'transfer_group',id,'metadata[order_id]',id),'processing',?
    FROM marketplace_orders WHERE id=? AND transfer_id IS NULL AND status='paid' AND settled=1 AND disputed=0 AND dispute_status!='open' AND refund_minor=0 AND creator_minor>0
    AND NOT EXISTS(SELECT 1 FROM marketplace_provider_operations WHERE order_id=? AND status='processing')`, `transfer-${order.id}`, account.provider_account_id, Date.now(), orderId, orderId).run();
  const operation = await first(db, 'SELECT * FROM marketplace_provider_operations WHERE id=?', `transfer-${order.id}`);
  if (!operation || operation.kind !== 'transfer') fail(409, 'Another money operation is pending; retry');
  const result = await completeTransferOperation(env, db, operation);
  // A refund may race the HTTP transfer. Reconcile again and recover any excess.
  await reconcile(env, db, orderId);
  return json({ orderId, transferId: result.id, status: 'transferred_to_provider' });
}
async function refundRequest(request, env, db, accountId, admin, orderId, resolve) {
  const data = await body(request);
  if (resolve && !admin) fail(403, 'Administrator access required');
  const order = await first(db, 'SELECT * FROM marketplace_orders WHERE id=?', orderId);
  if (!order || (!resolve && order.account_id !== accountId)) fail(404, 'Order not found');
  if (!resolve) {
    if (order.status !== 'paid') fail(409, 'Only paid orders can request a refund');
    const reason = String(data.reason || '').trim(); if (!reason || reason.length > 2000) fail(422, 'Provide a refund reason');
    await statement(db, `INSERT OR IGNORE INTO marketplace_refund_requests(order_id,account_id,reason,status,created_at,updated_at) VALUES(?,?,?,'requested',?,?)`, order.id, accountId, reason, Date.now(), Date.now()).run();
    return json({ orderId, status: 'requested' });
  }
  if (!['approve', 'reject'].includes(data.decision)) fail(422, 'Choose approve or reject');
  const row = await first(db, 'SELECT * FROM marketplace_refund_requests WHERE order_id=?', orderId);
  if (!row) fail(404, 'Refund request not found');
  if (row.status !== 'requested') return json({ orderId, status: row.status });
  let refundId = null;
  if (data.decision === 'approve') {
    const result = await providerFor(env).createRefund(order);
    refundId = result.id;
    // Ownership changes only after the signed provider event confirms the refund.
  }
  await statement(db, 'UPDATE marketplace_refund_requests SET status=?,resolution=?,provider_refund_id=?,resolved_by=?,updated_at=? WHERE order_id=? AND status=?', data.decision === 'approve' ? 'approved' : 'rejected', String(data.reason || '').slice(0, 2000), refundId, accountId, Date.now(), order.id, 'requested').run();
  return json({ orderId, status: data.decision === 'approve' ? 'approved' : 'rejected', providerRefundId: refundId });
}
export async function handleCommerceRequest(request, env, context = {}) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(`${PREFIX}/commerce/`) && path !== `${PREFIX}/webhooks/stripe`) return null;
  try {
    const db = context.db || env.MARKETPLACE_DB;
    if (!db) fail(503, 'Marketplace database is unavailable');
    if (path === `${PREFIX}/webhooks/stripe` && request.method === 'POST') return await webhook(request, env, db);
    const accountId = context.accountId;
    if (!accountId) fail(401, 'Authentication required');
    const tail = path.slice(`${PREFIX}/commerce`.length);
    if (tail === '/checkout' && request.method === 'POST') return await checkout(request, env, db, accountId);
    if (tail === '/onboarding' && request.method === 'POST') return await onboarding(env, db, accountId);
    if (tail === '/statements' && request.method === 'GET') {
      const orders = await statement(db, 'SELECT id,item_id,title,currency,price_minor,gross_minor,tax_minor,refund_minor,processing_minor,creator_minor,vumiro_minor,status,settled,payout_status,transferred_minor,recovered_minor,created_at FROM marketplace_orders WHERE creator_id=? ORDER BY created_at DESC LIMIT 200', accountId).all();
      const ledger = await statement(db, 'SELECT l.* FROM marketplace_ledger l JOIN marketplace_orders o ON o.id=l.order_id WHERE o.creator_id=? ORDER BY l.created_at DESC LIMIT 1000', accountId).all();
      return json({ mode: 'sandbox', orders: orders.results || [], ledger: ledger.results || [], payoutCostsPaidBy: 'Vumiro', note: 'Transfers to a connected account do not confirm bank payout.' });
    }
    const match = /^\/orders\/([a-zA-Z0-9-]+)\/(transfer|refund-request|refund-resolve)$/.exec(tail);
    if (match && request.method === 'POST') {
      if (match[2] === 'transfer') { if (!context.admin) fail(403, 'Administrator access required'); return await transfer(env, db, match[1]); }
      return await refundRequest(request, env, db, accountId, !!context.admin, match[1], match[2] === 'refund-resolve');
    }
    if (tail === '/orders' && request.method === 'GET') return json({ orders: (await statement(db, 'SELECT id,item_id,title,currency,price_minor,status,payout_status,created_at FROM marketplace_orders WHERE account_id=? ORDER BY created_at DESC LIMIT 200', accountId).all()).results || [] });
    return json({ error: 'Commerce route not found' }, 404);
  } catch (error) { return json({ error: error.status ? error.message : 'Commerce operation failed; retry safely' }, error.status || 500); }
}
