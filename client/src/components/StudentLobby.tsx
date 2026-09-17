import React from 'react';

interface StudentLobbyProps {
  nickname: string;
  pin: string;
}

export const StudentLobby: React.FC<StudentLobbyProps> = ({ nickname, pin }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 140px)',
      padding: '24px',
      textAlign: 'center'
    }}>
      <div className="glass-panel animate-pop" style={{
        maxWidth: '460px',
        width: '100%',
        padding: '48px 32px',
        position: 'relative'
      }}>
        {/* Animated Avatar Icon */}
        <div style={{
          width: '90px',
          height: '90px',
          borderRadius: '50%',
          background: '#070913',
          border: '2px solid rgba(255, 215, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          boxShadow: '0 0 35px rgba(255, 68, 0, 0.45), 0 0 15px rgba(255, 215, 0, 0.3)',
          animation: 'pulseGlow 2.5s infinite',
          overflow: 'hidden'
        }}>
          <img
            src="/logo.png"
            alt="Enterprise Quiz Competition Logo"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>

        <p style={{
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          fontSize: '0.8rem',
          fontWeight: 700,
          color: 'var(--choice-green)',
          marginBottom: '8px'
        }}>
          ♔ Connected to Session #{pin}
        </p>

        <h2 style={{ fontSize: '2.2rem', marginBottom: '8px', color: '#fff' }}>
          You're In, {nickname}!
        </h2>

        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '32px' }}>
          See your nickname on the classroom screen? Get ready to answer fast for maximum points!
        </p>

        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-md)',
          padding: '18px 20px',
          textAlign: 'left'
        }}>
          <h4 style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            💡 Pro Gamer Tips:
          </h4>
          <ul style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', paddingLeft: '18px', lineHeight: 1.6 }}>
            <li>Points scale directly with your response speed (up to 1,000 pts).</li>
            <li>Maintain consecutive correct answers for up to a <strong>1.5x streak multiplier</strong>.</li>
            <li>Never refresh your browser during an active round!</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
