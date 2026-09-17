import React, { useState } from 'react';
import { soundManager } from '../utils/soundManager';

interface LandingScreenProps {
  onJoinGame: (pin: string, nickname: string) => Promise<void>;
  onOpenTeacherPortal: () => void;
  isLoading: boolean;
  errorMessage: string | null;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({
  onJoinGame,
  onOpenTeacherPortal,
  isLoading,
  errorMessage
}) => {
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [step, setStep] = useState<'PIN' | 'NICKNAME'>('PIN');
  const [localError, setLocalError] = useState<string | null>(null);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const cleanedPin = pin.trim().replace(/\D/g, '');
    if (cleanedPin.length !== 6) {
      setLocalError('Please enter a valid 6-digit game PIN');
      soundManager.playWrongBuzzer();
      return;
    }
    soundManager.playTick();
    setStep('NICKNAME');
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const cleanedNick = nickname.trim();
    if (!cleanedNick) {
      setLocalError('Please choose a classroom nickname');
      soundManager.playWrongBuzzer();
      return;
    }
    if (cleanedNick.length < 2 || cleanedNick.length > 20) {
      setLocalError('Nickname must be between 2 and 20 characters');
      soundManager.playWrongBuzzer();
      return;
    }

    soundManager.playTick();
    try {
      await onJoinGame(pin.trim(), cleanedNick);
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setLocalError(err.message || 'Failed to join game');
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 120px)',
      padding: '24px 16px'
    }}>
      {/* Hero Badge */}
      <div className="floating-badge" style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 18px',
        borderRadius: 'var(--radius-full)',
        background: 'rgba(121, 40, 202, 0.2)',
        border: '1px solid rgba(0, 223, 216, 0.35)',
        color: 'var(--accent-cyan)',
        fontSize: '0.85rem',
        fontWeight: 600,
        marginBottom: '20px'
      }}>
        <span style={{ fontSize: '1.1rem' }}>♔</span> Enterprise Competition Day 2026 • Strategy & Decision Arena
      </div>

      {/* Hero Header */}
      <h1 style={{
        fontSize: 'clamp(2.5rem, 6vw, 4.2rem)',
        textAlign: 'center',
        lineHeight: 1.1,
        marginBottom: '12px',
        background: 'linear-gradient(135deg, #ffffff 30%, #00dfd8 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        Ready to Compete?
      </h1>
      <p style={{
        color: 'var(--text-secondary)',
        fontSize: '1.1rem',
        textAlign: 'center',
        maxWidth: '480px',
        marginBottom: '36px'
      }}>
        Experience zero-trust, millisecond-accurate live classroom quiz battles.
      </p>

      {/* Main Glass Form Card */}
      <div className="glass-panel animate-pop" style={{
        width: '100%',
        maxWidth: '440px',
        padding: '36px 32px',
        textAlign: 'center',
        position: 'relative'
      }}>
        {step === 'PIN' ? (
          <form onSubmit={handlePinSubmit}>
            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              marginBottom: '16px'
            }}>
              Enter Game PIN
            </label>

            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              autoFocus
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="000 000"
              style={{
                width: '100%',
                fontSize: '2.4rem',
                fontWeight: 800,
                textAlign: 'center',
                letterSpacing: '0.25em',
                color: '#fff',
                background: 'rgba(10, 14, 28, 0.8)',
                padding: '16px',
                marginBottom: '24px',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-mono)'
              }}
            />

            {(localError || errorMessage) && (
              <div style={{
                background: 'rgba(255, 51, 102, 0.15)',
                color: 'var(--choice-red)',
                border: '1px solid rgba(255, 51, 102, 0.3)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                marginBottom: '18px'
              }}>
                {localError || errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || pin.length < 6}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '1.15rem',
                fontWeight: 800,
                borderRadius: 'var(--radius-md)',
                background: pin.length === 6
                  ? 'var(--accent-gradient)'
                  : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                cursor: pin.length === 6 ? 'pointer' : 'not-allowed',
                boxShadow: pin.length === 6 ? '0 0 25px rgba(0, 223, 216, 0.4)' : 'none'
              }}
            >
              {isLoading ? 'Verifying PIN...' : 'Next Step →'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoinSubmit}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px'
            }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                PIN: <strong style={{ color: 'var(--accent-cyan)' }}>{pin}</strong>
              </span>
              <button
                type="button"
                onClick={() => setStep('PIN')}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '0.8rem',
                  textDecoration: 'underline'
                }}
              >
                Change PIN
              </button>
            </div>

            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              marginBottom: '16px'
            }}>
              Choose Your Classroom Nickname
            </label>

            <input
              type="text"
              maxLength={20}
              value={nickname}
              autoFocus
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Brainiac99"
              style={{
                width: '100%',
                fontSize: '1.4rem',
                fontWeight: 700,
                textAlign: 'center',
                color: '#fff',
                background: 'rgba(10, 14, 28, 0.8)',
                padding: '16px',
                marginBottom: '12px',
                borderRadius: 'var(--radius-md)'
              }}
            />

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              🛡️ Profane or reserved names are blocked by the zero-trust filter.
            </p>

            {(localError || errorMessage) && (
              <div style={{
                background: 'rgba(255, 51, 102, 0.15)',
                color: 'var(--choice-red)',
                border: '1px solid rgba(255, 51, 102, 0.3)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                marginBottom: '18px'
              }}>
                {localError || errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !nickname.trim()}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '1.15rem',
                fontWeight: 800,
                borderRadius: 'var(--radius-md)',
                background: nickname.trim()
                  ? 'var(--accent-gradient)'
                  : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                cursor: nickname.trim() ? 'pointer' : 'not-allowed',
                boxShadow: nickname.trim() ? '0 0 25px rgba(121, 40, 202, 0.5)' : 'none'
              }}
            >
              {isLoading ? 'Joining Lobby...' : 'Enter Arena ⚡'}
            </button>
          </form>
        )}
      </div>

      {/* Teacher Link Footnote */}
      <div style={{ marginTop: '36px', textAlign: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Hosting a live session?{' '}
        </span>
        <button
          onClick={onOpenTeacherPortal}
          style={{
            background: 'transparent',
            color: 'var(--accent-cyan)',
            fontWeight: 700,
            fontSize: '0.9rem',
            textDecoration: 'underline'
          }}
        >
          Open Teacher Command Center
        </button>
      </div>
    </div>
  );
};
