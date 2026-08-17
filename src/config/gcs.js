const { Storage } = require('@google-cloud/storage');

// Uses Application Default Credentials - the Cloud Run service account in
// production, or `gcloud auth application-default login` / a key file
// pointed to by GOOGLE_APPLICATION_CREDENTIALS locally. No key file is
// bundled with the app.
//
// V4 signed URLs (see utils/storage.js's generateSignedReadUrl) require ONE
// extra IAM permission beyond normal bucket access: ADC on Cloud Run/GCE has
// no local private key to sign with, so the client library signs via the
// IAM Credentials API's signBlob method instead, which means the runtime
// service account must be allowed to sign blobs AS ITSELF -
// "roles/iam.serviceAccountTokenCreator" granted to the same service account
// it's already running as. Without that role, getSignedUrl() fails with
// "IAM signBlob permission denied" / "you need iam.serviceAccounts.signBlob
// permission". This is an IAM policy grant, not something configurable from
// application code.
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
