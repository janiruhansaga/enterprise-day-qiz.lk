import { App, getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import fs from 'node:fs';

let firebaseApp: App | null = null;

export interface FirebaseConfigOptions {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
}

/**
 * Initialize Firebase Admin SDK using environment variables or service account file.
 * NEVER hardcodes credentials.
 */
export function getFirebaseAdminApp(): App {
  if (firebaseApp) {
    return firebaseApp;
  }

  // Check if Firebase app is already initialized in this process
  const apps = getApps();
  if (apps.length > 0 && apps[0]) {
    firebaseApp = apps[0];
    return firebaseApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    // Option A: Service account file (e.g. injected into container secrets)
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || projectId
    });
  } else if (projectId && clientEmail && privateKey) {
    // Option B: Direct environment variable injection (Cloud Run friendly)
    // Normalize newlines in private key string
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    firebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      }),
      projectId
    });
  } else if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Option C: Firebase Local Emulator Suite
    firebaseApp = initializeApp({
      projectId: projectId || 'mindpulse-arena-emulator'
    });
  } else {
    // Default application credentials (e.g. Google Cloud Run IAM metadata server)
    firebaseApp = initializeApp({
      projectId
    });
  }

  return firebaseApp;
}

/**
 * Get Firestore database instance from Firebase Admin SDK
 */
export function getFirestoreDb(): Firestore {
  const app = getFirebaseAdminApp();
  const db = getFirestore(app);
  
  // Ignore undefined properties to avoid Firestore write errors
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

let customAuthInstance: Auth | null = null;

/**
 * Set a custom Auth instance for unit testing / mocking
 */
export function setCustomFirebaseAuth(auth: Auth | null): void {
  customAuthInstance = auth;
}

/**
 * Get Firebase Auth instance from Firebase Admin SDK
 */
export function getFirebaseAuth(): Auth {
  if (customAuthInstance) {
    return customAuthInstance;
  }
  const app = getFirebaseAdminApp();
  return getAuth(app);
}

/**
 * Check whether Firebase Admin configuration is present
 */
export function isFirebaseAdminAvailable(): boolean {
  if (customAuthInstance) return true;
  return !!(
    (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIRESTORE_EMULATOR_HOST
  );
}

