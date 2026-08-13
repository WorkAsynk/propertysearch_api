const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const userController = require('../controllers/user.controller');
const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');

const ALL_ROLES = ['customer', 'broker', 'agency_admin', 'builder', 'internal_sales', 'admin', 'super_admin'];
const USER_STATUSES = ['active', 'pending_approval', 'inactive', 'suspended'];
const MANAGE_ROLES = ['agency_admin', 'admin', 'super_admin'];

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: >
 *     Admin user management (list, view, edit, delete, change role, reset
 *     password). Reachable by agency_admin (own tenant only), admin, and
 *     super_admin. For self-service profile edits, see `PUT /auth/me`.
 */

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List users (tenant-scoped for agency_admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [customer, broker, agency_admin, builder, internal_sales, admin, super_admin] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, pending_approval, inactive, suspended] }
 *       - in: query
 *         name: tenantId
 *         schema: { type: string, format: uuid }
 *         description: admin/super_admin only - filter to a specific tenant
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches against full_name, email, or mobile
 *     responses:
 *       200:
 *         description: Paginated list of users
 *       403:
 *         description: Not an agency_admin/admin/super_admin
 */
router.get(
  '/',
  authenticate,
  authorize(...MANAGE_ROLES),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('role').optional().isIn(ALL_ROLES),
    query('status').optional().isIn(USER_STATUSES),
  ],
  validate,
  userController.listUsers
);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get a single user by id
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User fetched successfully
 *       403:
 *         description: Not permitted (agency_admin targeting a user outside their tenant)
 *       404:
 *         description: User not found
 */
router.get(
  '/:id',
  authenticate,
  authorize(...MANAGE_ROLES),
  [param('id').isUUID().withMessage('Invalid user id')],
  validate,
  userController.getUser
);

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Edit a user's details
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string, example: Rahul Sharma }
 *               email: { type: string, example: rahul@example.com }
 *               mobile: { type: string, example: "9876543210" }
 *               status: { type: string, enum: [active, pending_approval, inactive, suspended] }
 *               tenantId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200:
 *         description: User updated successfully
 *       403:
 *         description: Not permitted
 *       404:
 *         description: User not found
 */
router.put(
  '/:id',
  authenticate,
  authorize(...MANAGE_ROLES),
  [
    param('id').isUUID().withMessage('Invalid user id'),
    body('email').optional().isEmail().withMessage('Valid email required'),
    body('mobile').optional().isMobilePhone().withMessage('Valid mobile number required'),
    body('status').optional().isIn(USER_STATUSES),
  ],
  validate,
  userController.updateUser
);

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       400:
 *         description: Cannot delete your own account, or other records still reference this user
 *       403:
 *         description: Not permitted
 *       404:
 *         description: User not found
 */
router.delete(
  '/:id',
  authenticate,
  authorize(...MANAGE_ROLES),
  [param('id').isUUID().withMessage('Invalid user id')],
  validate,
  userController.deleteUser
);

/**
 * @swagger
 * /users/{id}/role:
 *   put:
 *     summary: Change a user's role
 *     description: >
 *       super_admin may assign any role. admin may assign
 *       customer/broker/agency_admin/builder/internal_sales only (not
 *       admin/super_admin). agency_admin cannot change roles.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [customer, broker, agency_admin, builder, internal_sales, admin, super_admin] }
 *     responses:
 *       200:
 *         description: User role updated successfully
 *       403:
 *         description: Not permitted to assign this role
 *       404:
 *         description: User not found
 */
router.put(
  '/:id/role',
  authenticate,
  authorize('admin', 'super_admin'),
  [
    param('id').isUUID().withMessage('Invalid user id'),
    body('role').isIn(ALL_ROLES).withMessage(`Role must be one of: ${ALL_ROLES.join(', ')}`),
  ],
  validate,
  userController.changeRole
);

/**
 * @swagger
 * /users/{id}/password:
 *   put:
 *     summary: Admin-reset a user's password (no current password required)
 *     description: >
 *       Sets a new password directly and revokes all of the user's existing
 *       refresh tokens, logging them out everywhere.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, example: NewPassw0rd!123 }
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       403:
 *         description: Not permitted
 *       404:
 *         description: User not found
 */
router.put(
  '/:id/password',
  authenticate,
  authorize(...MANAGE_ROLES),
  [
    param('id').isUUID().withMessage('Invalid user id'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  userController.setPassword
);

module.exports = router;
