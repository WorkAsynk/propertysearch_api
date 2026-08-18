const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const tenantController = require('../controllers/tenant.controller');
const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');

const MANAGE_ROLES = ['admin', 'super_admin'];
const STATUSES = ['active', 'inactive'];

/**
 * @swagger
 * tags:
 *   name: Agencies
 *   description: >
 *     Agency (tenant) management - onboarding new agencies and toggling
 *     their status. Every other module scopes its own data to a tenant_id
 *     that must point at a row created here. Restricted to admin/super_admin.
 */

/**
 * @swagger
 * /tenants:
 *   get:
 *     summary: List agencies, with live broker and active-listing counts
 *     tags: [Agencies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of agencies
 *       403:
 *         description: Not an admin/super_admin
 */
router.get('/', authenticate, authorize(...MANAGE_ROLES), tenantController.listTenants);

/**
 * @swagger
 * /tenants/{id}:
 *   get:
 *     summary: Get a single agency by id
 *     tags: [Agencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agency fetched successfully
 *       404:
 *         description: Agency not found
 */
router.get(
  '/:id',
  authenticate,
  authorize(...MANAGE_ROLES),
  [param('id').isUUID().withMessage('Invalid agency id')],
  validate,
  tenantController.getTenant
);

/**
 * @swagger
 * /tenants:
 *   post:
 *     summary: Onboard a new agency
 *     description: >
 *       Creates a tenant row. `slug` is derived from `name` when omitted, and
 *       a numeric suffix is appended automatically if it collides with an
 *       existing agency's slug. Agency admin/broker accounts are created
 *       separately (POST /users or /auth/register) with this agency's id as
 *       `tenantId`.
 *     tags: [Agencies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TenantCreateRequest'
 *     responses:
 *       201:
 *         description: Agency created successfully
 *       403:
 *         description: Not an admin/super_admin
 *       422:
 *         description: Validation failed
 */
router.post(
  '/',
  authenticate,
  authorize(...MANAGE_ROLES),
  [
    body('name').notEmpty().withMessage('Agency name is required'),
    body('slug').optional().isString(),
    body('status').optional().isIn(STATUSES),
  ],
  validate,
  tenantController.createTenant
);

/**
 * @swagger
 * /tenants/{id}:
 *   put:
 *     summary: Update an agency's name or status
 *     tags: [Agencies]
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
 *             $ref: '#/components/schemas/TenantUpdateRequest'
 *     responses:
 *       200:
 *         description: Agency updated successfully
 *       403:
 *         description: Not an admin/super_admin
 *       404:
 *         description: Agency not found
 */
router.put(
  '/:id',
  authenticate,
  authorize(...MANAGE_ROLES),
  [
    param('id').isUUID().withMessage('Invalid agency id'),
    body('name').optional().notEmpty(),
    body('status').optional().isIn(STATUSES),
  ],
  validate,
  tenantController.updateTenant
);

/**
 * @swagger
 * /tenants/{id}:
 *   delete:
 *     summary: Delete an agency
 *     description: Users/properties/deals referencing this tenant have tenant_id set to NULL rather than being deleted (ON DELETE SET NULL).
 *     tags: [Agencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agency deleted successfully
 *       403:
 *         description: Not an admin/super_admin
 *       404:
 *         description: Agency not found
 */
router.delete(
  '/:id',
  authenticate,
  authorize(...MANAGE_ROLES),
  [param('id').isUUID().withMessage('Invalid agency id')],
  validate,
  tenantController.deleteTenant
);

module.exports = router;
