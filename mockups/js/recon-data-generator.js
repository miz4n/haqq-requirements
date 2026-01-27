/**
 * Mock Data Generator for Reconciliation
 * Generates realistic reconciliation data for testing and demonstration
 */

const ReconDataGenerator = {
  // Default configuration
  config: {
    matchRate: 0.95,        // 95% of records will match
    rulePassRate: 0.90,     // 90% of rules will pass
    recordCount: 1000,      // Default record count for full mode
    previewCount: 100       // Record count for preview mode
  },

  // Sample data for generating realistic values
  sampleData: {
    currencies: ['USD', 'EUR', 'GBP', 'JPY', 'CAD'],
    statuses: ['COMPLETED', 'PENDING', 'PROCESSING', 'FAILED', 'SETTLED'],
    paymentMethods: ['CARD', 'BANK_TRANSFER', 'WALLET', 'CRYPTO'],
    merchants: ['ACME Corp', 'Widget Inc', 'TechStore', 'GlobalShop', 'PayServices'],
    regions: ['NA', 'EU', 'APAC', 'LATAM', 'MEA']
  },

  /**
   * Generate mock records for a datasource based on schema
   * @param {Object} schema - Field definitions
   * @param {number} count - Number of records to generate
   * @param {Object} datetimeRange - { start, end } datetime range
   * @returns {Array} Generated records
   */
  generateRecords(schema, count, datetimeRange) {
    const records = [];
    const fields = schema?.fields || this.getDefaultFields();

    for (let i = 0; i < count; i++) {
      const record = {};
      fields.forEach(field => {
        record[field.name] = this.generateFieldValue(field, i, datetimeRange);
      });
      records.push(record);
    }

    return records;
  },

  /**
   * Get default fields if no schema is provided
   */
  getDefaultFields() {
    return [
      { name: 'transaction_id', type: 'string' },
      { name: 'amount', type: 'decimal' },
      { name: 'currency', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'timestamp', type: 'timestamp' },
      { name: 'reference', type: 'string' }
    ];
  },

  /**
   * Generate a value for a specific field type
   */
  generateFieldValue(field, index, datetimeRange) {
    const type = field.type?.toLowerCase() || 'string';

    switch (type) {
      case 'string':
        return this.generateStringValue(field.name, index);
      case 'int':
      case 'integer':
        return this.generateIntValue(field.name, index);
      case 'decimal':
      case 'number':
      case 'float':
        return this.generateDecimalValue(field.name, index);
      case 'date':
      case 'timestamp':
        return this.generateTimestampValue(datetimeRange, index);
      case 'boolean':
        return Math.random() > 0.2;
      default:
        return this.generateStringValue(field.name, index);
    }
  },

  /**
   * Generate string value based on field name
   */
  generateStringValue(fieldName, index) {
    const name = fieldName.toLowerCase();

    if (name.includes('transaction') || name.includes('txn') || name.includes('id')) {
      return `TXN${String(index + 1).padStart(8, '0')}`;
    }
    if (name.includes('currency')) {
      return this.randomPick(this.sampleData.currencies);
    }
    if (name.includes('status')) {
      return this.randomPick(this.sampleData.statuses);
    }
    if (name.includes('method') || name.includes('payment_type')) {
      return this.randomPick(this.sampleData.paymentMethods);
    }
    if (name.includes('merchant')) {
      return this.randomPick(this.sampleData.merchants);
    }
    if (name.includes('region')) {
      return this.randomPick(this.sampleData.regions);
    }
    if (name.includes('reference') || name.includes('ref')) {
      return `REF${String(index + 1).padStart(6, '0')}`;
    }
    if (name.includes('description') || name.includes('note')) {
      return `Transaction ${index + 1} description`;
    }

    return `value_${index + 1}`;
  },

  /**
   * Generate integer value based on field name
   */
  generateIntValue(fieldName, index) {
    const name = fieldName.toLowerCase();

    if (name.includes('count') || name.includes('quantity')) {
      return Math.floor(Math.random() * 100) + 1;
    }
    if (name.includes('year')) {
      return 2024;
    }
    if (name.includes('month')) {
      return Math.floor(Math.random() * 12) + 1;
    }
    if (name.includes('day')) {
      return Math.floor(Math.random() * 28) + 1;
    }

    return index + 1;
  },

  /**
   * Generate decimal value based on field name
   */
  generateDecimalValue(fieldName, index) {
    const name = fieldName.toLowerCase();

    if (name.includes('amount') || name.includes('total') || name.includes('price')) {
      // Generate realistic amounts between 10 and 10000
      return Math.round((Math.random() * 9990 + 10) * 100) / 100;
    }
    if (name.includes('rate') || name.includes('percent')) {
      return Math.round(Math.random() * 100 * 100) / 100;
    }
    if (name.includes('fee') || name.includes('commission')) {
      return Math.round(Math.random() * 50 * 100) / 100;
    }

    return Math.round(Math.random() * 1000 * 100) / 100;
  },

  /**
   * Generate timestamp within range
   */
  generateTimestampValue(datetimeRange, index) {
    const start = datetimeRange?.start ? new Date(datetimeRange.start).getTime() : Date.now() - 86400000;
    const end = datetimeRange?.end ? new Date(datetimeRange.end).getTime() : Date.now();
    const timestamp = start + Math.random() * (end - start);
    return new Date(timestamp).toISOString();
  },

  /**
   * Generate matched pairs from left and right records
   * @param {Array} leftRecords - Records from left source
   * @param {Array} rightRecords - Records from right source
   * @param {Array} joinConditions - Join condition definitions
   * @param {number} matchRate - Percentage of records that should match (0-1)
   * @returns {Object} { matched, unmatchedLeft, unmatchedRight }
   */
  generateMatchedPairs(leftRecords, rightRecords, joinConditions, matchRate = 0.95) {
    const matched = [];
    const unmatchedLeft = [];
    const unmatchedRight = [];

    const matchCount = Math.floor(Math.min(leftRecords.length, rightRecords.length) * matchRate);

    // Create matched pairs
    for (let i = 0; i < matchCount; i++) {
      matched.push({
        leftRecord: leftRecords[i],
        rightRecord: this.createMatchingRecord(leftRecords[i], rightRecords[i] || {}, joinConditions),
        matchedOn: joinConditions.map(jc => jc.leftField?.split('.')[1] || 'id')
      });
    }

    // Remaining left records are unmatched
    for (let i = matchCount; i < leftRecords.length; i++) {
      unmatchedLeft.push(leftRecords[i]);
    }

    // Remaining right records are unmatched
    for (let i = matchCount; i < rightRecords.length; i++) {
      unmatchedRight.push(rightRecords[i] || this.createUnmatchedRightRecord(i));
    }

    return { matched, unmatchedLeft, unmatchedRight };
  },

  /**
   * Create a matching right record that aligns with join conditions
   */
  createMatchingRecord(leftRecord, baseRightRecord, joinConditions) {
    const rightRecord = { ...baseRightRecord };

    // Copy join field values from left to right
    joinConditions.forEach(jc => {
      const leftField = jc.leftField?.split('.')[1] || jc.leftField;
      const rightField = jc.rightField?.split('.')[1] || jc.rightField;

      if (leftRecord[leftField] !== undefined) {
        rightRecord[rightField] = leftRecord[leftField];
      }
    });

    return rightRecord;
  },

  /**
   * Create an unmatched right record
   */
  createUnmatchedRightRecord(index) {
    return {
      transaction_id: `UNMATCHED_R${String(index + 1).padStart(6, '0')}`,
      amount: Math.round((Math.random() * 5000 + 100) * 100) / 100,
      currency: this.randomPick(this.sampleData.currencies),
      status: this.randomPick(this.sampleData.statuses),
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Evaluate rules on matched pairs and generate results
   * @param {Array} matchedPairs - Array of matched record pairs
   * @param {Array} rules - Rule definitions
   * @param {number} passRate - Overall rule pass rate (0-1)
   * @returns {Array} Rule results with statistics
   */
  generateRuleResults(matchedPairs, rules, passRate = 0.90) {
    if (!rules || rules.length === 0) {
      return [];
    }

    return rules.map(rule => {
      // Randomize pass rate per rule (between passRate-10% and passRate+5%)
      const rulePassRate = Math.max(0.5, Math.min(1, passRate + (Math.random() - 0.5) * 0.15));
      const totalEvaluated = matchedPairs.length;
      const passed = Math.floor(totalEvaluated * rulePassRate);
      const failed = totalEvaluated - passed;

      // Generate sample failures
      const sampleFailures = [];
      const failureCount = Math.min(5, failed);

      for (let i = 0; i < failureCount; i++) {
        const pairIndex = Math.floor(Math.random() * matchedPairs.length);
        const pair = matchedPairs[pairIndex];

        sampleFailures.push({
          leftRecord: pair.leftRecord,
          rightRecord: pair.rightRecord,
          failureReason: this.generateFailureReason(rule)
        });
      }

      return {
        ruleName: rule.name || `rule_${rules.indexOf(rule) + 1}`,
        severity: rule.severity || 'error',
        description: rule.description || '',
        statistics: {
          totalEvaluated,
          passed,
          failed,
          passRate: totalEvaluated > 0 ? Math.round(passed / totalEvaluated * 100 * 100) / 100 : 100
        },
        sampleFailures
      };
    });
  },

  /**
   * Generate a human-readable failure reason for a rule
   */
  generateFailureReason(rule) {
    const reasons = [
      'Value mismatch between sources',
      'Left value differs from right by more than tolerance',
      'Field value not found in right source',
      'Data type mismatch',
      'Value outside expected range',
      'Null value in required field'
    ];

    return reasons[Math.floor(Math.random() * reasons.length)];
  },

  /**
   * Generate result query results
   * @param {Array} matchedPairs - Matched pairs with rule results
   * @param {Array} resultQueries - Query definitions
   * @param {Array} ruleResults - Rule evaluation results
   * @returns {Array} Query results with counts and samples
   */
  generateQueryResults(matchedPairs, resultQueries, ruleResults) {
    if (!resultQueries || resultQueries.length === 0) {
      return [];
    }

    return resultQueries.map(query => {
      // Calculate expected count based on rules passed/failed criteria
      let baseCount = matchedPairs.length;

      if (query.rulesPassed && query.rulesPassed.length > 0) {
        // Reduce count based on pass rates of required rules
        query.rulesPassed.forEach(ruleName => {
          const ruleResult = ruleResults.find(r => r.ruleName === ruleName);
          if (ruleResult) {
            baseCount = Math.floor(baseCount * ruleResult.statistics.passRate / 100);
          }
        });
      }

      if (query.rulesFailed && query.rulesFailed.length > 0) {
        // Further reduce based on failure rates
        query.rulesFailed.forEach(ruleName => {
          const ruleResult = ruleResults.find(r => r.ruleName === ruleName);
          if (ruleResult) {
            const failRate = 1 - ruleResult.statistics.passRate / 100;
            baseCount = Math.floor(baseCount * failRate);
          }
        });
      }

      // Generate sample records for this query
      const sampleCount = Math.min(10, baseCount);
      const sampleRecords = matchedPairs.slice(0, sampleCount);

      return {
        queryName: query.name || 'unnamed_query',
        description: query.description || '',
        recordCount: baseCount,
        filters: {
          rulesPassed: query.rulesPassed || [],
          rulesFailed: query.rulesFailed || []
        },
        sampleRecords
      };
    });
  },

  /**
   * Generate sample records for display
   * @param {Object} matchResult - { matched, unmatchedLeft, unmatchedRight }
   * @param {Array} ruleResults - Rule results for indicators
   * @param {number} sampleSize - Number of samples per category
   * @returns {Object} Sample records for each category
   */
  generateSampleRecords(matchResult, ruleResults, sampleSize = 10) {
    return {
      matched: matchResult.matched.slice(0, sampleSize).map(pair => ({
        ...pair,
        ruleResults: this.generatePairRuleResults(pair, ruleResults)
      })),
      unmatchedLeft: matchResult.unmatchedLeft.slice(0, sampleSize),
      unmatchedRight: matchResult.unmatchedRight.slice(0, sampleSize)
    };
  },

  /**
   * Generate per-pair rule pass/fail results
   */
  generatePairRuleResults(pair, ruleResults) {
    return ruleResults.map(rule => ({
      ruleName: rule.ruleName,
      severity: rule.severity,
      passed: Math.random() < (rule.statistics.passRate / 100)
    }));
  },

  /**
   * Random pick from array
   */
  randomPick(array) {
    return array[Math.floor(Math.random() * array.length)];
  },

  /**
   * Set configuration options
   */
  setConfig(options) {
    this.config = { ...this.config, ...options };
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReconDataGenerator;
}
