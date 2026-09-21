import { collection, doc, onSnapshot, getFirestore, query, orderBy } from 'firebase/firestore';
import { firebaseApp } from '../config/firebase';

export interface PublicSessionState {
  sessionId: string;
  status: string;
  quizTitle?: string;
  currentQuestionIndex?: number | null;
  totalQuestions?: number;
  currentQuestionId?: string | null;
  prompt?: string | null;
  timeLimitSec?: number | null;
  basePoints?: number | null;
  serverStartTime?: number | null;
  serverDeadline?: number | null;
  roundNonce?: string | null;
  options?: Array<{ id: string; option_text: string; optionText?: string; order_index: number }>;
  answersCount?: number;
  totalParticipants?: number;
  revealedCorrectOptionId?: string | null;
  leaderboard?: Array<{ rank: number; nickname: string; score: number; streak: number }> | null;
  podium?: {
    topThree: Array<{ rank: number; nickname: string; score: number; streak: number }>;
    totalParticipants: number;
  } | null;
  updatedAt?: number;
}

export interface ParticipantRecord {
  id: string;
  nickname: string;
  total_score: number;
  streak_count: number;
}

/**
 * Subscribe to the server-published public state document.
 * Students read this unauthenticated; teachers read via their Firebase Auth role.
 */
export function subscribeToSessionState(
  sessionId: string,
  onState: (state: PublicSessionState) => void,
  onError?: (error: any) => void
): () => void {
  const db = getFirestore(firebaseApp);
  const ref = doc(db, 'game_sessions', sessionId, 'state', 'public');

  return onSnapshot(
    ref,
    { includeMetadataChanges: false },
    (snap) => {
      if (snap.exists()) {
        onState(snap.data() as PublicSessionState);
      }
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

/**
 * Subscribe to the kicked marker document for a participant.
 * When the document is created (participant kicked), call onKicked.
 */
export function subscribeToKicked(
  sessionId: string,
  participantId: string,
  onKicked: () => void
): () => void {
  const db = getFirestore(firebaseApp);
  const ref = doc(db, 'game_sessions', sessionId, 'kicked', participantId);

  return onSnapshot(
    ref,
    { includeMetadataChanges: false },
    (snap) => {
      if (snap.exists()) {
        onKicked();
      }
    },
    () => {}
  );
}

/**
 * Subscribe to the participants subcollection for the host's teacher roster.
 * Only accessible by the session host teacher via Firestore rules.
 */
export function subscribeToParticipants(
  sessionId: string,
  onParticipants: (participants: ParticipantRecord[]) => void
): () => void {
  const db = getFirestore(firebaseApp);
  const q = query(
    collection(db, 'game_sessions', sessionId, 'participants'),
    orderBy('total_score', 'desc')
  );

  return onSnapshot(
    q,
    { includeMetadataChanges: false },
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ParticipantRecord, 'id'>)
      }));
      onParticipants(list);
    },
    () => {}
  );
}
