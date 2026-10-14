const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const auditService = require('../services/audit.service');
const onboarding = require('../services/onboarding.service');

// Module 34 - Onboarding Assist (brokers, agencies, builders). Mounted at /api/onboarding.

const router = express.Router();
const STAFF = ['internal_sales', 'admin', 'super_admin'];
const ADMIN = ['admin', 'super_admin'];
const PARTNERS = ['broker', 'agency_admin', 'builder'];
const meta = (req) => auditService.requestMeta(req);
const ok = (res, message, data, code = 200) => success(res, code, message, data);
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Onboarding Assist
 *   description: >
 *     Module 34 - broker / agency / builder onboarding: details (areas served, firm, RERA, preferences), a checklist read from
 *     live activity, the next best action, a named A R Buildwel assistant, automatic nudges, and partner enquiries turned into accounts.
 */

/**
 * @swagger
 * /onboarding/me:
 *   get:
 *     summary: My onboarding - details, checklist, progress, next action and my A R Buildwel assistant
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Onboarding } }
 *   put:
 *     summary: Save my details - firm, areas served (mandatory for a broker), cities, RERA number, preferences
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Onboarding } }
 */
router.get('/me', authorize(...PARTNERS), asyncHandler(async (req, res) => ok(res, 'Onboarding', await onboarding.view(req.user.id))));
const detailRules = [body('firmName').optional({ nullable: true }).isString().isLength({ max: 200 }), body('reraNumber').optional({ nullable: true }).isString().isLength({ max: 60 }), body('cities').optional().isArray({ max: 20 }), body('areas').optional().isArray({ max: 60 }), body('preferences').optional().isObject()];
router.put('/me', authorize(...PARTNERS), detailRules, validate, asyncHandler(async (req, res) => ok(res, 'Details saved', await onboarding.saveDetails(req.user, req.user.id, req.body, meta(req)))));
/**
 * @swagger
 * /onboarding/me/help:
 *   post:
 *     summary: Ask my A R Buildwel assistant for help with onboarding
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Onboarding } }
 */
router.post('/me/help', authorize(...PARTNERS), [body('message').trim().isLength({ min: 5, max: 1000 })], validate, asyncHandler(async (req, res) => ok(res, 'Help requested', await onboarding.requestHelp(req.user, req.body.message, meta(req)))));

/**
 * @swagger
 * /onboarding/partners:
 *   get:
 *     summary: "[Staff] Onboarding desk - every broker and builder with progress, what they are stuck on, assistant and help requests"
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: state, schema: { type: string, enum: [not_started, in_progress, stalled, completed, needs_help] } }
 *       - { in: query, name: role, schema: { type: string, enum: [broker, agency_admin, builder] } }
 *       - { in: query, name: q, schema: { type: string } }
 *     responses: { 200: { description: Partners and totals } }
 */
router.get('/partners', authorize(...STAFF), [query('state').optional().isIn(['not_started', 'in_progress', 'stalled', 'completed', 'needs_help']), query('role').optional().isIn(PARTNERS), query('assistedBy').optional().isUUID(), query('q').optional().isString().isLength({ max: 100 })], validate, asyncHandler(async (req, res) => ok(res, 'Partners', await onboarding.listPartners(req.query))));
/**
 * @swagger
 * /onboarding/leads:
 *   get:
 *     summary: "[Staff] Join as Broker / Builder enquiries not yet turned into an account"
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Enquiries } }
 */
router.get('/leads', authorize(...STAFF), asyncHandler(async (req, res) => ok(res, 'Partner enquiries', await onboarding.pendingLeads())));
/**
 * @swagger
 * /onboarding/leads/{id}/convert:
 *   post:
 *     summary: "[Admin] Turn a partner enquiry into a broker / agency / builder account, pre-filled, with an assistant"
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 201: { description: Partner onboarding } }
 */
router.post('/leads/:id/convert', authorize(...ADMIN), [param('id').isUUID(), body('email').optional({ nullable: true }).isEmail(), body('password').isLength({ min: 8 }), body('role').optional().isIn(['broker', 'agency_admin'])], validate, asyncHandler(async (req, res) => ok(res, 'Account created', await onboarding.convertLead(req.user, req.params.id, req.body, meta(req)), 201)));
/**
 * @swagger
 * /onboarding/jobs/sweep:
 *   post:
 *     summary: "[Admin] Run the stall check now - nudges, then asks the assistant to step in"
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Result } }
 */
router.post('/jobs/sweep', authorize(...ADMIN), asyncHandler(async (req, res) => ok(res, 'Stall check run', await onboarding.sweep())));

const uid = [param('userId').isUUID()];
router.get('/partners/:userId', authorize(...STAFF), uid, validate, asyncHandler(async (req, res) => ok(res, 'Partner onboarding', await onboarding.getPartner(req.params.userId))));
/**
 * @swagger
 * /onboarding/partners/{userId}/details:
 *   put:
 *     summary: "[Staff] Fill in a partner's details on their behalf (recorded on their notes)"
 *     tags: [Onboarding Assist]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Partner onboarding } }
 */
router.put('/partners/:userId/details', authorize(...STAFF), [...uid, ...detailRules], validate, asyncHandler(async (req, res) => { await onboarding.saveDetails(req.user, req.params.userId, req.body, meta(req)); return ok(res, 'Details saved', await onboarding.getPartner(req.params.userId)); }));
router.put('/partners/:userId/assistant', authorize(...ADMIN), [...uid, body('staffId').optional({ nullable: true }).isUUID()], validate, asyncHandler(async (req, res) => ok(res, 'Assistant saved', await onboarding.assign(req.user, req.params.userId, req.body.staffId || null, meta(req)))));
router.post('/partners/:userId/notes', authorize(...STAFF), [...uid, body('kind').optional().isIn(['note', 'call', 'visit']), body('body').trim().isLength({ min: 3, max: 2000 })], validate, asyncHandler(async (req, res) => ok(res, 'Note added', await onboarding.addNote(req.user, req.params.userId, req.body, meta(req)))));
router.post('/partners/:userId/nudge', authorize(...STAFF), uid, validate, asyncHandler(async (req, res) => ok(res, 'Reminder sent', await onboarding.nudge(req.user, req.params.userId, meta(req)))));

module.exports = router;
