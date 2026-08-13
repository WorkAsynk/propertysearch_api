const path = require('path');
const { randomUUID } = require('crypto');
const { getBucket } = require('../config/gcs');

function publicUrlPrefix() {
  return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/`;
}

// Uploads a buffer to GCS under `<folder>/<uuid><ext>` and returns its public
// URL. The bucket is expected to already have bucket-level public read
// access configured (allUsers -> Storage Object Viewer) since uniform
// bucket-level access blocks per-object ACLs.
async function uploadBuffer(buffer, folder, originalName, mimetype) {
  const ext = path.extname(originalName || '');
  const objectPath = `${folder}/${randomUUID()}${ext}`;
  const file = getBucket().file(objectPath);

  await file.save(buffer, {
    resumable: false,
    contentType: mimetype,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  return `${publicUrlPrefix()}${objectPath}`;
}

// Best-effort delete of a previously uploaded object, given its public URL.
// Silently no-ops on URLs that weren't produced by uploadBuffer (e.g. legacy
// externally-hosted URLs) and swallows "already gone" errors.
async function deleteByUrl(url) {
  const prefix = publicUrlPrefix();
  if (!url || !url.startsWith(prefix)) return;

  const objectPath = url.slice(prefix.length);
  try {
    await getBucket().file(objectPath).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

module.exports = { uploadBuffer, deleteByUrl };
