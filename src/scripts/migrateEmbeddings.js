import { migrateSessionEmbeddings } from '../services/embeddingService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const sessionId = process.env.SESSION_ID;
  if (!sessionId) {
    console.error('SESSION_ID is not set in environment variables.');
    process.exit(1);
  }

  console.log(`Starting embedding migration for session: ${sessionId}`);

  const result = await migrateSessionEmbeddings(sessionId);

  if (result) {
    console.log(`Embedding migration completed successfully for session ${sessionId}`);
  } else {
    console.error(`Failed to migrate embeddings for session ${sessionId}`);
  }
}

main().catch(error => {
  console.error('Error during embedding migration:', error);
  process.exit(1);
});