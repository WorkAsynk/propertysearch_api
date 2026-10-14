const express = require('express');
const multer = require('multer');
const { body, param, query } = require('express-validator');
const router = express.Router();

const validate = require('../middlewares/validate');
const { authenticate, authorize, optionalAuthenticate } = require('../middlewares/auth');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const auditService = require('../services/audit.service');
const fields = require('../services/dynamicFields.service');

// Section 5 - Dynamic Field Manager. Defining fields is for the Super Admin
// only; reading a form's fields is open to whoever is filling the form in.
const STAFF = ['internal_sales', 'admin', 'super_admin'];
const meta = (req) => auditService.requestMeta(req);
const ENTITY = Object.keys(fields.ENTITIES);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * @swagger
 * tags:
 *   - name: Dynamic fields
 *     description: No-code fields added to forms by the Super Admin (sec. 5)
 * /fields/form:
 *   get:
 *     summary: The admin-added fields of a form, for a place and the caller's role
 *     tags: [Dynamic fields]
 *     parameters:
 *       - { in: query, name: entityType, required: true, schema: { type: string, enum: [property, requirement, user_profile, crm_lead, institution, kyc, due_diligence, agreement, dashboard_widget] } }
 *       - { in: query, name: city, schema: { type: string }, description: Fields limited to a state or city appear only there }
 *       - { in: query, name: state, schema: { type: string }, description: State code such as DL; worked out from the city when left out }
 *       - { in: query, name: module, schema: { type: string } }
 *     responses:
 *       200: { description: "Sections, each with its fields in order" }
 */
router.get(
  '/form',
  optionalAuthenticate,
  [query('entityType').isIn(ENTITY), query('city').optional().isString().isLength({ max: 120 }), query('state').optional().isString().isLength({ max: 10 }), query('module').optional().isString().isLength({ max: 40 })],
  validate,
  asyncHandler(async (req, res) => success(res, 200, 'Form fields', await fields.form({ ...req.query, role: req.user?.role || null })))
);

router.use(authenticate);

/**
 * @swagger
 * /fields/{id}/upload:
 *   post:
 *     summary: Upload a file or image for an upload field; send what comes back as the field's value
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, properties: { file: { type: string, format: binary } } }
 *     responses:
 *       201: { description: "{ path, name, size, mime, url }" }
 */
router.post('/:id/upload', upload.single('file'), [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 201, 'Uploaded', await fields.uploadFile(req.user, req.params.id, req.file))));

/**
 * @swagger
 * /fields/values/{entityType}/{entityId}:
 *   get:
 *     summary: A record's custom field values (staff, or anyone for their own user_profile)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: entityType, required: true, schema: { type: string } }
 *       - { in: path, name: entityId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Values }
 *   put:
 *     summary: Set custom field values on a record (staff) - for KYC, due diligence, agreements and profiles
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { customFields: { type: object }, city: { type: string }, state: { type: string } } }
 *     responses:
 *       200: { description: Values }
 */
const valueParams = [param('entityType').isIn(ENTITY), param('entityId').isUUID()];
router.get('/values/:entityType/:entityId', valueParams, validate, asyncHandler(async (req, res) => success(res, 200, 'Values', await fields.getValues(req.user, req.params.entityType, req.params.entityId))));
router.put('/values/:entityType/:entityId', valueParams, validate, asyncHandler(async (req, res) => success(res, 200, 'Saved', await fields.setValues(req.user, req.params.entityType, req.params.entityId, req.body, meta(req)))));

/**
 * @swagger
 * /fields/meta:
 *   get:
 *     summary: Forms, field types, roles and rule names the manager offers (staff)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reference lists }
 * /fields:
 *   get:
 *     summary: Every field, including hidden ones, with how many records hold a value (staff)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: entityType, schema: { type: string } }
 *     responses:
 *       200: { description: Fields }
 *   post:
 *     summary: Add a field to a form (Super Admin)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, label, type]
 *             properties:
 *               entityType: { type: string }
 *               label: { type: string, example: Patta Number }
 *               name: { type: string, description: Internal key; made from the label when left out }
 *               type: { type: string, enum: [text, textarea, number, decimal, currency, dropdown, multiselect, date, datetime, checkbox, file, image, email, phone, address, geo_point, rating] }
 *               section: { type: string }
 *               module: { type: string }
 *               helpText: { type: string }
 *               placeholder: { type: string }
 *               required: { type: boolean }
 *               displayOrder: { type: integer }
 *               defaultValue: {}
 *               options: { type: array, items: { type: object, properties: { value: { type: string }, label: { type: string }, is_active: { type: boolean } } } }
 *               validation: { type: object, description: "min, max, step, precision, min_length, max_length, regex, required_if, allowed_values, max_file_size, accepted_file_types, multiple, max_files, min_items, max_items, rows" }
 *               conditionalLogic: { type: object, example: { show_if: { field: transactionType, operator: equals, value: rent } } }
 *               applicableStates: { type: array, items: { type: string }, example: [TG] }
 *               applicableCities: { type: array, items: { type: string } }
 *               applicableRoles: { type: array, items: { type: string } }
 *               visiblePublicly: { type: boolean }
 *               searchable: { type: boolean }
 *     responses:
 *       201: { description: Field }
 */
router.get('/meta', authorize(...STAFF), asyncHandler(async (req, res) => success(res, 200, 'Field manager', fields.meta())));
router.get('/', authorize(...STAFF), [query('entityType').optional().isIn(ENTITY)], validate, asyncHandler(async (req, res) => success(res, 200, 'Fields', await fields.listFields(req.query))));
router.post('/', authorize('super_admin'), [body('entityType').isIn(ENTITY), body('label').isString(), body('type').isString()], validate, asyncHandler(async (req, res) => success(res, 201, 'Field added', await fields.createField(req.user, req.body, meta(req)))));

/**
 * @swagger
 * /fields/reorder:
 *   put:
 *     summary: Set the order (and section) of fields (Super Admin)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { items: { type: array, items: { type: object, properties: { id: { type: string }, displayOrder: { type: integer }, section: { type: string } } } } } }
 *     responses:
 *       200: { description: Done }
 * /fields/{id}:
 *   put:
 *     summary: Edit a field - label, rules, options, where it applies, shown or hidden (Super Admin)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Field }
 *   delete:
 *     summary: Delete a field no record has used yet; one that holds values can only be hidden (Super Admin)
 *     tags: [Dynamic fields]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Deleted }
 */
router.put('/reorder', authorize('super_admin'), [body('items').isArray({ min: 1, max: 500 }), body('items.*.id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Order saved', await fields.reorder(req.user, req.body.items, meta(req)))));
router.put('/:id', authorize('super_admin'), [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Field saved', await fields.updateField(req.user, req.params.id, req.body, meta(req)))));
router.delete('/:id', authorize('super_admin'), [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Field deleted', await fields.deleteField(req.user, req.params.id, meta(req)))));

module.exports = router;
