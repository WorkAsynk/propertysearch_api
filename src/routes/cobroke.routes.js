const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const auditService = require('../services/audit.service');
const cobroke = require('../services/cobroke.service');

// Module 37 - Broker Network: co-broking. Mounted at /api/cobroke.

const router = express.Router();
const STAFF = ['internal_sales', 'admin', 'super_admin'];
const BROKERS = ['broker', 'agency_admin'];
const meta = (req) => auditService.requestMeta(req);
const ok = (res, message, data, code = 200) => success(res, code, message, data);
const id = [param('id').isUUID()];
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Broker Network
 *   description: >
 *     Module 37 - co-broking: find partner brokers (trust score and track record, never a phone or email), propose to work a
 *     listing or buyer requirement together with a split, accept / decline / counter, link the deal, and have the split recorded
 *     when it closes. Every offer and message is kept; contact details are blocked.
 */

/**
 * @swagger
 * /cobroke/brokers:
 *   get:
 *     summary: Partner broker directory - by city or name, with trust score, badges, live listings and closed deals
 *     tags: [Broker Network]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 *     responses: { 200: { description: Brokers } }
 */
router.get('/brokers', authorize(...BROKERS, ...STAFF), [query('city').optional().isString().isLength({ max: 100 }), query('q').optional().isString().isLength({ max: 100 })], validate, asyncHandler(async (req, res) => ok(res, 'Brokers', await cobroke.directory(req.user, req.query))));
router.get('/brokers/:id/listings', authorize(...BROKERS, ...STAFF), id, validate, asyncHandler(async (req, res) => ok(res, 'Listings', await cobroke.listingsOf(req.user, req.params.id))));

/**
 * @swagger
 * /cobroke/mine:
 *   get:
 *     summary: My co-broking proposals and agreements, with the suggested split
 *     tags: [Broker Network]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Agreements } }
 */
router.get('/mine', authorize(...BROKERS), asyncHandler(async (req, res) => ok(res, 'Co-broking', { ...(await cobroke.mine(req.user)), summary: await cobroke.summary(req.user) })));
/**
 * @swagger
 * /cobroke/all:
 *   get:
 *     summary: "[Staff] Every co-broking agreement with totals"
 *     tags: [Broker Network]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Agreements and totals } }
 */
router.get('/all', authorize(...STAFF), [query('status').optional().isIn(['proposed', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'deal_open', 'completed', 'cancelled']), query('q').optional().isString().isLength({ max: 100 })], validate, asyncHandler(async (req, res) => ok(res, 'Co-broking', await cobroke.all(req.query))));

/**
 * @swagger
 * /cobroke:
 *   post:
 *     summary: Propose to co-broke another broker's listing (propertyId) or buyer requirement (requirementId) with your share
 *     tags: [Broker Network]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               propertyId: { type: string, format: uuid }
 *               requirementId: { type: string, format: uuid }
 *               myShare: { type: number, description: Your share of the brokers' share, in percent. Defaults to the suggested split. }
 *               note: { type: string }
 *     responses: { 201: { description: Proposal } }
 */
router.post('/', authorize(...BROKERS), [body('propertyId').optional({ nullable: true }).isUUID(), body('requirementId').optional({ nullable: true }).isUUID(), body('myShare').optional({ nullable: true }).isFloat({ gt: 0, lt: 100 }), body('note').optional({ nullable: true }).isString().isLength({ max: 1000 })], validate, asyncHandler(async (req, res) => ok(res, 'Proposal sent', await cobroke.propose(req.user, req.body, meta(req)), 201)));
router.get('/:id', id, validate, asyncHandler(async (req, res) => ok(res, 'Co-broking agreement', await cobroke.get(req.user, req.params.id))));
/**
 * @swagger
 * /cobroke/{id}/respond:
 *   post:
 *     summary: Accept, decline or counter the offer on the table (only the broker who did not make it)
 *     tags: [Broker Network]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Agreement } }
 */
router.post('/:id/respond', authorize(...BROKERS), [...id, body('action').isIn(['accept', 'decline', 'counter']), body('myShare').optional({ nullable: true }).isFloat({ gt: 0, lt: 100 }), body('note').optional({ nullable: true }).isString().isLength({ max: 1000 })], validate, asyncHandler(async (req, res) => ok(res, 'Answer recorded', await cobroke.respond(req.user, req.params.id, req.body, meta(req)))));
router.post('/:id/withdraw', authorize(...BROKERS), id, validate, asyncHandler(async (req, res) => ok(res, 'Proposal withdrawn', await cobroke.withdraw(req.user, req.params.id, meta(req)))));
router.post('/:id/message', [...id, body('body').trim().isLength({ min: 2, max: 1000 })], validate, asyncHandler(async (req, res) => ok(res, 'Message added', await cobroke.message(req.user, req.params.id, req.body.body, meta(req)))));
/**
 * @swagger
 * /cobroke/{id}/link-deal:
 *   post:
 *     summary: Tie the deal the two brokers are working to the agreement (also happens by itself when the deal is opened)
 *     tags: [Broker Network]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Agreement } }
 */
router.post('/:id/link-deal', [...id, body('dealId').isUUID()], validate, asyncHandler(async (req, res) => ok(res, 'Deal linked', await cobroke.linkDeal(req.user, req.params.id, req.body.dealId, meta(req)))));
router.post('/:id/cancel', [...id, body('reason').trim().isLength({ min: 5, max: 500 })], validate, asyncHandler(async (req, res) => ok(res, 'Agreement cancelled', await cobroke.cancel(req.user, req.params.id, req.body.reason, meta(req)))));

module.exports = router;
