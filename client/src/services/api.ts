const getApiBase = (): string => {
  const envApiUrl = import.meta.env.VITE_API_URL;
  if (envApiUrl && envApiUrl.trim()) {
    return envApiUrl.trim().replace(/\/+$/, '');
  }

  // Strictly avoid localhost in production
  if (import.meta.env.PROD) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api/v1`;
    }
    return '/api/v1';
  }

  return 'http://localhost:4000/api/v1';
};

const API_BASE = getApiBase();

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

export interface QuizOption {
  id?: string;
  optionText: string;
  isCorrect?: boolean;
}

export interface QuizQuestion {
  id?: string;
  prompt: string;
  timeLimitSec: number;
  basePoints: number;
  options: QuizOption[];
}

export interface Quiz {
  id: string;
  title: string;
  description: string;
  question_count?: number;
  questions?: QuizQuestion[];
  created_at: number;
}

export const api = {
  async register(data: {
    email: string;
    password: string;
    displayName: string;
    requestedRole: 'STUDENT' | 'TEACHER';
    invitationCode?: string;
  }) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok) {
      if (json.errors && typeof json.errors === 'object') {
        const fieldDetails = Object.entries(json.errors)
          .map(([field, errs]: [string, any]) => `${field}: ${Array.isArray(errs) ? errs.join(', ') : errs}`)
          .join(' | ');
        throw new Error(fieldDetails || json.message || 'Registration failed');
      }
      throw new Error(json.message || 'Registration failed');
    }
    return json;
  },

  async login(credentials: { email: string; password: string }) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Login failed');
    return json;
  },

  async firebaseLogin(idToken: string) {
    const res = await fetch(`${API_BASE}/auth/firebase-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ idToken })
    });
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(json.message || 'Firebase login failed') as any;
      err.code = json.code;
      throw err;
    }
    return json;
  },

  async firebaseRegister(idToken: string, data: { displayName: string; invitationCode: string }) {
    const res = await fetch(`${API_BASE}/auth/firebase-register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ idToken, ...data })
    });
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(json.message || 'Registration failed') as any;
      err.code = json.code;
      throw err;
    }
    return json;
  },

  async getMe(token: string): Promise<User> {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to authenticate');
    return json.user;
  },

  async getQuizzes(token: string): Promise<Quiz[]> {
    const res = await fetch(`${API_BASE}/quizzes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to load quizzes');
    return json.quizzes;
  },

  async getQuizDetails(token: string, quizId: string): Promise<Quiz> {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to load quiz details');
    return json.quiz;
  },

  async createQuiz(token: string, data: { title: string; description: string }) {
    const res = await fetch(`${API_BASE}/quizzes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to create quiz');
    return json.quiz;
  },

  async addQuestion(token: string, quizId: string, question: QuizQuestion) {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(question)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to add question');
    return json.question;
  },

  async hostGameSession(token: string, quizId: string) {
    const res = await fetch(`${API_BASE}/games`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ quizId })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to host game');
    return json.session;
  },

  async lookupPin(pin: string) {
    const res = await fetch(`${API_BASE}/games/pin/${pin}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Game not found');
    return json;
  },

  async joinGame(pin: string, nickname: string) {
    const res = await fetch(`${API_BASE}/games/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, nickname })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to join game');
    return json;
  },

  async submitAnswer(
    token: string,
    data: { sessionId: string; questionId: string; selectedOptionId: string; roundNonce: string }
  ) {
    const res = await fetch(`${API_BASE}/games/answers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(json.message || 'Answer rejected') as any;
      err.code = json.code;
      throw err;
    }
    return json;
  },

  async startGame(token: string, sessionId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to start game');
    return json;
  },

  async nextQuestion(token: string, sessionId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to advance question');
    return json;
  },

  async finishRound(token: string, sessionId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/finish-round`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to finish round');
    return json;
  },

  async showLeaderboard(token: string, sessionId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/leaderboard`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to show leaderboard');
    return json;
  },

  async kickParticipant(token: string, sessionId: string, participantId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/kick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ sessionId, participantId })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to kick participant');
    return json;
  },

  async getPodium(token: string, sessionId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/podium`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to load results');
    return json;
  },

  async getGameState(sessionId: string) {
    const res = await fetch(`${API_BASE}/games/${sessionId}/state`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to load game state');
    return json.state;
  }
};
