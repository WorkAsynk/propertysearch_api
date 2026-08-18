const tenantService = require('../services/tenant.service');
const { success } = require('../utils/response');

// GET /api/tenants
async function listTenants(req, res, next) {
  try {
    const items = await tenantService.listTenants();
    return success(res, 200, 'Agencies fetched successfully', { items });
  } catch (err) {
    next(err);
  }
}

// GET /api/tenants/:id
async function getTenant(req, res, next) {
  try {
    const tenant = await tenantService.getTenantById(req.params.id);
    return success(res, 200, 'Agency fetched successfully', tenant);
  } catch (err) {
    next(err);
  }
}

// POST /api/tenants
async function createTenant(req, res, next) {
  try {
    const tenant = await tenantService.createTenant(req.body);
    return success(res, 201, 'Agency created successfully', tenant);
  } catch (err) {
    next(err);
  }
}

// PUT /api/tenants/:id
async function updateTenant(req, res, next) {
  try {
    const tenant = await tenantService.updateTenant(req.params.id, req.body);
    return success(res, 200, 'Agency updated successfully', tenant);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/tenants/:id
async function deleteTenant(req, res, next) {
  try {
    await tenantService.deleteTenant(req.params.id);
    return success(res, 200, 'Agency deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  deleteTenant,
};
