const { Storage } = require('@google-cloud/storage');

// Uses Application Default Credentials - the Cloud Run service account in
// production, or `gcloud auth application-default login` / a key file
// pointed to by GOOGLE_APPLICATION_CREDENTIALS locally. No key file is
// bundled with the app.
const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID || undefined });

// Resolved lazily (not at require-time) so the server can still boot when
// GCS_BUCKET_NAME isn't set yet (e.g. local dev before uploads are needed) -
// storage.bucket() throws synchronously on an empty name otherwise, which
// would crash the whole app on startup rather than just the upload request.
let _bucket = null;
function getBucket() {
  if (!process.env.GCS_BUCKET_NAME) {
    const err = new Error('GCS_BUCKET_NAME is not set - required to upload/delete files in Cloud Storage');
    err.statusCode = 500;
    throw err;
  }
  if (!_bucket) {
    _bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
  }
  return _bucket;
}

module.exports = { storage, getBucket };
