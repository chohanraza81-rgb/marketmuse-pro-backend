// src/app.ts
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();

// ✅ Trust proxy for Railway/Render deployment
app.set('trust proxy', 1);

// ✅ CORS — allow configured origin with fallback to all
app.use(cors({
  origin: env.ALLOWED_ORIGIN === '*' ? '*' : env.ALLOWED_ORIGIN.split(','),
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiter
app.use('/api', apiLimiter);

// Routes
app.use('/api', routes);

// Error handler
app.use(errorHandler);

export default app;
