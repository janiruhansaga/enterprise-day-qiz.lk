import React from 'react';
import { ChessKingIcon } from './ChessAtmosphere';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        width: '100%',
        borderTop: '1px solid var(--border-glass)',
        background: 'rgba(7, 9, 19, 0.92)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '24px 20px',
        marginTop: 'auto',
        position: 'relative',
        zIndex: 20
      }}
    >
      <div
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          textAlign: 'center'
        }}
      >
        {/* Emblem & Society Title */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em'
          }}
        >
          <ChessKingIcon size={18} glow color="var(--accent-cyan)" />
          <span>Nalanda College Enterprise Society</span>
        </div>

        {/* Creator Attribution */}
        <p
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            margin: 0
          }}
        >
          Made by <strong style={{ color: '#fff', fontWeight: 600 }}>Janiru Hansaga</strong>
        </p>

        {/* Official Copyright */}
        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            margin: 0,
            letterSpacing: '0.02em'
          }}
        >
          © 2026 Nalanda College Enterprise Society. All rights reserved.
        </p>
      </div>
    </footer>
  );
};
