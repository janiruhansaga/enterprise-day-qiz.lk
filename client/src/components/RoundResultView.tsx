import React, { useEffect } from 'react';
import { soundManager } from '../utils/soundManager';

interface StudentResult {
  correct: boolean;
  pointsAwarded: number;
  totalScore: number;
  streak: number;
}

interface RoundResultViewProps {
  correctOptionId: string;
  options: { id: string; optionText: string }[];
  isTeacher: boolean;
  studentResult?: StudentResult | null;
  onShowLeaderboard?: () => void;
}

export const RoundResultView: React.FC<RoundResultViewProps> = ({
  correctOptionId,
  options,
  isTeacher,
  studentResult,
  onShowLeaderboard
}) => {
  const correctOption = options.find((o) => o.id === correctOptionId);

  useEffect(() => {
    if (!isTeacher && studentResult) {
      if (studentResult.correct) {
        soundManager.playCorrectChime();
      } else {
        soundManager.playWrongBuzzer();
      }
    }
  }, [isTeacher, studentResult]);

  return (
    <div style={{
      maxWidth: '860px',
      margin: '0 auto',
      padding: '36px 20px',
      textAlign: 'center',
      minHeight: 'calc(100vh - 140px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      {/* Student Feedback Header */}
      {!isTeacher && studentResult && (
        <div className="animate-pop" style={{
          padding: '32px',
          borderRadius: 'var(--radius-lg)',
          background: studentResult.correct
            ? 'rgba(0, 214, 143, 0.15)'
            : 'rgba(255, 51, 102, 0.15)',
          border: `2px solid ${studentResult.correct ? 'var(--choice-green)' : 'var(--choice-red)'}`,
          boxShadow: studentResult.correct
            ? '0 0 40px rgba(0, 214, 143, 0.3)'
            : '0 0 40px rgba(255, 51, 102, 0.3)',
          marginBottom: '32px'
        }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '8px' }}>
            {studentResult.correct ? '🎉' : '💭'}
          </div>
          <h2 style={{
            fontSize: '2.5rem',
            color: studentResult.correct ? 'var(--choice-green)' : 'var(--choice-red)',
            marginBottom: '12px'
          }}>
            {studentResult.correct ? 'Correct Answer!' : 'Not Quite!'}
          </h2>

          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '24px',
            fontSize: '1.2rem',
            fontWeight: 700
          }}>
            <div style={{
              background: 'rgba(255, 255, 255, 0.08)',
              padding: '10px 22px',
              borderRadius: 'var(--radius-md)'
            }}>
              +{studentResult.pointsAwarded} pts
            </div>
            <div style={{
              background: 'rgba(255, 255, 255, 0.08)',
              padding: '10px 22px',
              borderRadius: 'var(--radius-md)'
            }}>
              Total: {studentResult.totalScore}
            </div>
            {studentResult.streak > 1 && (
              <div style={{
                background: 'rgba(255, 184, 0, 0.2)',
                color: 'var(--choice-yellow)',
                padding: '10px 22px',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                🔥 {studentResult.streak} Streak!
              </div>
            )}
          </div>
        </div>
      )}

      {/* Correct Answer Reveal Card */}
      <div className="glass-panel animate-slide" style={{
        padding: '36px',
        marginBottom: '36px'
      }}>
        <p style={{
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          marginBottom: '10px'
        }}>
          Authoritative Answer Reveal
        </p>

        <div style={{
          fontSize: '1.6rem',
          fontWeight: 800,
          color: 'var(--choice-green)',
          background: 'rgba(0, 214, 143, 0.1)',
          border: '1px solid rgba(0, 214, 143, 0.3)',
          padding: '18px 24px',
          borderRadius: 'var(--radius-md)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span>✓</span>
          <span>{correctOption?.optionText || (correctOption as any)?.option_text || 'Correct Option'}</span>
        </div>
      </div>

      {/* Teacher Next Step Action */}
      {isTeacher ? (
        <button
          onClick={onShowLeaderboard}
          style={{
            background: 'var(--accent-gradient)',
            color: '#fff',
            fontSize: '1.25rem',
            fontWeight: 800,
            padding: '18px 48px',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 0 35px rgba(121, 40, 202, 0.6)',
            alignSelf: 'center',
            cursor: 'pointer'
          }}
        >
          View Live Leaderboard →
        </button>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Waiting for teacher to show leaderboard...
        </p>
      )}
    </div>
  );
};
