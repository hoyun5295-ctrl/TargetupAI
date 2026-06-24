/**
 * SMS Table Name Validator for MySQL
 * Whitelist validator to prevent SQL injection in dynamic table names
 */
/**
 * Validates a single SMS table name against the whitelist pattern
 * @param tableName - Table name to validate
 * @returns Trimmed table name if valid
 * @throws Error with detailed message if invalid
 */
export declare function validateSmsTable(tableName: string): string;
/**
 * Validates an array of SMS table names
 * @param tableNames - Array of table names to validate
 * @returns Array of validated trimmed table names
 * @throws Error on first invalid table name
 */
export declare function validateSmsTables(tableNames: string[]): string[];
/**
 * Non-throwing validation check for SMS table name
 * @param tableName - Table name to validate
 * @returns True if valid, false otherwise
 */
export declare function isValidSmsTable(tableName: string): boolean;
//# sourceMappingURL=sms-table-validator.d.ts.map