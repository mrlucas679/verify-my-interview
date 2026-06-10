import mongoose from 'mongoose';
import * as redis from 'redis';

export interface DatabaseConnections {
  mongoClient: typeof mongoose.connection;
  redisClient: redis.RedisClientType;
}

let connections: DatabaseConnections | null = null;

export async function initializeDatabase(): Promise<DatabaseConnections> {
  if (connections) {
    return connections;
  }

  try {
    // MongoDB connection
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/verify-interview';
    await mongoose.connect(mongoUri, {
      retryWrites: true,
      w: 'majority',
    });

    console.log('✓ Connected to MongoDB');

    // Redis connection
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisClient = redis.createClient({
      url: redisUrl,
    });

    redisClient.on('error', (err) => console.log('Redis Client Error', err));
    await redisClient.connect();

    console.log('✓ Connected to Redis');

    connections = {
      mongoClient: mongoose.connection,
      redisClient,
    };

    return connections;
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  if (connections) {
    await mongoose.connection.close();
    await connections.redisClient.disconnect();
    connections = null;
    console.log('✓ Database connections closed');
  }
}

export function getConnections(): DatabaseConnections {
  if (!connections) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return connections;
}
