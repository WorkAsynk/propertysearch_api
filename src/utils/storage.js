const path = require('path');
const { randomUUID } = require('crypto');
const { bucket } = require('../config/gcs');

const PUBLIC_URL_PREFIX = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME || ''}/`;

// Uploads a buffer to GCS under `<folder>/<uuid><ext>` and returns its public
// URL. The bucket is expected to already have bucket-level public read
// access configured (allUsers -> Storage Object Viewer) since uniform
// bucket-level access blocks per-object ACLs.
async function uploadBuffer(buffer, folder, originalName, mimetype) {
  const ext = path.extname(originalName || '');
  const objectPath = `${folder}/${randomUUID()}${ext}`;
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    resumable: false,
    contentType: mimetype,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  return `${PUBLIC_URL_PREFIX}${objectPath}`;
}

// Best-effort delete of a previously uploaded object, given its public URL.
// Silently no-ops on URLs that weren't produced by uploadBuffer (e.g. legacy
// externally-hosted URLs) and swallows "already gone" errors.
async function deleteByUrl(url) {
  if (!url || !url.startsWith(PUBLIC_URL_PREFIX)) return;

  const objectPath = url.slice(PUBLIC_URL_PREFIX.length);
  try {
    await bucket.file(objectPath).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

module.exports = { uploadBuffer, deleteByUrl };
