const pool = require('../config/db');
const configService = require('./config.service');
const notificationService = require('./notification.service');
const auditService = require('./audit.service');
const { assertCleanContent } = require('../utils/contentGuard');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

// Module 37 - Broker Network: the co-broking workflow.
//   Find    : a directory of active brokers by city - trust score, badges,
//             live listings, closed deals. Never a phone or an email.
//   Propose : work another broker's listing (you bring the buyer) or their
//             buyer requirement (you bring the listing), with a split.
//   Agree   : accept, decline or counter the split; every offer is kept.
//   Deal    : the deal on that listing is linked to the agreement; when it
//             closes the split is recorded against the brokers' share.
// Clients stay with the A R Buildwel representative throughout - co-broking
// shares the work and the brokers' share, not the client's contact.

const STAFF = ['internal_sales', 'admin', 'super_admin'];
const BROKERS = ['broker', 'agency_admin'];
const LIVE = ['proposed', 'countered', 'accepted', 'deal_open'];
const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function settings() {
  const [split, min, days] = await Promise.all([
    configService.getConfig('cobroke.default_split', {}),
    configService.getConfig('cobroke.min_share_percent', 10),
    configService.getConfig('cobroke.proposal_valid_days', 7),
  ]);
  return { split: { listing_side: 50, buyer_side: 50, ...(split || {}) }, minShare: Math.max(1, Number(min) || 10), validDays: Math.max(1, Number(days) || 7) };
}

const notify = async (ids, n) => {
  for (const id of [...new Set(ids.filter(Boolean))]) await notificationService.createNotification({ userId: id, ...n }).catch(() => {});
};
const event = (agreementId, kind, actor, { split = null, note = null } = {}, client = pool) =>
  client.query(`INSERT INTO cobroke_events (agreement_id, kind, actor_id, split_proposer_percent, note) VALUES ($1, $2, $3, $4, $5)`, [agreementId, kind, actor?.id || null, split, note]);

async function brokerUser(id) {
  const u = (await pool.query(`SELECT u.id, u.full_name, u.status, u.tenant_id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [id])).rows[0];
  return u && BROKERS.includes(u.role) ? u : null;
}
function assertBroker(user) {
  if (!BROKERS.includes(user.role)) throw forbidden('Co-broking is for brokers and agencies');
}

// -------------------------------------------------------------- directory

// Who a broker can work with. Shows what earns trust - never how to reach them directly.
async function directory(user, { city = null, q = null, limit = 60 } = {}) {
  const r = await pool.query(
    `SELECT u.id, u.full_name, r.name AS role, po.firm_name, po.cities, po.areas, ts.score AS trust_score,
            (SELECT COALESCE(json_agg(DISTINCT ub.badge_key), '[]'::json) FROM user_badges ub WHERE ub.user_id = u.id AND ub.status <> 'revoked') AS badges,
            (SELECT COUNT(*) FROM properties p WHERE (p.broker_id = u.id OR p.created_by = u.id) AND p.status::text = 'approved')::int AS live_listings,
            (SELECT COALESCE(json_agg(DISTINCT p.city), '[]'::json) FROM properties p WHERE (p.broker_id = u.id OR p.created_by = u.id) AND p.status::text = 'approved') AS listing_cities,
            (SELECT COUNT(*) FROM deals d WHERE d.broker_id = u.id AND d.stage::text = 'closed_won')::int AS deals_closed,
            (SELECT COUNT(*) FROM cobroke_agreements c WHERE (c.proposer_id = u.id OR c.partner_id = u.id) AND c.status = 'completed')::int AS cobrokes_completed,
            EXISTS (SELECT 1 FROM cobroke_agreements c WHERE c.status = ANY($4) AND ((c.proposer_id = u.id AND c.partner_id = $1) OR (c.partner_id = u.id AND c.proposer_id = $1))) AS working_together,
            EXISTS (SELECT 1 FROM broker_vouches v WHERE v.voucher_id = $1 AND v.vouchee_id = u.id AND v.revoked_at IS NULL) AS vouched_by_me
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN partner_onboarding po ON po.user_id = u.id LEFT JOIN trust_scores ts ON ts.user_id = u.id
     WHERE r.name = ANY($2) AND u.status = 'active' AND u.id <> $1 AND u.anonymised_at IS NULL
       AND ($3::text IS NULL OR u.full_name ILIKE $3 OR po.firm_name ILIKE $3)
       -- Works in the city: chosen at onboarding, or has a live listing there.
       AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM unnest(po.cities) x WHERE lower(x) = lower($5))
            OR EXISTS (SELECT 1 FROM properties p WHERE (p.broker_id = u.id OR p.created_by = u.id) AND p.status::text = 'approved' AND lower(p.city) = lower($5)))
     ORDER BY ts.score DESC NULLS LAST, u.created_at ASC LIMIT $6`,
    [user.id, BROKERS, q ? `%${q}%` : null, LIVE, city ? String(city).trim() : null, Math.min(Math.max(Number(limit) || 60, 1), 200)]
  );
  return r.rows
    .map((b) => ({ ...b, all_cities: [...new Set([...(b.cities || []), ...(b.listing_cities || [])].filter(Boolean))] }))
    .map((b) => ({ id: b.id, name: b.full_name, firmName: b.firm_name, role: b.role, cities: b.all_cities, areas: (b.areas || []).slice(0, 8), trustScore: b.trust_score, badges: b.badges || [], liveListings: b.live_listings, dealsClosed: b.deals_closed, cobrokesCompleted: b.cobrokes_completed, workingTogether: b.working_together, vouchedByMe: b.vouched_by_me }));
}

// A broker's approved listings another broker may propose to co-broke.
async function listingsOf(user, brokerId) {
  if (!(await brokerUser(brokerId))) throw notFound('Broker not found');
  const r = await pool.query(
    `SELECT p.id, p.title, p.city, p.locality, p.property_type, p.transaction_type, p.price,
            EXISTS (SELECT 1 FROM cobroke_agreements c WHERE c.property_id = p.id AND c.status = ANY($3) AND (c.proposer_id = $2 OR c.partner_id = $2)) AS already
     FROM properties p WHERE (p.broker_id = $1 OR (p.broker_id IS NULL AND p.created_by = $1)) AND p.status::text = 'approved' AND p.listing_category = 'residential'
     ORDER BY p.created_at DESC LIMIT 100`,
    [brokerId, user.id, LIVE]
  );
  return r.rows.map((p) => ({ id: p.id, title: p.title, city: p.city, locality: p.locality, propertyType: p.property_type, transactionType: p.transaction_type, price: p.price, alreadyProposed: p.already }));
}

// -------------------------------------------------------------- agreements

const SELECT = `SELECT c.*, pu.full_name AS proposer_name, tu.full_name AS partner_name, ppo.firm_name AS proposer_firm, tpo.firm_name AS partner_firm,
    pr.title AS property_title, pr.city AS property_city, pr.locality AS property_locality, pr.price AS property_price,
    rq.city AS req_city, rq.property_type AS req_type, rq.budget_min AS req_min, rq.budget_max AS req_max, d.stage::text AS deal_stage
  FROM cobroke_agreements c JOIN users pu ON pu.id = c.proposer_id JOIN users tu ON tu.id = c.partner_id
  LEFT JOIN partner_onboarding ppo ON ppo.user_id = c.proposer_id LEFT JOIN partner_onboarding tpo ON tpo.user_id = c.partner_id
  LEFT JOIN properties pr ON pr.id = c.property_id LEFT JOIN requirements rq ON rq.id = c.requirement_id LEFT JOIN deals d ON d.id = c.deal_id`;

function view(c, viewerId = null) {
  const mine = viewerId === c.proposer_id ? 'proposer' : viewerId === c.partner_id ? 'partner' : null;
  const offerOpen = ['proposed', 'countered'].includes(c.status);
  return {
    id: c.id, agreementNumber: c.agreement_number, subjectType: c.subject_type, status: c.status,
    proposer: { id: c.proposer_id, name: c.proposer_name, firmName: c.proposer_firm, sharePercent: Number(c.split_proposer_percent), side: c.subject_type === 'listing' ? 'Brings the buyer' : 'Brings the listing' },
    partner: { id: c.partner_id, name: c.partner_name, firmName: c.partner_firm, sharePercent: Number(c.split_partner_percent), side: c.subject_type === 'listing' ? 'Holds the listing' : 'Holds the buyer' },
    property: c.property_id ? { id: c.property_id, title: c.property_title, city: c.property_city, locality: c.property_locality, price: c.property_price } : null,
    // A buyer requirement is described by area and budget only - never who the buyer is.
    requirement: c.requirement_id ? { id: c.requirement_id, city: c.req_city, propertyType: c.req_type, budgetMin: c.req_min === null ? null : Number(c.req_min), budgetMax: c.req_max === null ? null : Number(c.req_max) } : null,
    myRole: mine, mySharePercent: mine === 'proposer' ? Number(c.split_proposer_percent) : mine === 'partner' ? Number(c.split_partner_percent) : null,
    // The offer on the table is answered by the side that did not make it.
    awaitingMe: offerOpen && !!viewerId && !!mine && c.last_offer_by !== viewerId,
    expiresAt: offerOpen ? c.expires_at : null, acceptedAt: c.accepted_at, dealId: c.deal_id, dealStage: c.deal_stage, settlement: c.settlement, completedAt: c.completed_at, cancelReason: c.cancel_reason, createdAt: c.created_at,
  };
}

async function row(user, id) {
  const c = (await pool.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0];
  if (!c) throw notFound('Co-broking agreement not found');
  if (!STAFF.includes(user.role) && ![c.proposer_id, c.partner_id].includes(user.id)) throw notFound('Co-broking agreement not found');
  return c;
}

async function get(user, id) {
  const c = await row(user, id);
  const ev = await pool.query(`SELECT e.kind, e.split_proposer_percent, e.note, e.created_at, u.full_name FROM cobroke_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.agreement_id = $1 ORDER BY e.created_at`, [id]);
  return { ...view(c, user.id), timeline: ev.rows.map((e) => ({ kind: e.kind, by: e.full_name, note: e.note, at: e.created_at, split: e.split_proposer_percent === null ? null : { proposer: Number(e.split_proposer_percent), partner: round2(100 - Number(e.split_proposer_percent)) } })) };
}

async function mine(user) {
  await expire();
  const r = await pool.query(`${SELECT} WHERE c.proposer_id = $1 OR c.partner_id = $1 ORDER BY (c.status = ANY($2)) DESC, c.updated_at DESC LIMIT 300`, [user.id, LIVE]);
  const s = await settings();
  return { agreements: r.rows.map((c) => view(c, user.id)), defaultSplit: s.split, minSharePercent: s.minShare };
}

async function all({ status = null, q = null } = {}) {
  await expire();
  const r = await pool.query(
    `${SELECT} WHERE ($1::text IS NULL OR c.status = $1) AND ($2::text IS NULL OR c.agreement_number ILIKE $2 OR pu.full_name ILIKE $2 OR tu.full_name ILIKE $2 OR pr.title ILIKE $2)
     ORDER BY c.updated_at DESC LIMIT 500`,
    [status, q ? `%${q}%` : null]
  );
  const stats = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('proposed', 'countered'))::int AS negotiating, COUNT(*) FILTER (WHERE status = 'accepted')::int AS agreed,
            COUNT(*) FILTER (WHERE status = 'deal_open')::int AS deal_open, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed FROM cobroke_agreements`
  )).rows[0];
  return { agreements: r.rows.map((c) => view(c)), stats };
}

function assertSplit(proposerPercent, minShare) {
  const p = round2(proposerPercent);
  if (!(p >= minShare && p <= 100 - minShare)) throw badRequest(`Each broker's share must be at least ${minShare}%`);
  return p;
}

async function propose(user, data, meta = {}) {
  assertBroker(user);
  const s = await settings();
  let partnerId;
  let propertyId = null;
  let requirementId = null;
  let subject;
  if (data.propertyId) {
    subject = 'listing';
    const p = (await pool.query(`SELECT id, title, status::text AS status, broker_id, created_by FROM properties WHERE id = $1`, [data.propertyId])).rows[0];
    if (!p || p.status !== 'approved') throw notFound('Listing not found or not live');
    partnerId = p.broker_id || p.created_by;
    propertyId = p.id;
  } else if (data.requirementId) {
    subject = 'requirement';
    const rq = (await pool.query(`SELECT r.id, r.status, COALESCE(sh.shared_by, l.created_by, r.created_by) AS holder
       FROM requirements r LEFT JOIN leads l ON l.id = r.lead_id
       LEFT JOIN requirement_shares sh ON sh.requirement_id = r.id AND sh.shared_with = $2 WHERE r.id = $1 ORDER BY sh.created_at DESC NULLS LAST LIMIT 1`, [data.requirementId, user.id])).rows[0];
    if (!rq || rq.status !== 'active') throw notFound('Requirement not found or no longer active');
    partnerId = rq.holder;
    requirementId = rq.id;
  } else throw badRequest('Choose the listing or the buyer requirement to co-broke');
  const partner = await brokerUser(partnerId);
  if (!partner || partner.status !== 'active') throw badRequest(subject === 'listing' ? 'This listing is not held by a partner broker' : 'This requirement is not held by a partner broker');
  if (partner.id === user.id) throw badRequest('This is your own - there is nobody to co-broke with');
  const dup = await pool.query(
    `SELECT 1 FROM cobroke_agreements WHERE status = ANY($1) AND property_id IS NOT DISTINCT FROM $2 AND requirement_id IS NOT DISTINCT FROM $3
       AND ((proposer_id = $4 AND partner_id = $5) OR (proposer_id = $5 AND partner_id = $4))`,
    [LIVE, propertyId, requirementId, user.id, partner.id]
  );
  if (dup.rows.length) throw badRequest('You already have a co-broking proposal or agreement with this broker on this');
  // Suggested split by side unless the proposer names one.
  const suggested = subject === 'listing' ? s.split.buyer_side : s.split.listing_side;
  const proposerPercent = assertSplit(data.myShare !== undefined && data.myShare !== null && data.myShare !== '' ? Number(data.myShare) : suggested, s.minShare);
  const note = data.note ? String(data.note).trim().slice(0, 1000) : null;
  if (note) await assertCleanContent({ note }, { blockContact: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const n = (await client.query(`SELECT nextval('cobroke_agreement_seq') AS n`)).rows[0].n;
    const c = (
      await client.query(
        `INSERT INTO cobroke_agreements (agreement_number, proposer_id, partner_id, subject_type, property_id, requirement_id, split_proposer_percent, split_partner_percent, last_offer_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2, now() + make_interval(days => $9)) RETURNING *`,
        [`CB-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`, user.id, partner.id, subject, propertyId, requirementId, proposerPercent, round2(100 - proposerPercent), s.validDays]
      )
    ).rows[0];
    await event(c.id, 'proposed', user, { split: proposerPercent, note }, client);
    await client.query('COMMIT');
    await auditService.log({ actor: user, action: 'cobroke.proposed', entityType: 'cobroke_agreement', entityId: c.id, after: { number: c.agreement_number, partnerId: partner.id, subject, split: proposerPercent }, ...meta });
    await notify([partner.id], { type: 'cobroke', title: `Co-broking proposal ${c.agreement_number}`, message: `A partner broker proposes to work ${subject === 'listing' ? 'your listing' : 'your buyer requirement'} together - your share ${round2(100 - proposerPercent)}%. Answer within ${s.validDays} days.` });
    return get(user, c.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Accept, decline or counter the offer on the table. Only the side that did not make it may answer.
async function respond(user, id, { action, myShare, note }, meta = {}) {
  await expire();
  const c = await row(user, id);
  if (![c.proposer_id, c.partner_id].includes(user.id)) throw forbidden('Only the two brokers can answer');
  if (!['proposed', 'countered'].includes(c.status)) throw badRequest('There is no open offer on this agreement');
  if (c.last_offer_by === user.id) throw badRequest('Your offer is waiting for the other broker');
  if (!['accept', 'decline', 'counter'].includes(action)) throw badRequest('action must be accept, decline or counter');
  const text = note ? String(note).trim().slice(0, 1000) : null;
  if (text) await assertCleanContent({ note: text }, { blockContact: true });
  const other = user.id === c.proposer_id ? c.partner_id : c.proposer_id;
  const s = await settings();
  if (action === 'counter') {
    if (myShare === undefined || myShare === null || myShare === '') throw badRequest('Enter the share you are asking for');
    const mine = Number(myShare);
    const proposerPercent = assertSplit(user.id === c.proposer_id ? mine : 100 - mine, s.minShare);
    if (proposerPercent === Number(c.split_proposer_percent)) throw badRequest('That is the split already on the table - accept it instead');
    await pool.query(`UPDATE cobroke_agreements SET status = 'countered', split_proposer_percent = $2, split_partner_percent = $3, last_offer_by = $4, expires_at = now() + make_interval(days => $5) WHERE id = $1`, [id, proposerPercent, round2(100 - proposerPercent), user.id, s.validDays]);
    await event(id, 'countered', user, { split: proposerPercent, note: text });
    await notify([other], { type: 'cobroke', title: `${c.agreement_number}: counter-offer`, message: `Your share would be ${round2(user.id === c.proposer_id ? 100 - proposerPercent : proposerPercent)}%.` });
  } else if (action === 'decline') {
    await pool.query(`UPDATE cobroke_agreements SET status = 'declined' WHERE id = $1`, [id]);
    await event(id, 'declined', user, { note: text });
    await notify([other], { type: 'cobroke', title: `${c.agreement_number}: declined`, message: text || 'The other broker declined the co-broking proposal.' });
  } else {
    await pool.query(`UPDATE cobroke_agreements SET status = 'accepted', accepted_at = now(), expires_at = NULL WHERE id = $1`, [id]);
    await event(id, 'accepted', user, { split: Number(c.split_proposer_percent), note: text });
    // The buyer-side broker becomes a partner on the listing with the agreed share.
    if (c.subject_type === 'listing' && c.property_id) {
      await pool.query(
        `INSERT INTO property_partners (property_id, partner_user_id, split_percent, via) SELECT $1, $2, $3, 'cobroke'
         WHERE NOT EXISTS (SELECT 1 FROM property_partners WHERE property_id = $1 AND partner_user_id = $2)`,
        [c.property_id, c.proposer_id, c.split_proposer_percent]
      ).catch(() => {});
    }
    await notify([other], { type: 'cobroke', title: `${c.agreement_number}: agreed`, message: `Split ${Number(c.split_proposer_percent)}% / ${Number(c.split_partner_percent)}%. Open the deal with the A R Buildwel representative; it links to this agreement.` });
    require('./reputation.service').recomputeAll?.().catch(() => {});
    // A deal already open on this listing with one of the two brokers is linked at once.
    await autoLink(id).catch(() => {});
  }
  await auditService.log({ actor: user, action: `cobroke.${action}`, entityType: 'cobroke_agreement', entityId: id, before: { status: c.status, split: Number(c.split_proposer_percent) }, after: { myShare: myShare ?? null }, ...meta });
  return get(user, id);
}

async function withdraw(user, id, meta = {}) {
  const c = await row(user, id);
  if (!['proposed', 'countered'].includes(c.status)) throw badRequest('Only an open proposal can be withdrawn');
  if (c.proposer_id !== user.id) throw forbidden('Only the broker who proposed it can withdraw it');
  await pool.query(`UPDATE cobroke_agreements SET status = 'withdrawn' WHERE id = $1`, [id]);
  await event(id, 'withdrawn', user);
  await auditService.log({ actor: user, action: 'cobroke.withdrawn', entityType: 'cobroke_agreement', entityId: id, ...meta });
  await notify([c.partner_id], { type: 'cobroke', title: `${c.agreement_number}: withdrawn`, message: 'The proposal was withdrawn.' });
  return get(user, id);
}

// Notes between the two brokers - on the record, contact details blocked.
async function message(user, id, body, meta = {}) {
  const c = await row(user, id);
  if (![c.proposer_id, c.partner_id].includes(user.id) && !STAFF.includes(user.role)) throw forbidden('Not allowed');
  if (['declined', 'withdrawn', 'expired', 'cancelled'].includes(c.status)) throw badRequest('This agreement is closed');
  const text = String(body || '').trim();
  if (text.length < 2) throw badRequest('Write a message');
  await assertCleanContent({ message: text }, { blockContact: true });
  await event(id, 'message', user, { note: text.slice(0, 1000) });
  await notify([c.proposer_id, c.partner_id].filter((x) => x !== user.id), { type: 'cobroke', title: `${c.agreement_number}: new message`, message: text.slice(0, 140) });
  await auditService.log({ actor: user, action: 'cobroke.message', entityType: 'cobroke_agreement', entityId: id, ...meta });
  return get(user, id);
}

async function dealFits(c, dealId) {
  const d = (await pool.query(`SELECT d.id, d.stage::text AS stage, d.property_id, d.broker_id, d.customer_id, (SELECT customer_id FROM requirements WHERE id = $2) AS req_customer FROM deals d WHERE d.id = $1`, [dealId, c.requirement_id])).rows[0];
  if (!d) throw notFound('Deal not found');
  if (c.subject_type === 'listing' && d.property_id !== c.property_id) throw badRequest('That deal is on a different listing');
  if (c.subject_type === 'requirement' && d.customer_id !== d.req_customer) throw badRequest('That deal is for a different buyer');
  if (![c.proposer_id, c.partner_id].includes(d.broker_id)) throw badRequest('Neither broker on this agreement is the broker on that deal');
  if ((await pool.query(`SELECT 1 FROM cobroke_agreements WHERE deal_id = $1 AND id <> $2 AND status IN ('deal_open', 'completed')`, [dealId, c.id])).rows.length) throw badRequest('That deal is already linked to another co-broking agreement');
  return d;
}

// The deal the two brokers are working is tied to the agreement.
async function linkDeal(user, id, dealId, meta = {}) {
  const c = await row(user, id);
  if (c.status !== 'accepted') throw badRequest('Link a deal once the split is agreed');
  const d = await dealFits(c, dealId);
  if (d.stage === 'closed_lost') throw badRequest('That deal was lost');
  await pool.query(`UPDATE cobroke_agreements SET deal_id = $2, status = 'deal_open' WHERE id = $1`, [id, dealId]);
  await event(id, 'deal_linked', user);
  await auditService.log({ actor: user, action: 'cobroke.deal_linked', entityType: 'cobroke_agreement', entityId: id, after: { dealId }, ...meta });
  await notify([c.proposer_id, c.partner_id].filter((x) => x !== user.id), { type: 'cobroke', title: `${c.agreement_number}: deal linked`, message: 'The deal is now tied to your co-broking agreement.' });
  if (d.stage === 'closed_won') await onDealClosed(dealId);
  return get(user, id);
}

async function autoLink(agreementId) {
  const c = (await pool.query('SELECT * FROM cobroke_agreements WHERE id = $1', [agreementId])).rows[0];
  if (!c || c.status !== 'accepted') return;
  const d = (
    await pool.query(
      `SELECT d.id FROM deals d WHERE d.stage::text NOT IN ('closed_lost') AND d.broker_id = ANY($3::uuid[])
         AND (($1::uuid IS NOT NULL AND d.property_id = $1) OR ($2::uuid IS NOT NULL AND d.customer_id = (SELECT customer_id FROM requirements WHERE id = $2)))
         AND NOT EXISTS (SELECT 1 FROM cobroke_agreements x WHERE x.deal_id = d.id AND x.status IN ('deal_open', 'completed'))
       ORDER BY d.created_at DESC LIMIT 1`,
      [c.subject_type === 'listing' ? c.property_id : null, c.subject_type === 'requirement' ? c.requirement_id : null, [c.proposer_id, c.partner_id]]
    )
  ).rows[0];
  if (!d) return;
  await pool.query(`UPDATE cobroke_agreements SET deal_id = $2, status = 'deal_open' WHERE id = $1 AND status = 'accepted'`, [c.id, d.id]);
  await event(c.id, 'deal_linked', null, { note: 'Linked automatically to the deal opened on this listing.' });
  await notify([c.proposer_id, c.partner_id], { type: 'cobroke', title: `${c.agreement_number}: deal linked`, message: 'The deal opened on this listing is tied to your co-broking agreement.' });
}

// Hook: a deal was opened - tie it to the agreed co-broke on that listing, if there is one.
async function onDealCreated(deal) {
  if (!deal?.id || !deal.broker_id) return;
  const c = (
    await pool.query(
      `SELECT id FROM cobroke_agreements WHERE status = 'accepted' AND (proposer_id = $1 OR partner_id = $1)
         AND ((subject_type = 'listing' AND property_id = $2) OR (subject_type = 'requirement' AND requirement_id IN (SELECT id FROM requirements WHERE customer_id = $3)))
       ORDER BY accepted_at DESC LIMIT 1`,
      [deal.broker_id, deal.property_id || null, deal.customer_id || null]
    )
  ).rows[0];
  if (c) await autoLink(c.id);
}
const safeOnDealCreated = (deal) => onDealCreated(deal).catch((err) => console.error('[cobroke] deal link failed:', err.message));

// Hook: the linked deal closed - record the split against the brokers' share.
async function onDealClosed(dealId) {
  const c = (await pool.query(`SELECT * FROM cobroke_agreements WHERE deal_id = $1 AND status = 'deal_open'`, [dealId])).rows[0];
  if (!c) return null;
  const d = (await pool.query('SELECT stage::text AS stage, commission_amount, deal_value FROM deals WHERE id = $1', [dealId])).rows[0];
  if (d.stage === 'closed_lost') {
    await pool.query(`UPDATE cobroke_agreements SET status = 'cancelled', cancel_reason = 'The deal did not go through' WHERE id = $1`, [c.id]);
    await event(c.id, 'cancelled', null, { note: 'The deal did not go through.' });
    await notify([c.proposer_id, c.partner_id], { type: 'cobroke', title: `${c.agreement_number}: closed without a deal`, message: 'The linked deal did not go through.' });
    return null;
  }
  if (d.stage !== 'closed_won') return null;
  // The brokers' share recorded on the deal is what is split; without it the percentages stand on their own.
  const basis = d.commission_amount === null ? null : Number(d.commission_amount);
  const settlement = { basis, basisNote: basis === null ? "The brokers' share was not recorded on the deal - the agreed percentages apply to it" : "Brokers' share recorded on the deal", proposerPercent: Number(c.split_proposer_percent), partnerPercent: Number(c.split_partner_percent),
    proposerAmount: basis === null ? null : round2((basis * Number(c.split_proposer_percent)) / 100), partnerAmount: basis === null ? null : round2(basis - round2((basis * Number(c.split_proposer_percent)) / 100)) };
  await pool.query(`UPDATE cobroke_agreements SET status = 'completed', completed_at = now(), settlement = $2 WHERE id = $1`, [c.id, JSON.stringify(settlement)]);
  await event(c.id, 'completed', null, { split: Number(c.split_proposer_percent), note: basis === null ? 'Deal closed. Split recorded as agreed.' : `Deal closed. Brokers' share ₹${basis.toLocaleString('en-IN')} split as agreed.` });
  await auditService.log({ actor: null, action: 'cobroke.completed', entityType: 'cobroke_agreement', entityId: c.id, after: settlement });
  await notify([c.proposer_id, c.partner_id], { type: 'cobroke', title: `${c.agreement_number}: deal closed`, message: `Split recorded: ${settlement.proposerPercent}% / ${settlement.partnerPercent}%.` });
  const trust = require('./trust.service');
  trust.safeRecompute(c.proposer_id, 'cobroke_completed');
  trust.safeRecompute(c.partner_id, 'cobroke_completed');
  return settlement;
}
const safeOnDealClosed = (dealId) => onDealClosed(dealId).catch((err) => console.error('[cobroke] deal close failed:', err.message));

// After the split is agreed, either broker (or staff) can end it with a reason - before the deal closes.
async function cancel(user, id, reason, meta = {}) {
  const c = await row(user, id);
  if (!['accepted', 'deal_open'].includes(c.status)) throw badRequest('Only an agreed co-broke that has not completed can be cancelled');
  const text = String(reason || '').trim();
  if (text.length < 5) throw badRequest('Give the reason');
  await assertCleanContent({ reason: text }, { blockContact: true });
  if (c.status === 'deal_open' && !STAFF.includes(user.role)) throw forbidden('A deal is already open on this agreement - ask A R Buildwel to cancel it, or raise a dispute');
  await pool.query(`UPDATE cobroke_agreements SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`, [id, text.slice(0, 500)]);
  await event(id, 'cancelled', user, { note: text.slice(0, 500) });
  if (c.subject_type === 'listing') await pool.query(`DELETE FROM property_partners WHERE property_id = $1 AND partner_user_id = $2 AND via = 'cobroke'`, [c.property_id, c.proposer_id]).catch(() => {});
  await auditService.log({ actor: user, action: 'cobroke.cancelled', entityType: 'cobroke_agreement', entityId: id, after: { reason: text }, ...meta });
  await notify([c.proposer_id, c.partner_id].filter((x) => x !== user.id), { type: 'cobroke', title: `${c.agreement_number}: cancelled`, message: text.slice(0, 140) });
  return get(user, id);
}

// Offers left unanswered lapse.
async function expire() {
  const r = await pool.query(`UPDATE cobroke_agreements SET status = 'expired' WHERE status IN ('proposed', 'countered') AND expires_at < now() RETURNING id, agreement_number, proposer_id, partner_id`);
  for (const c of r.rows) {
    await event(c.id, 'expired', null, { note: 'No answer in time.' });
    await notify([c.proposer_id, c.partner_id], { type: 'cobroke', title: `${c.agreement_number}: expired`, message: 'The offer was not answered in time.' });
  }
  return r.rows.length;
}

// A broker's network at a glance.
async function summary(user) {
  const r = (
    await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('proposed', 'countered') AND last_offer_by <> $1)::int AS to_answer,
              COUNT(*) FILTER (WHERE status IN ('proposed', 'countered') AND last_offer_by = $1)::int AS waiting,
              COUNT(*) FILTER (WHERE status IN ('accepted', 'deal_open'))::int AS active, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(DISTINCT CASE WHEN status IN ('accepted', 'deal_open', 'completed') THEN (CASE WHEN proposer_id = $1 THEN partner_id ELSE proposer_id END) END)::int AS partners
       FROM cobroke_agreements WHERE proposer_id = $1 OR partner_id = $1`,
      [user.id]
    )
  ).rows[0];
  return r;
}

module.exports = { settings, directory, listingsOf, get, mine, all, propose, respond, withdraw, message, linkDeal, cancel, expire, summary, onDealCreated, safeOnDealCreated, onDealClosed, safeOnDealClosed };
