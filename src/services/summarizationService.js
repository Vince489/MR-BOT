// summarizationService.js
// Enhanced summarization service with two-for-one approach and LLM-based topic extraction

import { Mistral } from "@mistralai/mistralai";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE || 'https://api.mistral.ai/v1';

if (!MISTRAL_API_KEY) {
  console.error("CRITICAL: MISTRAL_API_KEY is not set in environment variables. Summarization service will not work.");
}

let mistralClient; // Will store the Mistral client instance

try {
  if (MISTRAL_API_KEY) {
    mistralClient = new Mistral({ apiKey: MISTRAL_API_KEY });
    console.log("Mistral client initialized for summarization service.");
  } else {
    console.warn("CRITICAL: Summarization service could not be initialized due to missing MISTRAL_API_KEY.");
  }
} catch (error) {
  console.error("CRITICAL FAILURE initializing Mistral client for Summarization Service:", error);
  // mistralClient will remain undefined
}

/**
 * Two-for-One Summarization: Generate both summary and topic in single LLM call
 */
export async function generateSessionSummary(messages, sessionId = null) {
  if (!Array.isArray(messages) || messages.length === 0) {
    console.warn('generateSessionSummary: No messages provided');
    return null;
  }

  if (!mistralClient) {
    console.error("generateSessionSummary: Mistral client is not initialized.");
    throw new Error("Mistral client is not initialized. Check server startup logs for initialization errors.");
  }

  try {
    // Build conversation context
    const conversationContext = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    // Enhanced prompt for two-for-one summarization
    const summaryPrompt = `Analyze this conversation and return a JSON object with the following structure:

{
  "summary": "2-3 sentence overview of the key topics and decisions from this conversation",
  "topic": "3-5 word descriptive title that captures the main focus",
  "category": "technical|general|triage - classify the conversation type",
  "keyPoints": ["3-5 bullet points of the most important information"]
}

Conversation:
${conversationContext}

IMPORTANT: Return ONLY the JSON object, no additional text or explanation.`;

    const response = await mistralClient.chat({
      model: "mistral-small",
      messages: [
        {
          role: "user",
          content: summaryPrompt
        }
      ],
      max_tokens: 500,
      temperature: 0.3, // Lower temperature for more consistent, focused output
      response_format: {
        type: "json_object"
      }
    });

    const result = response.choices[0].message.content;
    
    // Parse the JSON response
    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (parseError) {
      console.error('Failed to parse LLM response as JSON:', result);
      throw new Error('Invalid JSON response from LLM');
    }

    // Validate required fields
    if (!parsedResult.summary || !parsedResult.topic || !parsedResult.category) {
      console.error('LLM response missing required fields:', parsedResult);
      throw new Error('LLM response missing required fields');
    }

    // Normalize category
    const validCategories = ['technical', 'general', 'triage'];
    const normalizedCategory = validCategories.includes(parsedResult.category.toLowerCase()) 
      ? parsedResult.category.toLowerCase() 
      : 'general';

    const enhancedResult = {
      summary: parsedResult.summary,
      topic: parsedResult.topic,
      category: normalizedCategory,
      keyPoints: parsedResult.keyPoints || [],
      sessionId: sessionId,
      messageCount: messages.length,
      timestamp: new Date().toISOString()
    };

    console.log(`📝 [SUMMARIZATION] Generated summary for ${sessionId || 'unknown session'}:`, {
      topic: enhancedResult.topic,
      category: enhancedResult.category,
      messageCount: enhancedResult.messageCount
    });

    return enhancedResult;

  } catch (error) {
    console.error('Error during session summarization:', error);
    throw new Error(`Failed to generate session summary: ${error.message}`);
  }
}

/**
 * Generate embedding for session summary
 */
export async function generateSessionEmbedding(summaryText) {
  if (!mistralClient) {
    console.error("generateSessionEmbedding: Mistral client is not initialized.");
    throw new Error("Mistral client is not initialized.");
  }

  if (!summaryText || typeof summaryText !== 'string') {
    throw new Error("Invalid summary text provided for embedding");
  }

  try {
    const response = await mistralClient.embeddings({
      model: "mistral-embed",
      inputs: [summaryText]
    });

    if (response && response.data && response.data.length > 0 && response.data[0].embedding) {
      return response.data[0].embedding;
    } else {
      throw new Error("Failed to generate valid embedding structure from Mistral.");
    }
  } catch (error) {
    console.error("Error during Mistral embeddings.create call:", error);
    throw new Error(`Failed to generate session embedding: ${error.message}`);
  }
}

/**
 * Enhanced session summarization with automatic embedding
 */
export async function summarizeSessionWithEmbedding(sessionId, messages) {
  try {
    // Generate enhanced summary with topic and category
    const summaryData = await generateSessionSummary(messages, sessionId);
    
    if (!summaryData) {
      console.warn(`No summary generated for session ${sessionId}`);
      return false;
    }

    // Generate embedding for the summary
    const embedding = await generateSessionEmbedding(summaryData.summary);
    
    // Update session with enhanced summary and embedding
    const Session = await import('../models/Session.js');
    await Session.default.findByIdAndUpdate(sessionId, {
      summary: summaryData.summary,
      sessionEmbedding: embedding,
      topic: summaryData.topic,
      category: summaryData.category
    });

    console.log(`✅ [SUMMARIZATION] Successfully updated session ${sessionId} with enhanced summary`);
    return true;

  } catch (error) {
    console.error(`❌ [SUMMARIZATION] Failed to summarize session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Batch session summarization for multiple sessions
 */
export async function batchSummarizeSessions(sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    console.warn('batchSummarizeSessions: No session IDs provided');
    return [];
  }

  const results = [];
  
  for (const sessionId of sessionIds) {
    try {
      const Message = await import('../models/Message.js');
      const messages = await Message.default.find({ session: sessionId })
        .sort({ createdAt: 1 })
        .limit(50);

      if (messages.length === 0) {
        console.warn(`No messages found for session ${sessionId}`);
        results.push({ sessionId, success: false, reason: 'No messages' });
        continue;
      }

      const success = await summarizeSessionWithEmbedding(sessionId, messages);
      results.push({ sessionId, success });
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`Failed to summarize session ${sessionId}:`, error);
      results.push({ sessionId, success: false, reason: error.message });
    }
  }

  return results;
}

/**
 * Summarization health check
 */
export async function checkSummarizationServiceHealth() {
  try {
    if (!mistralClient) {
      return {
        status: 'error',
        message: 'Mistral client not initialized',
        details: {
          apiKeySet: !!MISTRAL_API_KEY,
          clientInitialized: false
        }
      };
    }
    
    // Test with a simple summarization request
    const testMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ];
    
    const testResult = await generateSessionSummary(testMessages);
    const isHealthy = testResult && testResult.summary && testResult.topic;
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      message: isHealthy ? 'Summarization service is healthy' : 'Summarization service returned invalid result',
      details: {
        apiKeySet: !!MISTRAL_API_KEY,
        clientInitialized: !!mistralClient,
        testResult: isHealthy ? { summary: testResult.summary, topic: testResult.topic } : null
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Summarization service health check failed: ${error.message}`,
      details: {
        apiKeySet: !!MISTRAL_API_KEY,
        clientInitialized: !!mistralClient,
        error: error.message
      }
    };
  }
}

/**
 * Get session categorization for search optimization
 */
export function getSessionCategoryFilters() {
  return {
    technical: {
      description: 'Code, development, technical issues',
      patterns: ['function', 'class', 'api', 'database', 'debug', 'error', 'bug', 'optimization']
    },
    triage: {
      description: 'Support, troubleshooting, help requests',
      patterns: ['help', 'support', 'troubleshoot', 'how to', 'issue', 'problem', 'fix']
    },
    general: {
      description: 'General conversation, planning, discussions',
      patterns: ['plan', 'discuss', 'idea', 'thought', 'opinion', 'general']
    }
  };
}

/**
 * Auto-trigger summarization based on session activity
 */
export async function autoTriggerSummarization(sessionId, messageCount) {
  // Trigger summarization when session reaches certain milestones
  const triggerPoints = [20, 50, 100, 200]; // Message count thresholds
  
  if (triggerPoints.includes(messageCount)) {
    try {
      const Message = await import('../models/Message.js');
      const messages = await Message.default.find({ session: sessionId })
        .sort({ createdAt: 1 })
        .limit(50);

      if (messages.length > 0) {
        await summarizeSessionWithEmbedding(sessionId, messages);
        console.log(`🤖 [AUTO-SUMMARIZATION] Triggered for session ${sessionId} at ${messageCount} messages`);
      }
    } catch (error) {
      console.error(`Auto-summarization failed for session ${sessionId}:`, error);
    }
  }
}