const pool = require('../config/db');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

// Engine 8 / Section 33.2 - scheme coupons.
//   Code      COU-[CATEGORY]-[CAMPAIGN], e.g. COU-BU-DIW26 (buyers, Diwali 2026)
//             or COU-ALL-LNCH (everyone). Created only by an admin; case does
//             not matter on input, stored upper-case.
//   Rules     validity window, per-person cap, total cap, the service it
//             applies to, stack / no-stack, and who may use it (the category
//             in the code: the person's referral-code category when issued,
//             or their current role - the benefits of a new role attach).
//   Services  professional_fee  off the next professional-fee invoice of a
//                               deal - never below the 1% minimum fee;
//             advertising       off a campaign's unpaid invoice;
//             crm_workspace     the Full CRM workspace for a number of days;
//             manual            a benefit staff deliver and mark done.
//   Never     deleted (deactivated instead), and never a commission entry.

const CATEGORIES = ['BU', 'SE', 'OW', 'TE', 'BR', 'BD', 'NR', 'HN', 'IB', 'IS', 'PE', 'CO', 'LN', 'LG', 'FR', 'PG', 'WF', 'ST', 'ALL'];
const CATEGORY_LABEL = {
  BU: 'Buyers', SE: 'Sellers', OW: 'Owners / landlords', TE: 'Tenants', BR: 'Brokers', BD: 'Builders', NR: 'NRIs', HN: 'HNIs', IB: 'Institutional buyers', IS: 'Institutional sellers',
  PE: 'PE funds', CO: 'Companies', LN: 'Lenders', LG: 'Legal professionals', FR: 'Franchisees / agencies', PG: 'PG operators', WF: 'Field partners', ST: 'Staff', ALL: 'Everyone',
};
const SERVICES = {
  professional_fee: { label: 'Professional fee (deal invoice)', benefits: ['percent', 'flat'] },
  advertising: { label: 'Advertising campaign', benefits: ['percent', 'flat'] },
  crm_workspace: { label: 'Full CRM workspace', benefits: ['days'] },
  manual: { label: 'Other benefit (delivered by staff)', benefits: ['manual'] },
};
const PATTERN = new RegExp(`^COU-(${CATEGORIES.join('|')})-[A-Z0-9]{3,6}$`);
const ADMIN = ['admin', 'super_admin'];
const STAFF = ['internal_sales', 'admin', 'super_admin'];
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const upper = (v) => String(v || '').trim().toUpperCase();

const view = (c, usage) => {
  const now = Date.now();
  // An expired coupon reads as expired even after the sweep has switched it off.
  const status = new Date(c.valid_until).getTime() <= now ? 'expired' : !c.is_active ? 'inactive' : new Date(c.valid_from).getTime() > now ? 'scheduled' : 'live';
  return {
    id: c.id, code: c.code, category: c.category, categoryLabel: CATEGORY_LABEL[c.category], name: c.name, description: c.description,
    service: c.service, serviceLabel: SERVICES[c.service].label, benefitType: c.benefit_type, benefitValue: num(c.benefit_value), maxDiscount: num(c.max_discount), minAmount: num(c.min_amount),
    validFrom: c.valid_from, validUntil: c.valid_until, perUserLimit: c.per_user_limit, totalLimit: c.total_limit, stackable: c.stackable, isActive: c.is_active,
    deactivatedAt: c.deactivated_at, deactivatedReason: c.deactivated_reason, status, createdAt: c.created_at,
    ...(usage ? { used: usage.used, discountGiven: num(usage.discount) } : {}),
  };
};
const benefitText = (c) => (c.benefit_type === 'percent' ? `${num(c.benefit_value)}% off${c.max_discount ? ` (up to Rs ${num(c.max_discount).toLocaleString('en-IN')})` : ''}`
  : c.benefit_type === 'flat' ? `Rs ${num(c.benefit_value).toLocaleString('en-IN')} off`
    : c.benefit_type === 'days' ? `${num(c.benefit_value)} days of the Full CRM workspace` : c.description || 'A benefit our team delivers');

// ------------------------------------------------------------ admin

function input(data, current) {
  const pick = (k, cur) => (data[k] === undefined ? cur : data[k]);
  const name = String(pick('name', current?.name) || '').trim();
  if (name.length < 3 || name.length > 120) throw badRequest('Give the scheme a name (3 to 120 characters)');
  const service = current?.service || data.service;
  if (!SERVICES[service]) throw badRequest(`The service must be one of: ${Object.keys(SERVICES).join(', ')}`);
  const benefitType = pick('benefitType', current?.benefit_type) || SERVICES[service].benefits[0];
  if (!SERVICES[service].benefits.includes(benefitType)) throw badRequest(`For ${SERVICES[service].label} the benefit is ${SERVICES[service].benefits.join(' or ')}`);
  const value = pick('benefitValue', num(current?.benefit_value));
  if (benefitType === 'percent' && !(Number(value) > 0 && Number(value) <= 100)) throw badRequest('A percentage must be more than 0 and at most 100');
  if (benefitType === 'flat' && !(Number(value) > 0)) throw badRequest('Give the amount off');
  if (benefitType === 'days' && !(Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 366)) throw badRequest('Give the number of days (1 to 366)');
  const from = new Date(pick('validFrom', current?.valid_from) || Date.now());
  const until = new Date(pick('validUntil', current?.valid_until));
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) throw badRequest('Give the dates the coupon is valid');
  if (until <= from) throw badRequest('The coupon must end after it starts');
  const perUser = Number(pick('perUserLimit', current?.per_user_limit ?? 1));
  if (!Number.isInteger(perUser) || perUser < 1) throw badRequest('Uses per person must be 1 or more');
  const total = pick('totalLimit', current?.total_limit ?? null);
  if (total !== null && total !== '' && !(Number.isInteger(Number(total)) && Number(total) >= 1)) throw badRequest('Total uses must be 1 or more, or empty for no limit');
  const money = (k, cur) => {
    const v = pick(k, cur);
    if (v === null || v === undefined || v === '') return null;
    if (!(Number(v) >= 0)) throw badRequest('Amounts cannot be negative');
    return r2(v);
  };
  return {
    name, description: pick('description', current?.description) ? String(pick('description', current?.description)).slice(0, 1000) : null,
    service, benefit_type: benefitType, benefit_value: benefitType === 'manual' ? null : Number(value),
    max_discount: benefitType === 'percent' ? money('maxDiscount', num(current?.max_discount)) : null,
    min_amount: ['percent', 'flat'].includes(benefitType) ? money('minAmount', num(current?.min_amount)) : null,
    valid_from: from, valid_until: until, per_user_limit: perUser, total_limit: total === null || total === '' ? null : Number(total),
    stackable: !!pick('stackable', current?.stackable ?? false),
  };
}

async function usage(couponId) {
  return (await pool.query(`SELECT COUNT(*)::int AS used, COALESCE(SUM(discount_amount), 0) AS discount FROM user_coupons WHERE coupon_id = $1 AND status <> 'reversed'`, [couponId])).rows[0];
}

async function create(admin, data, meta = {}) {
  if (!ADMIN.includes(admin.role)) throw forbidden('Only an admin creates coupons');
  const code = upper(data.code);
  if (!PATTERN.test(code)) throw badRequest('The code must look like COU-BU-DIW26: COU, the category (or ALL), then 3 to 6 letters or digits');
  const row = input(data, null);
  if (row.service === 'professional_fee' && row.benefit_type === 'percent' && row.benefit_value >= 100) throw badRequest('A professional fee cannot be waived in full - the 1% minimum always applies');
  try {
    const c = (await pool.query(
      `INSERT INTO coupons (code, category, name, description, service, benefit_type, benefit_value, max_discount, min_amount, valid_from, valid_until, per_user_limit, total_limit, stackable, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING *`,
      [code, code.split('-')[1], row.name, row.description, row.service, row.benefit_type, row.benefit_value, row.max_discount, row.min_amount, row.valid_from, row.valid_until, row.per_user_limit, row.total_limit, row.stackable, admin.id]
    )).rows[0];
    await auditService.log({ actor: admin, action: 'coupon.created', entityType: 'coupon', entityId: c.id, after: view(c), ...meta });
    return view(c, { used: 0, discount: 0 });
  } catch (err) {
    if (err.code === '23505') throw badRequest('A coupon with this code already exists - codes are never reused');
    throw err;
  }
}

async function update(admin, id, data, meta = {}) {
  if (!ADMIN.includes(admin.role)) throw forbidden('Only an admin changes coupons');
  const cur = (await pool.query('SELECT * FROM coupons WHERE id = $1', [id])).rows[0];
  if (!cur) throw notFound('Coupon not found');
  const u = await usage(id);
  // Once used, the benefit itself is fixed - people were promised it.
  if (u.used && ['benefitType', 'benefitValue', 'maxDiscount', 'minAmount'].some((k) => data[k] !== undefined && String(data[k]) !== String({ benefitType: cur.benefit_type, benefitValue: num(cur.benefit_value), maxDiscount: num(cur.max_discount), minAmount: num(cur.min_amount) }[k]))) {
    throw badRequest('This coupon has been used, so its benefit cannot change. Deactivate it and create a new one.');
  }
  const row = input(data, cur);
  const c = (await pool.query(
    `UPDATE coupons SET name = $1, description = $2, benefit_type = $3, benefit_value = $4, max_discount = $5, min_amount = $6, valid_from = $7, valid_until = $8, per_user_limit = $9, total_limit = $10, stackable = $11, updated_by = $12, updated_at = now()
     WHERE id = $13 RETURNING *`,
    [row.name, row.description, row.benefit_type, row.benefit_value, row.max_discount, row.min_amount, row.valid_from, row.valid_until, row.per_user_limit, row.total_limit, row.stackable, admin.id, id]
  )).rows[0];
  await auditService.log({ actor: admin, action: 'coupon.updated', entityType: 'coupon', entityId: id, before: view(cur), after: view(c), ...meta });
  return view(c, u);
}

async function setActive(admin, id, active, reason, meta = {}) {
  if (!ADMIN.includes(admin.role)) throw forbidden('Only an admin changes coupons');
  const cur = (await pool.query('SELECT * FROM coupons WHERE id = $1', [id])).rows[0];
  if (!cur) throw notFound('Coupon not found');
  if (!active && (!reason || String(reason).trim().length < 3)) throw badRequest('Say why the coupon is being deactivated');
  if (active && new Date(cur.valid_until) <= new Date()) throw badRequest('This coupon has expired - create a new one');
  const c = (await pool.query(
    `UPDATE coupons SET is_active = $1, deactivated_at = CASE WHEN $1 THEN NULL ELSE now() END, deactivated_reason = CASE WHEN $1 THEN NULL ELSE $2 END, updated_by = $3, updated_at = now() WHERE id = $4 RETURNING *`,
    [!!active, reason ? String(reason).trim().slice(0, 500) : null, admin.id, id]
  )).rows[0];
  await auditService.log({ actor: admin, action: active ? 'coupon.reactivated' : 'coupon.deactivated', entityType: 'coupon', entityId: id, after: { reason }, ...meta });
  return view(c, await usage(id));
}

async function list({ status, service, q } = {}) {
  const where = [];
  const params = [];
  if (service) { params.push(service); where.push(`c.service = $${params.length}`); }
  if (q) { params.push(`%${String(q).trim()}%`); where.push(`(c.code ILIKE $${params.length} OR c.name ILIKE $${params.length})`); }
  const rows = (await pool.query(
    `SELECT c.*, COALESCE(u.used, 0)::int AS used, COALESCE(u.discount, 0) AS discount FROM coupons c
     LEFT JOIN (SELECT coupon_id, COUNT(*) AS used, SUM(discount_amount) AS discount FROM user_coupons WHERE status <> 'reversed' GROUP BY coupon_id) u ON u.coupon_id = c.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at DESC LIMIT 500`,
    params
  )).rows.map((c) => view(c, c));
  return status ? rows.filter((r) => r.status === status) : rows;
}

const redemptionView = (r) => ({
  id: r.id, couponId: r.coupon_id, code: r.code, couponName: r.coupon_name, userId: r.user_id, userName: r.user_name, roleAtIssue: r.role_at_issue, service: r.service, entityType: r.entity_type, entityId: r.entity_id,
  status: r.status, amountBefore: num(r.amount_before), discount: num(r.discount_amount), daysGranted: r.days_granted, invoiceId: r.invoice_id, note: r.note,
  createdAt: r.created_at, appliedAt: r.applied_at, fulfilledAt: r.fulfilled_at, reversedAt: r.reversed_at, reversalReason: r.reversal_reason,
});
const REDEMPTION_SELECT = `SELECT uc.*, c.code, c.name AS coupon_name, u.full_name AS user_name FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id JOIN users u ON u.id = uc.user_id`;

async function redemptions({ couponId, status } = {}) {
  const where = [];
  const params = [];
  if (couponId) { params.push(couponId); where.push(`uc.coupon_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`uc.status = $${params.length}`); }
  return (await pool.query(`${REDEMPTION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY uc.created_at DESC LIMIT 500`, params)).rows.map(redemptionView);
}

// ------------------------------------------------------------ who may use it

const PORTAL_PREFIX = { buyer: 'BU', seller: 'SE', owner: 'OW', tenant: 'TE', nri: 'NR', hni: 'HN' };
const ROLE_PREFIX = { broker: 'BR', builder: 'BD', agency_admin: 'FR', internal_sales: 'ST', admin: 'ST', super_admin: 'ST' };

// The categories a person belongs to: their code's category when issued, and
// whatever their current role and investor profile make them.
async function categoriesOf(userId) {
  const u = (await pool.query(
    `SELECT u.referral_code, r.name AS role, ip.is_nri, ip.is_hni, (SELECT cu.portal_roles FROM customers cu WHERE cu.user_id = u.id LIMIT 1) AS portal_roles
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN investor_profiles ip ON ip.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  )).rows[0];
  if (!u) throw notFound('Person not found');
  const set = new Set();
  const issued = u.referral_code && /^[A-Z]{2}-/.test(u.referral_code) ? u.referral_code.slice(0, 2) : null;
  if (issued) set.add(issued);
  if (ROLE_PREFIX[u.role]) set.add(ROLE_PREFIX[u.role]);
  for (const p of Array.isArray(u.portal_roles) ? u.portal_roles : []) if (PORTAL_PREFIX[p]) set.add(PORTAL_PREFIX[p]);
  if (u.is_nri) set.add('NR');
  if (u.is_hni) set.add('HN');
  if (u.role === 'customer' && !set.size) set.add('BU');
  if ((await pool.query('SELECT 1 FROM wfh_workers WHERE user_id = $1', [userId]).catch(() => ({ rows: [] }))).rows.length) set.add('WF');
  return { issued: issued || [...set][0] || null, all: set, role: u.role };
}

// Everything that can stop this person using this coupon on this record.
async function check(coupon, userId, { entityType, entityId } = {}) {
  const now = new Date();
  if (!coupon.is_active) return 'This coupon is no longer active';
  if (new Date(coupon.valid_from) > now) return `This coupon starts on ${new Date(coupon.valid_from).toLocaleDateString('en-IN')}`;
  if (new Date(coupon.valid_until) <= now) return 'This coupon has expired';
  const cats = await categoriesOf(userId);
  if (coupon.category !== 'ALL' && !cats.all.has(coupon.category)) return `This coupon is for ${CATEGORY_LABEL[coupon.category].toLowerCase()} only`;
  const counts = (await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE user_id = $2)::int AS mine FROM user_coupons WHERE coupon_id = $1 AND status <> 'reversed'`,
    [coupon.id, userId]
  )).rows[0];
  if (coupon.total_limit && counts.total >= coupon.total_limit) return 'This coupon has been fully used';
  if (counts.mine >= coupon.per_user_limit) return coupon.per_user_limit === 1 ? 'You have already used this coupon' : `You have used this coupon ${counts.mine} times - the limit`;
  if (entityId) {
    const others = (await pool.query(
      `SELECT c.code, c.stackable FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.entity_type = $1 AND uc.entity_id = $2 AND uc.status <> 'reversed'`,
      [entityType, entityId]
    )).rows;
    if (others.some((o) => o.code === coupon.code)) return 'This coupon is already applied here';
    // Stacking: every coupon on the same record must allow it.
    if (others.length && (!coupon.stackable || others.some((o) => !o.stackable))) return `${others[0].code} is already applied here and the two cannot be combined`;
  }
  return null;
}

async function couponByCode(code) {
  const c = (await pool.query('SELECT * FROM coupons WHERE code = $1', [upper(code)])).rows[0];
  if (!c) throw badRequest(PATTERN.test(upper(code)) ? 'No coupon with this code' : 'A coupon code looks like COU-BU-DIW26');
  return c;
}

// The discount a percent / flat coupon gives on an amount, within its own limits.
function discountOn(c, amount, maxAllowed = amount) {
  if (c.min_amount && amount < Number(c.min_amount)) return { discount: 0, reason: `Applies to amounts of Rs ${num(c.min_amount).toLocaleString('en-IN')} or more` };
  let d = c.benefit_type === 'percent' ? (amount * Number(c.benefit_value)) / 100 : Number(c.benefit_value);
  if (c.max_discount) d = Math.min(d, Number(c.max_discount));
  return { discount: r2(Math.max(0, Math.min(d, maxAllowed, amount))) };
}

// ------------------------------------------------------------ the records a coupon applies to

const isStaff = (u) => STAFF.includes(u.role);

// A deal the person is invoiced on: the buyer / tenant customer, or the listing's owner.
async function dealFor(actor, userId, dealId) {
  const d = (await pool.query(
    `SELECT d.id, d.customer_id, cu.user_id AS buyer_user_id, p.created_by AS lister_id, p.title FROM deals d LEFT JOIN customers cu ON cu.id = d.customer_id LEFT JOIN properties p ON p.id = d.property_id WHERE d.id = $1`,
    [dealId]
  )).rows[0];
  if (!d) throw notFound('Deal not found');
  const party = d.buyer_user_id === userId ? 'buyer' : d.lister_id === userId ? 'seller' : null;
  if (!party) throw forbidden(isStaff(actor) ? 'That person is not invoiced on this deal' : 'This is not your deal');
  return { ...d, party };
}

// Unpaid invoice for this person on the deal that does not carry a coupon yet.
async function openFeeInvoice(dealId, userId) {
  return (await pool.query(
    `SELECT i.* FROM invoices i WHERE i.deal_id = $1 AND i.liable_user_id = $2 AND i.status IN ('invoiced', 'overdue') AND i.discount_amount = 0 ORDER BY i.created_at LIMIT 1`,
    [dealId, userId]
  )).rows[0] || null;
}

// The 1% professional fee minimum (sec. 15): a coupon only reduces what is above it.
function feeFloor(inv) {
  if (inv.kind === 'lease') return 0;
  return r2(Number(inv.gross_value) * 0.01 * (Number(inv.instalment_percent) / 100));
}

async function reduceInvoice(inv, discount, client = pool) {
  const fee = r2(Number(inv.fee_amount) - discount);
  const gst = inv.gst_type === 'igst' ? { c: 0, s: 0, i: r2(Number(inv.igst_amount) * (fee / Number(inv.fee_amount))) } : { c: r2(Number(inv.cgst_amount) * (fee / Number(inv.fee_amount))), s: r2(Number(inv.sgst_amount) * (fee / Number(inv.fee_amount))), i: 0 };
  return (await client.query(
    `UPDATE invoices SET fee_before_discount = COALESCE(fee_before_discount, fee_amount), fee_amount = $1, discount_amount = discount_amount + $2, cgst_amount = $3, sgst_amount = $4, igst_amount = $5, total_amount = $6 WHERE id = $7 RETURNING *`,
    [fee, discount, gst.c, gst.s, gst.i, r2(fee + gst.c + gst.s + gst.i), inv.id]
  )).rows[0];
}

// Apply a reserved professional-fee coupon to an invoice (when it is raised, or at once if one is open).
async function settleFee(uc, coupon, inv) {
  const allowed = r2(Number(inv.fee_amount) - feeFloor(inv));
  const { discount, reason } = discountOn(coupon, Number(inv.fee_amount), Math.max(0, allowed));
  if (!discount) {
    await pool.query(`UPDATE user_coupons SET note = $1 WHERE id = $2`, [reason || 'The fee is already at the 1% minimum, so there is nothing to take off', uc.id]);
    return null;
  }
  const updated = await reduceInvoice(inv, discount);
  await pool.query(`UPDATE user_coupons SET status = 'applied', applied_at = now(), amount_before = $1, discount_amount = $2, invoice_id = $3, note = NULL WHERE id = $4`, [inv.fee_amount, discount, inv.id, uc.id]);
  return updated;
}

// Called by orchestration right after a professional-fee invoice is raised.
async function onFeeInvoice(inv) {
  if (!inv?.liable_user_id) return inv;
  const reserved = (await pool.query(
    `SELECT uc.*, c.* , uc.id AS uc_id FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.entity_type = 'deal' AND uc.entity_id = $1 AND uc.user_id = $2 AND uc.status = 'reserved' ORDER BY uc.created_at LIMIT 1`,
    [inv.deal_id, inv.liable_user_id]
  )).rows[0];
  if (!reserved || Number(inv.discount_amount) > 0) return inv;
  return (await settleFee({ id: reserved.uc_id }, reserved, inv)) || inv;
}
const safeOnFeeInvoice = (inv) => onFeeInvoice(inv).catch((err) => { console.error('[coupons] fee invoice not adjusted:', err.message); return inv; });

// ------------------------------------------------------------ applying

async function preview(actor, { code, service, entityId, userId }) {
  const who = userId && isStaff(actor) ? userId : actor.id;
  const c = await couponByCode(code);
  if (service && c.service !== service) return { valid: false, reason: `This coupon is for ${SERVICES[c.service].label.toLowerCase()}`, coupon: { code: c.code, name: c.name } };
  const entityType = { professional_fee: 'deal', advertising: 'ad_campaign', crm_workspace: 'user', manual: entityId ? 'record' : null }[c.service];
  const reason = await check(c, who, { entityType, entityId: c.service === 'crm_workspace' ? who : entityId });
  return { valid: !reason, reason, coupon: { code: c.code, name: c.name, service: c.service, serviceLabel: SERVICES[c.service].label, benefit: benefitText(c), validUntil: c.valid_until, stackable: c.stackable } };
}

// Apply a coupon. Staff may apply one for a customer (userId).
async function apply(actor, { code, entityId, userId, note } = {}, meta = {}) {
  const who = userId && isStaff(actor) ? userId : actor.id;
  if (userId && !isStaff(actor) && userId !== actor.id) throw forbidden('You can only apply a coupon for yourself');
  const c = await couponByCode(code);
  const cats = await categoriesOf(who);
  let entityType = null;
  let target = entityId || null;
  let ctx = {};
  if (c.service === 'professional_fee') {
    if (!target) throw badRequest('Choose the deal the coupon is for');
    ctx = await dealFor(actor, who, target);
    entityType = 'deal';
  } else if (c.service === 'advertising') {
    if (!target) throw badRequest('Choose the campaign the coupon is for');
    const camp = (await pool.query(`SELECT ac.id, ac.advertiser_id, a.user_id FROM ad_campaigns ac JOIN advertisers a ON a.id = ac.advertiser_id WHERE ac.id = $1`, [target]).catch(() => ({ rows: [] }))).rows[0];
    if (!camp) throw notFound('Campaign not found');
    if (camp.user_id !== who && !isStaff(actor)) throw forbidden('This is not your campaign');
    ctx.invoice = (await pool.query(`SELECT * FROM ad_invoices WHERE campaign_id = $1 AND status = 'due' ORDER BY created_at DESC LIMIT 1`, [target])).rows[0];
    if (!ctx.invoice) throw badRequest('This campaign has no unpaid invoice');
    if (Number(ctx.invoice.discount_amount) > 0 && !c.stackable) throw badRequest('A coupon is already applied to this invoice');
    entityType = 'ad_campaign';
  } else if (c.service === 'crm_workspace') {
    if (cats.role !== 'customer') throw badRequest('The Full CRM workspace coupon is for customer accounts');
    entityType = 'user';
    target = who;
  } else {
    entityType = target ? 'record' : null;
  }
  const reason = await check(c, who, { entityType, entityId: target });
  if (reason) throw badRequest(reason);

  const uc = (await pool.query(
    `INSERT INTO user_coupons (coupon_id, user_id, role_at_issue, service, entity_type, entity_id, status, note, applied_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [c.id, who, cats.all.has(c.category) ? c.category : cats.issued, c.service, entityType, target, c.service === 'professional_fee' ? 'reserved' : c.service === 'manual' ? 'pending' : 'applied', note ? String(note).slice(0, 500) : null, actor.id]
  ).catch((err) => {
    if (err.code === '23505') throw badRequest('This coupon is already applied here');
    throw err;
  })).rows[0];

  let result = {};
  if (c.service === 'professional_fee') {
    // Reduces the next invoice on the deal - or the open one, if it is already raised.
    const open = await openFeeInvoice(target, who);
    if (open) result.invoice = await settleFee(uc, c, open);
  } else if (c.service === 'advertising') {
    const inv = ctx.invoice;
    const { discount, reason: why } = discountOn(c, Number(inv.amount));
    if (!discount) {
      await pool.query(`UPDATE user_coupons SET status = 'reversed', reversed_at = now(), reversal_reason = $1 WHERE id = $2`, [why || 'Nothing to take off', uc.id]);
      throw badRequest(why || 'This coupon takes nothing off this invoice');
    }
    const amount = r2(Number(inv.amount) - discount);
    const gst = r2((amount * Number(inv.gst_percent)) / 100);
    await pool.query(
      `UPDATE ad_invoices SET amount_before_discount = COALESCE(amount_before_discount, amount), amount = $1, discount_amount = discount_amount + $2, gst_amount = $3, total_amount = $4 WHERE id = $5`,
      [amount, discount, gst, r2(amount + gst), inv.id]
    );
    await pool.query(`UPDATE user_coupons SET amount_before = $1, discount_amount = $2, invoice_id = $3, applied_at = now() WHERE id = $4`, [inv.amount, discount, inv.id, uc.id]);
    // Fully covered: the campaign goes ahead without a payment.
    if (amount === 0) await require('./advertising.service').markPaid(inv.campaign_id, { gateway: 'none', reference: `Coupon ${c.code}`, actor });
  } else if (c.service === 'crm_workspace') {
    const days = Number(c.benefit_value);
    await pool.query(`UPDATE customers SET full_crm_until = GREATEST(COALESCE(full_crm_until, now()), now()) + ($1 || ' days')::interval WHERE user_id = $2`, [String(days), who]);
    await pool.query(`UPDATE user_coupons SET days_granted = $1, applied_at = now() WHERE id = $2`, [days, uc.id]);
  } else {
    const admins = (await pool.query(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name IN ('admin', 'super_admin') AND u.status = 'active'`)).rows;
    for (const a of admins) {
      await notificationService.createNotification({ userId: a.id, type: 'coupon', title: `Coupon ${c.code} to deliver`, message: `${c.name}: a benefit is waiting to be delivered by hand.`, relatedEntityType: 'coupon', relatedEntityId: c.id }).catch(() => {});
    }
  }
  await auditService.log({ actor, action: 'coupon.applied', entityType: 'coupon', entityId: c.id, after: { code: c.code, userId: who, service: c.service, entityId: target }, ...meta });
  const row = (await pool.query(`${REDEMPTION_SELECT} WHERE uc.id = $1`, [uc.id])).rows[0];
  return { ...redemptionView(row), benefit: benefitText(c), message: messageFor(row, c) };
}

function messageFor(r, c) {
  if (r.status === 'reserved') return `${c.code} is saved on the deal and will come off your next professional-fee invoice${r.note ? ` (${r.note})` : ''}.`;
  if (r.status === 'pending') return `${c.code} is noted - our team will deliver the benefit and let you know.`;
  if (r.service === 'crm_workspace') return `Your Full CRM workspace is on for ${r.days_granted} days.`;
  return `${c.code} took Rs ${num(r.discount_amount).toLocaleString('en-IN')} off.`;
}

async function mine(user) {
  return (await pool.query(`${REDEMPTION_SELECT} WHERE uc.user_id = $1 ORDER BY uc.created_at DESC LIMIT 100`, [user.id])).rows.map(redemptionView);
}

// Take a coupon back: a reserved one by its owner; anything not yet paid for, by an admin.
async function reverse(actor, id, reason, meta = {}) {
  const r = (await pool.query(`SELECT uc.*, c.code FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Coupon use not found');
  const own = r.user_id === actor.id && r.status === 'reserved';
  if (!own && !ADMIN.includes(actor.role)) throw forbidden('Only an admin can take back a coupon that has been used');
  if (r.status === 'reversed') return redemptionView(r);
  if (!own && (!reason || String(reason).trim().length < 3)) throw badRequest('Give the reason');
  if (r.status === 'applied' && r.invoice_id) {
    const table = r.service === 'advertising' ? 'ad_invoices' : 'invoices';
    const inv = (await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [r.invoice_id])).rows[0];
    if (inv?.status === 'paid') throw badRequest('The invoice has been paid - the coupon can no longer be taken back');
    if (inv && r.service === 'advertising') {
      const amount = r2(Number(inv.amount) + Number(r.discount_amount));
      const gst = r2((amount * Number(inv.gst_percent)) / 100);
      await pool.query(`UPDATE ad_invoices SET amount = $1, discount_amount = GREATEST(discount_amount - $2, 0), gst_amount = $3, total_amount = $4 WHERE id = $5`, [amount, r.discount_amount, gst, r2(amount + gst), inv.id]);
    } else if (inv) {
      const fee = r2(Number(inv.fee_amount) + Number(r.discount_amount));
      const ratio = Number(inv.fee_amount) ? fee / Number(inv.fee_amount) : 1;
      await pool.query(
        `UPDATE invoices SET fee_amount = $1, discount_amount = GREATEST(discount_amount - $2, 0), cgst_amount = round(cgst_amount * $3, 2), sgst_amount = round(sgst_amount * $3, 2), igst_amount = round(igst_amount * $3, 2),
           total_amount = $1 + round(cgst_amount * $3, 2) + round(sgst_amount * $3, 2) + round(igst_amount * $3, 2) WHERE id = $4`,
        [fee, r.discount_amount, ratio, inv.id]
      );
    }
  }
  if (r.status === 'applied' && r.service === 'crm_workspace' && r.days_granted) {
    await pool.query(`UPDATE customers SET full_crm_until = full_crm_until - ($1 || ' days')::interval WHERE user_id = $2 AND full_crm_until IS NOT NULL`, [String(r.days_granted), r.user_id]);
  }
  const out = (await pool.query(`UPDATE user_coupons SET status = 'reversed', reversed_by = $1, reversed_at = now(), reversal_reason = $2 WHERE id = $3 RETURNING *`, [actor.id, reason ? String(reason).slice(0, 500) : 'Withdrawn', id])).rows[0];
  await auditService.log({ actor, action: 'coupon.reversed', entityType: 'coupon', entityId: r.coupon_id, after: { redemptionId: id, reason }, ...meta });
  return redemptionView({ ...out, code: r.code });
}

async function fulfil(admin, id, note, meta = {}) {
  if (!STAFF.includes(admin.role)) throw forbidden();
  const r = (await pool.query(`UPDATE user_coupons SET status = 'fulfilled', fulfilled_by = $1, fulfilled_at = now(), note = COALESCE($2, note) WHERE id = $3 AND status = 'pending' RETURNING *`, [admin.id, note ? String(note).slice(0, 500) : null, id])).rows[0];
  if (!r) throw badRequest('Only a benefit waiting to be delivered can be marked delivered');
  await notificationService.createNotification({ userId: r.user_id, type: 'coupon', title: 'Your coupon benefit has been delivered', message: note || 'Our team has delivered the benefit of your coupon.', relatedEntityType: 'coupon', relatedEntityId: r.coupon_id }).catch(() => {});
  await auditService.log({ actor: admin, action: 'coupon.fulfilled', entityType: 'coupon', entityId: r.coupon_id, after: { redemptionId: id }, ...meta });
  return redemptionView(r);
}

// Expired coupons are switched off (never deleted).
async function sweep() {
  const r = await pool.query(`UPDATE coupons SET is_active = false, deactivated_at = now(), deactivated_reason = 'Expired' WHERE is_active AND valid_until <= now() RETURNING id`);
  return { deactivated: r.rowCount };
}

const meta = () => ({
  categories: CATEGORIES.map((key) => ({ key, label: CATEGORY_LABEL[key] })),
  services: Object.entries(SERVICES).map(([key, s]) => ({ key, label: s.label, benefits: s.benefits })),
  pattern: PATTERN.source,
});

module.exports = { PATTERN, meta, create, update, setActive, list, redemptions, preview, apply, mine, reverse, fulfil, sweep, categoriesOf, onFeeInvoice, safeOnFeeInvoice, feeFloor };
