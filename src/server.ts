import mongoose from 'mongoose';
import app from './app';
import { env } from './config/env';

mongoose
  .connect(env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
