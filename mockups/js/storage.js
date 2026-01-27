/**
 * LocalStorage Utilities
 * Manages state persistence across pages
 */

const STORAGE_KEY = 'reconciliation_config';

const Storage = {
  /**
   * Get the current reconciliation configuration
   */
  get() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : this.getDefault();
    } catch (error) {
      console.error('Error loading config:', error);
      return this.getDefault();
    }
  },

  /**
   * Save the reconciliation configuration
   */
  save(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  },

  /**
   * Update a specific section of the config
   */
  update(section, data) {
    const config = this.get();
    config[section] = data;
    config.lastModified = new Date().toISOString();
    return this.save(config);
  },

  /**
   * Clear all configuration
   */
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },

  /**
   * Get default empty configuration
   */
  getDefault() {
    return {
      // Step 1: Recon Unit
      reconUnit: null,

      // Step 2: Data Sources (legacy format)
      sourceA: null,
      sourceB: null,
      dataSources: [],

      // Step 3: Schemas
      schemaA: null,
      schemaB: null,
      schemas: [],

      // Step 4: Stages & Rules (new unified format)
      stages: [],
      job: {
        name: '',
        description: '',
        schedule: null
      },

      // Legacy fields (kept for backward compatibility)
      matchingRules: null,
      reconciliation: null,

      // Metadata
      created: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };
  },

  /**
   * Check if configuration is complete (5-step flow)
   */
  isComplete() {
    const config = this.get();
    return !!(
      config.reconUnit &&
      (config.sourceA || (config.dataSources && config.dataSources.length >= 1)) &&
      (config.sourceB || (config.dataSources && config.dataSources.length >= 2)) &&
      (config.schemaA || (config.schemas && config.schemas.length >= 1)) &&
      (config.schemaB || (config.schemas && config.schemas.length >= 2)) &&
      ((config.stages && config.stages.length > 0) || config.matchingRules)
    );
  },

  /**
   * Get completed step count (5-step flow)
   */
  getCompletedSteps() {
    const config = this.get();
    let count = 0;

    // Step 1: Recon Unit
    if (config.reconUnit) count++;

    // Step 2: Data Sources
    if ((config.sourceA && config.sourceB) ||
        (config.dataSources && config.dataSources.length >= 2)) count++;

    // Step 3: Schema
    if ((config.schemaA && config.schemaA.fields && config.schemaA.fields.length > 0) ||
        (config.schemas && config.schemas.length >= 2)) count++;

    // Step 4: Stages & Rules
    if ((config.stages && config.stages.length > 0) ||
        (config.matchingRules && config.reconciliation)) count++;

    return count;
  },

  /**
   * Migrate old config format to new stages format
   */
  migrateToStagesFormat(config) {
    if (config.stages && config.stages.length > 0) {
      return config; // Already in new format
    }

    if (!config.matchingRules) {
      return config; // Nothing to migrate
    }

    // Create a stage from the old matchingRules + reconciliation
    const stage = {
      id: 'stage_migrated_' + Date.now(),
      name: 'Primary Matching',
      order: 1,
      mode: 'one_to_one',

      datasourceLeft: {
        type: 'datasource',
        datasourceId: 'source_a'
      },
      datasourceRight: {
        type: 'datasource',
        datasourceId: 'source_b'
      },

      joinConditions: (config.matchingRules.join || []).map((j, i) => ({
        id: 'join_' + i,
        leftField: j.left,
        rightField: j.right
      })),

      matchingRule: this.convertRulesToExpression(config.matchingRules.rules || []),

      resultQueries: (config.reconciliation?.queries || []).map(q => ({
        id: 'query_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: q.name,
        description: q.description || '',
        filter: q.script || ''
      })),

      outputs: {
        matched: {
          enabled: config.reconciliation?.outputs?.matched?.store !== false,
          path: config.reconciliation?.outputs?.matched?.path || '/results/{run_id}/matched.csv'
        },
        unmatchedLeft: {
          enabled: config.reconciliation?.outputs?.unmatchedLeft?.store !== false,
          path: config.reconciliation?.outputs?.unmatchedLeft?.path || '/results/{run_id}/unmatched_left.csv'
        },
        unmatchedRight: {
          enabled: config.reconciliation?.outputs?.unmatchedRight?.store !== false,
          path: config.reconciliation?.outputs?.unmatchedRight?.path || '/results/{run_id}/unmatched_right.csv'
        }
      }
    };

    config.stages = [stage];
    config.job = {
      name: config.reconciliation?.name || '',
      description: config.reconciliation?.description || '',
      schedule: config.reconciliation?.schedule || null
    };

    return config;
  },

  /**
   * Convert old rules array to block expression
   */
  convertRulesToExpression(rules) {
    if (!rules || rules.length === 0) {
      return {
        type: 'boolean',
        operator: 'AND',
        children: [null, null]
      };
    }

    const children = rules.map(rule => {
      if (rule.type === 'script') {
        // Can't convert Lua scripts to blocks, return placeholder
        return null;
      }

      return {
        type: 'comparison',
        operator: rule.operator || '=',
        left: rule.left ? {
          type: 'field_reference',
          source: rule.left.startsWith('source_a') ? 'source_left' : 'source_right',
          fieldName: rule.left.split('.')[1] || ''
        } : null,
        right: rule.right ? {
          type: 'field_reference',
          source: rule.right.startsWith('source_a') ? 'source_left' : 'source_right',
          fieldName: rule.right.split('.')[1] || ''
        } : null
      };
    }).filter(Boolean);

    if (children.length === 0) {
      children.push(null, null);
    } else if (children.length === 1) {
      children.push(null);
    }

    return {
      type: 'boolean',
      operator: 'AND',
      children
    };
  },

  /**
   * Generate unique ID for data sources and schemas
   */
  generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
};

/**
 * Execution Results Storage
 * Manages reconciliation execution results
 */
const EXECUTION_RESULTS_KEY = 'execution_results';

const ExecutionStorage = {
  /**
   * Save an execution result
   * @param {Object} result - The execution result to save
   */
  saveResult(result) {
    const results = this.getResults();

    // Keep only last 20 results
    if (results.length >= 20) {
      results.pop();
    }

    results.unshift(result);
    localStorage.setItem(EXECUTION_RESULTS_KEY, JSON.stringify(results));
  },

  /**
   * Get all execution results
   * @returns {Array} Array of execution results
   */
  getResults() {
    try {
      const data = localStorage.getItem(EXECUTION_RESULTS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error loading execution results:', error);
      return [];
    }
  },

  /**
   * Get a specific execution result by run ID
   * @param {string} runId - The run ID to find
   * @returns {Object|null} The execution result or null
   */
  getResultById(runId) {
    const results = this.getResults();
    return results.find(r => r.runId === runId) || null;
  },

  /**
   * Delete a specific execution result
   * @param {string} runId - The run ID to delete
   */
  deleteResult(runId) {
    const results = this.getResults();
    const filtered = results.filter(r => r.runId !== runId);
    localStorage.setItem(EXECUTION_RESULTS_KEY, JSON.stringify(filtered));
  },

  /**
   * Clear all execution results
   */
  clearResults() {
    localStorage.removeItem(EXECUTION_RESULTS_KEY);
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}
