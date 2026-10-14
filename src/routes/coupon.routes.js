const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const auditService = require('../services/audit.service');
const coupons = require('../services/coupon.service');

// Engine 8 / Section 33.2 - scheme coupons (COU-...). Admins create them; anyone eligible applies one.
const ADMIN = ['admin', 'super_admin'];
const STAFF = ['internal_sales', 'admin', 'super_admin'];
const meta = (req) => auditService.requestMeta(req);
const h = asyncHandler;
const ok = (res, msg, data, code = 200) => success(res, code, msg, data);
const idp = [param('id').isUUID()];

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Coupons
 *     description: Scheme coupons COU-[CATEGORY]-[CAMPAIGN] (Engine 8, sec. 33.2). Never a commission entry.
 * /coupons/check:
 *   post:
 *     summary: Is this coupon valid for me (and this deal / campaign)? Nothing is applied.
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: COU-BU-DIW26 }
 *               service: { type: string, enum: [professional_fee, advertising, crm_workspace, manual] }
 *               entityId: { type: string, format: uuid, description: The deal (professional fee) or campaign (advertising) }
 *     responses:
 *       200: { description: "{ valid, reason, coupon }" }
 * /coupons/apply:
 *   post:
 *     summary: Apply a coupon. A professional-fee coupon is saved on the deal and comes off the next fee invoice (never below the 1% minimum).
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *               entityId: { type: string, format: uuid }
 *               userId: { type: string, format: uuid, description: Staff only - apply for this customer }
 *               note: { type: string }
 *     responses:
 *       201: { description: The coupon use }
 * /coupons/mine:
 *   get:
 *     summary: The coupons I have applied
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Coupon uses }
 * /coupons/mine/{id}/withdraw:
 *   post:
 *     summary: Withdraw a coupon that is still waiting for its invoice
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Withdrawn }
 */
router.post('/check', [body('code').isString().isLength({ min: 3, max: 20 }), body('entityId').optional({ nullable: true }).isUUID()], validate, h(async (req, res) => ok(res, 'Coupon checked', await coupons.preview(req.user, req.body))));
router.post('/apply', [body('code').isString().isLength({ min: 3, max: 20 }), body('entityId').optional({ nullable: true }).isUUID(), body('userId').optional({ nullable: true }).isUUID()], validate, h(async (req, res) => ok(res, 'Coupon applied', await coupons.apply(req.user, req.body, meta(req)), 201)));
router.get('/mine', h(async (req, res) => ok(res, 'My coupons', await coupons.mine(req.user))));
router.post('/mine/:id/withdraw', idp, validate, h(async (req, res) => ok(res, 'Coupon withdrawn', await coupons.reverse(req.user, req.params.id, null, meta(req)))));

/**
 * @swagger
 * /coupons/manage:
 *   get:
 *     summary: Every coupon with its status and use (staff)
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [live, scheduled, expired, inactive] } }
 *       - { in: query, name: service, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200: { description: Coupons }
 *   post:
 *     summary: Create a coupon (admin)
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, service, validUntil]
 *             properties:
 *               code: { type: string, example: COU-NR-UAE10 }
 *               name: { type: string }
 *               description: { type: string }
 *               service: { type: string, enum: [professional_fee, advertising, crm_workspace, manual] }
 *               benefitType: { type: string, enum: [percent, flat, days, manual] }
 *               benefitValue: { type: number }
 *               maxDiscount: { type: number }
 *               minAmount: { type: number }
 *               validFrom: { type: string, format: date-time }
 *               validUntil: { type: string, format: date-time }
 *               perUserLimit: { type: integer }
 *               totalLimit: { type: integer }
 *               stackable: { type: boolean }
 *     responses:
 *       201: { description: Coupon }
 * /coupons/manage/meta:
 *   get:
 *     summary: Categories, services and the code pattern (staff)
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reference lists }
 * /coupons/manage/{id}:
 *   put:
 *     summary: Edit a coupon (admin). The code, category and service never change; the benefit is fixed once used.
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Coupon }
 * /coupons/manage/{id}/deactivate:
 *   post:
 *     summary: Deactivate a coupon (admin). Coupons are never deleted.
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Coupon }
 * /coupons/manage/redemptions:
 *   get:
 *     summary: Coupon uses (staff), by coupon or status
 *     tags: [Coupons]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Uses }
 */
router.get('/manage/meta', authorize(...STAFF), h(async (req, res) => ok(res, 'Coupon reference', coupons.meta())));
router.get('/manage', authorize(...STAFF), [query('status').optional().isIn(['live', 'scheduled', 'expired', 'inactive'])], validate, h(async (req, res) => ok(res, 'Coupons', await coupons.list(req.query))));
router.post('/manage', authorize(...ADMIN), [body('code').isString(), body('name').isString(), body('service').isString(), body('validUntil').isISO8601()], validate, h(async (req, res) => ok(res, 'Coupon created', await coupons.create(req.user, req.body, meta(req)), 201)));
router.get('/manage/redemptions', authorize(...STAFF), [query('couponId').optional().isUUID(), query('status').optional().isIn(['reserved', 'applied', 'pending', 'fulfilled', 'reversed'])], validate, h(async (req, res) => ok(res, 'Coupon uses', await coupons.redemptions(req.query))));
router.post('/manage/redemptions/:id/fulfil', authorize(...STAFF), idp, validate, h(async (req, res) => ok(res, 'Marked delivered', await coupons.fulfil(req.user, req.params.id, req.body.note, meta(req)))));
router.post('/manage/redemptions/:id/reverse', authorize(...ADMIN), [...idp, body('reason').isString().isLength({ min: 3, max: 500 })], validate, h(async (req, res) => ok(res, 'Coupon taken back', await coupons.reverse(req.user, req.params.id, req.body.reason, meta(req)))));
router.put('/manage/:id', authorize(...ADMIN), idp, validate, h(async (req, res) => ok(res, 'Coupon saved', await coupons.update(req.user, req.params.id, req.body, meta(req)))));
router.post('/manage/:id/deactivate', authorize(...ADMIN), [...idp, body('reason').isString().isLength({ min: 3, max: 500 })], validate, h(async (req, res) => ok(res, 'Coupon deactivated', await coupons.setActive(req.user, req.params.id, false, req.body.reason, meta(req)))));
router.post('/manage/:id/reactivate', authorize(...ADMIN), idp, validate, h(async (req, res) => ok(res, 'Coupon reactivated', await coupons.setActive(req.user, req.params.id, true, null, meta(req)))));
router.post('/manage/sweep', authorize(...ADMIN), h(async (req, res) => ok(res, 'Expired coupons switched off', await coupons.sweep())));

module.exports = router;
