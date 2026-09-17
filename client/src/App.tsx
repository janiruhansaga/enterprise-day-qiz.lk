import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { LandingScreen } from './components/LandingScreen';
import { TeacherPortal } from './components/TeacherPortal';
import { HostLobby } from './components/HostLobby';
import { StudentLobby } from './components/StudentLobby';
import { ActiveQuestionView, type QuestionPayload } from './components/ActiveQuestionView';
import { RoundResultView } from './components/RoundResultView';
import { LeaderboardView, type LeaderboardEntry } from './components/LeaderboardView';
import { PodiumView } from './components/PodiumView';
import { ChessAtmosphere } from './components/ChessAtmosphere';
import { ChessLoader } from './components/ChessLoader';
import { Footer } from './components/Footer';
import { api, type User } from './services/api';
import { socketService } from './services/socket';
import { soundManager } from './utils/soundManager';
import { firebaseAuthService } from './services/firebaseAuth';

type AppView =
  | 'LANDING'
  | 'STUDENT_LOBBY'
  | 'TEACHER_LOBBY'
  | 'QUESTION'
  | 'ROUND_RESULT'
  | 'LEADERBOARD'
  | 'PODIUM';

export const App: React.FC = () => {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('mindpulse_token'));
  const [showTeacherModal, setShowTeacherModal] = useState(false);

  // App Navigation & Session state
  const [view, setView] = useState<AppView>('LANDING');
  const [isTeacher, setIsTeacher] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [gamePin, setGamePin] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [participantId, setParticipantId] = useState<string>('');
  const [participants, setParticipants] = useState<{ id: string; nickname: string }[]>([]);

  // Active Game state
  const [currentQuestion, setCurrentQuestion] = useState<QuestionPayload | null>(null);
  const [totalAnswers, setTotalAnswers] = useState<number>(0);
  const [correctOptionId, setCorrectOptionId] = useState<string>('');
  const [studentResult, setStudentResult] = useState<{
    correct: boolean;
    pointsAwarded: number;
    totalScore: number;
    streak: number;
  } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [topThree, setTopThree] = useState<LeaderboardEntry[]>([]);
  const [personalFinalResult, setPersonalFinalResult] = useState<{
    rank: number;
    totalScore: number;
    streak: number;
    totalParticipants: number;
  } | null>(null);

  // UI status
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef(socketService.connect());
  const sessionRef = useRef({ sessionId, participantId, isTeacher, token });

  useEffect(() => {
    sessionRef.current = { sessionId, participantId, isTeacher, token };
  }, [sessionId, participantId, isTeacher, token]);

  // Load teacher user if token exists
  useEffect(() => {
    if (token) {
      api.getMe(token)
        .then((u) => {
          if (u && (u.role === 'TEACHER' || u.role === 'ADMIN')) {
            setUser(u);
          } else {
            localStorage.removeItem('mindpulse_token');
            setToken(null);
            setUser(null);
          }
        })
        .catch(() => {
          localStorage.removeItem('mindpulse_token');
          setToken(null);
          setUser(null);
        });
    }
  }, [token]);

  // Subscribe to Firebase Auth persistence (Only for authorized teachers)
  useEffect(() => {
    const unsubscribe = firebaseAuthService.subscribeToAuthChanges(async (firebaseUser) => {
      if (firebaseUser && !token) {
        try {
          const freshToken = await firebaseUser.getIdToken();
          const res = await api.firebaseLogin(freshToken);
          if (res.user && (res.user.role === 'TEACHER' || res.user.role === 'ADMIN')) {
            setUser(res.user);
            setToken(freshToken);
            localStorage.setItem('mindpulse_token', freshToken);
          }
        } catch {
          // Unregistered Google user or token expired; do not store token or set teacher state
        }
      }
    });
    return () => unsubscribe();
  }, [token]);

  // Setup Socket event handlers
  useEffect(() => {
    const socket = socketRef.current;

    // 0. Socket Connection / Reconnection handling
    socket.on('connect', () => {
      const { sessionId: currentSessionId, participantId: currentPartId, isTeacher: currentIsTeacher, token: currentToken } = sessionRef.current;
      if (currentSessionId) {
        if (currentIsTeacher && currentToken) {
          socket.emit('game:teacher_join', { sessionId: currentSessionId, token: currentToken });
        } else if (currentPartId) {
          socket.emit('game:reconnect', { sessionId: currentSessionId, participantId: currentPartId });
        }
      }
    });

    // 1. Participant joined lobby event
    socket.on('game:participant_joined', (data: { participantId: string; nickname: string }) => {
      soundManager.playJoinChime();
      setParticipants((prev) => {
        if (prev.some((p) => p.id === data.participantId)) return prev;
        return [...prev, { id: data.participantId, nickname: data.nickname }];
      });
    });

    // 2. Participant left lobby
    socket.on('game:participant_left', (data: { participantId: string }) => {
      setParticipants((prev) => prev.filter((p) => p.id !== data.participantId));
    });

    // 3. Student kicked by teacher
    socket.on('game:kicked', () => {
      soundManager.playWrongBuzzer();
      setView('LANDING');
      setErrorMessage('You have been removed from the session by the host.');
    });

    // 4. Question Started (Sanitized authoritatively)
    socket.on('game:question_started', (q: any) => {
      soundManager.playTick();
      const normalizedQuestion: QuestionPayload = {
        questionId: q.questionId,
        questionIndex: q.questionIndex,
        totalQuestions: q.totalQuestions,
        prompt: q.prompt || q.questionText || '',
        durationSec: q.durationSec ?? q.timeLimitSec ?? 20,
        serverStartTime: q.serverStartTime || Date.now(),
        roundNonce: q.roundNonce || '',
        options: (q.options || []).map((opt: any) => ({
          id: opt.id,
          optionText: opt.optionText || opt.option_text || ''
        }))
      };
      setCurrentQuestion(normalizedQuestion);
      setTotalAnswers(0);
      setCorrectOptionId('');
      setStudentResult(null);
      setView('QUESTION');
    });

    // 5. Live Answers counter update
    socket.on('game:answer_count_updated', (data: { totalAnswers: number }) => {
      setTotalAnswers(data.totalAnswers);
    });

    // 6. Answer Acknowledged (Student private feedback)
    socket.on('game:answer_acknowledged', () => {
      // Confirmed receipt on authoritative server
    });

    // 7. Question Ended (Answer Reveal)
    socket.on('game:question_ended', (data: {
      correctOptionId: string;
      correctOptionText?: string;
      studentFeedback?: {
        isCorrect: boolean;
        pointsAwarded: number;
        totalScore: number;
        streak: number;
      };
    }) => {
      setCorrectOptionId(data.correctOptionId);
      if (data.studentFeedback) {
        setStudentResult({
          correct: data.studentFeedback.isCorrect,
          pointsAwarded: data.studentFeedback.pointsAwarded,
          totalScore: data.studentFeedback.totalScore,
          streak: data.studentFeedback.streak
        });
      }
      setView('ROUND_RESULT');
    });

    // 8. Leaderboard Update
    socket.on('game:leaderboard_update', (data: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(data.leaderboard);
      setView('LEADERBOARD');
    });

    // 9. Final Podium
    socket.on('game:final_podium', (podium: { topThree: LeaderboardEntry[]; totalParticipants: number }) => {
      setTopThree(podium.topThree);
      setView('PODIUM');
    });

    // 10. Private Personal Result
    socket.on('game:final_personal_result', (res: any) => {
      setPersonalFinalResult(res);
    });

    // Socket Errors
    socket.on('game:error', (err: { message: string; code: string }) => {
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Game operation error');
    });

    return () => {
      socket.off('connect');
      socket.off('game:participant_joined');
      socket.off('game:participant_left');
      socket.off('game:kicked');
      socket.off('game:question_started');
      socket.off('game:answer_count_updated');
      socket.off('game:answer_acknowledged');
      socket.off('game:question_ended');
      socket.off('game:leaderboard_update');
      socket.off('game:final_podium');
      socket.off('game:final_personal_result');
      socket.off('game:error');
    };
  }, []);

  // --- Student Actions ---
  const handleJoinGame = async (pin: string, nick: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      await api.lookupPin(pin);
      const socket = socketRef.current;

      socket.emit('game:join', { pin, nickname: nick }, (res: any) => {
        setIsLoading(false);
        if (res && res.success) {
          soundManager.playJoinChime();
          setGamePin(pin);
          setNickname(nick);
          setSessionId(res.sessionId);
          if (res.participantId) {
            setParticipantId(res.participantId);
          }
          setIsTeacher(false);
          setView('STUDENT_LOBBY');
        } else {
          soundManager.playWrongBuzzer();
          setErrorMessage(res?.message || 'Failed to join game');
        }
      });
    } catch (err: any) {
      setIsLoading(false);
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Game not found');
    }
  };

  const handleSubmitAnswer = (selectedOptionId: string) => {
    if (!currentQuestion) return;
    const socket = socketRef.current;

    socket.emit('game:submit_answer', {
      sessionId,
      questionId: currentQuestion.questionId,
      selectedOptionId,
      roundNonce: currentQuestion.roundNonce
    });
  };

  // --- Teacher Actions ---
  const handleLoginSuccess = (authenticatedUser: User, authToken: string) => {
    setUser(authenticatedUser);
    setToken(authToken);
    localStorage.setItem('mindpulse_token', authToken);
  };

  const handleLogout = async () => {
    try {
      await firebaseAuthService.signOutTeacher();
    } catch {
      // Ignore
    }
    setUser(null);
    setToken(null);
    localStorage.removeItem('mindpulse_token');
    setView('LANDING');
  };

  const handleHostGame = async (quizId: string) => {
    if (!token) return;
    setIsLoading(true);

    try {
      const session = await api.hostGameSession(token, quizId);
      const socket = socketRef.current;

      socket.emit('game:teacher_join', { sessionId: session.id, token }, (res: any) => {
        setIsLoading(false);
        if (res && res.success) {
          setSessionId(session.id);
          setGamePin(session.pin);
          setIsTeacher(true);
          setParticipants([]);
          setShowTeacherModal(false);
          setView('TEACHER_LOBBY');
        } else {
          setErrorMessage(res?.message || 'Failed to initialize session');
        }
      });
    } catch (err: any) {
      setIsLoading(false);
      setErrorMessage(err.message || 'Failed to host game');
    }
  };

  const handleStartGame = () => {
    soundManager.playTick();
    const socket = socketRef.current;
    socket.emit('game:start_game', { sessionId, token }, (res: any) => {
      if (res && !res.success) {
        soundManager.playWrongBuzzer();
        setErrorMessage(res.message || 'Failed to start game');
      }
    });
  };

  const handleNextQuestion = () => {
    soundManager.playTick();
    const socket = socketRef.current;
    socket.emit('game:next_question', { sessionId });
  };

  const handleShowLeaderboard = () => {
    soundManager.playTick();
    const socket = socketRef.current;
    socket.emit('game:show_leaderboard', { sessionId });
  };

  const handleKickParticipant = (participantId: string) => {
    const socket = socketRef.current;
    socket.emit('game:kick_participant', { sessionId, participantId });
  };

  const handleReturnHome = () => {
    soundManager.playTick();
    setView('LANDING');
    setSessionId('');
    setGamePin('');
    setNickname('');
    setParticipantId('');
    setCurrentQuestion(null);
    setStudentResult(null);
    setPersonalFinalResult(null);
    setParticipants([]);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'hidden' }}>
      {/* Strategic Chess Atmospheric Background */}
      <ChessAtmosphere />

      <Navbar
        user={user}
        onLogout={handleLogout}
        onOpenTeacherPortal={() => setShowTeacherModal(true)}
        onHomeClick={handleReturnHome}
      />

      <main style={{ flex: 1, position: 'relative', zIndex: 10 }}>
        {view === 'LANDING' && (
          <LandingScreen
            onJoinGame={handleJoinGame}
            onOpenTeacherPortal={() => setShowTeacherModal(true)}
            isLoading={isLoading}
            errorMessage={errorMessage}
          />
        )}

        {view === 'STUDENT_LOBBY' && (
          <StudentLobby nickname={nickname} pin={gamePin} />
        )}

        {view === 'TEACHER_LOBBY' && (
          <HostLobby
            pin={gamePin}
            sessionId={sessionId}
            participants={participants}
            onStartGame={handleStartGame}
            onKickParticipant={handleKickParticipant}
            onCancelGame={handleReturnHome}
          />
        )}

        {view === 'QUESTION' && currentQuestion && (
          <ActiveQuestionView
            question={currentQuestion}
            isTeacher={isTeacher}
            totalAnswers={totalAnswers}
            totalParticipants={isTeacher ? participants.length : totalAnswers}
            onSubmitAnswer={handleSubmitAnswer}
          />
        )}

        {view === 'ROUND_RESULT' && currentQuestion && (
          <RoundResultView
            correctOptionId={correctOptionId}
            options={currentQuestion.options}
            isTeacher={isTeacher}
            studentResult={studentResult}
            onShowLeaderboard={handleShowLeaderboard}
          />
        )}

        {view === 'LEADERBOARD' && (
          <LeaderboardView
            leaderboard={leaderboard}
            isTeacher={isTeacher}
            onNextQuestion={handleNextQuestion}
          />
        )}

        {view === 'PODIUM' && (
          <PodiumView
            topThree={topThree}
            personalResult={personalFinalResult}
            onHomeClick={handleReturnHome}
          />
        )}

        {/* Teacher Portal Modal */}
        {showTeacherModal && (
          <TeacherPortal
            user={user}
            token={token}
            onLoginSuccess={handleLoginSuccess}
            onHostGame={handleHostGame}
            onClose={() => setShowTeacherModal(false)}
          />
        )}
      </main>

      {/* Official Enterprise Competition Day Footer */}
      <Footer />

      {/* Strategic Chess Loading Modal */}
      {isLoading && <ChessLoader />}
    </div>
  );
};

export default App;
