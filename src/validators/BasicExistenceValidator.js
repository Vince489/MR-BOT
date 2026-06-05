/**
 * Basic Existence Validator
 *
 * Validates that an artifact exists and is not empty/null/undefined
 */
export class BasicExistenceValidator {
  /**
   * Validate that an artifact exists and is not empty
   * @param {Object} artifact The artifact to validate
   * @param {string} criteria Validation criteria
   * @returns {Promise<Object>} Validation result
   */
  async validate(artifact, criteria) {
    try {
      // Check for null or undefined
      if (artifact === null || artifact === undefined) {
        return {
          valid: false,
          message: "Artifact must exist and cannot be null or undefined"
        };
      }

      // Check for empty string
      if (typeof artifact === 'string' && artifact.trim() === '') {
        return {
          valid: false,
          message: "String artifact cannot be empty"
        };
      }

      // Check for empty object
      if (typeof artifact === 'object' && Object.keys(artifact).length === 0) {
        return {
          valid: false,
          message: "Object artifact cannot be empty"
        };
      }

      // Check for empty array
      if (Array.isArray(artifact) && artifact.length === 0) {
        return {
          valid: false,
          message: "Array artifact cannot be empty"
        };
      }

      return {
        valid: true,
        message: "Artifact exists and is not empty"
      };
    } catch (error) {
      return {
        valid: false,
        message: `Validation error: ${error.message}`
      };
    }
  }
}