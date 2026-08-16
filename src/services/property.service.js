const pool = require('../config/db');
const { isAdmin } = require('../utils/ownership');
const { uploadBuffer, deleteByUrl } = require('../utils/storage');

function notFound(message = 'Property not found') {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Every human-readable field a property row needs for display - the
// properties table itself only stores FK ids. Shared by listProperties/
// getPropertyById so the shape returned to the frontend is identical
// everywhere.
const PROPERTY_SELECT = `
  SELECT p.*,
         creator.full_name AS created_by_name,
         broker.full_name AS broker_name,
         builder.full_name AS builder_name
  FROM properties p
  LEFT JOIN users creator ON creator.id = p.created_by
  LEFT JOIN users broker ON broker.id = p.broker_id
  LEFT JOIN users builder ON builder.id = p.builder_id
`;

// Restricts a listing query to the caller's own tenant/records unless
// they are admin/super_admin, per the module's tenant-isolation rule.
function applyTenantScope(user, where, params) {
  if (isAdmin(user.role)) return;
  params.push(user.tenant_id || null, user.id);
  where.push(`(p.tenant_id = $${params.length - 1} OR p.created_by = $${params.length})`);
}

async function listProperties(user, filters, page, limit) {
  const where = [];
  const params = [];

  applyTenantScope(user, where, params);

  if (filters.city) {
    params.push(filters.city);
    where.push(`p.city ILIKE $${params.length}`);
  }
  if (filters.propertyType) {
    params.push(filters.propertyType);
    where.push(`p.property_type = $${params.length}`);
  }
  if (filters.transactionType) {
    params.push(filters.transactionType);
    where.push(`p.transaction_type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`p.status = $${params.length}`);
  }
  if (filters.minPrice) {
    params.push(filters.minPrice);
    where.push(`p.price >= $${params.length}`);
  }
  if (filters.maxPrice) {
    params.push(filters.maxPrice);
    where.push(`p.price <= $${params.length}`);
  }
  // Used by the Broker CRM dashboard (GET /api/broker/inventory) to scope
  // to "properties created by or assigned (as broker) to this user" - kept
  // here rather than duplicated in broker.service.js since this service
  // owns all properties-table querying.
  if (filters.brokerId) {
    params.push(filters.brokerId);
    where.push(`(p.created_by = $${params.length} OR p.broker_id = $${params.length})`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM properties p ${whereClause}`,
    params
  );

  params.push(limit, offset);
  const result = await pool.query(
    `${PROPERTY_SELECT}
     ${whereClause}
     ORDER BY p.created_at DESC
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

async function getPropertyById(id) {
  const result = await pool.query(`${PROPERTY_SELECT} WHERE p.id = $1`, [id]);
  const property = result.rows[0];
  if (!property) throw notFound();

  const media = await pool.query(
    'SELECT * FROM property_media WHERE property_id = $1 ORDER BY display_order ASC, created_at ASC',
    [id]
  );

  return { ...property, media: media.rows };
}

async function createProperty(data, user) {
  const {
    title,
    description,
    propertyType,
    transactionType,
    price,
    city,
    locality,
    address,
    latitude,
    longitude,
    areaSqft,
    bedrooms,
    bathrooms,
    amenities,
    brokerId,
    builderId,
  } = data;

  const result = await pool.query(
    `INSERT INTO properties (
       tenant_id, created_by, broker_id, builder_id, title, description,
       property_type, transaction_type, price, city, locality, address,
       latitude, longitude, area_sqft, bedrooms, bathrooms, amenities, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pending_approval'
     ) RETURNING *`,
    [
      user.tenant_id || null,
      user.id,
      brokerId || (user.role === 'broker' ? user.id : null),
      builderId || (user.role === 'builder' ? user.id : null),
      title,
      description || null,
      propertyType,
      transactionType,
      price,
      city,
      locality || null,
      address || null,
      latitude || null,
      longitude || null,
      areaSqft || null,
      bedrooms || null,
      bathrooms || null,
      JSON.stringify(amenities || []),
    ]
  );

  return getPropertyById(result.rows[0].id);
}

const UPDATABLE_FIELDS = {
  title: 'title',
  description: 'description',
  propertyType: 'property_type',
  transactionType: 'transaction_type',
  city: 'city',
  locality: 'locality',
  address: 'address',
  latitude: 'latitude',
  longitude: 'longitude',
  areaSqft: 'area_sqft',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
};

async function updateProperty(id, data) {
  const set = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (data[key] !== undefined) {
      params.push(data[key]);
      set.push(`${column} = $${params.length}`);
    }
  }
  if (data.amenities !== undefined) {
    params.push(JSON.stringify(data.amenities));
    set.push(`amenities = $${params.length}`);
  }

  if (set.length === 0) throw badRequest('No updatable fields provided');

  params.push(id);
  await pool.query(
    `UPDATE properties SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return getPropertyById(id);
}

async function deleteProperty(id) {
  await pool.query('DELETE FROM properties WHERE id = $1', [id]);
}

async function addMedia(propertyId, mediaItems) {
  const inserted = [];
  for (const item of mediaItems) {
    const result = await pool.query(
      `INSERT INTO property_media (property_id, media_type, url, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        propertyId,
        item.mediaType || 'image',
        item.url,
        item.displayOrder || 0,
        item.isPrimary || false,
      ]
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

// Uploads a single file straight to GCS (properties/<id>/images|videos/...)
// and records the resulting public URL in property_media.
async function uploadMedia(propertyId, file, options = {}) {
  const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  const folder = `properties/${propertyId}/${mediaType === 'video' ? 'videos' : 'images'}`;
  const url = await uploadBuffer(file.buffer, folder, file.originalname, file.mimetype);

  const result = await pool.query(
    `INSERT INTO property_media (property_id, media_type, url, display_order, is_primary)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [propertyId, mediaType, url, options.displayOrder || 0, options.isPrimary || false]
  );
  return result.rows[0];
}

async function deleteMedia(propertyId, mediaId) {
  const result = await pool.query(
    'DELETE FROM property_media WHERE id = $1 AND property_id = $2 RETURNING id, url',
    [mediaId, propertyId]
  );
  if (result.rows.length === 0) throw notFound('Media not found for this property');
  await deleteByUrl(result.rows[0].url);
}

async function updateAvailability(id, property, isAvailable) {
  if (!['approved', 'inactive'].includes(property.status)) {
    throw badRequest(
      'Availability can only be toggled for a property that has already been approved'
    );
  }

  const newStatus = isAvailable ? 'approved' : 'inactive';
  await pool.query('UPDATE properties SET status = $1 WHERE id = $2 RETURNING *', [newStatus, id]);
  return getPropertyById(id);
}

async function updatePricing(id, price) {
  await pool.query('UPDATE properties SET price = $1 WHERE id = $2 RETURNING *', [price, id]);
  return getPropertyById(id);
}

async function approveProperty(id, adminUser) {
  const result = await pool.query(
    `UPDATE properties
     SET status = 'approved', approved_by = $1, approved_at = now(), rejection_reason = NULL
     WHERE id = $2 RETURNING id`,
    [adminUser.id, id]
  );
  if (result.rows.length === 0) throw notFound();
  return getPropertyById(id);
}

async function rejectProperty(id, reason, adminUser) {
  const result = await pool.query(
    `UPDATE properties
     SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = now()
     WHERE id = $3 RETURNING id`,
    [reason, adminUser.id, id]
  );
  if (result.rows.length === 0) throw notFound();
  return getPropertyById(id);
}

module.exports = {
  listProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  addMedia,
  uploadMedia,
  deleteMedia,
  updateAvailability,
  updatePricing,
  approveProperty,
  rejectProperty,
};
