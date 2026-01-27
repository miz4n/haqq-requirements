/**
 * Schema Auto-Detection
 * Mock implementation of schema auto-detection from sample data
 */

const SchemaDetector = {
  /**
   * Mock sample data for different data source types
   */
  getSampleData(sourceType) {
    const samples = {
      'sftp-csv': [
        { transaction_id: 'TXN001', amount: '100.50', currency: 'USD', status: 'COMPLETED', created_at: '2024-03-15T10:30:00Z' },
        { transaction_id: 'TXN002', amount: '250.00', currency: 'EUR', status: 'COMPLETED', created_at: '2024-03-15T10:35:00Z' },
        { transaction_id: 'TXN003', amount: '75.25', currency: 'USD', status: 'PENDING', created_at: '2024-03-15T10:40:00Z' },
        { transaction_id: 'TXN004', amount: '500.00', currency: 'GBP', status: 'COMPLETED', created_at: '2024-03-15T10:45:00Z' },
        { transaction_id: 'TXN005', amount: '1250.75', currency: 'USD', status: 'COMPLETED', created_at: '2024-03-15T10:50:00Z' }
      ],
      'api': [
        { txn_id: 'PAY001', txn_amount: 100.50, txn_currency: 'USD', txn_status: 'SUCCESS', gateway_fee: 2.50, created_at: '2024-03-15T10:30:00.000Z' },
        { txn_id: 'PAY002', txn_amount: 250.00, txn_currency: 'EUR', txn_status: 'SUCCESS', gateway_fee: 5.00, created_at: '2024-03-15T10:35:00.000Z' },
        { txn_id: 'PAY003', txn_amount: 75.25, txn_currency: 'USD', txn_status: 'PENDING', gateway_fee: 1.50, created_at: '2024-03-15T10:40:00.000Z' },
        { txn_id: 'PAY004', txn_amount: 500.00, txn_currency: 'GBP', txn_status: 'SUCCESS', gateway_fee: 10.00, created_at: '2024-03-15T10:45:00.000Z' },
        { txn_id: 'PAY005', txn_amount: 1250.75, txn_currency: 'USD', txn_status: 'SUCCESS', gateway_fee: 25.00, created_at: '2024-03-15T10:50:00.000Z' }
      ],
      'postgresql': [
        { transaction_id: 'TXN001', merchant_id: 'M001', amount: 100.50, currency: 'USD', status: 'COMPLETED', created_at: '2024-03-15 10:30:00', fee_amount: 0.00 },
        { transaction_id: 'TXN002', merchant_id: 'M002', amount: 250.00, currency: 'EUR', status: 'COMPLETED', created_at: '2024-03-15 10:35:00', fee_amount: 0.00 },
        { transaction_id: 'TXN003', merchant_id: 'M001', amount: 75.25, currency: 'USD', status: 'PENDING', created_at: '2024-03-15 10:40:00', fee_amount: 0.00 },
        { transaction_id: 'TXN004', merchant_id: 'M003', amount: 500.00, currency: 'GBP', status: 'COMPLETED', created_at: '2024-03-15 10:45:00', fee_amount: 0.00 },
        { transaction_id: 'TXN005', merchant_id: 'M002', amount: 1250.75, currency: 'USD', status: 'COMPLETED', created_at: '2024-03-15 10:50:00', fee_amount: 0.00 }
      ]
    };

    return samples[sourceType] || [];
  },

  /**
   * Detect field type from sample values
   */
  detectType(values) {
    // Remove null/undefined values
    const validValues = values.filter(v => v !== null && v !== undefined && v !== '');

    if (validValues.length === 0) return 'string';

    // Check for numbers
    const allNumbers = validValues.every(v => !isNaN(parseFloat(v)) && isFinite(v));
    if (allNumbers) {
      // Check if decimal
      const hasDecimal = validValues.some(v => String(v).includes('.'));
      return hasDecimal ? 'decimal' : 'integer';
    }

    // Check for dates/timestamps
    const datePattern = /^\d{4}-\d{2}-\d{2}/;
    const allDates = validValues.every(v => datePattern.test(String(v)));
    if (allDates) {
      const hasTime = validValues.some(v => String(v).includes('T') || String(v).includes(' '));
      return hasTime ? 'timestamp' : 'date';
    }

    // Check for boolean
    const boolValues = ['true', 'false', '1', '0', 'yes', 'no'];
    const allBools = validValues.every(v => boolValues.includes(String(v).toLowerCase()));
    if (allBools) return 'boolean';

    return 'string';
  },

  /**
   * Auto-detect schema from sample data
   */
  detectSchema(sampleData, sourceName = 'data_source') {
    if (!sampleData || sampleData.length === 0) {
      return { fields: [], source: sourceName };
    }

    const fields = [];
    const firstRow = sampleData[0];
    const columnNames = Object.keys(firstRow);

    columnNames.forEach(columnName => {
      const values = sampleData.map(row => row[columnName]);
      const detectedType = this.detectType(values);

      const field = {
        source: columnName,
        name: this.normalizeFieldName(columnName),
        type: detectedType,
        required: values.every(v => v !== null && v !== undefined && v !== ''),
        transform: null
      };

      // Add type-specific properties
      if (detectedType === 'decimal') {
        field.precision = 19;
        field.scale = 4;
      }

      // Suggest Lua transform for type conversion
      if (detectedType === 'decimal' || detectedType === 'integer') {
        field.transform = 'tonumber(value)';
      } else if (detectedType === 'timestamp') {
        field.transform = 'parse_timestamp(value)';
      } else if (detectedType === 'date') {
        field.transform = 'parse_date(value)';
      } else if (detectedType === 'boolean') {
        field.transform = 'parse_boolean(value)';
      }

      fields.push(field);
    });

    return {
      name: `${sourceName}_schema`,
      version: 1,
      fields: fields,
      sampleData: sampleData
    };
  },

  /**
   * Normalize field name (snake_case, lowercase)
   */
  normalizeFieldName(name) {
    return name
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/__+/g, '_');
  },

  /**
   * Get suggested transforms for common patterns
   */
  getSuggestedTransforms(fieldName, fieldType) {
    const suggestions = [];

    // Enum mapping for status fields
    if (fieldName.toLowerCase().includes('status')) {
      suggestions.push({
        name: 'Enum Mapping',
        code: `local v = string.upper(value or "")
if v == "SUCCESS" or v == "OK" then
  return "COMPLETED"
elseif v == "FAILED" or v == "ERROR" then
  return "REJECTED"
else
  return "UNKNOWN"
end`
      });
    }

    // Amount calculations
    if (fieldName.toLowerCase().includes('amount')) {
      suggestions.push({
        name: 'Parse with Default',
        code: `if value == nil or value == "" then
  return 0.00
end
return tonumber(value)`
      });

      suggestions.push({
        name: 'Round to 2 Decimals',
        code: `local num = tonumber(value)
return math.floor(num * 100 + 0.5) / 100`
      });
    }

    return suggestions;
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SchemaDetector;
}
