const pool = require('../config/db');

function notFound(message = 'Agency not found') {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function slugify(name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return base || 'agency';
}

// A tenant row only stores name/slug/status - broker headcount and active
// listing count are aggregated live here so the frontend Agencies list can
// show them without a second round trip per row.
const TENANT_SELECT = `
  SELECT t.*,
         COALESCE(broker_counts.count, 0) AS broker_count,
         COALESCE(listing_counts.count, 0) AS active_listing_count
  FROM tenants t
  LEFT JOIN (
    SELECT u.tenant_id, COUNT(*) AS count
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'broker'
    GROUP BY u.tenant_id
  ) broker_counts ON broker_counts.tenant_id = t.id
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS count FROM properties
    WHERE status = 'approved'
    GROUP BY tenant_id
  ) listing_counts ON listing_counts.tenant_id = t.id
`;

async function listTenants() {
  const result = await pool.query(`${TENANT_SELECT} ORDER BY t.created_at DESC`);
  return result.rows;
}

async function getTenantById(id) {
  const result = await pool.query(`${TENANT_SELECT} WHERE t.id = $1`, [id]);
  const tenant = result.rows[0];
  if (!tenant) throw notFound();
  return tenant;
}

// Slugs must be unique - on a collision (e.g. two agencies both named
// "Skyline Realty") a short numeric suffix is appended until one is free.
async function createTenant({ name, slug, status }) {
  if (!name || !name.trim()) throw badRequest('Agency name is required');

  let candidate = slug ? slugify(slug) : slugify(name);
  let attempt = 0;
  while (true) {
    const existing = await pool.query('SELECT id FROM tenants WHERE slug = $1', [candidate]);
    if (existing.rows.length === 0) break;
    attempt += 1;
    candidate = `${slugify(slug || name)}-${attempt + 1}`;
  }

  const result = await pool.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING *`,
    [name.trim(), candidate, status || 'active']
  );

  return getTenantById(result.rows[0].id);
}

const UPDATABLE_FIELDS = { name: 'name', status: 'status' };

async function updateTenant(id, data) {
  const set = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      set.push(`${column} = $${params.length}`);
    }
  }

  if (set.length === 0) throw badRequest('No updatable fields provided');

  params.push(id);
  const result = await pool.query(
    `UPDATE tenants SET ${set.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (result.rows.length === 0) throw notFound();

  return getTenantById(id);
}

async function deleteTenant(id) {
  const result = await pool.query('DELETE FROM tenants WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw notFound();
}

module.exports = {
  listTenants,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
};
