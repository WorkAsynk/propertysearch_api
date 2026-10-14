const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const configService = require('./config.service');
const notificationService = require('./notification.service');
const auditService = require('./audit.service');
const { assertCleanContent } = require('../utils/contentGuard');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

// Module 34 - Onboarding Assist for brokers, agencies and builders.
//   Partner : the Screen 2 details (areas served - mandatory for a broker -
//             firm, RERA, preferences), a checklist worked out from what
//             they have actually done, the next best action, and a named
//             A R Buildwel staff member to ask for help.
//   Staff   : who is onboarding and where each one is stuck; assign an
//             assistant, log calls and notes, fill details on their behalf,
//             nudge; turn a "Join as Broker / Builder" enquiry into an account.
//   System  : nudges anyone who stalls, then asks the assistant to step in.

const STAFF = ['internal_sales', 'admin', 'super_admin'];
const ADMIN = ['admin', 'super_admin'];
const PARTNER_ROLES = ['broker', 'agency_admin', 'builder'];
const list = (v, max = 40) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean))].slice(0, max);

async function settings() {
  const [stallDays, maxNudges] = await Promise.all([configService.getConfig('onboarding.stall_days', 3), configService.getConfig('onboarding.max_nudges', 3)]);
  return { stallDays: Math.max(1, Number(stallDays) || 3), maxNudges: Math.max(0, Number(maxNudges) || 3) };
}

const adminIds = async () => (await pool.query(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = ANY($1) AND u.status = 'active'`, [ADMIN])).rows.map((r) => r.id);
const notify = async (ids, n) => {
  for (const id of [...new Set(ids.filter(Boolean))]) await notificationService.createNotification({ userId: id, ...n }).catch(() => {});
};
const note = (userId, kind, body, author = null) => pool.query(`INSERT INTO partner_onboarding_notes (user_id, author_id, kind, body) VALUES ($1, $2, $3, $4)`, [userId, author?.id || null, kind, String(body).slice(0, 2000)]);

async function partner(userId) {
  const u = (await pool.query(`SELECT u.id, u.full_name, u.email, u.mobile, u.status, u.mobile_verified, u.tenant_id, u.created_at, u.last_login_at, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [userId])).rows[0];
  if (!u || !PARTNER_ROLES.includes(u.role)) throw notFound('Broker or builder not found');
  return u;
}
async function ensure(userId) {
  await pool.query(`INSERT INTO partner_onboarding (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  return (await pool.query('SELECT * FROM partner_onboarding WHERE user_id = $1', [userId])).rows[0];
}

// The checklist is read from live data - nothing is ticked by hand.
async function steps(u, p) {
  const builder = u.role === 'builder';
  const f = (
    await pool.query(
      `SELECT (SELECT status FROM user_verifications WHERE user_id = $1 AND kind = 'kyc' ORDER BY (status = 'verified') DESC, created_at DESC LIMIT 1) AS kyc,
              (SELECT status FROM user_verifications WHERE user_id = $1 AND kind = 'rera' ORDER BY (status = 'verified') DESC, created_at DESC LIMIT 1) AS rera,
              (SELECT status FROM user_verifications WHERE user_id = $1 AND kind = 'company' ORDER BY (status = 'verified') DESC, created_at DESC LIMIT 1) AS company,
              (SELECT COUNT(*) FROM properties WHERE created_by = $1 OR broker_id = $1 OR builder_id = $1)::int AS listings,
              (SELECT COUNT(*) FROM properties WHERE (created_by = $1 OR broker_id = $1 OR builder_id = $1) AND status::text = 'approved')::int AS live_listings,
              (SELECT COUNT(*) FROM projects WHERE builder_id = $1)::int AS projects,
              (SELECT COUNT(*) FROM leads WHERE first_contacted_by = $1)::int AS responded,
              (SELECT COUNT(*) FROM lead_source_connections WHERE tenant_id = $2::uuid AND status = 'active')::int AS sources,
              ((SELECT COUNT(*) FROM broker_vouches WHERE (voucher_id = $1 OR vouchee_id = $1) AND revoked_at IS NULL)
               + (SELECT COUNT(*) FROM cobroke_agreements WHERE (proposer_id = $1 OR partner_id = $1) AND status IN ('accepted', 'deal_open', 'completed')))::int AS network`,
      [u.id, u.tenant_id]
    )
  ).rows[0];
  const state = (v) => (v === 'verified' ? 'done' : v === 'pending' ? 'in_review' : 'todo');
  const detailsDone = builder ? !!(p.firm_name && p.cities.length) : !!(p.firm_name && p.areas.length);
  const out = [
    { key: 'details', label: builder ? 'Your company and the cities you build in' : 'Your firm and the areas you work in', required: true, state: detailsDone ? 'done' : 'todo', to: '/app/get-started', hint: builder ? 'Company name and at least one city.' : 'Firm name and at least one area - inquiries are matched to the areas you choose.' },
    { key: 'mobile', label: 'Verify your mobile number', required: true, state: u.mobile_verified ? 'done' : 'todo', to: '/app/settings', hint: 'Needed before a listing can go live.' },
    { key: 'kyc', label: 'Identity check (KYC)', required: true, state: state(f.kyc), to: '/app/trust', hint: 'Upload PAN, Aadhaar or passport under Trust & Reviews. Only the last 4 characters are stored.' },
  ];
  if (builder) {
    out.push({ key: 'company', label: 'Company registration or RERA', required: true, state: [state(f.company), state(f.rera)].includes('done') ? 'done' : [state(f.company), state(f.rera)].includes('in_review') ? 'in_review' : 'todo', to: '/app/trust', hint: 'CIN / LLPIN or your promoter RERA number.' });
    out.push({ key: 'first_project', label: 'Add your first project', required: true, state: f.projects > 0 ? 'done' : 'todo', to: '/app/projects', hint: 'Projects hold your units and their availability.' });
    out.push({ key: 'first_listing', label: 'List a unit or property', required: false, state: f.listings > 0 ? 'done' : 'todo', to: '/app/properties/new', hint: 'Listings are matched to live buyer requirements as soon as they are approved.' });
  } else {
    out.push({ key: 'rera', label: 'RERA registration', required: false, state: state(f.rera), to: '/app/trust', hint: 'Optional at sign-up. A verified RERA number adds the Verified Broker badge.' });
    out.push({ key: 'first_listing', label: 'Post your first listing', required: true, state: f.live_listings > 0 ? 'done' : f.listings > 0 ? 'in_review' : 'todo', to: '/app/properties/new', hint: 'It goes live once approved and is matched to buyer requirements.' });
    out.push({ key: 'first_response', label: 'Respond to your first inquiry', required: false, state: f.responded > 0 ? 'done' : 'todo', to: '/app/enquiries', hint: 'Log first contact inside the response window - it builds your trust score.' });
    out.push({ key: 'lead_source', label: 'Connect a lead source', required: false, state: f.sources > 0 ? 'done' : 'todo', to: '/app/lead-sources', hint: 'Portal, ad and WhatsApp leads flow into your CRM with their source tagged.' });
    out.push({ key: 'network', label: 'Make your first broker connection', required: false, state: f.network > 0 ? 'done' : 'todo', to: '/app/broker-network', hint: 'Co-broke a listing or vouch for a broker you have worked with.' });
  }
  return out;
}

async function view(userId, { staff = false } = {}) {
  const u = await partner(userId);
  let p = await ensure(userId);
  const st = await steps(u, p);
  const required = st.filter((s) => s.required);
  const done = st.filter((s) => s.state === 'done').length;
  const requiredDone = required.filter((s) => s.state === 'done').length;
  const complete = requiredDone === required.length;
  // Progress and completion are recorded as they happen, for the stall check.
  if (done !== p.done_count || (complete && !p.completed_at) || (st[0].state === 'done' && !p.details_completed_at)) {
    p = (
      await pool.query(
        `UPDATE partner_onboarding SET done_count = $2, last_progress_at = CASE WHEN $2 > done_count THEN now() ELSE last_progress_at END,
                details_completed_at = CASE WHEN $3 AND details_completed_at IS NULL THEN now() ELSE details_completed_at END,
                completed_at = CASE WHEN $4 AND completed_at IS NULL THEN now() ELSE completed_at END WHERE user_id = $1 RETURNING *`,
        [userId, done, st[0].state === 'done', complete]
      )
    ).rows[0];
    if (complete && done !== 0 && !p.nudged_at) { /* nothing to undo */ }
  }
  const next = st.find((s) => s.required && s.state === 'todo') || st.find((s) => s.required && s.state === 'in_review') || st.find((s) => !s.required && s.state === 'todo') || null;
  const assistant = p.assisted_by ? (await pool.query(`SELECT u.full_name, ar.platform_number FROM users u LEFT JOIN arb_representatives ar ON ar.user_id = u.id WHERE u.id = $1`, [p.assisted_by])).rows[0] : null;
  return {
    userId: u.id, role: u.role, accountStatus: u.status,
    details: { firmName: p.firm_name, reraNumber: p.rera_number, cities: p.cities, areas: p.areas, preferences: p.preferences || {} },
    steps: st, progressPercent: Math.round((requiredDone / required.length) * 100), requiredDone, requiredTotal: required.length, complete, completedAt: p.completed_at,
    // First-success-action guidance.
    nextAction: next ? { key: next.key, label: next.label, to: next.to, hint: next.hint, waiting: next.state === 'in_review' } : null,
    // The partner sees their assistant's name and platform number only.
    assistant: assistant ? { name: assistant.full_name, platformNumber: assistant.platform_number || null } : null,
    helpRequestedAt: p.help_requested_at,
    ...(staff ? { name: u.full_name, email: u.email, mobile: u.mobile, joinedAt: u.created_at, lastLoginAt: u.last_login_at, assistedBy: p.assisted_by, bdLeadId: p.bd_lead_id, lastProgressAt: p.last_progress_at, nudgeCount: p.nudge_count, nudgedAt: p.nudged_at } : {}),
  };
}

function cleanDetails(role, data, before) {
  const pick = (k, col) => (data[k] !== undefined ? data[k] : before[col]);
  const firmName = pick('firmName', 'firm_name') ? String(pick('firmName', 'firm_name')).trim().slice(0, 200) : null;
  const rera = pick('reraNumber', 'rera_number') ? String(pick('reraNumber', 'rera_number')).trim().slice(0, 60) : null;
  const cities = list(pick('cities', 'cities'), 20);
  const areas = list(pick('areas', 'areas'), 60);
  if (data.firmName !== undefined && (!firmName || firmName.length < 2)) throw badRequest(role === 'builder' ? 'Enter your company name' : 'Enter your firm name');
  if (role !== 'builder' && data.areas !== undefined && !areas.length) throw badRequest('Choose at least one area you work in');
  if (role === 'builder' && data.cities !== undefined && !cities.length) throw badRequest('Choose at least one city');
  const prefs = { ...(before.preferences || {}) };
  if (data.preferences && typeof data.preferences === 'object') {
    for (const k of ['propertyTypes', 'dealTypes', 'budgetBands', 'languages', 'projectTypes']) if (data.preferences[k] !== undefined) prefs[k] = list(data.preferences[k], 15);
    for (const k of ['teamSize', 'experienceYears']) if (data.preferences[k] !== undefined) prefs[k] = data.preferences[k] === null || data.preferences[k] === '' ? null : Math.max(0, Math.min(999, Number(data.preferences[k]) || 0));
  }
  return { firmName, rera, cities, areas, prefs };
}

async function saveDetails(actor, userId, data, meta = {}) {
  const u = await partner(userId);
  const before = await ensure(userId);
  const v = cleanDetails(u.role, data, before);
  await assertCleanContent({ firmName: v.firmName || '' }, { blockContact: true });
  await pool.query(`UPDATE partner_onboarding SET firm_name = $2, rera_number = $3, cities = $4, areas = $5, preferences = $6 WHERE user_id = $1`, [userId, v.firmName, v.rera, v.cities, v.areas, JSON.stringify(v.prefs)]);
  await auditService.log({ actor, action: actor.id === userId ? 'onboarding.details_saved' : 'onboarding.details_saved_by_staff', entityType: 'user', entityId: userId, after: { firmName: v.firmName, areas: v.areas.length, cities: v.cities.length }, ...meta });
  if (actor.id !== userId) await note(userId, 'system', 'Details filled in on their behalf.', actor);
  return view(userId, { staff: STAFF.includes(actor.role) });
}

// The partner asks for a hand: the assistant (or admins) are told.
async function requestHelp(user, message, meta = {}) {
  const text = String(message || '').trim();
  if (text.length < 5) throw badRequest('Tell us what you need help with');
  await assertCleanContent({ message: text }, { blockContact: true });
  const p = await ensure(user.id);
  await pool.query('UPDATE partner_onboarding SET help_requested_at = now() WHERE user_id = $1', [user.id]);
  await note(user.id, 'help_request', text, user);
  await notify(p.assisted_by ? [p.assisted_by] : await adminIds(), { type: 'onboarding_help', title: 'Onboarding help requested', message: text.slice(0, 160) });
  await auditService.log({ actor: user, action: 'onboarding.help_requested', entityType: 'user', entityId: user.id, ...meta });
  return view(user.id);
}

// ------------------------------------------------------------------ staff

// One query for the whole desk: the same checklist rules as view(), worked
// out set-based so the list and its totals stay fast with thousands of partners.
const DESK_CTE = `WITH base AS (
    SELECT u.id, u.full_name, u.email, u.status::text AS account_status, u.created_at, u.last_login_at, u.mobile_verified, r.name AS role,
           p.firm_name, p.assisted_by, a.full_name AS assistant_name, COALESCE(p.nudge_count, 0) AS nudge_count, p.help_requested_at,
           COALESCE(p.last_progress_at, u.created_at) AS last_progress_at,
           (p.firm_name IS NOT NULL AND CASE WHEN r.name = 'builder' THEN cardinality(p.cities) > 0 ELSE cardinality(p.areas) > 0 END) IS TRUE AS s_details,
           EXISTS (SELECT 1 FROM user_verifications v WHERE v.user_id = u.id AND v.kind = 'kyc' AND v.status = 'verified') AS s_kyc,
           EXISTS (SELECT 1 FROM user_verifications v WHERE v.user_id = u.id AND v.kind = 'kyc' AND v.status = 'pending') AS w_kyc,
           EXISTS (SELECT 1 FROM user_verifications v WHERE v.user_id = u.id AND v.kind IN ('company', 'rera') AND v.status = 'verified') AS s_company,
           EXISTS (SELECT 1 FROM user_verifications v WHERE v.user_id = u.id AND v.kind IN ('company', 'rera') AND v.status = 'pending') AS w_company,
           EXISTS (SELECT 1 FROM properties x WHERE (x.created_by = u.id OR x.broker_id = u.id) AND x.status::text = 'approved') AS s_listing,
           EXISTS (SELECT 1 FROM properties x WHERE (x.created_by = u.id OR x.broker_id = u.id)) AS w_listing,
           EXISTS (SELECT 1 FROM projects x WHERE x.builder_id = u.id) AS s_project
    FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN partner_onboarding p ON p.user_id = u.id LEFT JOIN users a ON a.id = p.assisted_by
    WHERE r.name = ANY($1) AND u.status::text <> 'inactive' AND u.anonymised_at IS NULL
  ), scored AS (
    SELECT b.*, CASE WHEN b.role = 'builder' THEN 5 ELSE 4 END AS required_total,
           (b.s_details::int + b.mobile_verified::int + b.s_kyc::int + CASE WHEN b.role = 'builder' THEN b.s_company::int + b.s_project::int ELSE b.s_listing::int END) AS required_done
    FROM base b
  ), stated AS (
    SELECT s.*, CASE WHEN s.required_done = s.required_total THEN 'completed'
                     WHEN s.last_progress_at < now() - make_interval(days => $2) THEN 'stalled'
                     WHEN s.required_done = 0 THEN 'not_started' ELSE 'in_progress' END AS state
    FROM scored s
  )`;

function stuckOn(x) {
  const builder = x.role === 'builder';
  const order = [
    [x.s_details, false, builder ? 'Your company and the cities you build in' : 'Your firm and the areas you work in'],
    [x.mobile_verified, false, 'Verify your mobile number'],
    [x.s_kyc, x.w_kyc, 'Identity check (KYC)'],
    ...(builder ? [[x.s_company, x.w_company, 'Company registration or RERA'], [x.s_project, false, 'Add your first project']] : [[x.s_listing, x.w_listing, 'Post your first listing']]),
  ];
  const todo = order.find(([done, waiting]) => !done && !waiting) || order.find(([done]) => !done);
  return todo ? { label: todo[2], waiting: !!todo[1] } : { label: null, waiting: false };
}

async function listPartners({ role = null, state = null, assistedBy = null, q = null } = {}) {
  const s = await settings();
  const [rows, stats] = await Promise.all([
    pool.query(
      `${DESK_CTE} SELECT * FROM stated
       WHERE ($3::text IS NULL OR role = $3) AND ($4::uuid IS NULL OR assisted_by = $4)
         AND ($5::text IS NULL OR full_name ILIKE $5 OR email ILIKE $5 OR firm_name ILIKE $5)
         AND ($6::text IS NULL OR state = $6 OR ($6 = 'needs_help' AND help_requested_at IS NOT NULL AND state <> 'completed'))
       ORDER BY (state = 'completed'), help_requested_at DESC NULLS LAST, (state = 'stalled') DESC, created_at DESC LIMIT 200`,
      [PARTNER_ROLES, s.stallDays, role, assistedBy, q ? `%${q}%` : null, state]
    ),
    pool.query(
      `${DESK_CTE} SELECT COUNT(*) FILTER (WHERE state = 'not_started')::int AS "notStarted", COUNT(*) FILTER (WHERE state = 'in_progress')::int AS "inProgress",
              COUNT(*) FILTER (WHERE state = 'stalled')::int AS stalled, COUNT(*) FILTER (WHERE state = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE help_requested_at IS NOT NULL AND state <> 'completed')::int AS "needsHelp",
              COUNT(*) FILTER (WHERE assisted_by IS NULL AND state <> 'completed')::int AS unassigned, COUNT(*)::int AS total FROM stated`,
      [PARTNER_ROLES, s.stallDays]
    ),
  ]);
  return {
    partners: rows.rows.map((x) => {
      const stuck = stuckOn(x);
      return { userId: x.id, name: x.full_name, email: x.email, role: x.role, accountStatus: x.account_status, firmName: x.firm_name, joinedAt: x.created_at, lastLoginAt: x.last_login_at, state: x.state,
        progressPercent: Math.round((x.required_done / x.required_total) * 100), stuckOn: x.state === 'completed' ? null : stuck.label, waiting: stuck.waiting, assistantName: x.assistant_name, assistedBy: x.assisted_by,
        nudgeCount: x.nudge_count, helpRequestedAt: x.state === 'completed' ? null : x.help_requested_at, lastProgressAt: x.last_progress_at };
    }),
    stats: stats.rows[0],
    shown: rows.rows.length,
  };
}

async function getPartner(userId) {
  const v = await view(userId, { staff: true });
  const notes = await pool.query(`SELECT n.id, n.kind, n.body, n.created_at, u.full_name FROM partner_onboarding_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`, [userId]);
  return { ...v, notes: notes.rows.map((n) => ({ id: n.id, kind: n.kind, body: n.body, by: n.full_name, at: n.created_at })) };
}

async function assertStaff(userId) {
  const u = (await pool.query(`SELECT r.name, u.full_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.status = 'active'`, [userId])).rows[0];
  if (!u || !STAFF.includes(u.name)) throw badRequest('The assistant must be an active A R Buildwel staff member');
  return u;
}

async function assign(actor, userId, staffId, meta = {}) {
  const u = await partner(userId);
  await ensure(userId);
  const s = staffId ? await assertStaff(staffId) : null;
  await pool.query('UPDATE partner_onboarding SET assisted_by = $2 WHERE user_id = $1', [userId, staffId || null]);
  await note(userId, 'system', s ? `${s.full_name} assigned to assist.` : 'Assistant removed.', actor);
  await auditService.log({ actor, action: 'onboarding.assistant_assigned', entityType: 'user', entityId: userId, after: { staffId: staffId || null }, ...meta });
  if (s) {
    await notify([staffId], { type: 'onboarding_assigned', title: 'Onboarding to assist', message: `${u.full_name} (${u.role.replace('_', ' ')}) is yours to help get started.` });
    await notify([userId], { type: 'onboarding', title: 'Your onboarding contact', message: `${s.full_name} from A R Buildwel will help you get set up.` });
  }
  return getPartner(userId);
}

async function addNote(actor, userId, { kind = 'note', body }, meta = {}) {
  await partner(userId);
  await ensure(userId);
  if (!['note', 'call', 'visit'].includes(kind)) throw badRequest('kind must be note, call or visit');
  if (!body || String(body).trim().length < 3) throw badRequest('Write the note');
  await note(userId, kind, String(body).trim(), actor);
  // A logged call or visit answers an open help request.
  if (kind !== 'note') await pool.query('UPDATE partner_onboarding SET help_requested_at = NULL WHERE user_id = $1', [userId]);
  await auditService.log({ actor, action: 'onboarding.note_added', entityType: 'user', entityId: userId, after: { kind }, ...meta });
  return getPartner(userId);
}

async function nudgeOne(userId, actor = null) {
  const v = await view(userId, { staff: true });
  if (v.complete || !v.nextAction) return false;
  await notify([userId], { type: 'onboarding', title: v.nextAction.waiting ? 'Your onboarding is with our team' : `Next step: ${v.nextAction.label}`, message: v.nextAction.hint });
  await pool.query('UPDATE partner_onboarding SET nudge_count = nudge_count + 1, nudged_at = now() WHERE user_id = $1', [userId]);
  await note(userId, 'nudge', `Reminder sent: ${v.nextAction.label}`, actor);
  return true;
}

async function nudge(actor, userId, meta = {}) {
  await partner(userId);
  if (!(await nudgeOne(userId, actor))) throw badRequest('This partner has finished onboarding');
  await auditService.log({ actor, action: 'onboarding.nudged', entityType: 'user', entityId: userId, ...meta });
  return getPartner(userId);
}

// "Join as Broker / Builder" enquiry -> an account with what they told us filled in.
async function convertLead(actor, bdLeadId, { email, password, role }, meta = {}) {
  const lead = (await pool.query('SELECT * FROM bd_leads WHERE id = $1', [bdLeadId])).rows[0];
  if (!lead) throw notFound('Enquiry not found');
  if (!['broker', 'builder'].includes(lead.category)) throw badRequest('Only a broker or builder partner enquiry can be turned into an account');
  if (lead.converted_user_id) throw badRequest('This enquiry already has an account');
  const targetRole = lead.category === 'builder' ? 'builder' : role === 'agency_admin' ? 'agency_admin' : 'broker';
  const mail = String(email || lead.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw badRequest('A login email is required');
  if (!password || String(password).length < 8) throw badRequest('Set an initial password of at least 8 characters');
  if ((await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [mail])).rows.length) throw badRequest('An account with this email already exists');
  const mobile = lead.mobile ? String(lead.mobile).replace(/\D/g, '').slice(-10) : null;
  const mobileFree = mobile && !(await pool.query('SELECT 1 FROM users WHERE mobile = $1', [mobile])).rows.length;
  const assistant = lead.assigned_to && STAFF.includes((await pool.query(`SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [lead.assigned_to])).rows[0]?.name) ? lead.assigned_to : STAFF.includes(actor.role) ? actor.id : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roleId = (await client.query('SELECT id FROM roles WHERE name = $1', [targetRole])).rows[0].id;
    const u = (
      await client.query(
        `INSERT INTO users (role_id, full_name, email, mobile, password_hash, status, email_verified, created_by, signup_source) VALUES ($1, $2, $3, $4, $5, 'active', true, $6, 'admin_created') RETURNING id`,
        [roleId, lead.full_name, mail, mobileFree ? mobile : null, await bcrypt.hash(String(password), 10), actor.id]
      )
    ).rows[0];
    await client.query(
      `INSERT INTO partner_onboarding (user_id, firm_name, cities, areas, assisted_by, bd_lead_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [u.id, lead.business_name || null, lead.city_name ? [lead.city_name] : [], lead.area_name ? [lead.area_name] : [], assistant, lead.id]
    );
    await client.query(`UPDATE bd_leads SET status = 'converted', converted_user_id = $2, converted_at = now() WHERE id = $1`, [lead.id, u.id]);
    await client.query('COMMIT');
    await note(u.id, 'system', 'Account created from a partner enquiry.', actor);
    await auditService.log({ actor, action: 'onboarding.lead_converted', entityType: 'user', entityId: u.id, after: { bdLeadId: lead.id, role: targetRole }, ...meta });
    return getPartner(u.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Partner enquiries not yet turned into accounts - the top of the onboarding funnel.
async function pendingLeads() {
  const r = await pool.query(
    `SELECT b.id, b.category, b.full_name, b.city_name, b.area_name, b.business_name, b.status::text AS status, b.created_at, a.full_name AS assigned_name
     FROM bd_leads b LEFT JOIN users a ON a.id = b.assigned_to WHERE b.category IN ('broker', 'builder') AND b.converted_user_id IS NULL AND b.status::text NOT IN ('converted', 'rejected', 'closed')
     ORDER BY b.created_at DESC LIMIT 100`
  );
  return r.rows.map((b) => ({ id: b.id, category: b.category, name: b.full_name, city: b.city_name, area: b.area_name, businessName: b.business_name, status: b.status, assignedName: b.assigned_name, createdAt: b.created_at }));
}

// Anyone still onboarding with no progress for a few days is nudged; after
// the last nudge their assistant (or the admins) is asked to step in.
async function sweep() {
  const s = await settings();
  const stalled = await pool.query(
    `SELECT p.user_id, p.nudge_count, p.assisted_by, u.full_name FROM partner_onboarding p JOIN users u ON u.id = p.user_id JOIN roles r ON r.id = u.role_id
     WHERE p.completed_at IS NULL AND u.status = 'active' AND r.name = ANY($1)
       AND p.last_progress_at < now() - make_interval(days => $2) AND (p.nudged_at IS NULL OR p.nudged_at < now() - make_interval(days => $2))`,
    [PARTNER_ROLES, s.stallDays]
  );
  let nudged = 0;
  let escalated = 0;
  for (const x of stalled.rows) {
    if (x.nudge_count < s.maxNudges) {
      if (await nudgeOne(x.user_id)) nudged += 1;
    } else if (x.nudge_count === s.maxNudges) {
      await pool.query('UPDATE partner_onboarding SET nudge_count = nudge_count + 1, nudged_at = now() WHERE user_id = $1', [x.user_id]);
      await note(x.user_id, 'system', 'Still stalled after the automatic reminders - personal follow-up needed.');
      await notify(x.assisted_by ? [x.assisted_by] : await adminIds(), { type: 'onboarding_stalled', title: 'Onboarding stalled', message: `${x.full_name} has not moved forward after ${s.maxNudges} reminders. Give them a call.` });
      escalated += 1;
    }
  }
  return { checked: stalled.rows.length, nudged, escalated };
}

let timer = null;
function startScheduler() {
  if (timer) return;
  timer = setInterval(() => sweep().catch((err) => console.error('[onboarding] sweep failed:', err.message)), 6 * 60 * 60 * 1000);
}

module.exports = { PARTNER_ROLES, view, saveDetails, requestHelp, listPartners, getPartner, assign, addNote, nudge, convertLead, pendingLeads, sweep, startScheduler };
