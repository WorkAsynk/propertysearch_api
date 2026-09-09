const express = require('express');
const { body, param, query } = require('express-validator');

const projectController = require('../controllers/project.controller');
const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');

const PROJECT_STATUSES = ['draft', 'upcoming', 'ongoing', 'completed', 'on_hold'];
const UNIT_STATUSES = ['available', 'held', 'sold'];
const CREATE_ROLES = ['builder', 'admin', 'super_admin'];

const projectRouter = express.Router();
const unitRouter = express.Router();

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: >
 *     Builder projects and their units. All endpoints require authentication;
 *     non-admin roles are scoped to their own tenant's projects.
 */

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: List projects (tenant-scoped for non-admin roles)
 *     tags: [Projects]
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
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, upcoming, ongoing, completed, on_hold] }
 *     responses:
 *       200:
 *         description: Paginated list of projects
 *       401:
 *         description: Not authenticated
 */
projectRouter.get(
  '/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(PROJECT_STATUSES),
  ],
  validate,
  projectController.listProjects
);

/**
 * @swagger
 * /projects/{id}:
 *   get:
 *     summary: Get a single project by id
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Project fetched successfully
 *       404:
 *         description: Project not found
 */
projectRouter.get(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Invalid project id')],
  validate,
  projectController.getProject
);

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create a new builder project
 *     description: Allowed roles builder, admin, super_admin. Admin/super_admin must pass builderId.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectCreateRequest'
 *     responses:
 *       201:
 *         description: Project created successfully
 *       403:
 *         description: Role not permitted to create projects
 *       422:
 *         description: Validation failed
 */
projectRouter.post(
  '/',
  authenticate,
  authorize(...CREATE_ROLES),
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('city').notEmpty().withMessage('City is required'),
    body('builderId').optional().isUUID(),
  ],
  validate,
  projectController.createProject
);

/**
 * @swagger
 * /projects/{id}:
 *   put:
 *     summary: Update a project
 *     description: Only the project's builder or admin/super_admin may update.
 *     tags: [Projects]
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
 *             $ref: '#/components/schemas/ProjectUpdateRequest'
 *     responses:
 *       200:
 *         description: Project updated successfully
 *       403:
 *         description: Not the owner/admin
 *       404:
 *         description: Project not found
 */
projectRouter.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid project id'),
    body('status').optional().isIn(PROJECT_STATUSES),
  ],
  validate,
  projectController.updateProject
);

/**
 * @swagger
 * /projects/{id}:
 *   delete:
 *     summary: Delete a project
 *     description: Only the project's builder or admin/super_admin may delete.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *       403:
 *         description: Not the owner/admin
 *       404:
 *         description: Project not found
 */
projectRouter.delete(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Invalid project id')],
  validate,
  projectController.deleteProject
);

/**
 * @swagger
 * /projects/bulk-delete:
 *   post:
 *     summary: Delete multiple projects at once
 *     description: Runs the same per-project ownership check as DELETE /projects/{id} for each id - ids that fail that check are skipped and reported back, not treated as a fatal error for the whole batch.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Returns deletedCount, deletedIds, and failed (array of {id, reason})
 */
projectRouter.post(
  '/bulk-delete',
  authenticate,
  [
    body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array'),
    body('ids.*').isUUID().withMessage('Each id must be a valid UUID'),
  ],
  validate,
  projectController.bulkDeleteProjects
);

/**
 * @swagger
 * /projects/{id}/units:
 *   get:
 *     summary: List units within a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, held, sold] }
 *     responses:
 *       200:
 *         description: Units fetched successfully
 *       404:
 *         description: Project not found
 */
projectRouter.get(
  '/:id/units',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid project id'),
    query('status').optional().isIn(UNIT_STATUSES),
  ],
  validate,
  projectController.listUnits
);

/**
 * @swagger
 * /projects/{id}/units:
 *   post:
 *     summary: Add a unit to a project
 *     description: Only the project's builder or admin/super_admin may add units.
 *     tags: [Projects]
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
 *             $ref: '#/components/schemas/UnitCreateRequest'
 *     responses:
 *       201:
 *         description: Unit created successfully
 *       403:
 *         description: Not the project owner/admin
 *       404:
 *         description: Project not found
 *       409:
 *         description: A unit with this unit number already exists in the project
 */
projectRouter.post(
  '/:id/units',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid project id'),
    body('unitNumber').notEmpty().withMessage('unitNumber is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('floor').optional().isInt(),
    body('size').optional().isFloat({ min: 0 }),
  ],
  validate,
  projectController.createUnit
);

/**
 * @swagger
 * tags:
 *   name: Units
 *   description: Individual unit management within a builder project.
 */

/**
 * @swagger
 * /units/{id}:
 *   put:
 *     summary: Update a unit
 *     description: Only the parent project's builder or admin/super_admin may update.
 *     tags: [Units]
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
 *             $ref: '#/components/schemas/UnitUpdateRequest'
 *     responses:
 *       200:
 *         description: Unit updated successfully
 *       403:
 *         description: Not the project owner/admin
 *       404:
 *         description: Unit not found
 */
unitRouter.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid unit id'),
    body('price').optional().isFloat({ min: 0 }),
    body('floor').optional().isInt(),
    body('size').optional().isFloat({ min: 0 }),
  ],
  validate,
  projectController.updateUnit
);

/**
 * @swagger
 * /units/{id}/status:
 *   put:
 *     summary: Update a unit's availability status
 *     tags: [Units]
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [available, held, sold], example: sold }
 *     responses:
 *       200:
 *         description: Unit status updated
 *       403:
 *         description: Not the project owner/admin
 *       404:
 *         description: Unit not found
 */
unitRouter.put(
  '/:id/status',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid unit id'),
    body('status').isIn(UNIT_STATUSES).withMessage('Invalid unit status'),
  ],
  validate,
  projectController.updateUnitStatus
);

/**
 * @swagger
 * /units/{id}:
 *   delete:
 *     summary: Delete a unit
 *     description: Only the parent project's builder or admin/super_admin may delete.
 *     tags: [Units]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Unit deleted successfully
 *       403:
 *         description: Not the project owner/admin
 *       404:
 *         description: Unit not found
 */
unitRouter.delete(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Invalid unit id')],
  validate,
  projectController.deleteUnit
);

/**
 * @swagger
 * /units/bulk-delete:
 *   post:
 *     summary: Delete multiple units at once
 *     description: Runs the same per-unit ownership check as DELETE /units/{id} for each id - ids that fail that check are skipped and reported back, not treated as a fatal error for the whole batch.
 *     tags: [Units]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Returns deletedCount, deletedIds, and failed (array of {id, reason})
 */
unitRouter.post(
  '/bulk-delete',
  authenticate,
  [
    body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array'),
    body('ids.*').isUUID().withMessage('Each id must be a valid UUID'),
  ],
  validate,
  projectController.bulkDeleteUnits
);

module.exports = { projectRouter, unitRouter };
