const projectService = require('../services/project.service');
const { success, error } = require('../utils/response');
const { assertOwnerOrAdmin, assertTenantVisible } = require('../utils/ownership');
const { bulkDelete } = require('../utils/bulkDelete');

// GET /api/projects
async function listProjects(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const filters = { city: req.query.city, status: req.query.status };

    const { items, pagination } = await projectService.listProjects(req.user, filters, page, limit);
    return success(res, 200, 'Projects fetched successfully', { items, pagination });
  } catch (err) {
    next(err);
  }
}

// GET /api/projects/:id
async function getProject(req, res, next) {
  try {
    const project = await projectService.getProjectById(req.params.id);
    assertTenantVisible(req.user, project, 'Project not found');
    return success(res, 200, 'Project fetched successfully', project);
  } catch (err) {
    next(err);
  }
}

// POST /api/projects
async function createProject(req, res, next) {
  try {
    const project = await projectService.createProject(req.body, req.user);
    return success(res, 201, 'Project created successfully', project);
  } catch (err) {
    next(err);
  }
}

// PUT /api/projects/:id
async function updateProject(req, res, next) {
  try {
    const existing = await projectService.getProjectById(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    const project = await projectService.updateProject(req.params.id, req.body);
    return success(res, 200, 'Project updated successfully', project);
  } catch (err) {
    next(err);
  }
}

async function deleteOneProject(id, actingUser) {
  const existing = await projectService.getProjectById(id);
  assertOwnerOrAdmin(actingUser, existing);
  await projectService.deleteProject(id);
}

// DELETE /api/projects/:id
async function deleteProject(req, res, next) {
  try {
    await deleteOneProject(req.params.id, req.user);
    return success(res, 200, 'Project deleted successfully');
  } catch (err) {
    next(err);
  }
}

// POST /api/projects/bulk-delete
async function bulkDeleteProjects(req, res, next) {
  try {
    const result = await bulkDelete(req.body.ids, (id) => deleteOneProject(id, req.user));
    return success(res, 200, `${result.deletedCount} project(s) deleted`, result);
  } catch (err) {
    next(err);
  }
}

// POST /api/projects/:id/media
async function addMedia(req, res, next) {
  try {
    const existing = await projectService.getProjectById(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    const media = await projectService.addMedia(req.params.id, req.body.media);
    return success(res, 201, 'Media attached successfully', media);
  } catch (err) {
    next(err);
  }
}

// POST /api/projects/:id/media/upload
async function uploadMedia(req, res, next) {
  try {
    if (!req.file) return error(res, 400, 'A file is required (field name: file)');

    const existing = await projectService.getProjectById(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    const media = await projectService.uploadMedia(req.params.id, req.file, {
      isPrimary: req.body.isPrimary === 'true' || req.body.isPrimary === true,
      displayOrder: Number(req.body.displayOrder) || 0,
    });
    return success(res, 201, 'Media uploaded successfully', media);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/projects/:id/media/:mediaId
async function deleteMedia(req, res, next) {
  try {
    const existing = await projectService.getProjectById(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    await projectService.deleteMedia(req.params.id, req.params.mediaId);
    return success(res, 200, 'Media removed successfully');
  } catch (err) {
    next(err);
  }
}

// PUT /api/projects/:id/media/:mediaId/primary
async function setPrimaryMedia(req, res, next) {
  try {
    const existing = await projectService.getProjectById(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    const media = await projectService.setPrimaryMedia(req.params.id, req.params.mediaId);
    return success(res, 200, 'Cover photo updated successfully', media);
  } catch (err) {
    next(err);
  }
}

// GET /api/projects/:id/units
async function listUnits(req, res, next) {
  try {
    const project = await projectService.getProjectById(req.params.id);
    assertTenantVisible(req.user, project, 'Project not found');

    const units = await projectService.listUnits(req.params.id, { status: req.query.status });
    return success(res, 200, 'Units fetched successfully', units);
  } catch (err) {
    next(err);
  }
}

// POST /api/projects/:id/units
async function createUnit(req, res, next) {
  try {
    const project = await projectService.getProjectById(req.params.id);
    assertOwnerOrAdmin(req.user, project);

    const unit = await projectService.createUnit(req.params.id, req.body);
    return success(res, 201, 'Unit created successfully', unit);
  } catch (err) {
    next(err);
  }
}

// PUT /api/units/:id
async function updateUnit(req, res, next) {
  try {
    const existing = await projectService.getUnitWithProject(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    const unit = await projectService.updateUnit(req.params.id, req.body);
    return success(res, 200, 'Unit updated successfully', unit);
  } catch (err) {
    next(err);
  }
}

// PUT /api/units/:id/status
async function updateUnitStatus(req, res, next) {
  try {
    const existing = await projectService.getUnitWithProject(req.params.id);
    assertOwnerOrAdmin(req.user, existing);

    const unit = await projectService.updateUnitStatus(req.params.id, req.body.status);
    return success(res, 200, 'Unit status updated successfully', unit);
  } catch (err) {
    next(err);
  }
}

async function deleteOneUnit(id, actingUser) {
  const existing = await projectService.getUnitWithProject(id);
  assertOwnerOrAdmin(actingUser, existing);
  await projectService.deleteUnit(id);
}

// DELETE /api/units/:id
async function deleteUnit(req, res, next) {
  try {
    await deleteOneUnit(req.params.id, req.user);
    return success(res, 200, 'Unit deleted successfully');
  } catch (err) {
    next(err);
  }
}

// POST /api/units/bulk-delete
async function bulkDeleteUnits(req, res, next) {
  try {
    const result = await bulkDelete(req.body.ids, (id) => deleteOneUnit(id, req.user));
    return success(res, 200, `${result.deletedCount} unit(s) deleted`, result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  bulkDeleteProjects,
  addMedia,
  uploadMedia,
  deleteMedia,
  setPrimaryMedia,
  listUnits,
  createUnit,
  updateUnit,
  updateUnitStatus,
  deleteUnit,
  bulkDeleteUnits,
};
