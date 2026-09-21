import React, { useState, useEffect, useRef } from 'react';
import { soundManager } from '../utils/soundManager';

export interface QuestionPayload {
  questionId: string;
  questionIndex: number;
  totalQuestions: number;
  prompt: string;
  durationSec: number;
  serverStartTime: number;
  roundNonce: string;
  options: { id: string; optionText: string }[];
}

interface ActiveQuestionViewProps {
  question: QuestionPayload;
  isTeacher: boolean;
  totalAnswers: number;
  totalParticipants: number;
  onSubmitAnswer?: (selectedOptionId: string) => void;
  onTimeExpired?: () => void;
}

export const ActiveQuestionView: React.FC<ActiveQuestionViewProps> = ({
  question,
  isTeacher,
  totalAnswers,
  totalParticipants,
  onSubmitAnswer,
  onTimeExpired
}) => {
  const duration = question.durationSec || (question as any).timeLimitSec || 20;
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(duration);
  const expiredRef = useRef<boolean>(false);

  // Synchronized countdown timer based on serverStartTime
  useEffect(() => {
    setSelectedOptionId(null);
    expiredRef.current = false;

    const updateTimer = () => {
      const elapsedSec = (Date.now() - question.serverStartTime) / 1000;
      const remaining = Math.max(0, Math.ceil(duration - elapsedSec));
      setTimeLeft((prev: number) => {
        if (remaining !== prev && remaining <= 5 && remaining > 0) {
          soundManager.playTick();
        }
        return remaining;
      });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 200);
    return () => clearInterval(interval);
  }, [question.questionId, question.serverStartTime, duration]);

  // Teacher-driven round close: when the countdown ends, ask the server to close the round
  useEffect(() => {
    if (isTeacher && onTimeExpired && timeLeft <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      onTimeExpired();
    }
  }, [timeLeft, isTeacher, onTimeExpired]);

  const handleSelectOption = (optId: string) => {
    if (isTeacher || selectedOptionId || timeLeft <= 0) return;
    soundManager.playAnswerClick();
    setSelectedOptionId(optId);
    if (onSubmitAnswer) {
      onSubmitAnswer(optId);
    }
  };

  const choiceStyles = [
    { bg: 'var(--choice-red)', glow: 'var(--choice-red-glow)', shape: '▲' },
    { bg: 'var(--choice-blue)', glow: 'var(--choice-blue-glow)', shape: '◆' },
    { bg: 'var(--choice-yellow)', glow: 'var(--choice-yellow-glow)', shape: '●' },
    { bg: 'var(--choice-green)', glow: 'var(--choice-green-glow)', shape: '■' }
  ];

  const timeRatio = duration > 0 ? Math.max(0, Math.min(1, timeLeft / duration)) : 0;

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '24px 16px',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 'calc(100vh - 120px)'
    }}>
      {/* Top Bar: Question Index & Countdown & Counter */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px'
      }}>
        {/* Question Counter */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid var(--border-glass)',
          padding: '8px 18px',
          borderRadius: 'var(--radius-full)',
          fontSize: '0.95rem',
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ color: 'var(--accent-cyan)' }}>♔</span> Question {question.questionIndex + 1} of {question.totalQuestions}
        </div>

        {/* Circular Countdown Clock */}
        <div style={{
          width: '76px',
          height: '76px',
          borderRadius: '50%',
          background: 'rgba(15, 20, 38, 0.9)',
          border: `4px solid ${timeLeft <= 5 ? 'var(--choice-red)' : 'var(--accent-cyan)'}`,
          boxShadow: `0 0 20px ${timeLeft <= 5 ? 'var(--choice-red-glow)' : 'rgba(0, 223, 216, 0.4)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2rem',
          fontWeight: 900,
          fontFamily: 'var(--font-mono)',
          color: timeLeft <= 5 ? 'var(--choice-red)' : '#fff',
          transition: 'all 0.2s ease'
        }}>
          {timeLeft}
        </div>

        {/* Real-time Submissions Counter */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid var(--border-glass)',
          padding: '8px 18px',
          borderRadius: 'var(--radius-full)',
          fontSize: '0.95rem',
          fontWeight: 700,
          color: 'var(--accent-cyan)'
        }}>
          Answers: {totalAnswers} / {totalParticipants}
        </div>
      </div>

      {/* Animated Horizontal Progress Bar */}
      <div style={{
        width: '100%',
        height: '6px',
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: '4px',
        marginBottom: '24px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${timeRatio * 100}%`,
          height: '100%',
          background: timeLeft <= 5
            ? 'var(--choice-red)'
            : 'linear-gradient(90deg, #7928ca, #00dfd8)',
          transition: 'width 0.2s linear'
        }} />
      </div>

      {/* Big Question Prompt */}
      <div className="glass-panel animate-pop" style={{
        padding: '36px 28px',
        textAlign: 'center',
        marginBottom: '28px',
        background: 'rgba(15, 20, 42, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.12)'
      }}>
        <h2 style={{
          fontSize: 'clamp(1.4rem, 4vw, 2.4rem)',
          fontWeight: 800,
          lineHeight: 1.3,
          color: '#ffffff'
        }}>
          {question.prompt}
        </h2>
      </div>

      {/* Answer Buttons Grid (2x2) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '18px',
        flex: 1
      }}>
        {question.options.map((opt, idx) => {
          const style = choiceStyles[idx % choiceStyles.length];
          const isSelected = selectedOptionId === opt.id;
          const isDimmed = selectedOptionId !== null && !isSelected;

          return (
            <button
              key={opt.id}
              onClick={() => handleSelectOption(opt.id)}
              disabled={isTeacher || selectedOptionId !== null || timeLeft <= 0}
              className="animate-pop"
              style={{
                position: 'relative',
                background: style.bg,
                color: '#ffffff',
                borderRadius: 'var(--radius-lg)',
                padding: '24px 20px',
                minHeight: '140px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                boxShadow: isSelected
                  ? `0 0 40px ${style.glow}, inset 0 0 20px rgba(255, 255, 255, 0.5)`
                  : `0 8px 24px ${style.glow}`,
                transform: isSelected ? 'scale(1.02)' : isDimmed ? 'scale(0.96)' : 'scale(1)',
                opacity: isDimmed ? 0.35 : 1,
                cursor: (isTeacher || selectedOptionId !== null || timeLeft <= 0) ? 'default' : 'pointer',
                textAlign: 'left',
                border: isSelected ? '3px solid #ffffff' : 'none',
                transition: 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
              }}
            >
              {/* Shape Icon */}
              <div style={{
                fontSize: '2.5rem',
                fontWeight: 900,
                lineHeight: 1,
                textShadow: '0 2px 10px rgba(0, 0, 0, 0.3)'
              }}>
                {style.shape}
              </div>

              {/* Option Text */}
              <div style={{
                fontSize: 'clamp(1.1rem, 2.5vw, 1.4rem)',
                fontWeight: 700,
                lineHeight: 1.25,
                textShadow: '0 1px 4px rgba(0, 0, 0, 0.4)',
                flex: 1
              }}>
                {opt.optionText || (opt as any).option_text}
              </div>

              {/* Locked In Ribbon */}
              {isSelected && (
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '16px',
                  background: '#ffffff',
                  color: '#070913',
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)'
                }}>
                  LOCKED IN ✓
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Student Feedback Footer */}
      {!isTeacher && selectedOptionId && (
        <div className="animate-slide" style={{
          marginTop: '20px',
          textAlign: 'center',
          padding: '14px',
          background: 'rgba(0, 214, 143, 0.15)',
          border: '1px solid rgba(0, 214, 143, 0.4)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--choice-green)',
          fontWeight: 700,
          fontSize: '1.05rem'
        }}>
          ⚡ Answer received & timestamped on authoritative server! Waiting for round to conclude...
        </div>
      )}
    </div>
  );
};
