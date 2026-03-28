// show-messages-now.js
// Direct script to show messages from your MongoDB database right now
// This will connect and display actual messages

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import mongoose from 'mongoose';

/**
 * Show Messages Now - Direct database access to show messages
 */
export class ShowMessagesNow {
  constructor() {
    this.connected = false;
  }

  /**
   * Connect directly to MongoDB
   */
  async connect() {
    console.log('🔍 Connecting to MongoDB...');
    console.log(`MONGODB_URI: ${process.env.MONGODB_URI || 'NOT SET'}`);

    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI not found');
      return false;
    }

    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Connected to MongoDB');
      this.connected = true;
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error.message);
      return false;
    }
  }

  /**
   * Show all messages in the database
   */
  async showAllMessages() {
    if (!this.connected) {
      console.log('❌ Not connected to database');
      return;
    }

    console.log('\n📋 SHOWING ALL MESSAGES IN DATABASE');
    console.log('=' .repeat(60));

    try {
      // Access the messages collection directly
      const db = mongoose.connection.db;
      const messages = await db.collection('messages').find({}).sort({ createdAt: -1 }).limit(20).toArray();

      console.log(`Found ${messages.length} messages:\n`);

      if (messages.length === 0) {
        console.log('No messages found in the database.');
        return;
      }

      messages.forEach((msg, index) => {
        console.log(`${index + 1}. [${msg.role.toUpperCase()}] ${new Date(msg.createdAt).toLocaleString()}`);
        console.log(`   Session: ${msg.session}`);
        console.log(`   Message: ${msg.content}`);
        console.log('-'.repeat(50));
      });

    } catch (error) {
      console.error(`❌ Error fetching messages: ${error.message}`);
    }
  }

  /**
   * Show all sessions
   */
  async showAllSessions() {
    if (!this.connected) {
      console.log('❌ Not connected to database');
      return;
    }

    console.log('\n📚 SHOWING ALL SESSIONS');
    console.log('=' .repeat(40));

    try {
      const db = mongoose.connection.db;
      const sessions = await db.collection('sessions').find({}).sort({ lastActivity: -1 }).limit(10).toArray();

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
   * Run the show
   */
  async run() {
    console.log('🚀 SHOW MESSAGES NOW');
    console.log('=' .repeat(60));

    const connected = await this.connect();
    if (!connected) {
      console.log('Cannot show messages without database connection.');
      return;
    }

    await this.showAllSessions();
    await this.showAllMessages();

    console.log('\n🎯 SHOW COMPLETED');
    console.log('=' .repeat(60));

    // Close connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const show = new ShowMessagesNow();
  show.run().catch(console.error);
}

export default ShowMessagesNow;