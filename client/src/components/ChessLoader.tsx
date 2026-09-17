import React from 'react';
import { ChessKingIcon } from './ChessAtmosphere';

interface ChessLoaderProps {
  message?: string;
  subMessage?: string;
}

export const ChessLoader: React.FC<ChessLoaderProps> = ({
  message = 'Calculating Strategic Move...',
  subMessage = 'Enterprise Competition Day • Leadership & Strategy'
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(7, 9, 19, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
        padding: '24px',
        animation: 'popIn 0.3s ease-out forwards'
      }}
    >
      {/* Strategic Board Arena Container */}
      <div
        style={{
          position: 'relative',
          width: '220px',
          height: '220px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '28px'
        }}
      >
        {/* Glowing Mini-Chessboard Grid (4x4 tiles) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gridTemplateRows: 'repeat(4, 1fr)',
            gap: '4px',
            padding: '8px',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(15, 20, 38, 0.85)',
            border: '1px solid rgba(0, 223, 216, 0.25)',
            boxShadow: '0 0 40px rgba(0, 223, 216, 0.15)',
            transform: 'perspective(400px) rotateX(25deg)',
            transformOrigin: 'center center'
          }}
        >
          {Array.from({ length: 16 }).map((_, i) => {
            const isDark = (Math.floor(i / 4) + (i % 4)) % 2 === 1;
            return (
              <div
                key={i}
                style={{
                  borderRadius: '4px',
                  background: isDark
                    ? 'rgba(10, 14, 28, 0.9)'
                    : 'rgba(0, 223, 216, 0.08)',
                  border: isDark ? 'none' : '1px solid rgba(0, 223, 216, 0.12)',
                  animation: `chessCellPulse 2s ease-in-out infinite ${(i * 0.1).toFixed(1)}s`
                }}
              />
            );
          })}
        </div>

        {/* Central Strategic King with Lightning Beacon */}
        <div
          className="chess-beacon"
          style={{
            position: 'relative',
            zIndex: 10,
            transform: 'translateY(-12px)'
          }}
        >
          <ChessKingIcon size={84} glow />
        </div>

        {/* Outer Circular Orbital Progress Ring */}
        <div
          style={{
            position: 'absolute',
            inset: '-10px',
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: 'var(--accent-cyan)',
            borderRightColor: 'var(--accent-purple)',
            animation: 'spin 1.8s linear infinite',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Strategic Typography */}
      <div style={{ textAlign: 'center', maxWidth: '360px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.75rem',
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--accent-cyan)',
            marginBottom: '8px'
          }}
        >
          <span>♔</span> {subMessage}
        </div>

        <h3
          style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            color: '#fff',
            marginBottom: '6px'
          }}
        >
          {message}
        </h3>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Authoritative zero-trust synchronization
        </p>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
