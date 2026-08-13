const { Storage } = require('@google-cloud/storage');

// Uses Application Default Credentials - the Cloud Run service account in
// production, or `gcloud auth application-default login` / a key file
// pointed to by GOOGLE_APPLICATION_CREDENTIALS locally. No key file is
// bundled with the app.
const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID || undefined });

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || '');

module.exports = { storage, bucket };
