import { IDatastore } from './datastore.interface.js';
import { DatabaseService, defaultDatabase } from './database.js';
import { FirestoreDatastore } from './firestoreDatastore.js';

/**
 * Creates and returns the active datastore based on DATASTORE_TYPE environment variable.
 * Default: SQLite (for local development and offline automated testing).
 * Production: Firestore (for cloud-scale managed persistent storage).
 */
export function createDatastore(type?: string): IDatastore {
  const datastoreType = (type || process.env.DATASTORE_TYPE || 'sqlite').toLowerCase();

  if (datastoreType === 'firestore') {
    return new FirestoreDatastore();
  }

  return defaultDatabase;
}
