const pool = require('../config/db');
const { isAdmin } = require('../utils/ownership');
const { uploadBuffer, deleteObject, signUrls } = require('../utils/storage');

function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Projects don't have a created_by column (only builder_id) - map it onto
// the shape assertOwnerOrAdmin/assertTenantVisible expect (created_by).
function withOwnerShape(project) {
  if (!project) return project;
  return { ...project, created_by: project.builder_id };
}

function applyTenantScope(user, where, params) {
  if (isAdmin(user.role)) return;
  params.push(user.tenant_id || null, user.id);
  where.push(`(p.tenant_id = $${params.length - 1} OR p.builder_id = $${params.length})`);
}

async function listProjects(user, filters, page, limit) {
  const where = [];
  const params = [];

  applyTenantScope(user, where, params);

  if (filters.city) {
    params.push(filters.city);
    where.push(`p.city ILIKE $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`p.status = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await pool.query(`SELECT COUNT(*) FROM projects p ${whereClause}`, params);

  params.push(limit, offset);
  const result = await pool.query(
    `SELECT p.* FROM projects p
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    items: result.rows.map(withOwnerShape),
    pagination: {
      page,
      limit,
      total: Number(countResult.rows[0].count),
      totalPages: Math.ceil(Number(countResult.rows[0].count) / limit),
    },
  };
}

async function getProjectById(id) {
  const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
  const project = result.rows[0];
  if (!project) throw notFound('Project not found');

  const media = await pool.query(
    'SELECT * FROM project_media WHERE project_id = $1 ORDER BY display_order ASC, created_at ASC',
    [id]
  );

  return withOwnerShape({ ...project, media: await signUrls(media.rows, 'url') });
}

async function createProject(data, user) {
  const { name, description, city, locality, address, builderId, amenities, configurations } = data;

  const resolvedBuilderId = builderId || (user.role === 'builder' ? user.id : null);
  if (!resolvedBuilderId) {
    throw badRequest('builderId is required when creating a project as admin/super_admin');
  }

  const result = await pool.query(
    `INSERT INTO projects (tenant_id, builder_id, name, description, city, locality, address, amenities, configurations, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
     RETURNING *`,
    [
      user.tenant_id || null,
      resolvedBuilderId,
      name,
      description || null,
      city,
      locality || null,
      address || null,
      JSON.stringify(amenities || []),
      JSON.stringify(configurations || []),
    ]
  );

  return withOwnerShape(result.rows[0]);
}

const UPDATABLE_PROJECT_FIELDS = {
  name: 'name',
  description: 'description',
  city: 'city',
  locality: 'locality',
  address: 'address',
  status: 'status',
};

async function updateProject(id, data) {
  const set = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_PROJECT_FIELDS)) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      set.push(`${column} = $${params.length}`);
    }
  }
  if (data.amenities !== undefined) {
    params.push(JSON.stringify(data.amenities));
    set.push(`amenities = $${params.length}`);
  }
  if (data.configurations !== undefined) {
    params.push(JSON.stringify(data.configurations));
    set.push(`configurations = $${params.length}`);
  }

  if (set.length === 0) throw badRequest('No updatable fields provided');

  params.push(id);
  const result = await pool.query(
    `UPDATE projects SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return withOwnerShape(result.rows[0]);
}

async function addMedia(projectId, mediaItems) {
  const inserted = [];
  for (const item of mediaItems) {
    const result = await pool.query(
      `INSERT INTO project_media (project_id, media_type, url, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        projectId,
        item.mediaType || 'image',
        item.url,
        item.displayOrder || 0,
        item.isPrimary || false,
      ]
    );
    inserted.push(result.rows[0]);
  }
  return signUrls(inserted, 'url');
}

// Uploads a single file straight to GCS (projects/<id>/images|videos/...)
// and records the resulting object path in project_media - mirrors
// property.service.js's uploadMedia.
async function uploadMedia(projectId, file, options = {}) {
  const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  const folder = `projects/${projectId}/${mediaType === 'video' ? 'videos' : 'images'}`;
  const objectPath = await uploadBuffer(file.buffer, folder, file.originalname, file.mimetype);

  const result = await pool.query(
    `INSERT INTO project_media (project_id, media_type, url, display_order, is_primary)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [projectId, mediaType, objectPath, options.displayOrder || 0, options.isPrimary || false]
  );
  return signUrls(result.rows[0], 'url');
}

async function deleteMedia(projectId, mediaId) {
  const result = await pool.query(
    'DELETE FROM project_media WHERE id = $1 AND project_id = $2 RETURNING id, url',
    [mediaId, projectId]
  );
  if (result.rows.length === 0) throw notFound('Media not found for this project');
  await deleteObject(result.rows[0].url);
}

// Cover photo is mutually exclusive - see property.service.js's
// setPrimaryMedia for why this runs inside a transaction.
async function setPrimaryMedia(projectId, mediaId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query(
      'SELECT id FROM project_media WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [mediaId, projectId]
    );
    if (target.rows.length === 0) throw notFound('Media not found for this project');

    await client.query('UPDATE project_media SET is_primary = false WHERE project_id = $1', [projectId]);
    const result = await client.query(
      'UPDATE project_media SET is_primary = true WHERE id = $1 RETURNING *',
      [mediaId]
    );

    await client.query('COMMIT');
    return signUrls(result.rows[0], 'url');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listUnits(projectId, filters) {
  const where = ['project_id = $1'];
  const params = [projectId];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT * FROM units WHERE ${where.join(' AND ')} ORDER BY unit_number ASC`,
    params
  );
  return result.rows;
}

async function createUnit(projectId, data) {
  const { unitNumber, floor, size, price } = data;

  const existing = await pool.query(
    'SELECT id FROM units WHERE project_id = $1 AND unit_number = $2',
    [projectId, unitNumber]
  );
  if (existing.rows.length > 0) {
    const err = new Error('A unit with this unit number already exists in this project');
    err.statusCode = 409;
    throw err;
  }

  const result = await pool.query(
    `INSERT INTO units (project_id, unit_number, floor, size, price, status)
     VALUES ($1, $2, $3, $4, $5, 'available')
     RETURNING *`,
    [projectId, unitNumber, floor || null, size || null, price]
  );

  return result.rows[0];
}

// Fetches a unit along with its parent project's ownership fields, so
// callers can run ownership/tenant checks without a second round trip.
async function getUnitWithProject(unitId) {
  const result = await pool.query(
    `SELECT u.*, p.builder_id AS project_builder_id, p.tenant_id AS project_tenant_id
     FROM units u
     JOIN projects p ON p.id = u.project_id
     WHERE u.id = $1`,
    [unitId]
  );
  const unit = result.rows[0];
  if (!unit) throw notFound('Unit not found');

  return {
    ...unit,
    created_by: unit.project_builder_id,
    tenant_id: unit.project_tenant_id,
  };
}

const UPDATABLE_UNIT_FIELDS = {
  unitNumber: 'unit_number',
  floor: 'floor',
  size: 'size',
  price: 'price',
};

async function updateUnit(id, data) {
  const set = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_UNIT_FIELDS)) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      set.push(`${column} = $${params.length}`);
    }
  }

  if (set.length === 0) throw badRequest('No updatable fields provided');

  params.push(id);
  const result = await pool.query(
    `UPDATE units SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return result.rows[0];
}

async function updateUnitStatus(id, status) {
  const result = await pool.query(
    'UPDATE units SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  return result.rows[0];
}

async function deleteProject(id) {
  const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw notFound('Project not found');
}

async function deleteUnit(id) {
  const result = await pool.query('DELETE FROM units WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw notFound('Unit not found');
}

module.exports = {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  addMedia,
  uploadMedia,
  deleteMedia,
  setPrimaryMedia,
  listUnits,
  createUnit,
  getUnitWithProject,
  updateUnit,
  updateUnitStatus,
  deleteUnit,
};
