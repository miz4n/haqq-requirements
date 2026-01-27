/**
 * Reconciliation Runner
 * Mock execution engine for reconciliation jobs
 */

const ReconRunner = {
  // Current execution state
  currentExecution: null,
  progressCallback: null,

  /**
   * Execute reconciliation for the given datetime range
   * @param {Object} config - Reconciliation configuration
   * @param {Object} datetimeRange - { start, end } in ISO 8601
   * @param {Object} options - { runMode: 'full' | 'preview', onProgress }
   * @returns {Promise<Object>} ExecutionResult
   */
  async execute(config, datetimeRange, options = {}) {
    const runMode = options.runMode || 'preview';
    const runId = this.generateRunId();

    this.currentExecution = {
      runId,
      status: 'running',
      startedAt: new Date().toISOString()
    };

    this.progressCallback = options.onProgress || null;

    try {
      this.updateProgress(0, null, 'Initializing reconciliation...');

      // Validate configuration
      if (!config || !config.stages || config.stages.length === 0) {
        throw new Error('No stages configured for reconciliation');
      }

      const recordCount = runMode === 'full'
        ? ReconDataGenerator.config.recordCount
        : ReconDataGenerator.config.previewCount;

      const stageResults = [];
      let totalMatched = 0;
      let totalUnmatchedLeft = 0;
      let totalUnmatchedRight = 0;
      let totalLeftRecords = 0;
      let totalRightRecords = 0;

      // Execute each stage
      for (let i = 0; i < config.stages.length; i++) {
        const stage = config.stages[i];
        const stageProgress = ((i / config.stages.length) * 80) + 10; // 10-90%

        this.updateProgress(stageProgress, stage.name, `Executing Stage ${i + 1}: ${stage.name}...`);

        const stageResult = await this.executeStage(
          stage,
          config,
          datetimeRange,
          recordCount,
          stageProgress,
          stageResults // Pass previous results for chaining
        );

        stageResults.push(stageResult);

        // Aggregate totals
        totalMatched += stageResult.matching.totalMatched;
        totalUnmatchedLeft += stageResult.matching.unmatchedLeft;
        totalUnmatchedRight += stageResult.matching.unmatchedRight;
        totalLeftRecords += stageResult.datasources.left.recordCount;
        totalRightRecords += stageResult.datasources.right.recordCount;
      }

      this.updateProgress(95, null, 'Finalizing results...');

      // Simulate processing delay
      await this.delay(200);

      const completedAt = new Date().toISOString();
      const startTime = new Date(this.currentExecution.startedAt).getTime();
      const endTime = new Date(completedAt).getTime();

      const result = {
        runId,
        configName: config.job?.name || 'Unnamed Job',
        reconUnitId: config.reconUnit?.name || 'default',

        request: {
          configId: config.id || null,
          reconUnitId: config.reconUnit?.name,
          datetimeRange,
          runMode
        },

        status: 'completed',

        timing: {
          startedAt: this.currentExecution.startedAt,
          completedAt,
          durationMs: endTime - startTime
        },

        summary: {
          totalLeftRecords,
          totalRightRecords,
          totalMatched,
          totalUnmatchedLeft,
          totalUnmatchedRight,
          matchRate: totalLeftRecords > 0
            ? Math.round((totalMatched / totalLeftRecords) * 100 * 100) / 100
            : 0
        },

        stages: stageResults,
        errors: []
      };

      this.updateProgress(100, null, 'Reconciliation completed!');
      this.currentExecution = null;

      return result;

    } catch (error) {
      console.error('Reconciliation execution failed:', error);

      const completedAt = new Date().toISOString();
      const startTime = new Date(this.currentExecution.startedAt).getTime();
      const endTime = new Date(completedAt).getTime();

      return {
        runId,
        configName: config.job?.name || 'Unnamed Job',
        status: 'failed',
        timing: {
          startedAt: this.currentExecution.startedAt,
          completedAt,
          durationMs: endTime - startTime
        },
        summary: {
          totalLeftRecords: 0,
          totalRightRecords: 0,
          totalMatched: 0,
          totalUnmatchedLeft: 0,
          totalUnmatchedRight: 0,
          matchRate: 0
        },
        stages: [],
        errors: [{ stage: 'initialization', message: error.message }]
      };
    }
  },

  /**
   * Execute a single stage
   */
  async executeStage(stage, config, datetimeRange, recordCount, baseProgress, previousResults) {
    const stageStartTime = Date.now();

    // Get datasource info
    const leftSourceInfo = this.resolveDatasource(stage.datasourceLeft, config, previousResults);
    const rightSourceInfo = this.resolveDatasource(stage.datasourceRight, config, previousResults);

    // Determine record counts (vary slightly between sources)
    const leftCount = recordCount;
    const rightCount = Math.floor(recordCount * (1 + (Math.random() - 0.5) * 0.1));

    this.updateProgress(baseProgress + 2, stage.name, `Fetching ${leftSourceInfo.name} records...`);
    await this.delay(100);

    // Generate mock records for left source
    const leftSchema = this.getSchemaForSource(leftSourceInfo.name, config);
    const leftRecords = ReconDataGenerator.generateRecords(leftSchema, leftCount, datetimeRange);

    this.updateProgress(baseProgress + 4, stage.name, `Fetching ${rightSourceInfo.name} records...`);
    await this.delay(100);

    // Generate mock records for right source
    const rightSchema = this.getSchemaForSource(rightSourceInfo.name, config);
    const rightRecords = ReconDataGenerator.generateRecords(rightSchema, rightCount, datetimeRange);

    this.updateProgress(baseProgress + 6, stage.name, 'Matching records by JOIN conditions...');
    await this.delay(150);

    // Generate matched pairs
    const matchResult = ReconDataGenerator.generateMatchedPairs(
      leftRecords,
      rightRecords,
      stage.joinConditions || [],
      ReconDataGenerator.config.matchRate
    );

    this.updateProgress(baseProgress + 8, stage.name, 'Evaluating rules...');
    await this.delay(100);

    // Generate rule results
    const ruleResults = ReconDataGenerator.generateRuleResults(
      matchResult.matched,
      stage.rules || [],
      ReconDataGenerator.config.rulePassRate
    );

    this.updateProgress(baseProgress + 10, stage.name, 'Processing result queries...');
    await this.delay(50);

    // Generate result query results
    const queryResults = ReconDataGenerator.generateQueryResults(
      matchResult.matched,
      stage.resultQueries || [],
      ruleResults
    );

    // Generate sample records
    const sampleRecords = ReconDataGenerator.generateSampleRecords(
      matchResult,
      ruleResults,
      10
    );

    const stageEndTime = Date.now();

    return {
      stageId: stage.id,
      stageName: stage.name,
      order: stage.order || 1,
      mode: stage.mode || 'one_to_one',

      datasources: {
        left: {
          name: leftSourceInfo.name,
          type: leftSourceInfo.type,
          recordCount: leftRecords.length
        },
        right: {
          name: rightSourceInfo.name,
          type: rightSourceInfo.type,
          recordCount: rightRecords.length
        }
      },

      timing: {
        startedAt: new Date(stageStartTime).toISOString(),
        completedAt: new Date(stageEndTime).toISOString(),
        durationMs: stageEndTime - stageStartTime
      },

      matching: {
        totalMatched: matchResult.matched.length,
        unmatchedLeft: matchResult.unmatchedLeft.length,
        unmatchedRight: matchResult.unmatchedRight.length,
        matchRate: leftRecords.length > 0
          ? Math.round((matchResult.matched.length / leftRecords.length) * 100 * 100) / 100
          : 0
      },

      rules: ruleResults,
      resultQueries: queryResults,
      sampleRecords
    };
  },

  /**
   * Resolve datasource reference to actual source info
   */
  resolveDatasource(dsRef, config, previousResults) {
    if (!dsRef) {
      return { name: 'unknown', type: 'unknown' };
    }

    if (dsRef.type === 'stage_output') {
      // Find the stage output
      const stageResult = previousResults.find(r => r.stageId === dsRef.stageId);
      if (stageResult) {
        return {
          name: `${stageResult.stageName} (${dsRef.outputQuery || 'matched'})`,
          type: 'stage_output'
        };
      }
    }

    // Find in data sources
    const sources = config.dataSources || [];
    const source = sources.find(s => s.id === dsRef.datasourceId || s.name === dsRef.datasourceId);

    if (source) {
      return { name: source.name, type: source.type };
    }

    // Fallback to legacy format
    if (dsRef.datasourceId === 'source_a' && config.sourceA) {
      return { name: config.sourceA.name || 'Source A', type: config.sourceA.type };
    }
    if (dsRef.datasourceId === 'source_b' && config.sourceB) {
      return { name: config.sourceB.name || 'Source B', type: config.sourceB.type };
    }

    return { name: dsRef.datasourceId || 'unknown', type: 'unknown' };
  },

  /**
   * Get schema for a datasource
   */
  getSchemaForSource(sourceName, config) {
    // Try to find matching schema
    const schemas = config.schemas || [];
    const schema = schemas.find(s =>
      s.name?.toLowerCase() === sourceName?.toLowerCase() ||
      s.datasourceId === sourceName
    );

    if (schema) {
      return schema;
    }

    // Fallback to legacy schemas
    if (config.schemaA) return config.schemaA;
    if (config.schemaB) return config.schemaB;

    return null;
  },

  /**
   * Update execution progress
   */
  updateProgress(percent, stageName, action) {
    if (this.progressCallback) {
      this.progressCallback({
        percent: Math.round(percent),
        stage: stageName,
        action,
        elapsed: this.currentExecution
          ? Date.now() - new Date(this.currentExecution.startedAt).getTime()
          : 0
      });
    }
  },

  /**
   * Generate unique run ID
   */
  generateRunId() {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const random = Math.random().toString(36).substr(2, 6);
    return `run_${dateStr}_${random}`;
  },

  /**
   * Simulate async delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Set progress callback
   */
  setProgressCallback(callback) {
    this.progressCallback = callback;
  },

  /**
   * Check if execution is running
   */
  isRunning() {
    return this.currentExecution !== null;
  },

  /**
   * Cancel current execution
   */
  cancel() {
    if (this.currentExecution) {
      this.currentExecution.status = 'cancelled';
      this.currentExecution = null;
    }
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReconRunner;
}
