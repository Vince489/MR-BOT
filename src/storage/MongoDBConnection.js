import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * MongoDB connection manager
 */
class MongoDBConnection {
  constructor() {
    this.isConnected = false;
    this.connectionString = process.env.MONGODB_URI
    console.log('🔍 MongoDBConnection constructor - MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
    console.log('🔍 MongoDBConnection constructor - Using connection string:', this.connectionString ? 'SET' : 'NOT SET');
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    if (this.isConnected) {
      return true;
    }

    if (!this.connectionString) {
      throw new Error('MONGODB_URI environment variable is required for MongoDB storage');
    }

    try {
      await mongoose.connect(this.connectionString, {
        // Modern connection options
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      this.isConnected = true;
      console.log('✅ Connected to MongoDB successfully');
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.disconnect();
      this.isConnected = false;
      console.log('🔌 Disconnected from MongoDB');
    } catch (error) {
      console.error('Error disconnecting from MongoDB:', error.message);
    }
  }

  /**
   * Check if connected to MongoDB
   */
  isReady() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  /**
   * Get connection status
   */
  getStatus() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return {
      isConnected: this.isConnected,
      readyState: states[mongoose.connection.readyState] || 'unknown',
      connectionString: this.connectionString ? '***HIDDEN***' : 'NOT SET'
    };
  }
}

// Export singleton instance
export const mongoDBConnection = new MongoDBConnection();