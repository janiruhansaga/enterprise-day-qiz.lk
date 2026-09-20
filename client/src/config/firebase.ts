import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const rawApiKey = import.meta.env.VITE_FIREBASE_API_KEY || '';
const rawProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';

export const isFirebaseConfigured = Boolean(
  rawApiKey &&
  rawProjectId &&
  !rawApiKey.includes('your-')
);

// Authoritative client Firebase configuration
export const firebaseConfig = {
  apiKey: rawApiKey || 'AIzaSyCkCMxnW3BPuydMIDKowwbdgGDNb85iOKU',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'quiz26-4187e.firebaseapp.com',
  projectId: rawProjectId || 'quiz26-4187e',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'quiz26-4187e.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '235295790447',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:235295790447:web:74015048da4b3c76c1449a',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-MWP8Q4LQMM'
};

export function getClientFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(firebaseConfig);
}

export const firebaseApp: FirebaseApp = getClientFirebaseApp();

let authInstance: Auth;
try {
  authInstance = getAuth(firebaseApp);
} catch (err) {
  console.warn('[Firebase] Auth initialization warning:', err);
  const fallbackApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig, 'fallback-app');
  authInstance = getAuth(fallbackApp);
}

export const auth: Auth = authInstance;
export const googleProvider: GoogleAuthProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Safe Analytics initialization
let analyticsInstance: Analytics | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analyticsInstance = getAnalytics(firebaseApp);
    }
  }).catch(() => {
    // Analytics is not supported in non-browser environments or if blocked by client
  });
}

export { analyticsInstance as analytics };
