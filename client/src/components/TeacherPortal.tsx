import React, { useState, useEffect, useRef } from 'react';
import { api, type Quiz, type QuizQuestion, type User } from '../services/api';
import { soundManager } from '../utils/soundManager';
import { firebaseAuthService } from '../services/firebaseAuth';

interface TeacherPortalProps {
  user: User | null;
  token: string | null;
  onLoginSuccess: (user: User, token: string) => void;
  onHostGame: (quizId: string) => Promise<void>;
  onClose: () => void;
}

export const TeacherPortal: React.FC<TeacherPortalProps> = ({
  user,
  token,
  onLoginSuccess,
  onHostGame,
  onClose
}) => {
  // Auth state
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfoMessage, setAuthInfoMessage] = useState<string | null>(null);
  const [googlePendingToken, setGooglePendingToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  const handleCancelGooglePending = async () => {
    try {
      await firebaseAuthService.signOutTeacher();
    } catch {
      // Ignore
    }
    setGooglePendingToken(null);
    setInvitationCode('');
    setAuthError(null);
    setAuthInfoMessage(null);
  };

  // Quizzes state
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Quiz state
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([
    {
      prompt: 'What is the primary defense of zero-trust architecture?',
      timeLimitSec: 20,
      basePoints: 1000,
      options: [
        { optionText: 'Never trust, always verify authoritatively', isCorrect: true },
        { optionText: 'Rely on client browser checks', isCorrect: false },
        { optionText: 'Store secrets in localStorage', isCorrect: false },
        { optionText: 'Trust timestamps sent by the client', isCorrect: false }
      ]
    },
    {
      prompt: 'Which hashing algorithm is memory-hard and recommended for password storage?',
      timeLimitSec: 15,
      basePoints: 1000,
      options: [
        { optionText: 'MD5', isCorrect: false },
        { optionText: 'Argon2 / scrypt', isCorrect: true },
        { optionText: 'Plain SHA-256 without salt', isCorrect: false },
        { optionText: 'DES', isCorrect: false }
      ]
    }
  ]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load quizzes when token is available
  useEffect(() => {
    if (token) {
      loadQuizzes();
    }
  }, [token]);

  const loadQuizzes = async () => {
    if (!token) return;
    setLoadingQuizzes(true);
    try {
      const list = await api.getQuizzes(token);
      setQuizzes(list);
    } catch (err: any) {
      console.error('Failed to load quizzes:', err);
    } finally {
      setLoadingQuizzes(false);
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError(null);
    setAuthInfoMessage(null);
    setAuthLoading(true);

    try {
      const cred = await firebaseAuthService.signInWithGoogle();
      const idToken = await cred.user.getIdToken();

      try {
        const res = await api.firebaseLogin(idToken);
        soundManager.playCorrectChime();
        onLoginSuccess(res.user, idToken);
      } catch (backendErr: any) {
        if (backendErr.code === 'TEACHER_AUTHORIZATION_REQUIRED' || backendErr.message?.includes('authorization required')) {
          setGooglePendingToken(idToken);
          setAuthMode('REGISTER');
          setDisplayName(cred.user.displayName || '');
          setEmail(cred.user.email || '');
          setAuthInfoMessage('Google identity verified! Please enter your school Teacher Authorization Code to activate your account.');
        } else {
          throw backendErr;
        }
      }
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setAuthError(firebaseAuthService.formatError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setAuthError(null);
    setAuthInfoMessage(null);
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      soundManager.playWrongBuzzer();
      setAuthError('Please enter your school email address above to reset your password.');
      return;
    }

    setAuthLoading(true);
    try {
      await firebaseAuthService.sendPasswordReset(cleanEmail);
      soundManager.playCorrectChime();
      setAuthInfoMessage(`Password reset link sent to ${cleanEmail}. Please check your email inbox.`);
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setAuthError(firebaseAuthService.formatError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfoMessage(null);
    setAuthLoading(true);

    try {
      if (googlePendingToken) {
        const res = await api.firebaseRegister(googlePendingToken, {
          displayName: displayName.trim() || 'Teacher',
          invitationCode: invitationCode.trim()
        });
        soundManager.playCorrectChime();
        setGooglePendingToken(null);
        onLoginSuccess(res.user, googlePendingToken);
        return;
      }

      if (authMode === 'LOGIN') {
        let tokenToUse: string | null = null;
        let authResult: any = null;

        try {
          const cred = await firebaseAuthService.signInWithEmail(email, password);
          tokenToUse = await cred.user.getIdToken();
          authResult = await api.firebaseLogin(tokenToUse);
        } catch (firebaseErr: any) {
          // If Firebase Web credentials not configured, fallback to legacy login
          if (firebaseErr?.code === 'auth/invalid-api-key' || firebaseErr?.code === 'auth/api-key-not-valid' || !firebaseErr?.code) {
            const legacyRes = await api.login({ email, password });
            soundManager.playCorrectChime();
            onLoginSuccess(legacyRes.user, legacyRes.token);
            return;
          }
          throw new Error(firebaseAuthService.formatError(firebaseErr));
        }

        if (authResult && tokenToUse) {
          soundManager.playCorrectChime();
          onLoginSuccess(authResult.user, tokenToUse);
        }
      } else {
        let tokenToUse: string | null = null;
        let authResult: any = null;

        try {
          const cred = await firebaseAuthService.registerWithEmail(email, password);
          tokenToUse = await cred.user.getIdToken();
          authResult = await api.firebaseRegister(tokenToUse, {
            displayName: displayName.trim(),
            invitationCode: invitationCode.trim()
          });
        } catch (firebaseErr: any) {
          if (firebaseErr?.code === 'auth/invalid-api-key' || firebaseErr?.code === 'auth/api-key-not-valid' || !firebaseErr?.code) {
            const legacyRes = await api.register({
              email,
              password,
              displayName,
              requestedRole: 'TEACHER',
              invitationCode
            });
            soundManager.playCorrectChime();
            onLoginSuccess(legacyRes.user, legacyRes.token);
            return;
          }
          throw new Error(firebaseAuthService.formatError(firebaseErr));
        }

        if (authResult && tokenToUse) {
          soundManager.playCorrectChime();
          onLoginSuccess(authResult.user, tokenToUse);
        }
      }
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAddQuestion = () => {
    soundManager.playTick();
    setQuestions([
      ...questions,
      {
        prompt: 'New Question Prompt',
        timeLimitSec: 20,
        basePoints: 1000,
        options: [
          { optionText: 'Option 1', isCorrect: true },
          { optionText: 'Option 2', isCorrect: false },
          { optionText: 'Option 3', isCorrect: false },
          { optionText: 'Option 4', isCorrect: false }
        ]
      }
    ]);
  };

  const handleRemoveQuestion = (idx: number) => {
    if (questions.length <= 1) return;
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const handleOptionChange = (qIdx: number, optIdx: number, text: string) => {
    const updated = [...questions];
    updated[qIdx].options[optIdx].optionText = text;
    setQuestions(updated);
  };

  const handleSetCorrectOption = (qIdx: number, optIdx: number) => {
    soundManager.playTick();
    const updated = [...questions];
    updated[qIdx].options = updated[qIdx].options.map((o, idx) => ({
      ...o,
      isCorrect: idx === optIdx
    }));
    setQuestions(updated);
  };

  const openCreateModal = () => {
    soundManager.playTick();
    setCreateError(null);
    setTitleError(false);
    setShowCreateModal(true);
  };

  const handleSaveQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setCreateError(null);
    setTitleError(false);

    // 1. Explicitly Validate Quiz Title
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      soundManager.playWrongBuzzer();
      setTitleError(true);
      setCreateError('Quiz title is required.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => titleInputRef.current?.focus(), 80);
      return;
    }
    if (trimmedTitle.length < 3) {
      soundManager.playWrongBuzzer();
      setTitleError(true);
      setCreateError('Quiz title must be at least 3 characters long.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => titleInputRef.current?.focus(), 80);
      return;
    }
    if (trimmedTitle.length > 120) {
      soundManager.playWrongBuzzer();
      setTitleError(true);
      setCreateError('Quiz title must not exceed 120 characters.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => titleInputRef.current?.focus(), 80);
      return;
    }

    // 2. Validate Questions count
    if (questions.length === 0) {
      soundManager.playWrongBuzzer();
      setCreateError('Please add at least one question to the quiz.');
      return;
    }

    // 3. Validate Each Question & Option
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const trimmedPrompt = q.prompt.trim();
      if (!trimmedPrompt) {
        soundManager.playWrongBuzzer();
        setCreateError(`Question ${i + 1}: Question prompt is required.`);
        return;
      }
      if (trimmedPrompt.length < 5) {
        soundManager.playWrongBuzzer();
        setCreateError(`Question ${i + 1}: Question prompt must be at least 5 characters long.`);
        return;
      }
      if (!q.options || q.options.length < 2) {
        soundManager.playWrongBuzzer();
        setCreateError(`Question ${i + 1}: Must have at least 2 answer options.`);
        return;
      }
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].optionText.trim()) {
          soundManager.playWrongBuzzer();
          setCreateError(`Question ${i + 1}, Option ${j + 1}: Option text cannot be empty.`);
          return;
        }
      }
      if (!q.options.some(o => o.isCorrect)) {
        soundManager.playWrongBuzzer();
        setCreateError(`Question ${i + 1}: Please select a correct answer by clicking the radio button for the correct option.`);
        return;
      }
    }

    setCreateLoading(true);

    try {
      // Create quiz
      const createdQuiz = await api.createQuiz(token, {
        title: trimmedTitle,
        description: newDesc.trim() || 'Classroom competition'
      });

      // Add all questions
      for (const q of questions) {
        await api.addQuestion(token, createdQuiz.id, {
          prompt: q.prompt.trim(),
          timeLimitSec: q.timeLimitSec,
          basePoints: q.basePoints,
          options: q.options.map(o => ({
            optionText: o.optionText.trim(),
            isCorrect: o.isCorrect
          }))
        });
      }

      soundManager.playCorrectChime();
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
      setTitleError(false);
      await loadQuizzes();
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setCreateError(err.message || 'Failed to create quiz');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleLaunchSession = async (quizId: string) => {
    soundManager.playJoinChime();
    await onHostGame(quizId);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 7, 15, 0.88)',
      backdropFilter: 'blur(20px)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px'
    }}>
      <div className="glass-panel animate-pop" style={{
        width: '100%',
        maxWidth: user ? '860px' : '460px',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '36px 32px',
        position: 'relative'
      }}>
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(255, 255, 255, 0.08)',
            color: '#fff',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>

        {!user ? (
          /* Authentication View */
          <div>
            {googlePendingToken ? (
              /* Step 2: First-Time Google Teacher - Registration Code Prompt */
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: 'rgba(230, 180, 50, 0.15)',
                    color: '#f0c040',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    margin: '0 auto 10px'
                  }}>
                    ♔
                  </div>
                  <h2 style={{ fontSize: '1.6rem', marginBottom: '6px' }}>
                    Teacher Authorization Code
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: '1.4' }}>
                    Google identity verified for <strong style={{ color: '#fff' }}>{displayName || email}</strong>.
                    <br />
                    Please enter your school Teacher Registration Code to activate teacher access.
                  </p>
                </div>

                {authInfoMessage && (
                  <div style={{
                    background: 'rgba(0, 214, 143, 0.15)',
                    color: 'var(--choice-green)',
                    border: '1px solid rgba(0, 214, 143, 0.3)',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    textAlign: 'center'
                  }}>
                    {authInfoMessage}
                  </div>
                )}

                {authError && (
                  <div style={{
                    background: 'rgba(255, 51, 102, 0.15)',
                    color: 'var(--choice-red)',
                    border: '1px solid rgba(255, 51, 102, 0.3)',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    textAlign: 'center'
                  }}>
                    {authError}
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Teacher Registration Code
                  </label>
                  <input
                    type="password"
                    required
                    autoFocus
                    value={invitationCode}
                    onChange={(e) => setInvitationCode(e.target.value)}
                    placeholder="Enter school-issued authorization code"
                    style={{ width: '100%' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    Provided by the event administrator to authorize official competition hosts.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  style={{
                    width: '100%',
                    padding: '14px',
                    fontSize: '1rem',
                    fontWeight: 700,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-gradient)',
                    color: '#fff',
                    boxShadow: '0 4px 20px rgba(121, 40, 202, 0.5)',
                    cursor: 'pointer'
                  }}
                >
                  {authLoading ? 'Verifying Code...' : 'Authorize Teacher Account'}
                </button>

                <button
                  type="button"
                  onClick={handleCancelGooglePending}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    marginTop: '4px',
                    textAlign: 'center'
                  }}
                >
                  ← Sign in with a different Google account
                </button>
              </form>
            ) : (
              /* Step 1: Teacher Sign In - Google First */
              <div>
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: 'rgba(230, 180, 50, 0.15)',
                    color: '#f0c040',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    margin: '0 auto 12px'
                  }}>
                    ♔
                  </div>
                  <h2 style={{ fontSize: '1.8rem', marginBottom: '6px' }}>
                    Teacher Portal
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Enterprise Competition Day. Sign in to host quizzes and manage live battle arenas.
                  </p>
                </div>

                {authError && (
                  <div style={{
                    background: 'rgba(255, 51, 102, 0.15)',
                    color: 'var(--choice-red)',
                    border: '1px solid rgba(255, 51, 102, 0.3)',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    marginBottom: '16px',
                    textAlign: 'center'
                  }}>
                    {authError}
                  </div>
                )}

                {/* Google Authentication (Primary) */}
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={authLoading}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid var(--border-glass)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    marginBottom: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)'
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  {authLoading ? 'Connecting to Google...' : 'Continue with Google'}
                </button>

                {/* Optional Developer / Offline Email Fallback */}
                <div style={{ textAlign: 'center', marginTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setShowEmailFallback(!showEmailFallback)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    {showEmailFallback ? 'Hide Email / Password Login' : 'Offline / Developer Sign In'}
                  </button>
                </div>

                {showEmailFallback && (
                  <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-glass)', paddingTop: '16px' }}>
                    <div style={{
                      display: 'flex',
                      background: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px',
                      marginBottom: '16px'
                    }}>
                      <button
                        type="button"
                        onClick={() => setAuthMode('LOGIN')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: 'var(--radius-sm)',
                          background: authMode === 'LOGIN' ? 'var(--accent-purple)' : 'transparent',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.85rem'
                        }}
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthMode('REGISTER')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: 'var(--radius-sm)',
                          background: authMode === 'REGISTER' ? 'var(--accent-purple)' : 'transparent',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.85rem'
                        }}
                      >
                        Register
                      </button>
                    </div>

                    <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {authMode === 'REGISTER' && (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Full Name
                          </label>
                          <input
                            type="text"
                            required
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Teacher Name"
                            style={{ width: '100%' }}
                          />
                        </div>
                      )}

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                          Email Address
                        </label>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="teacher@school.edu"
                          style={{ width: '100%' }}
                        />
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            Password
                          </label>
                          {authMode === 'LOGIN' && (
                            <button
                              type="button"
                              onClick={handleForgotPassword}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                fontSize: '0.74rem',
                                cursor: 'pointer',
                                padding: 0
                              }}
                            >
                              Forgot password?
                            </button>
                          )}
                        </div>
                        <input
                          type="password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••••••"
                          style={{ width: '100%' }}
                        />
                      </div>

                      {authMode === 'REGISTER' && (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Teacher Registration Code
                          </label>
                          <input
                            type="password"
                            required
                            value={invitationCode}
                            onChange={(e) => setInvitationCode(e.target.value)}
                            placeholder="Enter school code"
                            style={{ width: '100%' }}
                          />
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={authLoading}
                        style={{
                          width: '100%',
                          padding: '12px',
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--accent-gradient)',
                          color: '#fff',
                          cursor: 'pointer'
                        }}
                      >
                        {authLoading ? 'Verifying...' : authMode === 'LOGIN' ? 'Sign In' : 'Register'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Teacher Dashboard */
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '28px',
              borderBottom: '1px solid var(--border-glass)',
              paddingBottom: '18px'
            }}>
              <div>
                <h2 style={{ fontSize: '1.8rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--accent-cyan)' }}>♔</span> Teacher Command Center
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Enterprise Competition Day • Authoritative Quiz & Strategy Controller
                </p>
              </div>

              <button
                onClick={openCreateModal}
                style={{
                  background: 'var(--accent-gradient)',
                  color: '#fff',
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 15px rgba(0, 223, 216, 0.3)'
                }}
              >
                <span>+</span> Create New Quiz
              </button>
            </div>

            {/* Quizzes List */}
            {loadingQuizzes ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px' }}>
                Loading your authorized quizzes...
              </p>
            ) : quizzes.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '48px 24px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: 'var(--radius-lg)',
                border: '1px dashed var(--border-glass)'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📚</div>
                <h3 style={{ marginBottom: '8px' }}>No Quizzes Created Yet</h3>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 20px' }}>
                  Create your first quiz with custom questions and secret answer keys to host a game.
                </p>
                <button
                  onClick={openCreateModal}
                  style={{
                    background: 'var(--accent-purple)',
                    color: '#fff',
                    padding: '10px 22px',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 700
                  }}
                >
                  Create Your First Quiz
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
                {quizzes.map((quiz) => (
                  <div
                    key={quiz.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-glass)',
                      borderRadius: 'var(--radius-md)',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <h4 style={{ fontSize: '1.2rem', color: '#fff' }}>{quiz.title}</h4>
                        <span style={{
                          background: 'rgba(0, 223, 216, 0.1)',
                          color: 'var(--accent-cyan)',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)'
                        }}>
                          {quiz.question_count || 0} Questions
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
                        {quiz.description || 'Classroom assessment'}
                      </p>
                    </div>

                    <button
                      onClick={() => handleLaunchSession(quiz.id)}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'linear-gradient(135deg, #00dfd8 0%, #007cf0 100%)',
                        color: '#fff',
                        fontWeight: 800,
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.95rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 14px rgba(0, 223, 216, 0.25)'
                      }}
                    >
                      <span>🚀</span> Host Live Game Session
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create Quiz Modal */}
        {showCreateModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(16px)',
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div ref={modalContentRef} className="glass-panel animate-slide" style={{
              width: '100%',
              maxWidth: '780px',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '32px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ fontSize: '1.5rem', marginBottom: '4px' }}>Create Authoritative Quiz</h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Define your question set and secret answer keys stored safely on the server.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  style={{ background: 'transparent', color: '#fff', fontSize: '20px' }}
                >
                  ✕
                </button>
              </div>

              {createError && (
                <div style={{
                  background: 'rgba(255, 51, 102, 0.15)',
                  color: 'var(--choice-red)',
                  border: '1px solid rgba(255, 51, 102, 0.4)',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  marginBottom: '18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleSaveQuiz} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: 700, color: titleError ? 'var(--choice-red)' : '#fff' }}>
                      Quiz Title <span style={{ color: 'var(--choice-red)' }}>*</span>
                    </label>
                    <span style={{ fontSize: '0.75rem', color: titleError ? 'var(--choice-red)' : 'var(--text-muted)' }}>
                      {titleError ? '⚠️ Title is required' : 'Required — Minimum 3 characters'}
                    </span>
                  </div>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={newTitle}
                    onChange={(e) => {
                      setNewTitle(e.target.value);
                      if (titleError && e.target.value.trim().length >= 3) {
                        setTitleError(false);
                        setCreateError(null);
                      }
                    }}
                    placeholder="e.g. Cybersecurity Fundamentals"
                    style={{
                      width: '100%',
                      border: titleError ? '1.5px solid var(--choice-red)' : undefined,
                      boxShadow: titleError ? '0 0 12px rgba(255, 51, 102, 0.35)' : undefined
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Description <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Short description for students (defaults to 'Classroom competition')"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h4 style={{ fontSize: '1.1rem', marginBottom: '2px' }}>Questions ({questions.length})</h4>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        All questions require a prompt and at least one marked correct answer
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddQuestion}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--accent-cyan)',
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.85rem',
                        fontWeight: 700
                      }}
                    >
                      + Add Question
                    </button>
                  </div>

                  {questions.map((q, qIdx) => (
                    <div
                      key={qIdx}
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: 'var(--radius-md)',
                        padding: '20px',
                        marginBottom: '16px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                          Question {qIdx + 1}
                        </span>
                        {questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestion(qIdx)}
                            style={{
                              background: 'transparent',
                              color: 'var(--choice-red)',
                              fontSize: '0.8rem'
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Question Prompt <span style={{ color: 'var(--choice-red)' }}>*</span>
                        </label>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Min 5 characters</span>
                      </div>
                      <input
                        type="text"
                        value={q.prompt}
                        onChange={(e) => {
                          const updated = [...questions];
                          updated[qIdx].prompt = e.target.value;
                          setQuestions(updated);
                        }}
                        placeholder="Enter question prompt..."
                        style={{ width: '100%', marginBottom: '14px' }}
                      />

                      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Time Limit (sec)</label>
                          <select
                            value={q.timeLimitSec}
                            onChange={(e) => {
                              const updated = [...questions];
                              updated[qIdx].timeLimitSec = Number(e.target.value);
                              setQuestions(updated);
                            }}
                            style={{ display: 'block', width: '120px', marginTop: '4px' }}
                          >
                            <option value={10}>10 seconds</option>
                            <option value={15}>15 seconds</option>
                            <option value={20}>20 seconds</option>
                            <option value={30}>30 seconds</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Base Points</label>
                          <input
                            type="number"
                            value={q.basePoints}
                            onChange={(e) => {
                              const updated = [...questions];
                              updated[qIdx].basePoints = Number(e.target.value);
                              setQuestions(updated);
                            }}
                            style={{ display: 'block', width: '120px', marginTop: '4px' }}
                          />
                        </div>
                      </div>

                      {/* Options */}
                      <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                        Options <span style={{ color: 'var(--choice-red)' }}>*</span> (Click radio button to set the secret correct answer):
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        {q.options.map((opt, optIdx) => {
                          const colors = ['var(--choice-red)', 'var(--choice-blue)', 'var(--choice-yellow)', 'var(--choice-green)'];
                          const shapes = ['▲', '◆', '●', '■'];
                          return (
                            <div
                              key={optIdx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'rgba(255, 255, 255, 0.03)',
                                padding: '8px 12px',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${opt.isCorrect ? colors[optIdx] : 'var(--border-glass)'}`
                              }}
                            >
                              <span style={{ color: colors[optIdx], fontWeight: 800 }}>
                                {shapes[optIdx]}
                              </span>
                              <input
                                type="text"
                                value={opt.optionText}
                                onChange={(e) => handleOptionChange(qIdx, optIdx, e.target.value)}
                                placeholder={`Option ${optIdx + 1}...`}
                                style={{ flex: 1, padding: '6px 10px', fontSize: '0.85rem' }}
                              />
                              <input
                                type="radio"
                                name={`correct-${qIdx}`}
                                checked={!!opt.isCorrect}
                                onChange={() => handleSetCorrectOption(qIdx, optIdx)}
                                title="Mark as correct answer"
                                style={{ cursor: 'pointer', accentColor: 'var(--choice-green)' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {createError && (
                  <div style={{
                    background: 'rgba(255, 51, 102, 0.15)',
                    color: 'var(--choice-red)',
                    border: '1px solid rgba(255, 51, 102, 0.4)',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                    <span>{createError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={createLoading}
                  style={{
                    padding: '14px',
                    background: 'var(--accent-gradient)',
                    color: '#fff',
                    fontWeight: 700,
                    borderRadius: 'var(--radius-md)',
                    fontSize: '1rem',
                    boxShadow: '0 4px 15px rgba(121, 40, 202, 0.4)'
                  }}
                >
                  {createLoading ? 'Saving Quiz...' : 'Save & Publish Quiz'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
