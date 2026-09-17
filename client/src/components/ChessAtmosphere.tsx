import React from 'react';

export interface ChessAtmosphereProps {
  variant?: 'landing' | 'lobby' | 'question' | 'teacher' | 'minimal';
}

/**
 * High-definition SVG Chess King Silhouette
 * Represents Leadership, Strategy, Decision-Making & Entrepreneurship
 */
export const ChessKingIcon: React.FC<{ size?: number; className?: string; glow?: boolean; color?: string }> = ({
  size = 48,
  className = '',
  glow = false,
  color
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    style={{ filter: glow ? 'drop-shadow(0 0 12px rgba(0, 223, 216, 0.6))' : 'none' }}
  >
    <defs>
      <linearGradient id="kingMetalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2a334e" />
        <stop offset="40%" stopColor="#171d31" />
        <stop offset="70%" stopColor="#0c101c" />
        <stop offset="100%" stopColor="#1e263d" />
      </linearGradient>
      <linearGradient id="kingRimHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#00dfd8" stopOpacity="0.8" />
        <stop offset="50%" stopColor="#7928ca" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#ff0080" stopOpacity="0.2" />
      </linearGradient>
      <linearGradient id="crownGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffd700" />
        <stop offset="100%" stopColor="#ff9900" />
      </linearGradient>
    </defs>

    {/* Top Cross */}
    <rect x="47" y="6" width="6" height="16" rx="1.5" fill={color || 'url(#crownGold)'} />
    <rect x="42" y="11" width="16" height="6" rx="1.5" fill={color || 'url(#crownGold)'} />

    {/* Crown Dome & Coronet */}
    <path
      d="M30 36 C30 26, 40 22, 50 22 C60 22, 70 26, 70 36 L66 46 L34 46 Z"
      fill={color || 'url(#kingMetalGradient)'}
      stroke="url(#kingRimHighlight)"
      strokeWidth="1.5"
    />
    {/* Crown Jewels / Spikes */}
    <circle cx="34" cy="34" r="2.5" fill="url(#crownGold)" />
    <circle cx="50" cy="31" r="3" fill="url(#crownGold)" />
    <circle cx="66" cy="34" r="2.5" fill="url(#crownGold)" />

    {/* Neck Collar */}
    <path
      d="M32 46 C32 46, 38 52, 50 52 C62 52, 68 46, 68 46 L65 60 L35 60 Z"
      fill={color || 'url(#kingMetalGradient)'}
      stroke="url(#kingRimHighlight)"
      strokeWidth="1.2"
    />

    {/* Main Body Pillar */}
    <path
      d="M35 60 C32 75, 28 88, 24 96 L76 96 C72 88, 68 75, 65 60 Z"
      fill={color || 'url(#kingMetalGradient)'}
      stroke="url(#kingRimHighlight)"
      strokeWidth="1.5"
    />

    {/* Tiered Solid Base */}
    <rect
      x="20"
      y="96"
      width="60"
      height="8"
      rx="3"
      fill={color || 'url(#kingMetalGradient)'}
      stroke="url(#kingRimHighlight)"
      strokeWidth="1.2"
    />
    <rect
      x="16"
      y="104"
      width="68"
      height="9"
      rx="4"
      fill={color || 'url(#kingMetalGradient)'}
      stroke="url(#kingRimHighlight)"
      strokeWidth="1.5"
    />
  </svg>
);

/**
 * Chess Knight Silhouette (Strategy & Tactical Maneuver)
 */
export const ChessKnightIcon: React.FC<{ size?: number; className?: string }> = ({ size = 42, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M32 104 L68 104 L68 96 C64 94, 62 88, 62 82 C62 76, 70 70, 72 62 C74 54, 72 44, 66 36 C60 28, 52 24, 46 20 C42 18, 38 22, 38 26 C38 30, 42 34, 40 38 C38 42, 32 44, 28 48 C24 52, 24 58, 28 62 C32 66, 36 64, 38 68 C40 72, 36 82, 32 88 Z"
      fill="rgba(255, 255, 255, 0.05)"
      stroke="rgba(0, 223, 216, 0.2)"
      strokeWidth="1.5"
    />
    <rect x="24" y="104" width="52" height="8" rx="3" fill="rgba(255, 255, 255, 0.04)" stroke="rgba(0, 223, 216, 0.15)" strokeWidth="1" />
  </svg>
);

/**
 * Chess Rook Silhouette (Fortitude & Institutional Strength)
 */
export const ChessRookIcon: React.FC<{ size?: number; className?: string }> = ({ size = 42, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    {/* Battlements */}
    <path
      d="M30 30 L30 42 L36 42 L36 34 L44 34 L44 42 L56 42 L56 34 L64 34 L64 42 L70 42 L70 30 Z"
      fill="rgba(255, 255, 255, 0.05)"
      stroke="rgba(121, 40, 202, 0.25)"
      strokeWidth="1.2"
    />
    {/* Body */}
    <path
      d="M34 42 L38 94 L62 94 L66 42 Z"
      fill="rgba(255, 255, 255, 0.04)"
      stroke="rgba(121, 40, 202, 0.2)"
      strokeWidth="1.2"
    />
    {/* Base */}
    <rect x="26" y="94" width="48" height="8" rx="2" fill="rgba(255, 255, 255, 0.05)" stroke="rgba(121, 40, 202, 0.25)" strokeWidth="1" />
    <rect x="22" y="102" width="56" height="8" rx="3" fill="rgba(255, 255, 255, 0.04)" stroke="rgba(121, 40, 202, 0.2)" strokeWidth="1" />
  </svg>
);

export const ChessAtmosphere: React.FC<ChessAtmosphereProps> = () => {
  return (
    <div
      aria-hidden="true"
      className="competition-chess-bg-layer"
    >
      {/* Subtle Readability & Atmosphere Overlay */}
      <div className="competition-chess-overlay" />
    </div>
  );
};
