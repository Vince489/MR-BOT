/**
 * Model Limits Configuration
 * Defines token limits for different Mistral models
 */

export const modelLimits = {
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
  return modelLimits[modelName] || 32768;
}

export function getAvailableModels() {
  return Object.keys(modelLimits);
}

export function isModelSupported(modelName) {
  return modelName in modelLimits;
}
