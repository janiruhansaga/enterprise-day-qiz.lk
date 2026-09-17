import React, { useState } from 'react';
import { soundManager } from '../utils/soundManager';
import { ChessKingIcon } from './ChessAtmosphere';

interface NavbarProps {
  user: { displayName: string; role: string } | null;
  onLogout: () => void;
  onOpenTeacherPortal: () => void;
  onHomeClick: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogout,
  onOpenTeacherPortal,
  onHomeClick
}) => {
  const [isMuted, setIsMuted] = useState(soundManager.getIsMuted());

  const handleToggleSound = () => {
    const muted = soundManager.toggleMute();
    setIsMuted(muted);
    if (!muted) soundManager.playTick();
  };

  return (
    <header className="mindpulse-navbar">
      {/* Brand */}
      <div
        onClick={onHomeClick}
        className="navbar-brand"
      >
        <div className="navbar-logo-box">
          <img
            src="/logo.png"
            alt="Enterprise Day Quiz Competition"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 'inherit'
            }}
          />
        </div>
        <div>
          <span className="navbar-title">
            MINDPULSE BATTLE
          </span>
          <span className="navbar-subtitle">
            <ChessKingIcon size={12} color="var(--accent-cyan)" />
            Enterprise Day '26 • Strategic Arena
          </span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="navbar-controls">
        {/* Sound Toggle */}
        <button
          onClick={handleToggleSound}
          title={isMuted ? 'Unmute Game Sounds' : 'Mute Game Sounds'}
          className="navbar-sound-btn"
        >
          {isMuted ? '🔇' : '🔊'}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {isMuted ? 'OFF' : 'ON'}
          </span>
        </button>

        {/* User / Teacher Portal Action */}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: 'rgba(121, 40, 202, 0.15)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(121, 40, 202, 0.3)',
              fontSize: '0.82rem',
              whiteSpace: 'nowrap'
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Teacher: </span>
              <strong style={{ color: '#fff' }}>{user.displayName}</strong>
            </div>
            <button
              onClick={onLogout}
              style={{
                background: 'rgba(255, 51, 102, 0.15)',
                color: 'var(--choice-red)',
                border: '1px solid rgba(255, 51, 102, 0.3)',
                padding: '7px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontWeight: 600,
                whiteSpace: 'nowrap'
              }}
            >
              Log Out
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenTeacherPortal}
            className="navbar-portal-btn"
          >
            Teacher Portal
          </button>
        )}
      </div>
    </header>
  );
};
