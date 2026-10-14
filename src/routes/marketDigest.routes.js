const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const validate = require('../middlewares/validate');
const { authenticate, authorize } = require('../middlewares/auth');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const auditService = require('../services/audit.service');
const digest = require('../services/marketDigest.service');

const ADMIN = ['admin', 'super_admin'];
const meta = (req) => auditService.requestMeta(req);

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Market digest
 *     description: Daily market notification for brokers, by the localities they follow (sec. 20.4)
 * /market-digest/me:
 *   get:
 *     summary: The areas I follow, when the digest is sent, and my latest digests
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Subscription and latest digest }
 *   put:
 *     summary: Choose the areas I follow, or switch the digest off
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               areas:
 *                 type: array
 *                 maxItems: 25
 *                 items:
 *                   type: object
 *                   required: [city]
 *                   properties:
 *                     city: { type: string }
 *                     locality: { type: string, description: Leave out to follow the whole city }
 *     responses:
 *       200: { description: Saved subscription }
 */
router.get('/me', asyncHandler(async (req, res) => success(res, 200, 'Market digest', await digest.mine(req.user))));
router.put('/me', [body('enabled').optional().isBoolean(), body('areas').optional().isArray({ max: 25 })], validate, asyncHandler(async (req, res) => success(res, 200, 'Saved', await digest.updateSubscription(req.user, req.body, meta(req)))));

/**
 * @swagger
 * /market-digest/preview:
 *   get:
 *     summary: What my digest would say right now (nothing is sent)
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Preview }
 * /market-digest/areas:
 *   get:
 *     summary: Cities to choose from, or the localities of one city
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: city, schema: { type: string } }
 *     responses:
 *       200: { description: Cities or localities }
 */
router.get('/preview', asyncHandler(async (req, res) => success(res, 200, 'Preview', await digest.preview(req.user))));
router.get('/areas', [query('city').optional().isString().isLength({ max: 120 })], validate, asyncHandler(async (req, res) => success(res, 200, 'Areas', await digest.areaOptions(req.query))));

/**
 * @swagger
 * /market-digest/manage/overview:
 *   get:
 *     summary: Who receives the digest and what went out in the last 14 days (admin)
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Overview }
 * /market-digest/manage/run:
 *   post:
 *     summary: Compile and / or send today's digest now (admin). force ignores the posting windows.
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               step: { type: string, enum: [aggregate, dispatch, both] }
 *               force: { type: boolean }
 *     responses:
 *       200: { description: Result }
 */
router.get('/manage/overview', authorize(...ADMIN), asyncHandler(async (req, res) => success(res, 200, 'Market digest overview', await digest.overview())));
router.post(
  '/manage/run',
  authorize(...ADMIN),
  [body('step').optional().isIn(['aggregate', 'dispatch', 'both']), body('force').optional().isBoolean()],
  validate,
  asyncHandler(async (req, res) => {
    const opts = { force: req.body.force === true };
    const step = req.body.step || 'both';
    const result = step === 'aggregate' ? await digest.aggregate(opts) : step === 'dispatch' ? await digest.dispatch(opts) : await digest.run(opts);
    await auditService.log({ actor: req.user, action: 'market_digest.run', entityType: 'market_digest', entityId: null, after: { step, force: opts.force }, ...meta(req) });
    return success(res, 200, 'Done', result);
  })
);

/**
 * @swagger
 * /market-digest/{id}:
 *   get:
 *     summary: One of my digests in full
 *     tags: [Market digest]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Digest }
 */
router.get('/:id', [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Digest', await digest.getDigest(req.user, req.params.id))));

module.exports = router;
