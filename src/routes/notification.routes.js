const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const notificationController = require('../controllers/notification.controller');
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const push = require('../services/push.service');
const intel = require('../services/notificationIntel.service');
const auditService = require('../services/audit.service');
const { authorize } = require('../middlewares/auth');

const ADMIN = ['admin', 'super_admin'];
const meta = (req) => auditService.requestMeta(req);

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: The logged-in user's notification inbox.
 */

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Unread notification count for the header bell
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ count }" }
 */
router.get('/unread-count', authenticate, notificationController.getUnreadCount);

/**
 * @swagger
 * /notifications/push:
 *   get:
 *     summary: Web push status for the caller - whether push is configured, the VAPID public key, how many browsers are subscribed
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ configured, publicKey, subscriptions }" } }
 *   post:
 *     summary: Subscribe this browser to push (PushSubscription.toJSON() from the service worker)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint, keys]
 *             properties:
 *               endpoint: { type: string }
 *               keys: { type: object, properties: { p256dh: { type: string }, auth: { type: string } } }
 *               app: { type: string, enum: [website, crm] }
 *     responses: { 201: { description: Subscribed } }
 *   delete:
 *     summary: Unsubscribe this browser
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Removed } }
 */
/**
 * @swagger
 * /notifications/preferences:
 *   get:
 *     summary: The caller's notification preferences - push on / off, topics, quiet hours and time zone
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Preferences } }
 *   put:
 *     summary: Update notification preferences (the in-app inbox always receives everything)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pushEnabled: { type: boolean }
 *               pushMuted: { type: array, items: { type: string, enum: [matches, enquiries, deals, rentals, account, updates] } }
 *               quietStart: { type: string, example: "22:00", nullable: true }
 *               quietEnd: { type: string, example: "07:00", nullable: true }
 *               timezone: { type: string, example: "Asia/Kolkata" }
 *     responses: { 200: { description: Saved } }
 */
router.get('/preferences', authenticate, asyncHandler(async (req, res) => success(res, 200, 'Notification preferences', await intel.getPreferences(req.user.id))));
router.put('/preferences', authenticate, asyncHandler(async (req, res) => success(res, 200, 'Preferences saved', await intel.updatePreferences(req.user.id, req.body || {}))));

router.get('/push', authenticate, asyncHandler(async (req, res) => success(res, 200, 'Push status', await push.status(req.user))));
router.post(
  '/push',
  authenticate,
  [body('endpoint').isString().isLength({ min: 10, max: 2000 }), body('keys.p256dh').isString(), body('keys.auth').isString(), body('app').optional().isIn(['website', 'crm'])],
  validate,
  asyncHandler(async (req, res) => success(res, 201, 'Push enabled on this device', await push.subscribe(req.user, req.body, req.headers['user-agent'])))
);
router.delete('/push', authenticate, [body('endpoint').isString()], validate, asyncHandler(async (req, res) => success(res, 200, 'Push disabled on this device', await push.unsubscribe(req.user, req.body))));

/**
 * @swagger
 * /notifications/push/test:
 *   post:
 *     summary: Send a test push to the caller's subscribed browsers
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ sent, removed }" } }
 */
router.post('/push/test', authenticate, asyncHandler(async (req, res) => success(res, 200, 'Test push sent', await push.sendToUser(req.user.id, { title: 'PropertySerch', body: 'Push notifications are working on this device.', tag: 'test' }))));

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List the current user's notifications
 *     tags: [Notifications]
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
 *         name: isRead
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Paginated list of notifications
 *       401:
 *         description: Not authenticated
 */
/**
 * @swagger
 * /notifications/summary:
 *   get:
 *     summary: Unread counts per category and the number of persistent alerts
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Summary }
 */
router.get('/summary', authenticate, asyncHandler(async (req, res) => success(res, 200, 'Notification summary', await intel.summary(req.user.id))));

/**
 * @swagger
 * /notifications/alerts:
 *   get:
 *     summary: Persistent alerts (mandate one day from expiry, overdue invoice) that stay until their cause is settled
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Alerts }
 */
router.get('/alerts', authenticate, asyncHandler(async (req, res) => success(res, 200, 'Persistent alerts', await intel.alerts(req.user.id))));

// ---- Notification Intelligence: admin (Module 43)

/**
 * @swagger
 * /notifications/manage/overview:
 *   get:
 *     summary: Delivery, batching and digest figures, with the current settings (admin)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: days, schema: { type: integer, default: 7 } }
 *     responses:
 *       200: { description: Overview }
 */
router.get('/manage/overview', authenticate, authorize(...ADMIN), asyncHandler(async (req, res) => success(res, 200, 'Notification intelligence', await intel.overview(req.query))));

/**
 * @swagger
 * /notifications/manage/deliveries:
 *   get:
 *     summary: Delivery log; status=dead lists the dead letters (admin)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [queued, held, sent, failed, dead, skipped] } }
 *       - { in: query, name: channel, schema: { type: string, enum: [push, whatsapp, email, sms] } }
 *     responses:
 *       200: { description: Deliveries }
 */
router.get(
  '/manage/deliveries',
  authenticate,
  authorize(...ADMIN),
  [query('status').optional().isIn(['queued', 'held', 'sent', 'failed', 'dead', 'skipped']), query('channel').optional().isIn(Object.keys(intel.CHANNELS))],
  validate,
  asyncHandler(async (req, res) => success(res, 200, 'Deliveries', await intel.listDeliveries(req.query)))
);

/**
 * @swagger
 * /notifications/manage/deliveries/{id}/retry:
 *   post:
 *     summary: Send a dead-lettered delivery again (admin)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Delivery after the new attempt }
 */
router.post('/manage/deliveries/:id/retry', authenticate, authorize(...ADMIN), [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Delivery retried', await intel.retryDelivery(req.user, req.params.id, meta(req)))));

/**
 * @swagger
 * /notifications/manage/run:
 *   post:
 *     summary: Run the delivery queue or the digests now (admin). Digests ignore the posting window when forced.
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               job: { type: string, enum: [queue, digest, alerts] }
 *               force: { type: boolean }
 *     responses:
 *       200: { description: Result of the run }
 */
router.post(
  '/manage/run',
  authenticate,
  authorize(...ADMIN),
  [body('job').isIn(['queue', 'digest', 'alerts'])],
  validate,
  asyncHandler(async (req, res) => {
    const job = req.body.job;
    const result = job === 'queue' ? await intel.processQueue() : job === 'digest' ? await intel.runDigests({ force: req.body.force === true }) : await intel.resolvePersistent();
    await auditService.log({ actor: req.user, action: 'notification.job_run', entityType: 'notification_job', entityId: null, after: { job, force: req.body.force === true }, ...meta(req) });
    return success(res, 200, 'Done', result);
  })
);

/**
 * @swagger
 * /notifications/manage/windows:
 *   get:
 *     summary: Posting windows - when digests and scheduled content go out (admin)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Posting windows }
 *   post:
 *     summary: Add a posting window (admin)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contentType, timeStart, timeEnd]
 *             properties:
 *               contentType: { type: string, example: notification_digest }
 *               city: { type: string, nullable: true }
 *               dayOfWeek: { type: integer, nullable: true, description: 0 Sunday to 6 Saturday; empty for every day }
 *               timeStart: { type: string, example: "09:30" }
 *               timeEnd: { type: string, example: "10:30" }
 *               priority: { type: integer }
 *               notes: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       201: { description: Posting window }
 */
router.get('/manage/windows', authenticate, authorize(...ADMIN), asyncHandler(async (req, res) => success(res, 200, 'Posting windows', await intel.listWindows())));
router.post('/manage/windows', authenticate, authorize(...ADMIN), asyncHandler(async (req, res) => success(res, 201, 'Posting window added', await intel.saveWindow(req.user, null, req.body || {}, meta(req)))));
router.put('/manage/windows/:id', authenticate, authorize(...ADMIN), [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Posting window saved', await intel.saveWindow(req.user, req.params.id, req.body || {}, meta(req)))));
router.delete('/manage/windows/:id', authenticate, authorize(...ADMIN), [param('id').isUUID()], validate, asyncHandler(async (req, res) => success(res, 200, 'Posting window removed', await intel.deleteWindow(req.user, req.params.id, meta(req)))));

router.get(
  '/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('isRead').optional().isBoolean(),
    query('category').optional().isIn(Object.keys(intel.CATEGORIES)),
    query('priority').optional().isIn(intel.PRIORITIES),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  validate,
  notificationController.listNotifications
);

/**
 * @swagger
 * /notifications/{id}/read:
 *   put:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found (or does not belong to the caller)
 */
router.put(
  '/:id/read',
  authenticate,
  [param('id').isUUID().withMessage('Invalid notification id')],
  validate,
  notificationController.markRead
);

/**
 * @swagger
 * /notifications/read-all:
 *   put:
 *     summary: Mark all of the current user's notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.put('/read-all', authenticate, notificationController.markAllRead);
// The name the Notification Centre specification uses.
router.put('/mark-all-read', authenticate, notificationController.markAllRead);

module.exports = router;
