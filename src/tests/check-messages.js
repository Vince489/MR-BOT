// check-messages.js
// Check if there are actual messages in the database
// This will show raw messages from MongoDB

import { mongoDBConnection } from '../storage/MongoDBConnection.js';
import Message from '../models/Message.js';
import Session from '../models/Session.js';

/**
 * Check Messages - Shows raw messages from database
 */
export class CheckMessages {
  constructor() {
    this.connected = false;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      await mongoDBConnection.connect();
      console.log('✅ Connected to MongoDB');
      this.connected = true;
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      return false;
    }
  }

  /**
   * Show recent messages
   */
  async showRecentMessages(limit = 20) {
    console.log(`\n📋 SHOWING RECENT MESSAGES (limit: ${limit})`);
    console.log('=' .repeat(60));

    try {
      const messages = await Message.find({})
        .sort({ createdAt: -1 })
        .limit(limit);

      console.log(`Found ${messages.length} messages in database:\n`);

      if (messages.length === 0) {
        console.log('No messages found in the database.');
        return;
      }

      messages.forEach((msg, index) => {
        console.log(`${index + 1}. [${msg.role.toUpperCase()}] ${new Date(msg.createdAt).toLocaleString()}`);
        console.log(`   Session: ${msg.session}`);
        console.log(`   Message: ${msg.content}`);
        console.log('-'.repeat(40));
      });

    } catch (error) {
      console.error(`❌ Error fetching messages: ${error.message}`);
    }
  }

  /**
   * Show sessions
   */
  async showSessions() {
    console.log('\n📚 SHOWING SESSIONS');
    console.log('=' .repeat(40));

    try {
      const sessions = await Session.find({})
        .sort({ lastActivity: -1 })
        .limit(10);

      console.log(`Found ${sessions.length} sessions:\n`);

      sessions.forEach((session, index) => {
        console.log(`${index + 1}. ${session.sessionId}`);
        console.log(`   Topic: "${session.topic}"`);
        console.log(`   Summary: ${session.summary || 'No summary'}`);
        console.log(`   Last Activity: ${new Date(session.lastActivity).toLocaleString()}`);
        console.log('-'.repeat(30));
      });

    } catch (error) {
      console.error(`❌ Error fetching sessions: ${error.message}`);
    }
  }

  /**
   * Run checks
   */
  async runChecks() {
    console.log('🔍 CHECKING MESSAGES IN DATABASE');
    console.log('=' .repeat(60));

    const connected = await this.connect();
    if (!connected) {
      console.log('Cannot check messages without database connection.');
      return;
    }

    await this.showSessions();
    await this.showRecentMessages(10);

    console.log('\n🎯 CHECK COMPLETED');
    console.log('=' .repeat(60));
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new CheckMessages();
  checker.runChecks().catch(console.error);
}

export default CheckMessages;