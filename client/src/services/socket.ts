import { io, Socket } from 'socket.io-client';

export const getSocketUrl = (): string => {
  const wsUrl = import.meta.env.VITE_WS_URL;
  if (wsUrl && wsUrl.trim()) {
    return wsUrl.trim().replace(/\/+$/, '');
  }

  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl && apiUrl.trim()) {
    return apiUrl.trim().replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
  }

  // Strictly avoid localhost in production
  if (import.meta.env.PROD) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return '';
  }

  return 'http://localhost:4000';
};

class SocketService {
  private socket: Socket | null = null;

  public connect(): Socket {
    if (!this.socket) {
      const targetUrl = getSocketUrl();

      if (import.meta.env.PROD && targetUrl.includes('.vercel.app')) {
        console.warn(
          `[Socket] Notice: Target WebSocket server is configured to a Vercel URL (${targetUrl}). ` +
          'Note that Vercel Serverless Functions do not support persistent Socket.IO WebSocket upgrades. ' +
          'For live multiplayer battle gameplay, deploy the backend to a persistent Node container ' +
          '(Railway, Render, Fly.io, Cloud Run) and set VITE_WS_URL accordingly.'
        );
      }

      this.socket = io(targetUrl, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      this.socket.on('connect', () => {
        console.log('[Socket] Connected to MindPulse server:', this.socket?.id);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
      });

      this.socket.on('connect_error', (err) => {
        console.error('[Socket] Connection error:', err.message);
      });
    }

    if (this.socket.disconnected) {
      this.socket.connect();
    }

    return this.socket;
  }

  public getSocket(): Socket | null {
    return this.socket;
  }

  public disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
