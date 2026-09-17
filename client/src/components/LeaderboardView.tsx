import React from 'react';

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  streak: number;
}

interface LeaderboardViewProps {
  leaderboard: LeaderboardEntry[];
  isTeacher: boolean;
  onNextQuestion?: () => void;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  leaderboard,
  isTeacher,
  onNextQuestion
}) => {
  const maxScore = Math.max(1, ...(leaderboard.map(e => e.score)));

  return (
    <div style={{
      maxWidth: '840px',
      margin: '0 auto',
      padding: '36px 20px',
      minHeight: 'calc(100vh - 140px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h2 style={{
          fontSize: '2.8rem',
          fontWeight: 900,
          background: 'linear-gradient(135deg, #ffffff 30%, #00dfd8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '6px'
        }}>
          Scoreboard
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Real-time server-authoritative standings
        </p>
      </div>

      {/* Leaderboard Bars List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '40px' }}>
        {leaderboard.map((entry, idx) => {
          const widthPercent = Math.max(15, Math.round((entry.score / maxScore) * 100));
          const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#00dfd8', '#7928ca'];
          const rankColor = rankColors[idx] || '#ffffff';

          return (
            <div
              key={entry.nickname}
              className="animate-slide"
              style={{
                background: 'rgba(15, 20, 42, 0.7)',
                border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-card)'
              }}
            >
              {/* Score Bar Background Fill */}
              <div style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: `${widthPercent}%`,
                background: `linear-gradient(90deg, ${rankColor}22, ${rankColor}44)`,
                borderRight: `2px solid ${rankColor}`,
                transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                pointerEvents: 'none'
              }} />

              {/* Content row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'relative',
                zIndex: 2
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    background: rankColor,
                    color: '#070913',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 900,
                    fontSize: '1.1rem',
                    boxShadow: `0 0 15px ${rankColor}66`
                  }}>
                    {entry.rank}
                  </div>

                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>
                    {entry.nickname}
                  </span>

                  {entry.streak > 1 && (
                    <span style={{
                      background: 'rgba(255, 184, 0, 0.2)',
                      color: 'var(--choice-yellow)',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '0.78rem',
                      fontWeight: 700
                    }}>
                      🔥 {entry.streak}
                    </span>
                  )}
                </div>

                <div style={{
                  fontSize: '1.4rem',
                  fontWeight: 900,
                  fontFamily: 'var(--font-mono)',
                  color: rankColor
                }}>
                  {entry.score.toLocaleString()} pts
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Teacher Action */}
      {isTeacher ? (
        <button
          onClick={onNextQuestion}
          style={{
            background: 'var(--accent-gradient)',
            color: '#fff',
            fontSize: '1.25rem',
            fontWeight: 800,
            padding: '16px 48px',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 0 30px rgba(0, 223, 216, 0.5)',
            alignSelf: 'center',
            cursor: 'pointer'
          }}
        >
          Next Round →
        </button>
      ) : (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Waiting for the next round to begin...
        </p>
      )}
    </div>
  );
};
