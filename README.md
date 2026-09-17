# ⚡ MindPulse Arena

> **Zero-Trust Real-Time Learning Game Platform**  
> *Engineered for School Classrooms with Anti-Cheat Architecture, Authoritative Timers, and Millisecond Scoring.*

---

## 🛡️ Core Security Architecture & Zero-Trust Mandate

MindPulse Arena assumes all student clients are **untrusted**. Browser JavaScript, hidden fields, localStorage, client-side clocks, and network packets are completely isolated from game authority.

### 7 Zero-Trust Pillars
1. **Server-Authoritative Timing**: Timers run strictly on the Node.js event loop. Client-side clocks are purely visual interpolators. Submissions arriving after $t_{\text{deadline}} + 500\text{ms}$ network grace receive `DEADLINE_EXCEEDED` and 0 points.
2. **Deterministic Round Nonces**: Every question dispatch generates an ephemeral UUIDv4 nonce (`round_nonce`). Any submission with a stale or mismatched nonce is rejected with `INVALID_NONCE` (anti-replay defense).
3. **Zero Answer Leakage**: The serializer purges `is_correct`, correct option IDs, and future question prompts from all WebSocket frames (`game:question_started`). Answers are stored strictly in server memory/DB and revealed only after the round ends.
4. **Atomic Mutex & Unique Constraint Locks**: Concurrent submissions (e.g. 50 parallel requests in 5ms) are serialized via in-memory participant locks and backed by `UNIQUE (session_id, participant_id, question_id)` database constraints. Exactly **one** answer can ever be committed per student per question.
5. **Memory-Hard Authentication**: Teacher credentials use scrypt with $N=16384, r=8, p=1$ and timing-safe equality checks (`crypto.timingSafeEqual`). Dummy password verifications run on nonexistent users to eliminate account enumeration timing oracles.
6. **FERPA Data Minimization**: Public leaderboard and podium broadcasts omit student emails, account IDs, and participant UUIDs. Only `{ rank, nickname, score }` are broadcast to the classroom screen.
7. **BOLA / Anti-IDOR Defense**: All quiz authoring and game hosting queries verify ownership at the database layer (`WHERE id = ? AND teacher_id = ?`).

---

## 📁 Repository Structure

```
├── client/                     # Vite + React 19 Frontend
│   ├── src/
│   │   ├── components/         # Glassmorphic UI Components
│   │   │   ├── Navbar.tsx      # Header with Security Status & Sound Toggle
│   │   │   ├── LandingScreen.tsx # 6-digit Game PIN & Nickname Entry
│   │   │   ├── TeacherPortal.tsx # Auth & Authoritative Quiz Creator
│   │   │   ├── HostLobby.tsx   # Projector-ready Classroom Lobby
│   │   │   ├── StudentLobby.tsx # Student waiting room
│   │   │   ├── ActiveQuestionView.tsx # 4-Card Battle Screen with Countdown
│   │   │   ├── RoundResultView.tsx # Answer Reveal & Streak Multiplier
│   │   │   ├── LeaderboardView.tsx # Rising Animated Scoreboard Bars
│   │   │   └── PodiumView.tsx  # 3D Gold/Silver/Bronze Steps & Confetti
│   │   ├── services/           # Typed REST & Socket.io Services
│   │   ├── utils/              # Pure Web Audio Sound Synthesizer
│   │   └── index.css           # Vanilla CSS Design System Tokens
│   └── dist/                   # Production optimized build bundle
│
├── server/                     # Fastify & Socket.io Backend
│   ├── src/
│   │   ├── auth/               # Scrypt Hashing & JWT Crypto
│   │   ├── config/             # Security Policies & Secrets
│   │   ├── db/                 # Native Node:SQLite Database Engine
│   │   ├── engine/             # Authoritative Game, Scoring & Leaderboard Engines
│   │   ├── middleware/         # RBAC Guards & Token Bucket Rate Limiter
│   │   ├── routes/             # REST Endpoints (Auth, Quizzes, Game Sessions)
│   │   ├── security/           # Nickname Profanity & Impersonation Sanitizer
│   │   └── sockets/            # Real-Time WebSocket Game Gateway
│   └── tests/                  # 10 Test Suites (89 Automated Tests)
│       ├── auth.test.ts        # Scrypt, timing-safe equality, JWT
│       ├── database.test.ts    # SQLite cascading, unique constraints
│       ├── quiz.test.ts        # Teacher CRUD, BOLA/IDOR isolation
│       ├── game.test.ts        # 6-digit PIN generator, lobby sockets
│       ├── question_dispatch.test.ts # Zero answer leakage, timing
│       ├── scoring.test.ts     # Formula scoring, duplicate answer race
│       ├── leaderboard.test.ts # FERPA privacy, podium calculation
│       ├── rate_limit.test.ts  # Token bucket, brute force locks
│       └── penetration.test.ts # Consolidated adversary exploit suite
│
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # Production container orchestration
└── .env.example                # Environment variable configuration template
```

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Node.js**: v22.x or v24.x (Native `node:sqlite` supported)
- **npm**: v10+

### 2. Local Development

#### Start Server:
```bash
cd server
npm install
npm run dev
# Server running at http://localhost:4000
```

#### Start Client:
```bash
cd client
npm install
npm run dev
# Frontend accessible at http://localhost:5173
```

---

## 🧪 Automated Security & Penetration Testing

MindPulse Arena includes **89 automated tests** covering unit, integration, and adversary penetration scenarios:

```bash
cd server
npm test
```

### Verified Test Results:
```
▶ Phase 2: Authentication & RBAC Security Suite (17 passed)
▶ Phase 3: Database Schema & Security Rules Suite (10 passed)
▶ Phase 4: Teacher Quiz Management & Anti-IDOR Security Suite (14 passed)
▶ Phase 5: Real-Time Game Session & Lobby Security Suite (12 passed)
▶ Phase 6: Server-Authoritative Question Dispatch & Zero-Answer Leakage Suite (7 passed)
▶ Phase 7: Server-Authoritative Scoring & Anti-Cheat Suite (5 passed)
▶ Phase 8: Real-Time Leaderboard & Privacy Defense Suite (4 passed)
▶ Phase 9: Anti-Cheat Protections, Rate Limiting & Abuse Prevention Suite (5 passed)
▶ Phase 10: Consolidated Adversary Penetration & Zero-Trust Verification Suite (15 passed)

ℹ tests 89
ℹ suites 48
ℹ pass 89
ℹ fail 0
```

---

## 🐳 Production Deployment

### Option A: Docker Compose
```bash
docker-compose up -d --build
```
Access the application at `http://localhost:4000`.

### Option B: Node.js Monolith Mode
```bash
# 1. Build Client
cd client
npm ci
npm run build

# 2. Run Server (Automatically serves client/dist)
cd ../server
npm ci --omit=dev
NODE_ENV=production npm run dev
```

---

## 📜 License
Educational Zero-Trust Architecture Project. Original Code & UI Design © 2026.
