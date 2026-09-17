import React from 'react';

interface Participant {
  id: string;
  nickname: string;
}

interface HostLobbyProps {
  pin: string;
  sessionId: string;
  participants: Participant[];
  onStartGame: () => void;
  onKickParticipant: (participantId: string) => void;
  onCancelGame: () => void;
}

export const HostLobby: React.FC<HostLobbyProps> = ({
  pin,
  participants,
  onStartGame,
  onKickParticipant,
  onCancelGame
}) => {
  return (
    <div style={{
      maxWidth: '1100px',
      margin: '0 auto',
      padding: '36px 20px',
      textAlign: 'center'
    }}>
      {/* Top Banner with PIN */}
      <div className="glass-panel animate-slide" style={{
        padding: '36px 24px',
        marginBottom: '36px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          top: '-50px',
          right: '-50px',
          width: '200px',
          height: '200px',
          background: 'radial-gradient(circle, rgba(0, 223, 216, 0.25), transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(30px)',
          pointerEvents: 'none'
        }} />

        <p style={{
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          fontSize: '0.9rem',
          fontWeight: 700,
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          Join at <span style={{ color: 'var(--accent-cyan)' }}>mindpulse.arena</span> with Game PIN
        </p>

        <div style={{
          fontSize: 'clamp(3.5rem, 9vw, 6.5rem)',
          fontWeight: 900,
          letterSpacing: '0.2em',
          fontFamily: 'var(--font-mono)',
          color: '#ffffff',
          textShadow: '0 0 40px rgba(0, 223, 216, 0.6)',
          margin: '12px 0 20px'
        }}>
          {pin.slice(0, 3)} {pin.slice(3)}
        </div>

        {/* Start Game Action */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', alignItems: 'center' }}>
          <button
            onClick={onCancelGame}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-secondary)',
              padding: '12px 24px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600,
              fontSize: '0.95rem'
            }}
          >
            Cancel Session
          </button>

          <button
            onClick={onStartGame}
            disabled={participants.length === 0}
            style={{
              background: participants.length > 0
                ? 'linear-gradient(135deg, #00d68f 0%, #00dfd8 100%)'
                : 'rgba(255, 255, 255, 0.1)',
              color: '#070913',
              padding: '16px 40px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 900,
              fontSize: '1.2rem',
              cursor: participants.length > 0 ? 'pointer' : 'not-allowed',
              boxShadow: participants.length > 0 ? '0 0 35px rgba(0, 214, 143, 0.5)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            {participants.length === 0
              ? 'Waiting for Players...'
              : `Start Game (${participants.length} Players) →`}
          </button>
        </div>
      </div>

      {/* Participants Counter Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        padding: '0 10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.5rem' }}>👥</span>
          <h3 style={{ fontSize: '1.3rem' }}>
            Connected Students ({participants.length})
          </h3>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Click ✕ on any name to remove a participant
        </span>
      </div>

      {/* Participants Grid */}
      {participants.length === 0 ? (
        <div className="glass-panel" style={{
          padding: '60px 20px',
          textAlign: 'center',
          color: 'var(--text-secondary)'
        }}>
          <div className="floating-badge" style={{ fontSize: '3rem', marginBottom: '14px' }}>
            ⏳
          </div>
          <h4 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '6px' }}>
            Lobby is Open & Waiting
          </h4>
          <p style={{ maxWidth: '400px', margin: '0 auto', fontSize: '0.9rem' }}>
            Tell students to visit the website and enter the 6-digit PIN on the screen.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '14px'
        }}>
          {participants.map((p, idx) => {
            const avatarColors = [
              '#ff3366', '#0099ff', '#ffb800', '#00d68f', '#7928ca', '#00dfd8'
            ];
            const color = avatarColors[idx % avatarColors.length];

            return (
              <div
                key={p.id}
                className="animate-pop"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${color}44`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: `0 4px 15px ${color}22`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    color: '#fff',
                    fontSize: '0.85rem',
                    flexShrink: 0
                  }}>
                    {p.nickname.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {p.nickname}
                  </span>
                </div>

                <button
                  onClick={() => onKickParticipant(p.id)}
                  title="Kick player"
                  style={{
                    background: 'transparent',
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: '14px',
                    padding: '4px',
                    borderRadius: '4px'
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
