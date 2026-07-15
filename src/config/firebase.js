const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

/**
 * Firebase Admin SDK initialization.
 *
 * Credential precedence (production-grade):
 *   1. Individual env vars (FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL)
 *      — preferred in production; the private key may contain escaped "\n" which we decode.
 *   2. A JSON service-account file at FIREBASE_SERVICE_ACCOUNT_PATH (default: ./firebase-service-account.json)
 *      — convenient for local dev.
 *   3. GOOGLE_APPLICATION_CREDENTIALS (default application credentials) — Cloud Run / GCP.
 *   4. FIREBASE_CONFIG (stringified JSON) — some PaaS providers.
 *
 * If none are available the SDK is left uninitialised and `isFirebaseEnabled`
 * is false, so the app degrades gracefully (push just no-ops).
 */

const APP_NAME = 'rentease-firebase';

let firebaseApp = null;
let initialised = false;

function decodePrivateKey(key) {
  if (!key) return key;
  // Env values often store the key with literal "\n"; restore real newlines.
  return key.replace(/\\n/g, '\n');
}

function buildCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = decodePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (projectId && privateKey && clientEmail) {
    return {
      credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
      source: 'env',
    };
  }

  // 2. JSON file
  const saPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, 'firebase-service-account.json');

  if (fs.existsSync(saPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      return {
        credential: admin.credential.cert(serviceAccount),
        source: `file:${path.basename(saPath)}`,
      };
    } catch (err) {
      logger.warn('⚠️ Firebase service-account file could not be parsed:', err.message);
    }
  }

  // 3 / 4. ADC or FIREBASE_CONFIG
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG) {
    try {
      return { credential: admin.applicationDefault(), source: 'applicationDefault' };
    } catch (err) {
      logger.warn('⚠️ Firebase application default credentials unavailable:', err.message);
    }
  }

  return null;
}

function init() {
  if (initialised) return;
  initialised = true;

  // Guard against "app already exists" when modules are re-evaluated (dev hot reload).
  const existing = admin.apps.find((a) => a.name === APP_NAME);
  if (existing) {
    firebaseApp = existing;
    logger.info('✅ Firebase already initialised');
    return;
  }

  const built = buildCredential();
  if (!built) {
    logger.warn(
      '⚠️ Firebase not configured. Set FIREBASE_* env vars or provide a service-account JSON. Push notifications will be disabled.'
    );
    return;
  }

  const options = { credential: built.credential };
  if (process.env.FIREBASE_DATABASE_URL) options.databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (process.env.FIREBASE_STORAGE_BUCKET) options.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  try {
    firebaseApp = admin.initializeApp(options, APP_NAME);
    logger.info(`✅ Firebase initialised successfully (source: ${built.source})`);
  } catch (error) {
    logger.error('❌ Failed to initialise Firebase:', error.message);
    firebaseApp = null;
  }
}

init();

/**
 * Lazily return a Messaging instance, or null if Firebase is disabled.
 * Always resolves through the named app to avoid cross-app contamination.
 */
const getMessaging = () => {
  if (!firebaseApp) return null;
  try {
    return admin.messaging(firebaseApp);
  } catch (error) {
    logger.error('❌ Failed to get Firebase Messaging instance:', error.message);
    return null;
  }
};

const isFirebaseEnabled = () => Boolean(firebaseApp);

module.exports = {
  firebaseApp,
  getMessaging,
  isFirebaseEnabled,
  admin,
  APP_NAME,
};
