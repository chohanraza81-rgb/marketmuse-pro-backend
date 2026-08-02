import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();

app.use(cors({ origin: env.ALLOWED_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);
app.use('/api', routes);
app.use(errorHandler);

export default app;
