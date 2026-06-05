/**
 * Non-Empty Array Validator
 *
 * Validates that an artifact is a non-empty array
 */
export class NonEmptyArrayValidator {
  /**
   * Validate that an artifact is a non-empty array
   * @param {Object} artifact The artifact to validate
   * @param {string} criteria Validation criteria
   * @returns {Promise<Object>} Validation result
   */
  async validate(artifact, criteria) {
    try {
      // Check if artifact is an array
      if (!Array.isArray(artifact)) {
        return {
          valid: false,
          message: "Artifact must be an array"
        };
      }

      // Check if array is empty
      if (artifact.length === 0) {
        return {
          valid: false,
          message: "Array must not be empty"
        };
      }

      // If criteria specifies minimum length
      if (criteria) {
        const minMatch = criteria.match(/minimum (\d+) items/i);
        if (minMatch && minMatch[1]) {
          const minItems = parseInt(minMatch[1]);
          if (artifact.length < minItems) {
            return {
              valid: false,
              message: `Array must contain at least ${minItems} items, got ${artifact.length}`
            };
          }
        }
      }

      return {
        valid: true,
        message: `Array contains ${artifact.length} items`
      };
    } catch (error) {
      return {
        valid: false,
        message: `Validation error: ${error.message}`
      };
    }
  }
}