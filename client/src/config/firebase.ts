import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const rawApiKey = import.meta.env.VITE_FIREBASE_API_KEY || '';
const rawProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';

export const isFirebaseConfigured = Boolean(
  rawApiKey &&
  rawProjectId &&
  !rawApiKey.includes('your-')
);

// Fallback dummy key to prevent getAuth(app) from crashing during module evaluation if .env is not yet set
const firebaseConfig = {
  apiKey: rawApiKey || 'AIzaSyMindPulseBattleDevKey2026Placeholder',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'mindpulse-battle.firebaseapp.com',
  projectId: rawProjectId || 'mindpulse-battle',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'mindpulse-battle.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abcdef123456'
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
  // Re-try with placeholder if user provided invalid key format
  const fallbackApp = getApps().length > 0 ? getApp() : initializeApp({
    apiKey: 'AIzaSyMindPulseBattleDevKey2026Placeholder',
    projectId: 'mindpulse-battle'
  }, 'fallback-app');
  authInstance = getAuth(fallbackApp);
}

export const auth: Auth = authInstance;
export const googleProvider: GoogleAuthProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
