import mongoose from 'mongoose';
import app from './app';
import { env } from './config/env';

const cleanupDatabase = async (): Promise<void> => {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      console.warn('⚠️ Database not connected, skipping cleanup');
      return;
    }

    console.log('🧹 Starting database cleanup...');
    
    const result = await db.collection('reports').deleteMany({
      $or: [
        { type: { $nin: ['product', 'seo'] } },
        { niche: { $exists: false } },
        { data: { $exists: false } },
        { country: { $nin: ['us', 'pk', 'gb', 'ae', 'sa'] } },
        { markdown: { $exists: false } },
        { value: { $ne: '$99' } }
      ]
    });

    console.log(`✅ Cleanup complete: Deleted ${result.deletedCount} invalid reports`);
    
    // Log remaining count
    const remaining = await db.collection('reports').countDocuments();
    console.log(`📊 Remaining valid reports: ${remaining}`);
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    // Don't throw - allow server to start even if cleanup fails
  }
};

const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ MongoDB connected successfully');
    console.log(`📦 Database: ${mongoose.connection.name}`);

    // Check if cleanup is requested
    const shouldCleanup = process.env.CLEANUP_ON_START === 'true';
    
    if (shouldCleanup) {
      console.log('🔧 CLEANUP_ON_START is enabled');
      await cleanupDatabase();
      console.log('💡 You can now remove CLEANUP_ON_START from environment variables');
    }

    // Start Express server
    app.listen(env.PORT, () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
      console.log(`🌍 Environment: ${env.NODE_ENV}`);
      console.log(`🔗 API URL: http://localhost:${env.PORT}/api`);
      
      if (shouldCleanup) {
        console.log('⚠️ Remember to remove CLEANUP_ON_START=true after cleanup');
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  try {
    await mongoose.connection.close();
    console.log('📦 MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();
