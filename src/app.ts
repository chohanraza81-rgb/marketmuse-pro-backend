import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();

// ✅ Trust proxy for Railway
app.set('trust proxy', 1);

// ✅ CORS — allow all origins temporarily (debug)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);
app.use('/api', routes);
app.use(errorHandler);

export default app;
