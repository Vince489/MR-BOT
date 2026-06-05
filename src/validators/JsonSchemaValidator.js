/**
 * JSON Schema Validator
 *
 * Validates that an artifact matches a required JSON schema structure
 */
export class JsonSchemaValidator {
  /**
   * Validate an artifact against JSON schema requirements
   * @param {Object} artifact The artifact to validate
   * @param {string} criteria Validation criteria (e.g., "must include vector_id, weight, original_text")
   * @returns {Promise<Object>} Validation result
   */
  async validate(artifact, criteria) {
    try {
      // Check if artifact is an object
      if (typeof artifact !== 'object' || artifact === null) {
        return {
          valid: false,
          message: "Artifact must be a JSON object"
        };
      }

      // Parse criteria to extract required fields
      const requiredFields = this._parseCriteria(criteria);

      // Check for required fields
      const missingFields = requiredFields.filter(field => !(field in artifact));

      if (missingFields.length > 0) {
        return {
          valid: false,
          message: `Missing required fields: ${missingFields.join(', ')}`
        };
      }

      // Additional type checking for known fields
      if ('weight' in artifact && (typeof artifact.weight !== 'number' ||
                                   artifact.weight < 0 ||
                                   artifact.weight > 1)) {
        return {
          valid: false,
          message: "Weight must be a number between 0 and 1"
        };
      }

      return {
        valid: true,
        message: "Artifact matches required JSON schema"
      };
    } catch (error) {
      return {
        valid: false,
        message: `Validation error: ${error.message}`
      };
    }
  }

  /**
   * Parse validation criteria to extract required fields
   * @param {string} criteria Validation criteria string
   * @returns {Array} Array of required field names
   */
  _parseCriteria(criteria) {
    if (!criteria) return [];

    // Look for patterns like "must include X, Y, Z" or "fields: X, Y, Z"
    const fieldPatterns = [
      /must include ([a-z_, ]+)/i,
      /fields?:? ([a-z_, ]+)/i,
      /require(s)? ([a-z_, ]+)/i
    ];

    for (const pattern of fieldPatterns) {
      const match = criteria.match(pattern);
      if (match && match[1]) {
        return match[1].split(',').map(f => f.trim());
      }
    }

    // Default fields for JSON schema validation
    return ['vector_id', 'weight', 'original_text'];
  }
}