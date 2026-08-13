const userService = require('../services/user.service');
const { success } = require('../utils/response');

// GET /api/users
async function listUsers(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const filters = {
      role: req.query.role,
      status: req.query.status,
      tenantId: req.query.tenantId,
      search: req.query.search,
    };

    const { items, pagination } = await userService.listUsers(req.user, filters, page, limit);
    return success(res, 200, 'Users fetched successfully', { items, pagination });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/:id
async function getUser(req, res, next) {
  try {
    const user = await userService.getUserById(req.user, req.params.id);
    return success(res, 200, 'User fetched successfully', user);
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/:id
async function updateUser(req, res, next) {
  try {
    const { fullName, email, mobile, status, tenantId } = req.body;
    const user = await userService.updateUser(req.user, req.params.id, { fullName, email, mobile, status, tenantId });
    return success(res, 200, 'User updated successfully', user);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/users/:id
async function deleteUser(req, res, next) {
  try {
    await userService.deleteUser(req.user, req.params.id);
    return success(res, 200, 'User deleted successfully');
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/:id/role
async function changeRole(req, res, next) {
  try {
    const user = await userService.changeRole(req.user, req.params.id, req.body.role);
    return success(res, 200, 'User role updated successfully', user);
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/:id/password
async function setPassword(req, res, next) {
  try {
    await userService.adminSetPassword(req.user, req.params.id, req.body.newPassword);
    return success(res, 200, "User's password changed successfully. All their sessions have been logged out.");
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/me (self-service profile edit)
async function updateOwnProfile(req, res, next) {
  try {
    const { fullName, email, mobile } = req.body;
    const user = await userService.updateOwnProfile(req.user.id, { fullName, email, mobile });
    return success(res, 200, 'Profile updated successfully', user);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  changeRole,
  setPassword,
  updateOwnProfile,
};
