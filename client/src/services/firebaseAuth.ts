import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
  type UserCredential
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../config/firebase';

export interface AuthStateCallback {
  (user: FirebaseUser | null): void;
}

function ensureConfigured(): void {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase Authentication is not configured. Please add your VITE_FIREBASE_* variables to client/.env');
  }
}

export const firebaseAuthService = {
  /**
   * Google Sign-In with popup
   */
  async signInWithGoogle(): Promise<UserCredential> {
    ensureConfigured();
    return signInWithPopup(auth, googleProvider);
  },

  /**
   * Email/Password Sign-In
   */
  async signInWithEmail(email: string, password: string): Promise<UserCredential> {
    ensureConfigured();
    return signInWithEmailAndPassword(auth, email.trim(), password);
  },

  /**
   * Email/Password Registration
   */
  async registerWithEmail(email: string, password: string): Promise<UserCredential> {
    ensureConfigured();
    return createUserWithEmailAndPassword(auth, email.trim(), password);
  },

  /**
   * Send Password Reset Email
   */
  async sendPasswordReset(email: string): Promise<void> {
    ensureConfigured();
    return sendPasswordResetEmail(auth, email.trim());
  },

  /**
   * Sign Out
   */
  async signOutTeacher(): Promise<void> {
    return signOut(auth);
  },

  /**
   * Retrieve current fresh Firebase ID Token
   */
  async getFreshIdToken(forceRefresh: boolean = false): Promise<string | null> {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    return currentUser.getIdToken(forceRefresh);
  },

  /**
   * Listen to Firebase auth state transitions
   */
  subscribeToAuthChanges(callback: AuthStateCallback) {
    return onAuthStateChanged(auth, callback);
  },

  /**
   * Map Firebase error codes to user-friendly messages
   */
  formatError(err: any): string {
    const code = err?.code || '';
    switch (code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This teacher account has been disabled. Please contact your administrator.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Invalid email or password.';
      case 'auth/email-already-in-use':
        return 'An account with this email address already exists. Please sign in instead.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 8 characters with letters and numbers.';
      case 'auth/popup-closed-by-user':
        return 'Google Sign-In was cancelled.';
      case 'auth/popup-blocked':
        return 'Pop-up was blocked by your browser. Please allow pop-ups for this site.';
      case 'auth/network-request-failed':
        return 'Network connection issue. Please check your internet connection.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return err?.message || 'Authentication failed. Please try again.';
    }
  }
};
