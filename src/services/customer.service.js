const pool = require('../config/db');
const { isAdmin } = require('../utils/ownership');
const { signUrls } = require('../utils/storage');

function notFound(message = 'Customer not found') {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const CUSTOMER_SELECT = `
  SELECT c.*, t.name AS tenant_name, creator.full_name AS created_by_name,
         account.signup_source AS account_signup_source, account.status AS account_status
  FROM customers c
  LEFT JOIN tenants t ON t.id = c.tenant_id
  LEFT JOIN users creator ON creator.id = c.created_by
  LEFT JOIN users account ON account.id = c.user_id
`;

function applyTenantScope(user, where, params) {
  if (isAdmin(user.role)) return;
  params.push(user.tenant_id || null, user.id);
  where.push(`(c.tenant_id = $${params.length - 1} OR c.created_by = $${params.length})`);
}

async function listCustomers(user, filters, page, limit) {
  const where = [];
  const params = [];

  applyTenantScope(user, where, params);

  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.mobile ILIKE $${params.length})`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await pool.query(`SELECT COUNT(*) FROM customers c ${whereClause}`, params);

  params.push(limit, offset);
  const result = await pool.query(
    `${CUSTOMER_SELECT}
     ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    items: result.rows,
    pagination: {
      page,
      limit,
      total: Number(countResult.rows[0].count),
      totalPages: Math.ceil(Number(countResult.rows[0].count) / limit),
    },
  };
}

async function getCustomerById(id) {
  const result = await pool.query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id]);
  const customer = result.rows[0];
  if (!customer) throw notFound();
  return customer;
}

// Looks up a customer record by the login account (users.id) it's linked
// to, rather than by customers.id - used to resolve "the customer record
// for the currently authenticated user" (e.g. for favorites). Returns
// null (not a 404) since a login account without a linked customer
// record is an expected, non-error case for staff roles.
async function getCustomerByUserId(userId) {
  const result = await pool.query('SELECT * FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
  return result.rows[0] || null;
}

async function createCustomer(data, user) {
  const { fullName, email, mobile, userId } = data;

  if (!email && !mobile) {
    throw badRequest('Either email or mobile is required');
  }

  const result = await pool.query(
    `INSERT INTO customers (tenant_id, created_by, user_id, full_name, email, mobile)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [user.tenant_id || null, user.id, userId || null, fullName, email || null, mobile || null]
  );

  return getCustomerById(result.rows[0].id);
}

// Used by the lead public-inquiry flow, and by a new self-registered
// `customer` user account (registerUser/loginWithGoogle) - reuses an
// existing customer record matched by email/mobile, or creates a new
// (tenant-less, staff-less) one. `userId`, when given, links the customer
// record to that login account - backfilled onto an existing match too, so
// a customer record created earlier from a public inquiry (with no
// account yet) gets linked the moment that same person signs up.
async function findOrCreateCustomerByContact({ fullName, email, mobile, userId } = {}) {
  let existing = null;
  if (email) {
    const result = await pool.query('SELECT * FROM customers WHERE email = $1 LIMIT 1', [email]);
    existing = result.rows[0];
  }
  if (!existing && mobile) {
    const result = await pool.query('SELECT * FROM customers WHERE mobile = $1 LIMIT 1', [mobile]);
    existing = result.rows[0];
  }

  if (existing) {
    if (userId && !existing.user_id) {
      const updated = await pool.query(
        'UPDATE customers SET user_id = $1 WHERE id = $2 RETURNING *',
        [userId, existing.id]
      );
      return updated.rows[0];
    }
    return existing;
  }

  const result = await pool.query(
    `INSERT INTO customers (user_id, full_name, email, mobile)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId || null, fullName, email || null, mobile || null]
  );
  return result.rows[0];
}

const UPDATABLE_CUSTOMER_FIELDS = {
  fullName: 'full_name',
  email: 'email',
  mobile: 'mobile',
  userId: 'user_id',
};

async function updateCustomer(id, data) {
  const set = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_CUSTOMER_FIELDS)) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      set.push(`${column} = $${params.length}`);
    }
  }

  if (set.length === 0) throw badRequest('No updatable fields provided');

  params.push(id);
  await pool.query(
    `UPDATE customers SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return getCustomerById(id);
}

async function getPreferences(customerId) {
  const result = await pool.query('SELECT * FROM customer_preferences WHERE customer_id = $1', [customerId]);
  return result.rows[0] || null;
}

async function upsertPreferences(customerId, data) {
  const {
    budgetMin,
    budgetMax,
    preferredLocations,
    propertyType,
    transactionType,
    bedrooms,
    notes,
  } = data;

  const result = await pool.query(
    `INSERT INTO customer_preferences (
       customer_id, budget_min, budget_max, preferred_locations,
       property_type, transaction_type, bedrooms, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (customer_id) DO UPDATE SET
       budget_min = EXCLUDED.budget_min,
       budget_max = EXCLUDED.budget_max,
       preferred_locations = EXCLUDED.preferred_locations,
       property_type = EXCLUDED.property_type,
       transaction_type = EXCLUDED.transaction_type,
       bedrooms = EXCLUDED.bedrooms,
       notes = EXCLUDED.notes
     RETURNING *`,
    [
      customerId,
      budgetMin ?? null,
      budgetMax ?? null,
      JSON.stringify(preferredLocations || []),
      propertyType || null,
      transactionType || null,
      bedrooms ?? null,
      notes || null,
    ]
  );

  return result.rows[0];
}

async function getDocuments(customerId) {
  const result = await pool.query(
    'SELECT * FROM customer_documents WHERE customer_id = $1 ORDER BY created_at DESC',
    [customerId]
  );
  return signUrls(result.rows, 'document_url');
}

// documentUrl is client-supplied (this endpoint takes a URL/path directly,
// there's no file upload step here) - it may be one of our GCS objects or a
// fully external URL. signUrls()/getReadUrl() only sign what's actually
// ours and pass anything else through untouched, so it's safe to run
// unconditionally.
async function addDocument(customerId, data, user) {
  const { documentUrl, documentType, dealId } = data;

  const result = await pool.query(
    `INSERT INTO customer_documents (customer_id, deal_id, document_url, document_type, uploaded_by, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [customerId, dealId || null, documentUrl, documentType || null, user.id]
  );

  return signUrls(result.rows[0], 'document_url');
}

// Used by GET /api/customers/:id/deals, now that the Deal Pipeline module's
// `deals` table exists (replaces the earlier empty-array placeholder). Not
// implemented via deal.service.js to avoid a circular require
// (deal.service -> lead.service -> customer.service), so the tenant-scope
// clause is duplicated inline here rather than shared.
async function getCustomerDeals(user, customerId) {
  const where = ['customer_id = $1'];
  const params = [customerId];

  if (!isAdmin(user.role)) {
    params.push(user.tenant_id || null, user.id);
    where.push(`(tenant_id = $${params.length - 1} OR broker_id = $${params.length})`);
  }

  const result = await pool.query(
    `SELECT * FROM deals WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  return result.rows;
}

async function deleteCustomer(id) {
  const result = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw notFound();
}

module.exports = {
  listCustomers,
  getCustomerById,
  getCustomerByUserId,
  createCustomer,
  findOrCreateCustomerByContact,
  updateCustomer,
  deleteCustomer,
  getPreferences,
  upsertPreferences,
  getDocuments,
  addDocument,
  getCustomerDeals,
};
