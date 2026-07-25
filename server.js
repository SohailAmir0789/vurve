require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const healthRouter = require('./src/routes/health');
const authRouter   = require('./src/routes/auth');
const videosRouter = require('./src/routes/videos');
const usersRouter  = require('./src/routes/users');
const feedRouter   = require('./src/routes/feed');
const errorHandler = require('./src/middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security & Utility Middleware ────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
// Read allowed origins from env variable, comma-separated, fallback to local hostnames
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-amz-*'],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/', healthRouter);
app.use('/auth',   authRouter);
app.use('/videos', videosRouter);
app.use('/users',  usersRouter);
app.use('/feed',   feedRouter);

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Central Error Handler (must be last) ─────────────────────────────────────
app.use(errorHandler);

// ── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] Vurve API running on port ${PORT}`);

  // Integrate background processing worker
  try {
    const { startInternalWorker } = require('./worker/videoProcessorMerged');
    startInternalWorker();
  } catch (err) {
    console.error('[server] Failed to initialize integrated video processing worker:', err);
  }
});

