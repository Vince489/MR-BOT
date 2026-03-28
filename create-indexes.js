import { mongoDBConnection } from './src/storage/MongoDBConnection.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script to create necessary MongoDB indexes for the dbsearch tool
 */

async function createIndexes() {
  console.log('🔧 Creating MongoDB indexes for dbsearch tool...\n');

  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoDBConnection.connect();
    console.log('✅ MongoDB connected successfully');

    // Get the mongoose connection
    const mongoose = await import('mongoose');
    
    // Create text index on messages.content for text search
    console.log('📝 Creating text index on messages.content...');
    await mongoose.default.connection.db.collection('messages').createIndex({ content: "text" });
    console.log('✅ Text index created successfully');

    // Create compound index for efficient time-based queries
    console.log('📝 Creating compound index for time queries...');
    await mongoose.default.connection.db.collection('messages').createIndex({ 
      session: 1, 
      createdAt: -1 
    });
    console.log('✅ Compound index created successfully');

    // Create index for session-based queries
    console.log('📝 Creating index for session queries...');
    await mongoose.default.connection.db.collection('sessions').createIndex({ 
      sessionId: 1 
    });
    console.log('✅ Session index created successfully');

    console.log('\n🎉 All indexes created successfully!');
    console.log('The dbsearch tool should now work properly with text search.');

  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Disconnect
    try {
      await mongoDBConnection.disconnect();
      console.log('🔌 Disconnected from MongoDB');
    } catch (error) {
      console.error('Error disconnecting from MongoDB:', error.message);
    }
  }
}

// Run the script
createIndexes();