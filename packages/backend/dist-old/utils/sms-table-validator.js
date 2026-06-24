"use strict";
/**
 * SMS Table Name Validator for MySQL
 * Whitelist validator to prevent SQL injection in dynamic table names
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSmsTable = validateSmsTable;
exports.validateSmsTables = validateSmsTables;
exports.isValidSmsTable = isValidSmsTable;
const SMS_TABLE_PATTERN = /^SMSQ_SEND(_\d{1,3})?(_\d{4,8})?$/;
/**
 * Validates a single SMS table name against the whitelist pattern
 * @param tableName - Table name to validate
 * @returns Trimmed table name if valid
 * @throws Error with detailed message if invalid
 */
function validateSmsTable(tableName) {
    if (typeof tableName !== 'string') {
        throw new Error(`Invalid table name type: expected string, got ${typeof tableName}`);
    }
    const trimmed = tableName.trim();
    if (!SMS_TABLE_PATTERN.test(trimmed)) {
        throw new Error(`Invalid SMS table name: "${trimmed}". Expected format: SMSQ_SEND[_1-999][_4-8digits]`);
    }
    return trimmed;
}
/**
 * Validates an array of SMS table names
 * @param tableNames - Array of table names to validate
 * @returns Array of validated trimmed table names
 * @throws Error on first invalid table name
 */
function validateSmsTables(tableNames) {
    if (!Array.isArray(tableNames)) {
        throw new Error('Expected array of table names');
    }
    return tableNames.map((name, index) => {
        try {
            return validateSmsTable(name);
        }
        catch (error) {
            throw new Error(`Invalid table name at index ${index}: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
}
/**
 * Non-throwing validation check for SMS table name
 * @param tableName - Table name to validate
 * @returns True if valid, false otherwise
 */
function isValidSmsTable(tableName) {
    try {
        return typeof tableName === 'string' && SMS_TABLE_PATTERN.test(tableName.trim());
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=sms-table-validator.js.map