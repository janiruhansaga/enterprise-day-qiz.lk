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
import {
  subscribeToSessionState,
  subscribeToKicked,
  subscribeToParticipants,
  type PublicSessionState
} from './services/gameRealtime';
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

interface PlayerSession {
  token: string;
  participantId: string;
  sessionId: string;
  pin: string;
  nickname: string;
}

const PLAYER_SESSION_KEY = 'mindpulse_player_session';

function savePlayerSession(data: PlayerSession) {
  sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(data));
}

function clearPlayerSession() {
  sessionStorage.removeItem(PLAYER_SESSION_KEY);
}

function loadPlayerSession(): PlayerSession | null {
  try {
    const raw = sessionStorage.getItem(PLAYER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerSession;
    if (parsed && parsed.token && parsed.participantId && parsed.sessionId) return parsed;
    return null;
  } catch {
    return null;
  }
}

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
  const [participantToken, setParticipantToken] = useState<string>('');
  const [participants, setParticipants] = useState<{ id: string; nickname: string }[]>([]);

  // Active Game state
  const [currentQuestion, setCurrentQuestion] = useState<QuestionPayload | null>(null);
  const [totalAnswers, setTotalAnswers] = useState<number>(0);
  const [totalParticipants, setTotalParticipants] = useState<number>(0);
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

  const lastAnswerRef = useRef<{
    roundNonce: string;
    correct: boolean;
    pointsAwarded: number;
    totalScore: number;
    streak: number;
  } | null>(null);
  const finishRoundInFlightRef = useRef<boolean>(false);

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

  // Restore an in-progress student session after a page refresh
  useEffect(() => {
    const saved = loadPlayerSession();
    if (!saved) return;

    setSessionId(saved.sessionId);
    setGamePin(saved.pin);
    setNickname(saved.nickname);
    setParticipantId(saved.participantId);
    setParticipantToken(saved.token);
    setIsTeacher(false);
    setView('STUDENT_LOBBY');
  }, []);

  // Subscribe to the server-published public state document (drives all screen transitions)
  useEffect(() => {
    if (!sessionId) return;

    let polling: number | undefined;

    const applyState = (state: PublicSessionState) => {
      if (!state || !state.status) return;

      switch (state.status) {
        case 'LOBBY':
          setView(isTeacher ? 'TEACHER_LOBBY' : 'STUDENT_LOBBY');
          break;

        case 'QUESTION_ACTIVE': {
          soundManager.playTick();
          const normalizedQuestion: QuestionPayload = {
            questionId: state.currentQuestionId || '',
            questionIndex: state.currentQuestionIndex ?? 0,
            totalQuestions: state.totalQuestions ?? 1,
            prompt: state.prompt || '',
            durationSec: state.timeLimitSec ?? 20,
            serverStartTime: state.serverStartTime || Date.now(),
            roundNonce: state.roundNonce || '',
            options: (state.options || []).map((opt) => ({
              id: opt.id,
              optionText: opt.optionText || opt.option_text || ''
            }))
          };
          lastAnswerRef.current = null;
          setCurrentQuestion(normalizedQuestion);
          setTotalAnswers(state.answersCount ?? 0);
          setTotalParticipants(state.totalParticipants ?? 0);
          setCorrectOptionId('');
          setStudentResult(null);
          setView('QUESTION');
          break;
        }

        case 'QUESTION_RESULTS':
          setCorrectOptionId(state.revealedCorrectOptionId || '');
          if (
            lastAnswerRef.current &&
            state.roundNonce &&
            lastAnswerRef.current.roundNonce === state.roundNonce
          ) {
            setStudentResult({
              correct: lastAnswerRef.current.correct,
              pointsAwarded: lastAnswerRef.current.pointsAwarded,
              totalScore: lastAnswerRef.current.totalScore,
              streak: lastAnswerRef.current.streak
            });
          } else {
            setStudentResult(null);
          }
          setView('ROUND_RESULT');
          break;

        case 'LEADERBOARD':
          setLeaderboard(
            (state.leaderboard || []).map((entry) => ({
              rank: entry.rank,
              nickname: entry.nickname,
              score: entry.score,
              streak: entry.streak
            }))
          );
          setView('LEADERBOARD');
          break;

        case 'FINISHED':
          setTopThree(
            (state.podium?.topThree || []).map((entry) => ({
              rank: entry.rank,
              nickname: entry.nickname,
              score: entry.score,
              streak: entry.streak
            }))
          );
          setView('PODIUM');
          if (participantToken && !isTeacher) {
            api
              .getPodium(participantToken, sessionId)
              .then((res) => {
                if (res && res.personalResult) {
                  setPersonalFinalResult({
                    rank: res.personalResult.rank,
                    totalScore: res.personalResult.totalScore,
                    streak: res.personalResult.streak,
                    totalParticipants: res.podium?.totalParticipants || totalParticipants
                  });
                }
              })
              .catch(() => {});
          }
          break;

        default:
          break;
      }
    };

    const stop = subscribeToSessionState(
      sessionId,
      applyState,
      () => {
        // Firestore unavailable or rules not yet deployed: poll the sanitized REST state as fallback
        polling = window.setInterval(() => {
          api
            .getGameState(sessionId)
            .then((state) => applyState(state))
            .catch(() => {});
        }, 1500);
      }
    );

    return () => {
      if (polling) window.clearInterval(polling);
      stop();
    };
  }, [sessionId, isTeacher, participantToken, totalParticipants]);

  // Teacher roster: subscribe to the participants subcollection (host-only via Firestore rules)
  useEffect(() => {
    if (!sessionId || !isTeacher) return;
    const stop = subscribeToParticipants(sessionId, (list) => {
      setParticipants(list.map((p) => ({ id: p.id, nickname: p.nickname })));
    });
    return stop;
  }, [sessionId, isTeacher]);

  // Student kicked marker: subscribe to own kicked document
  useEffect(() => {
    if (!sessionId || !participantId || isTeacher) return;
    const stop = subscribeToKicked(sessionId, participantId, () => {
      soundManager.playWrongBuzzer();
      setView('LANDING');
      setErrorMessage('You have been removed from the session by the host.');
      clearPlayerSession();
    });
    return stop;
  }, [sessionId, participantId, isTeacher]);

  // --- Student Actions ---
  const handleJoinGame = async (pin: string, nick: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.joinGame(pin, nick);
      soundManager.playJoinChime();
      setGamePin(pin);
      setNickname(nick);
      setSessionId(res.sessionId);
      setParticipantId(res.participantId);
      setParticipantToken(res.token);
      setIsTeacher(false);
      setParticipants([]);
      savePlayerSession({
        token: res.token,
        participantId: res.participantId,
        sessionId: res.sessionId,
        pin,
        nickname: nick
      });
      setView('STUDENT_LOBBY');
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Failed to join game');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAnswer = async (selectedOptionId: string) => {
    if (!currentQuestion || !participantToken) return;

    try {
      const res = await api.submitAnswer(participantToken, {
        sessionId,
        questionId: currentQuestion.questionId,
        selectedOptionId,
        roundNonce: currentQuestion.roundNonce
      });
      lastAnswerRef.current = {
        roundNonce: currentQuestion.roundNonce,
        correct: !!res.isCorrect,
        pointsAwarded: res.pointsAwarded ?? 0,
        totalScore: res.totalScore ?? 0,
        streak: res.streakCount ?? 0
      };
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Failed to submit answer');
    }
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
      setSessionId(session.id);
      setGamePin(session.pin);
      setIsTeacher(true);
      setParticipants([]);
      setShowTeacherModal(false);
      setView('TEACHER_LOBBY');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to host game');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartGame = async () => {
    if (!token || !sessionId) return;
    soundManager.playTick();
    try {
      await api.startGame(token, sessionId);
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Failed to start game');
    }
  };

  const handleFinishRound = async () => {
    if (!token || !sessionId || finishRoundInFlightRef.current) return;
    finishRoundInFlightRef.current = true;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          await api.finishRound(token, sessionId);
          return;
        } catch (err: any) {
          const isTooEarly = err?.message && /still in progress/i.test(err.message);
          if (isTooEarly && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          soundManager.playWrongBuzzer();
          setErrorMessage(err.message || 'Failed to finish round');
          return;
        }
      }
    } finally {
      finishRoundInFlightRef.current = false;
    }
  };

  const handleNextQuestion = async () => {
    if (!token || !sessionId) return;
    soundManager.playTick();
    try {
      await api.nextQuestion(token, sessionId);
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Failed to advance question');
    }
  };

  const handleShowLeaderboard = async () => {
    if (!token || !sessionId) return;
    soundManager.playTick();
    try {
      await api.showLeaderboard(token, sessionId);
    } catch (err: any) {
      soundManager.playWrongBuzzer();
      setErrorMessage(err.message || 'Failed to show leaderboard');
    }
  };

  const handleKickParticipant = async (kickedId: string) => {
    if (!token || !sessionId) return;
    try {
      await api.kickParticipant(token, sessionId, kickedId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to kick participant');
    }
  };

  const handleReturnHome = () => {
    soundManager.playTick();
    setView('LANDING');
    setSessionId('');
    setGamePin('');
    setNickname('');
    setParticipantId('');
    setParticipantToken('');
    setCurrentQuestion(null);
    setStudentResult(null);
    setPersonalFinalResult(null);
    setParticipants([]);
    clearPlayerSession();
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
            totalParticipants={isTeacher ? participants.length : totalParticipants}
            onSubmitAnswer={handleSubmitAnswer}
            onTimeExpired={isTeacher ? handleFinishRound : undefined}
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