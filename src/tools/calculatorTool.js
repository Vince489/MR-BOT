// calculator_tool.js

import * as math from 'mathjs';
import { createTool } from './toolFactory.js';

let memory = 0;
let previousResult = 0;

console.log('🧮 [CALCULATOR TOOL] Initialized');

function normalizeExpression(expression) {
  let processedExpression = expression.trim();

  if (processedExpression.match(/sine of (\d+(\.\d+)?) degrees/i)) {
    processedExpression = processedExpression.replace(
      /sine of (\d+(\.\d+)?) degrees/i,
      'sin($1 deg)'
    );
  }

  if (processedExpression.match(/^(calculate|compute|evaluate|what is|find|solve)\s+/i)) {
    processedExpression = processedExpression.replace(
      /^(calculate|compute|evaluate|what is|find|solve)\s+/i,
      ''
    );
  }

  const mathTerms = {
    'square root of': 'sqrt',
    'cube root of': 'cbrt',
    'log base (\\d+(\\.\\d+)?) of (\\d+(\\.\\d+)?)': (match) => `log(${match[2]}, ${match[1]})`,
    'factorial of': 'factorial',
    'percent of': '* 0.01 *',
    'to the power of': '^'
  };

  Object.entries(mathTerms).forEach(([pattern, replacement]) => {
    const regex = new RegExp(pattern, 'i');
    if (!regex.test(processedExpression)) {
      return;
    }

    if (typeof replacement === 'function') {
      processedExpression = processedExpression.replace(regex, replacement);
      return;
    }

    if (replacement === 'sqrt' || replacement === 'cbrt' || replacement === 'factorial') {
      const numberMatch = processedExpression.match(new RegExp(`${pattern}\\s*(\\d+(\\.\\d+)?)`, 'i'));
      if (numberMatch && numberMatch[1]) {
        processedExpression = processedExpression.replace(
          new RegExp(`${pattern}\\s*(\\d+(\\.\\d+)?)`, 'i'),
          `${replacement}(${numberMatch[1]})`
        );
      }
      return;
    }

    processedExpression = processedExpression.replace(regex, replacement);
  });

  const unitConversionMatch = processedExpression.match(/convert\s+([\d.]+)\s*([a-zA-Z]+)\s+to\s+([a-zA-Z]+)/i);
  if (unitConversionMatch) {
    const value = unitConversionMatch[1];
    const fromUnit = unitConversionMatch[2];
    const toUnit = unitConversionMatch[3];
    processedExpression = `${value} ${fromUnit} to ${toUnit}`;
  }

  if (processedExpression.match(/% of/i)) {
    processedExpression = processedExpression.replace(/% of/i, '* 0.01 *');
  }

  return processedExpression;
}

function formatResult(result) {
  if (math.typeOf(result) === 'Complex') {
    return result.toString();
  }

  if (math.typeOf(result) === 'BigNumber') {
    return result.toString();
  }

  if (Array.isArray(result)) {
    return JSON.stringify(result);
  }

  if (typeof result === 'object' && result !== null && typeof result.toString === 'function' && !result.isUnit) {
    return JSON.stringify(result);
  }

  if (result && typeof result.toString === 'function') {
    return result.toString();
  }

  return String(result);
}

function evaluateExpression({ expression }) {
  let processedExpression;

  try {
    if (!expression) {
      throw new Error('No expression provided. Please provide an "expression" parameter.');
    }

    const isMathExpression = /^[\d\s+\-*/^().%πe√!sin|cos|tan|log|ln|sqrt|cbrt|abs|factorial|round|convert|to\s+the\s+power\s+of|square\s+root\s+of|cube\s+root\s+of|percent\s+of|a-zA-Z\s]+$/i.test(expression);
    if (!isMathExpression && !expression.includes(' to ') && !expression.includes('km') && !expression.includes('miles') && !expression.includes('kg') && !expression.includes('lbs')) {
      throw new Error('Input is not a valid mathematical expression.');
    }

    processedExpression = normalizeExpression(expression);

    const roundingMatch = processedExpression.match(/round\s+([\d.]+)\s+to\s+(\d+)\s+decimal places/i);
    if (roundingMatch) {
      const number = parseFloat(roundingMatch[1]);
      const places = parseInt(roundingMatch[2], 10);
      const result = Math.round(number * Math.pow(10, places)) / Math.pow(10, places);
      previousResult = result;
      return result.toString();
    }

    let result = math.evaluate(processedExpression);
    previousResult = result;

    if (
      typeof result === 'number' &&
      (processedExpression.includes('sin') ||
        processedExpression.includes('cos') ||
        processedExpression.includes('tan') ||
        expression.trim().includes('sine of'))
    ) {
      const roundedResult = Math.round(result * 1e10) / 1e10;
      if (Math.abs(roundedResult - 0.5) < 1e-10) result = 0.5;
      else if (Math.abs(roundedResult - 1) < 1e-10) result = 1;
      else if (Math.abs(roundedResult - 0) < 1e-10) result = 0;
      else result = roundedResult;
    }

    return formatResult(result);
  } catch (error) {
    console.error(`❌ Calculator tool error: ${error.message} for expression "${expression}" (processed: "${processedExpression}")`);

    if (error.message.includes('Undefined symbol')) {
      const symbolMatch = error.message.match(/Undefined symbol\s+(\w+)/);
      const symbol = symbolMatch ? symbolMatch[1] : 'unknown';
      return `Error: '${symbol}' is not recognized. Did you mean to use a supported function like sin(), cos(), sqrt()?`;
    }

    if (error.message.includes('Unexpected token')) {
      return 'Error: Your expression has syntax errors. Please check for missing parentheses or operators.';
    }

    return `Calculator error: ${error.message}`;
  }
}

function storeMemory() {
  memory = previousResult;
  console.log(`💾 Memory store operation: ${memory}`);
  return `Value ${memory} stored in memory`;
}

function recallMemory() {
  console.log(`💾 Memory recall operation: ${memory}`);
  return memory.toString();
}

function clearMemory() {
  memory = 0;
  console.log('💾 Memory cleared');
  return 'Memory cleared';
}

export const calculatorTool = createTool({
  name: 'calculatorTool',
  description: 'Evaluates mathematical expressions using mathjs. Supports arithmetic, trigonometry, logarithms, unit conversions, rounding, and calculator memory operations.',
  properties: {
    action: {
      type: 'string',
      description: 'The specific calculator operation to perform.',
      enum: ['evaluateExpression', 'storeMemory', 'recallMemory', 'clearMemory']
    },
    expression: {
      type: 'string',
      description: 'The mathematical expression to evaluate for the evaluateExpression action.'
    }
  },
  required: ['action'],
  handler: async ({ action, expression }) => {
    switch (action) {
      case 'evaluateExpression':
        if (!expression) {
          throw new Error("evaluateExpression requires an 'expression' parameter.");
        }
        return evaluateExpression({ expression });
      case 'storeMemory':
        return storeMemory();
      case 'recallMemory':
        return recallMemory();
      case 'clearMemory':
        return clearMemory();
      default:
        throw new Error(`Unknown action '${action}'. Please use one of the defined actions.`);
    }
  }
});
