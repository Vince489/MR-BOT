/**
 * Model Limits Configuration
 * Defines token limits for different Mistral models
 */

export const MODEL_LIMITS = {
  // Your specified models
  'mistral-medium-2505': 131072,
  'mistral-medium-2508': 131072,
  'mistral-small-2506': 131072,
  'mistral-small-2603': 262144,
  
  // Additional models for reference
  'mistral-tiny': 32768,
  'mistral-small': 32768,
  'mistral-medium': 131072,
  'mistral-large': 131072,
  'open-mistral-7b': 32768,
  'open-mixtral-8x7b': 32768,
  'open-mixtral-8x22b': 65536,
  'codestral-22b': 32768,
  'codestral-mamba-24b': 256000
};

/**
 * Get the token limit for a specific model
 * @param {string} modelName - The name of the model
 * @returns {number} - The token limit for the model
 */
export function getModelLimit(modelName) {
  return MODEL_LIMITS[modelName] || 32768;
}

/**
 * Get all available models
 * @returns {Array<string>} - Array of available model names
 */
export function getAvailableModels() {
  return Object.keys(MODEL_LIMITS);
}

/**
 * Check if a model is supported
 * @param {string} modelName - The name of the model to check
 * @returns {boolean} - True if the model is supported
 */
export function isModelSupported(modelName) {
  return modelName in MODEL_LIMITS;
}