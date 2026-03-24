// date_time_tool.js

import { DateTime } from 'luxon';
import * as chrono from 'chrono-node';
import countriesAndTimezones from 'countries-and-timezones';

/**
 * Gets the host machine's IANA timezone (e.g., 'America/New_York').
 */
function getHostTimezoneName() {
  // Return Eastern Time timezone for this specific application (Florida)
  return 'America/New_York';
}

/**
 * Date/Time Tool for LLM/Agent using Luxon, structured for Google Function Calling.
 */
// --- Pure Function Tool Structure ---
const hostTimezone = getHostTimezoneName();
console.log(`🕒 [DATETIME TOOL] Initialized - Timezone: ${hostTimezone}`);

/**
 * Gets the current date and time.
 */
function getCurrentDateTime({ location } = {}) {
  try {
    let tz = location || hostTimezone;
    if (location) {
      const resolvedTimezone = resolveTimezone(location);
      if (!resolvedTimezone) {
        const suggestions = getTimezoneSuggestions(location);
        return `Error: Could not resolve location '${location}' to a valid timezone. ${suggestions}`;
      }
      tz = resolvedTimezone;
    }
    const dt = DateTime.now().setZone(tz);

    // Always return human-readable format for display
    return dt.toFormat("MMMM d, yyyy, 'at' h:mm a");
  } catch (error) {
    return `Error: Invalid timezone: ${location}. Use IANA format (e.g., 'America/New_York').`;
  }
}

/**
 * Converts a date/time to a different time zone.
 */
function convertToTimeZone({ dateTimeStr, targetTimeZone }) {
  try {
    const resolvedTimezone = resolveTimezone(targetTimeZone);
    if (!resolvedTimezone) {
      const suggestions = getTimezoneSuggestions(targetTimeZone);
      return `Error: Could not resolve target timezone '${targetTimeZone}' to a valid timezone. ${suggestions}`;
    }
    const dt = DateTime.fromISO(dateTimeStr).setZone(resolvedTimezone);
    if (!dt.isValid) throw new Error(dt.invalidReason || "Invalid date/time or timezone");
    return dt.toISO({ suppressMilliseconds: false });
  } catch (error) {
    return `Error: Could not convert ${dateTimeStr} to ${targetTimeZone}. ${error.message}`;
  }
}

/**
 * Formats a date/time string.
 */
function formatDateTime({ dateTimeStr, format }) {
  try {
    const dt = DateTime.fromISO(dateTimeStr);
    if (!dt.isValid) throw new Error("Invalid date/time string");
    return dt.toFormat(format);
  } catch (error) {
    return `Error: Invalid date/time or format: ${error.message}`;
  }
}

/**
 * Calculates the difference between two date/time values.
 */
function dateTimeDifference({ startDateTimeStr, endDateTimeStr, unit = 'days' }) {
  try {
    const start = DateTime.fromISO(startDateTimeStr);
    const end = DateTime.fromISO(endDateTimeStr);
    if (!start.isValid) throw new Error(`Invalid start: ${startDateTimeStr}`);
    if (!end.isValid) throw new Error(`Invalid end: ${endDateTimeStr}`);
    
    const diff = end.diff(start, unit);
    const value = diff.get(unit);
    if (value === undefined) throw new Error(`Invalid unit: ${unit}`);
    
    return `The difference is ${value} ${unit}.`;
  } catch (error) {
    return `Error calculating difference: ${error.message}`;
  }
}

/**
 * Adds time to a date/time.
 */
function addTimeToDateTime({ dateTimeStr, amount, unit }) {
  try {
    const dt = DateTime.fromISO(dateTimeStr).plus({ [unit]: amount });
    if (!dt.isValid) throw new Error("Invalid result");
    return dt.toISO({ suppressMilliseconds: false });
  } catch (error) {
    return `Error adding time: ${error.message}`;
  }
}

/**
 * Subtracts time from a date/time.
 */
function subtractTimeFromDateTime({ dateTimeStr, amount, unit }) {
  try {
    const dt = DateTime.fromISO(dateTimeStr).minus({ [unit]: amount });
    if (!dt.isValid) throw new Error("Invalid result");
    return dt.toISO({ suppressMilliseconds: false });
  } catch (error) {
    return `Error subtracting time: ${error.message}`;
  }
}

/**
 * Extracts a property (e.g., 'year', 'weekday') from a date/time.
 */
function getDateTimeProperty({ dateTimeStr, property }) {
  try {
    const dt = DateTime.fromISO(dateTimeStr);
    if (!dt.isValid) throw new Error("Invalid date/time");

    const propertyMap = {
      'weekday': () => dt.weekdayLong,
      'weekdayShort': () => dt.weekdayShort,
      'month': () => dt.monthLong,
      'monthShort': () => dt.monthShort,
      'year': () => dt.year,
      'day': () => dt.day,
      'hour': () => dt.hour,
      'minute': () => dt.minute,
      'second': () => dt.second,
      'weekNumber': () => dt.weekNumber,
      'quarter': () => dt.quarter,
      'daysInMonth': () => dt.daysInMonth,
      'offset': () => dt.offset,
      'zoneName': () => dt.zoneName
    };

    if (propertyMap[property]) {
      return String(propertyMap[property]());
    }

    const value = dt[property];
    if (value === undefined) {
      throw new Error(`Invalid property: ${property}. Valid: ${Object.keys(propertyMap).join(', ')}`);
    }
    return String(value);
  } catch (error) {
    return `Error extracting property: ${error.message}`;
  }
}

/**
 * Resolves a timezone input to a valid IANA timezone name.
 * Handles city names, country names, UTC offsets, and common aliases.
 * @param {string} input - The timezone input to resolve (e.g., 'New York', 'UTC+5', 'EST')
 * @returns {string} - The resolved IANA timezone name, or null if resolution failed
 */
function resolveTimezone(input) {
  if (!input) return null;

  // --- 1. PREPARE MAPS ---
  const abbreviationMap = {
    'EST': 'America/New_York', 'EDT': 'America/New_York',
    'CST': 'America/Chicago', 'CDT': 'America/Chicago',
    'MST': 'America/Denver', 'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles', 'PDT': 'America/Los_Angeles',
    'CET': 'Europe/Paris', 'CEST': 'Europe/Paris',
    'GMT': 'Europe/London', 'BST': 'Europe/London',
    'IST': 'Asia/Kolkata', 'JST': 'Asia/Tokyo',
    'SGT': 'Asia/Singapore', 'KST': 'Asia/Seoul'
  };

  const countryMap = {
    'Japan': 'Asia/Tokyo', 'USA': 'America/New_York', 'United States': 'America/New_York',
    'UK': 'Europe/London', 'United Kingdom': 'Europe/London', 'France': 'Europe/Paris',
    'Germany': 'Europe/Berlin', 'China': 'Asia/Shanghai', 'India': 'Asia/Kolkata',
    'Canada': 'America/Toronto', 'Brazil': 'America/Sao_Paulo', 'Russia': 'Europe/Moscow',
    'South Korea': 'Asia/Seoul', 'Italy': 'Europe/Rome', 'Spain': 'Europe/Madrid',
    'Mexico': 'America/Mexico_City', 'Egypt': 'Africa/Cairo', 'South Africa': 'Africa/Johannesburg',
    'Argentina': 'America/Argentina/Buenos_Aires', 'Chile': 'America/Santiago',
    'New Zealand': 'Pacific/Auckland', 'Switzerland': 'Europe/Zurich', 'Netherlands': 'Europe/Amsterdam',
    'Sweden': 'Europe/Stockholm', 'Norway': 'Europe/Oslo', 'Denmark': 'Europe/Copenhagen',
    'Finland': 'Europe/Helsinki', 'Belgium': 'Europe/Brussels', 'Austria': 'Europe/Vienna',
    'Greece': 'Europe/Athens', 'Portugal': 'Europe/Lisbon', 'Ireland': 'Europe/Dublin',
    'Poland': 'Europe/Warsaw', 'Turkey': 'Europe/Istanbul', 'Thailand': 'Asia/Bangkok',
    'Malaysia': 'Asia/Kuala_Lumpur', 'Singapore': 'Asia/Singapore', 'Indonesia': 'Asia/Jakarta',
    'Philippines': 'Asia/Manila', 'Vietnam': 'Asia/Ho_Chi_Minh', 'Hong Kong': 'Asia/Hong_Kong',
    'Taiwan': 'Asia/Taipei', 'Pakistan': 'Asia/Karachi', 'Bangladesh': 'Asia/Dhaka',
    'Saudi Arabia': 'Asia/Riyadh', 'UAE': 'Asia/Dubai', 'Israel': 'Asia/Jerusalem',
    'Nigeria': 'Africa/Lagos', 'Kenya': 'Africa/Nairobi', 'Colombia': 'America/Bogota',
    'Peru': 'America/Lima', 'Venezuela': 'America/Caracas', 'Cuba': 'America/Havana',
    'Puerto Rico': 'America/Puerto_Rico', 'Greenland': 'America/Godthab', 'Iceland': 'Atlantic/Reykjavik',
    'Fiji': 'Pacific/Fiji', 'Samoa': 'Pacific/Apia', 'Hawaii': 'Pacific/Honolulu', 'Alaska': 'America/Anchorage'
  };

  const cityMap = {
    'New York': 'America/New_York', 'Los Angeles': 'America/Los_Angeles',
    'Chicago': 'America/Chicago', 'London': 'Europe/London', 'Paris': 'Europe/Paris',
    'Berlin': 'Europe/Berlin', 'Tokyo': 'Asia/Tokyo', 'Sydney': 'Australia/Sydney',
    'Toronto': 'America/Toronto', 'Moscow': 'Europe/Moscow', 'Seoul': 'Asia/Seoul',
    'Rome': 'Europe/Rome', 'Madrid': 'Europe/Madrid', 'Mexico City': 'America/Mexico_City',
    'Cairo': 'Africa/Cairo', 'Johannesburg': 'Africa/Johannesburg', 'Buenos Aires': 'America/Argentina/Buenos_Aires',
    'Santiago': 'America/Santiago', 'Auckland': 'Pacific/Auckland', 'Zurich': 'Europe/Zurich',
    'Amsterdam': 'Europe/Amsterdam', 'Stockholm': 'Europe/Stockholm', 'Oslo': 'Europe/Oslo',
    'Copenhagen': 'Europe/Copenhagen', 'Helsinki': 'Europe/Helsinki', 'Brussels': 'Europe/Brussels',
    'Vienna': 'Europe/Vienna', 'Athens': 'Europe/Athens', 'Lisbon': 'Europe/Lisbon',
    'Dublin': 'Europe/Dublin', 'Warsaw': 'Europe/Warsaw', 'Istanbul': 'Europe/Istanbul',
    'Bangkok': 'Asia/Bangkok', 'Kuala Lumpur': 'Asia/Kuala_Lumpur', 'Jakarta': 'Asia/Jakarta',
    'Manila': 'Asia/Manila', 'Ho Chi Minh City': 'Asia/Ho_Chi_Minh', 'Hong Kong': 'Asia/Hong_Kong',
    'Taipei': 'Asia/Taipei', 'Karachi': 'Asia/Karachi', 'Dhaka': 'Asia/Dhaka',
    'Riyadh': 'Asia/Riyadh', 'Dubai': 'Asia/Dubai', 'Jerusalem': 'Asia/Jerusalem',
    'Lagos': 'Africa/Lagos', 'Nairobi': 'Africa/Nairobi', 'Bogota': 'America/Bogota',
    'Lima': 'America/Lima', 'Caracas': 'America/Caracas', 'Havana': 'America/Havana',
    'San Juan': 'America/Puerto_Rico', 'Nuuk': 'America/Godthab', 'Reykjavik': 'Atlantic/Reykjavik',
    'Suva': 'Pacific/Fiji', 'Apia': 'Pacific/Apia', 'Honolulu': 'Pacific/Honolulu', 'Anchorage': 'America/Anchorage',
    'Miami': 'America/New_York', 'Miami, FL': 'America/New_York'
  };

  // --- 2. PRIORITY CHECK: Custom Mappings ---
  // Check Abbreviations first (case insensitive)
  if (abbreviationMap[input.toUpperCase()]) {
    return abbreviationMap[input.toUpperCase()];
  }

  // Check Country/City Maps (case sensitive as defined)
  if (countryMap[input]) return countryMap[input];
  if (cityMap[input]) return cityMap[input];

  // --- 3. PRIORITY CHECK: UTC Offset Regex ---
  // We do this before the Luxon check because we want to force Etc/GMT format
  const offsetMatch = input.match(/^(UTC|GMT)?([+-]\d{1,2})(:\d{2})?$/i);
  if (offsetMatch) {
    const sign = offsetMatch[2][0] === '+' ? '-' : '+'; // Invert for Etc/GMT
    const hours = offsetMatch[2].substring(1);
    return `Etc/GMT${sign}${hours}`;
  }

  // --- 4. LIBRARY CHECK: countries-and-timezones ---
  try {
    const result = countriesAndTimezones.findTimeZone(input);
    if (result && result.timezones && result.timezones.length > 0) {
      return result.timezones[0];
    }
  } catch (e) {}

  // --- 5. FALLBACK: Native Luxon Check ---
  // If it's already a perfect IANA name like "America/New_York", this catches it.
  try {
    const testDt = DateTime.now().setZone(input);
    if (testDt.isValid && testDt.zoneName !== 'local') {
      return input;
    }
  } catch (e) {}

  return null;
}

/**
 * Provides helpful suggestions for resolving timezone inputs.
 * @param {string} input - The timezone input to get suggestions for
 * @returns {string} - A helpful message with suggestions
 */
function getTimezoneSuggestions(input) {
  if (input.match(/^(UTC|GMT)?([+-]\d{1,2})(:\d{2})?$/i)) {
    return `Try using a proper UTC offset format like 'UTC+5' or 'GMT-3'.`;
  }
  return `Try using a city's IANA timezone (e.g., 'New York' → 'America/New_York', 'London' → 'Europe/London').
  Common timezones: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, Europe/London, Europe/Paris, Europe/Berlin, Asia/Tokyo, Asia/Shanghai, Australia/Sydney, UTC. You can also use UTC offsets like 'UTC+5' or 'GMT-3'.`;
}

/**
 * Converts ISO string to Unix timestamp.
 */
function toTimestamp({ dateTimeStr, unit = 'seconds' }) {
  try {
    const dt = DateTime.fromISO(dateTimeStr);
    if (!dt.isValid) throw new Error("Invalid date/time");
    return unit === 'milliseconds' || unit === 'ms' 
      ? String(dt.toMillis()) 
      : String(dt.toUnixInteger());
  } catch (error) {
    return `Error converting to timestamp: ${error.message}`;
  }
}

/**
 * Converts Unix timestamp to ISO string.
 */
function fromTimestamp({ timestamp, unit = 'seconds', timezone }) {
  try {
    let dt = unit === 'milliseconds' || unit === 'ms'
      ? DateTime.fromMillis(Number(timestamp))
      : DateTime.fromSeconds(Number(timestamp));

    if (!dt.isValid) throw new Error("Invalid timestamp");

    if (timezone) {
      const resolvedTimezone = resolveTimezone(timezone);
      if (!resolvedTimezone) {
        const suggestions = getTimezoneSuggestions(timezone);
        return `Error: Could not resolve timezone '${timezone}' to a valid timezone. ${suggestions}`;
      }
      dt = dt.setZone(resolvedTimezone);
    } else if (hostTimezone) {
      dt = dt.setZone(hostTimezone);
    }

    return dt.toISO({ suppressMilliseconds: false });
  } catch (error) {
    return `Error converting from timestamp: ${error.message}`;
  }
}

/**
 * Parses natural language date/time expressions into ISO date/time strings.
 * @param {Object} params - Parameters for parsing
 * @param {string} params.expression - Natural language expression (e.g., "yesterday", "next week")
 * @param {string} [params.timezone] - Optional timezone for the parsed date
 * @returns {string} - ISO date/time string or error message
 */
function parseNaturalLanguage({ expression, timezone }) {
  try {
    if (!expression) {
      return "Error: Natural language expression is required.";
    }

    // Resolve the timezone for parsing
    let resolvedTimezone = hostTimezone;
    if (timezone) {
      const tz = resolveTimezone(timezone);
      if (!tz) {
        const suggestions = getTimezoneSuggestions(timezone);
        return `Error: Could not resolve timezone '${timezone}' to a valid timezone. ${suggestions}`;
      }
      resolvedTimezone = tz;
    }

    // Parse the natural language expression
    const parsed = chrono.parse(expression, new Date(), { timezone: resolvedTimezone });

    if (!parsed || parsed.length === 0) {
      return `Error: Could not parse natural language expression: '${expression}'. Try expressions like "yesterday", "next week", "tomorrow at 3pm", etc.`;
    }

    // Get the first result (most likely match)
    const result = parsed[0];

    // Call the date function to get the Date object
    const dateObj = result.start.date();

    // Convert to Luxon DateTime
    let dt = DateTime.fromJSDate(dateObj);

    // Apply timezone if specified
    if (timezone) {
      const tz = resolveTimezone(timezone);
      if (!tz) {
        const suggestions = getTimezoneSuggestions(timezone);
        return `Error: Could not resolve timezone '${timezone}' to a valid timezone. ${suggestions}`;
      }
      dt = dt.setZone(tz);
    } else if (hostTimezone) {
      dt = dt.setZone(hostTimezone);
    }

    return dt.toISO({ suppressMilliseconds: false });
  } catch (error) {
    return `Error parsing natural language expression: ${error.message}`;
  }
}

/**
 * Converts UTC timestamp to local timezone for display
 * @param {Object} params - Parameters for conversion
 * @param {string} params.utcTimestamp - UTC timestamp in ISO format
 * @param {string} [params.targetTimezone] - Target timezone (defaults to host timezone)
 * @param {string} [params.format] - Output format (defaults to human-readable)
 * @returns {string} - Formatted local time string
 */
function convertUTCToLocal({ utcTimestamp, targetTimezone, format = "MMMM d, yyyy, 'at' h:mm a" }) {
  try {
    if (!utcTimestamp) {
      return "Error: UTC timestamp is required.";
    }

    // Parse the UTC timestamp
    let dt = DateTime.fromISO(utcTimestamp, { zone: 'utc' });
    
    if (!dt.isValid) {
      return `Error: Invalid UTC timestamp format: ${utcTimestamp}`;
    }

    // Determine target timezone
    let targetTz = targetTimezone || hostTimezone;
    if (targetTimezone) {
      const resolvedTimezone = resolveTimezone(targetTimezone);
      if (!resolvedTimezone) {
        const suggestions = getTimezoneSuggestions(targetTimezone);
        return `Error: Could not resolve timezone '${targetTimezone}' to a valid timezone. ${suggestions}`;
      }
      targetTz = resolvedTimezone;
    }

    // Convert to target timezone
    dt = dt.setZone(targetTz);

    // Format the result
    return dt.toFormat(format);
  } catch (error) {
    return `Error converting UTC to local time: ${error.message}`;
  }
}


// Optimized tool definition for Mistral SDK
export const dateTimeTool = {
  type: "function",
  function: {
    name: 'datetime_tool',
    description: 'Provides current date and time using the host timezone, and can perform date/time calculations, conversions, and natural language parsing.',
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: 'The specific date/time operation to perform.',
          enum: [
            'getCurrentDateTime',
            'convertToTimeZone',
            'formatDateTime',
            'dateTimeDifference',
            'addTimeToDateTime',
            'subtractTimeFromDateTime',
            'getDateTimeProperty',
            'toTimestamp',
            'fromTimestamp',
            'parseNaturalLanguage',
            'convertUTCToLocal'
          ]
        },
        location: {
          type: "string",
          description: "OPTIONAL. The location for getCurrentDateTime. Can be an IANA timezone (e.g., 'America/New_York'), city name (e.g., 'New York'), country name (e.g., 'Japan'), or UTC offset (e.g., 'UTC+5'). If omitted, the user's auto-detected timezone will be used."
        },
        dateTimeStr: {
          type: "string",
          description: 'The date/time string in ISO format for conversion, formatting, difference, add, or subtract operations.'
        },
        targetTimeZone: {
          type: "string",
          description: "The target time zone for convertToTimeZone. Can be an IANA timezone (e.g., 'Europe/London'), city name (e.g., 'London'), country name (e.g., 'France'), or UTC offset (e.g., 'UTC+2')."
        },
        format: {
          type: "string",
          description: "The Luxon format string for formatDateTime (e.g., 'yyyy-MM-dd HH:mm:ss')."
        },
        startDateTimeStr: {
          type: "string",
          description: 'The starting date/time string in ISO format for dateTimeDifference.'
        },
        endDateTimeStr: {
          type: "string",
          description: 'The ending date/time string in ISO format for dateTimeDifference.'
        },
        unit: {
          type: "string",
          description: "Time unit. For dateTimeDifference/add/subtract: 'years', 'months', etc. For timestamps: 'seconds' or 'milliseconds'.",
          enum: ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds', 'ms']
        },
        amount: {
          type: "number",
          description: 'The numerical amount of time for addTimeToDateTime or subtractTimeFromDateTime.'
        },
        property: {
          type: "string",
          description: "The date/time property to extract for getDateTimeProperty (e.g., 'weekday', 'year', 'zoneName')."
        },
        timestamp: {
          type: "number",
          description: "Unix timestamp (seconds or milliseconds since Jan 1, 1970 UTC) for fromTimestamp action."
        },
        expression: {
          type: "string",
          description: "Natural language date/time expression (e.g., 'yesterday', 'next week', 'tomorrow at 3pm') for parseNaturalLanguage action."
        }
      },
      required: ['action']
    }
  },
  handler: async (params) => {
    console.log(`🕒 [DATETIME TOOL] Executing datetime_tool with params:`, params);

    // Extract task_progress if present
    const { task_progress, ...restParams } = params;
    const { action, ...actionParams } = restParams;

    try {
      switch (action) {
        case 'getCurrentDateTime':
          return getCurrentDateTime(actionParams);
        case 'convertToTimeZone':
          // Validate required parameters for this action
          if (!actionParams.dateTimeStr || !actionParams.targetTimeZone) {
            return "Error: convertToTimeZone requires 'dateTimeStr' and 'targetTimeZone' parameters.";
          }
          return convertToTimeZone(actionParams);
        case 'formatDateTime':
          if (!actionParams.dateTimeStr || !actionParams.format) {
            return "Error: formatDateTime requires 'dateTimeStr' and 'format' parameters.";
          }
          return formatDateTime(actionParams);
        case 'dateTimeDifference':
          if (!actionParams.startDateTimeStr || !actionParams.endDateTimeStr) {
            return "Error: dateTimeDifference requires 'startDateTimeStr' and 'endDateTimeStr' parameters.";
          }
          return dateTimeDifference(actionParams);
        case 'addTimeToDateTime':
          if (!actionParams.dateTimeStr || actionParams.amount === undefined || !actionParams.unit) {
            return "Error: addTimeToDateTime requires 'dateTimeStr', 'amount', and 'unit' parameters.";
          }
          return addTimeToDateTime(actionParams);
        case 'subtractTimeFromDateTime':
          if (!actionParams.dateTimeStr || actionParams.amount === undefined || !actionParams.unit) {
            return "Error: subtractTimeFromDateTime requires 'dateTimeStr', 'amount', and 'unit' parameters.";
          }
          return subtractTimeFromDateTime(actionParams);
        case 'getDateTimeProperty':
          if (!actionParams.dateTimeStr || !actionParams.property) {
            return "Error: getDateTimeProperty requires 'dateTimeStr' and 'property' parameters.";
          }
          return getDateTimeProperty(actionParams);
        case 'toTimestamp':
          if (!actionParams.dateTimeStr) {
            return "Error: toTimestamp requires 'dateTimeStr' parameter.";
          }
          return toTimestamp(actionParams);
        case 'fromTimestamp':
          if (actionParams.timestamp === undefined) {
            return "Error: fromTimestamp requires 'timestamp' parameter.";
          }
          return fromTimestamp(actionParams);
        case 'parseNaturalLanguage':
          if (!actionParams.expression) {
            return "Error: parseNaturalLanguage requires 'expression' parameter.";
          }
          return parseNaturalLanguage(actionParams);
        case 'convertUTCToLocal':
          if (!actionParams.utcTimestamp) {
            return "Error: convertUTCToLocal requires 'utcTimestamp' parameter.";
          }
          return convertUTCToLocal(actionParams);
        default:
          return `Error: Unknown action '${action}'. Please use one of the defined actions.`;
      }
    } catch (error) {
      console.error(`🕒 [DATETIME TOOL] Unexpected error during execution:`, error);
      return `An unexpected error occurred in the datetime tool: ${error.message}`;
    }
  }
};
