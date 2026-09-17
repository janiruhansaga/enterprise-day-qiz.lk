import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import type { LeaderboardEntry } from './LeaderboardView';
import { soundManager } from '../utils/soundManager';

interface PersonalResult {
  rank: number;
  totalScore: number;
  streak: number;
  totalParticipants: number;
}

interface PodiumViewProps {
  topThree: LeaderboardEntry[];
  personalResult?: PersonalResult | null;
  onHomeClick: () => void;
}

export const PodiumView: React.FC<PodiumViewProps> = ({
  topThree,
  personalResult,
  onHomeClick
}) => {
  useEffect(() => {
    soundManager.playPodiumFanfare();

    // Trigger multi-stage confetti
    const duration = 3.5 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  const first = topThree[0];
  const second = topThree[1];
  const third = topThree[2];

  return (
    <div style={{
      maxWidth: '960px',
      margin: '0 auto',
      padding: '40px 20px',
      textAlign: 'center',
      minHeight: 'calc(100vh - 140px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <h1 style={{
        fontSize: 'clamp(2.5rem, 6vw, 4rem)',
        fontWeight: 900,
        marginBottom: '8px',
        background: 'linear-gradient(135deg, #ffd700 0%, #ff0080 50%, #00dfd8 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        Victory Podium
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginBottom: '40px' }}>
        The battle is complete. Congratulations to the champions!
      </p>

      {/* 3D Podium Display */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: '16px',
        width: '100%',
        maxWidth: '680px',
        marginBottom: '48px',
        height: '360px'
      }}>
        {/* 2nd Place (Silver) */}
        {second && (
          <div className="animate-pop" style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: '#c0c0c0',
              color: '#070913',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              fontWeight: 900,
              marginBottom: '10px',
              boxShadow: '0 0 25px rgba(192, 192, 192, 0.6)'
            }}>
              🥈
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#fff', marginBottom: '4px' }}>
              {second.nickname}
            </div>
            <div style={{ color: '#c0c0c0', fontWeight: 700, fontSize: '0.9rem', marginBottom: '12px' }}>
              {second.score.toLocaleString()} pts
            </div>
            <div style={{
              width: '100%',
              height: '180px',
              background: 'linear-gradient(180deg, #718096, #2d3748)',
              borderTop: '4px solid #c0c0c0',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              fontWeight: 900,
              color: '#c0c0c0',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)'
            }}>
              2
            </div>
          </div>
        )}

        {/* 1st Place (Gold) */}
        {first && (
          <div className="animate-pop" style={{
            flex: 1.2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <div style={{
              width: '76px',
              height: '76px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #ffd700, #ffae00)',
              color: '#070913',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              fontWeight: 900,
              marginBottom: '10px',
              boxShadow: '0 0 35px rgba(255, 215, 0, 0.8)',
              animation: 'pulseGlow 2s infinite'
            }}>
              👑
            </div>
            <div style={{ fontWeight: 900, fontSize: '1.35rem', color: '#fff', marginBottom: '4px' }}>
              {first.nickname}
            </div>
            <div style={{ color: '#ffd700', fontWeight: 800, fontSize: '1.05rem', marginBottom: '12px' }}>
              {first.score.toLocaleString()} pts
            </div>
            <div style={{
              width: '100%',
              height: '240px',
              background: 'linear-gradient(180deg, #b7791f, #744210)',
              borderTop: '4px solid #ffd700',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '4rem',
              fontWeight: 900,
              color: '#ffd700',
              boxShadow: '0 10px 40px rgba(255, 215, 0, 0.25)'
            }}>
              1
            </div>
          </div>
        )}

        {/* 3rd Place (Bronze) */}
        {third && (
          <div className="animate-pop" style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: '#cd7f32',
              color: '#070913',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              fontWeight: 900,
              marginBottom: '10px',
              boxShadow: '0 0 25px rgba(205, 127, 50, 0.6)'
            }}>
              🥉
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#fff', marginBottom: '4px' }}>
              {third.nickname}
            </div>
            <div style={{ color: '#cd7f32', fontWeight: 700, fontSize: '0.9rem', marginBottom: '12px' }}>
              {third.score.toLocaleString()} pts
            </div>
            <div style={{
              width: '100%',
              height: '140px',
              background: 'linear-gradient(180deg, #9c4221, #441708)',
              borderTop: '4px solid #cd7f32',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              fontWeight: 900,
              color: '#cd7f32',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)'
            }}>
              3
            </div>
          </div>
        )}
      </div>

      {/* Private Student Summary Card */}
      {personalResult && (
        <div className="glass-panel animate-slide" style={{
          padding: '24px 36px',
          borderRadius: 'var(--radius-lg)',
          marginBottom: '36px',
          maxWidth: '520px',
          width: '100%',
          border: '1px solid var(--accent-cyan)'
        }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px', color: 'var(--accent-cyan)' }}>
            Your Official Result
          </h3>
          <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#fff', marginBottom: '6px' }}>
            Placed #{personalResult.rank} of {personalResult.totalParticipants}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
            Total Score: <strong>{personalResult.totalScore.toLocaleString()}</strong> pts
          </p>
        </div>
      )}

      {/* Home Action */}
      <button
        onClick={onHomeClick}
        style={{
          background: 'var(--accent-gradient)',
          color: '#fff',
          fontSize: '1.15rem',
          fontWeight: 800,
          padding: '16px 40px',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 0 25px rgba(0, 223, 216, 0.4)',
          cursor: 'pointer'
        }}
      >
        Play Another Game ⚡
      </button>
    </div>
  );
};
