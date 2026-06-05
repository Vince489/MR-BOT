import { JsonSchemaValidator } from './JsonSchemaValidator.js';
import { RangeValidator } from './RangeValidator.js';
import { NonEmptyArrayValidator } from './NonEmptyArrayValidator.js';
import { BasicExistenceValidator } from './BasicExistenceValidator.js';

/**
 * Validator Factory
 *
 * Creates appropriate validators based on artifact type
 */
export class ValidatorFactory {
  static getValidator(artifactType) {
    switch (artifactType.toUpperCase()) {
      case 'JSON_SCHEMA':
      case 'JSON':
        return new JsonSchemaValidator();
      case 'NUMERIC_RANGE':
      case 'RANGE':
        return new RangeValidator(0, 1); // Default range 0-1 for weights
      case 'SEARCH_RESULTS':
      case 'ARRAY':
        return new NonEmptyArrayValidator();
      default:
        return new BasicExistenceValidator();
    }
  }
}