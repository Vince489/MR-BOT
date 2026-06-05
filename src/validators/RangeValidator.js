/**
 * Range Validator
 *
 * Validates that a numeric value falls within a specified range
 */
export class RangeValidator {
  /**
   * Create a new RangeValidator
   * @param {number} min Minimum allowed value
   * @param {number} max Maximum allowed value
   */
  constructor(min, max) {
    this.min = min;
    this.max = max;
  }

  /**
   * Validate that a value is within the specified range
   * @param {Object} artifact The artifact to validate (should contain a numeric value)
   * @param {string} criteria Validation criteria (e.g., "must be between 0 and 1")
   * @returns {Promise<Object>} Validation result
   */
  async validate(artifact, criteria) {
    try {
      // Extract the value to validate
      let value = artifact;

      // If artifact is an object, try to get the value from common fields
      if (typeof artifact === 'object' && artifact !== null) {
        // Check for common field names that might contain the value
        const possibleFields = ['value', 'weight', 'score', 'result'];
        for (const field of possibleFields) {
          if (field in artifact) {
            value = artifact[field];
            break;
          }
        }
      }

      // Convert to number if it's a string
      if (typeof value === 'string') {
        value = parseFloat(value);
      }

      // Check if we have a valid number
      if (typeof value !== 'number' || isNaN(value)) {
        return {
          valid: false,
          message: "Value must be a number"
        };
      }

      // Check range
      if (value < this.min || value > this.max) {
        return {
          valid: false,
          message: `Value must be between ${this.min} and ${this.max}, got ${value}`
        };
      }

      return {
        valid: true,
        message: `Value ${value} is within range ${this.min}-${this.max}`
      };
    } catch (error) {
      return {
        valid: false,
        message: `Validation error: ${error.message}`
      };
    }
  }
}