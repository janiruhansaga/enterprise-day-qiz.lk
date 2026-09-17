import { IDatastore, MaybePromise } from '../db/datastore.interface.js';

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  streak: number;
}

export interface FinalPodiumResult {
  topThree: LeaderboardEntry[];
  totalParticipants: number;
}

export class LeaderboardEngine {
  private db: IDatastore;

  constructor(db: IDatastore) {
    this.db = db;
  }

  /**
   * Compute server-authoritative leaderboard for a game session.
   * PRIVACY-FIRST: Strips all internal user IDs, email addresses, and PII.
   */
  public getLeaderboard(sessionId: string, limit: number = 5): MaybePromise<LeaderboardEntry[]> {
    const res = this.db.getSessionParticipants(sessionId);
    if (res instanceof Promise) {
      return res.then(participants => this.formatLeaderboard(participants, limit));
    }
    return this.formatLeaderboard(res, limit);
  }

  private formatLeaderboard(participants: any[], limit: number): LeaderboardEntry[] {
    // Participants are already ordered by total_score DESC in the query
    return participants.slice(0, limit).map((p, index) => ({
      rank: index + 1,
      nickname: p.nickname,
      score: p.total_score,
      streak: p.streak_count
    }));
  }

  /**
   * Compute final game results with Top 3 Podium and individual participant ranks.
   */
  public getFinalPodium(sessionId: string): MaybePromise<{
    podium: FinalPodiumResult;
    participantRankMap: Map<string, { rank: number; totalScore: number; streak: number }>;
  }> {
    const res = this.db.getSessionParticipants(sessionId);
    if (res instanceof Promise) {
      return res.then(participants => this.formatFinalPodium(participants));
    }
    return this.formatFinalPodium(res);
  }

  private formatFinalPodium(participants: any[]) {
    const participantRankMap = new Map<string, { rank: number; totalScore: number; streak: number }>();

    participants.forEach((p, index) => {
      participantRankMap.set(p.id, {
        rank: index + 1,
        totalScore: p.total_score,
        streak: p.streak_count
      });
    });

    const topThree: LeaderboardEntry[] = participants.slice(0, 3).map((p, index) => ({
      rank: index + 1,
      nickname: p.nickname,
      score: p.total_score,
      streak: p.streak_count
    }));

    return {
      podium: {
        topThree,
        totalParticipants: participants.length
      },
      participantRankMap
    };
  }
}

