/**
 * Stages Manager
 * Manages multi-stage reconciliation configuration
 * including stage CRUD, tab switching, and stage chaining
 */

class StagesManager {
  constructor(options = {}) {
    this.containerId = options.containerId || 'stage-content';
    this.tabsId = options.tabsId || 'stage-tabs';
    this.onStateChange = options.onStateChange || (() => {});

    // Stages array
    this.stages = [];

    // Current active stage index
    this.activeStageIndex = 0;

    // Available datasources (from step 2)
    this.availableDatasources = [];

    // Available schemas (from step 3)
    this.schemas = {};

    // Block rule engines per stage
    this.ruleEngines = new Map();
    this.dragDropManagers = new Map();

    // Job configuration
    this.jobConfig = {
      name: '',
      description: '',
      schedule: null
    };
  }

  /**
   * Initialize with existing config
   */
  initialize(config) {
    // Load datasources - support both new format (dataSources array) and old format (sourceA/sourceB)
    if (config.dataSources && config.dataSources.length > 0) {
      // New format: dataSources array
      config.dataSources.forEach((ds, index) => {
        this.availableDatasources.push({
          id: ds.id || `source_${index}`,
          name: ds.name || `Source ${index + 1}`,
          type: ds.type
        });
      });
    } else {
      // Old format: sourceA/sourceB
      if (config.sourceA) {
        this.availableDatasources.push({
          id: 'source_a',
          name: config.sourceA.name || 'Source A',
          type: config.sourceA.type
        });
      }
      if (config.sourceB) {
        this.availableDatasources.push({
          id: 'source_b',
          name: config.sourceB.name || 'Source B',
          type: config.sourceB.type
        });
      }
    }

    // Load schemas - support both new format (schemas array) and old format (schemaA/schemaB)
    if (config.schemas && config.schemas.length > 0) {
      // New format: schemas array matching dataSources
      config.schemas.forEach((schema, index) => {
        const dsId = this.availableDatasources[index]?.id || `source_${index}`;
        if (schema.fields && schema.fields.length > 0) {
          this.schemas[dsId] = schema.fields.map(f => ({
            name: f.name,
            type: f.type
          }));
        }
      });
    } else {
      // Old format: schemaA/schemaB
      if (config.schemaA && config.schemaA.fields) {
        this.schemas.source_a = config.schemaA.fields.map(f => ({
          name: f.name,
          type: f.type
        }));
      }
      if (config.schemaB && config.schemaB.fields) {
        this.schemas.source_b = config.schemaB.fields.map(f => ({
          name: f.name,
          type: f.type
        }));
      }
    }

    // Load existing stages or create default
    if (config.stages && config.stages.length > 0) {
      this.stages = config.stages;

      // Migrate old matchingRule format to new rules[] array
      this.stages.forEach(stage => {
        if (stage.matchingRule && !stage.rules) {
          // Convert single matchingRule to rules array
          stage.rules = [{
            id: 'rule_migrated_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: 'matching_rule',
            description: 'Migrated from single matching rule',
            severity: 'error',
            expression: stage.matchingRule
          }];
          delete stage.matchingRule;
        } else if (!stage.rules) {
          // Initialize empty rules array if missing
          stage.rules = [];
        }

        // Ensure deduplicationOrder is initialized
        if (!stage.deduplicationOrder) {
          stage.deduplicationOrder = {
            enabled: false,
            left: [],
            right: []
          };
        }

        // Ensure resultQueries have the new structure
        if (stage.resultQueries) {
          stage.resultQueries.forEach(query => {
            if (!query.rulesPassed) query.rulesPassed = [];
            if (!query.rulesFailed) query.rulesFailed = [];
          });
        }
      });
    } else {
      // Create default stage
      this.stages = [this.createDefaultStage(1)];
    }

    // Load job config
    if (config.job) {
      this.jobConfig = config.job;
    } else if (config.reconciliation) {
      // Migrate from old format
      this.jobConfig = {
        name: config.reconciliation.name || '',
        description: config.reconciliation.description || '',
        schedule: config.reconciliation.schedule
      };
    }

    // Render
    this.renderTabs();
    this.renderStage(this.activeStageIndex);
  }

  /**
   * Create a default stage configuration
   */
  createDefaultStage(number) {
    const leftSource = this.availableDatasources[0];
    const rightSource = this.availableDatasources[1] || this.availableDatasources[0];

    return {
      id: 'stage_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: `Stage ${number}`,
      order: number,
      mode: 'one_to_one',

      datasourceLeft: {
        type: 'datasource',
        datasourceId: leftSource?.id || ''
      },
      datasourceRight: {
        type: 'datasource',
        datasourceId: rightSource?.id || ''
      },

      joinConditions: [
        {
          id: 'join_' + Date.now(),
          leftField: '',
          rightField: ''
        }
      ],

      // Deduplication ordering for handling multiple matches
      deduplicationOrder: {
        enabled: false,
        left: [],   // Array of { field, direction } objects
        right: []   // Array of { field, direction } objects
      },

      // Multiple named rules (optional - can be empty for JOIN-only matching)
      rules: [],

      resultQueries: [],

      outputs: {
        matched: {
          enabled: true,
          path: `/results/{run_id}/stage${number}_matched.csv`
        },
        unmatchedLeft: {
          enabled: true,
          path: `/results/{run_id}/stage${number}_unmatched_left.csv`
        },
        unmatchedRight: {
          enabled: true,
          path: `/results/{run_id}/stage${number}_unmatched_right.csv`
        }
      }
    };
  }

  /**
   * Create a default rule configuration
   */
  createDefaultRule(number) {
    return {
      id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: `rule_${number}`,
      description: '',
      severity: 'error',  // 'error' | 'warning'
      expression: {
        type: 'comparison',
        operator: '=',
        left: null,
        right: null
      }
    };
  }

  /**
   * Get all datasource options (configured + previous stage outputs)
   */
  getDatasourceOptions(forStageIndex) {
    const options = [];

    // Configured datasources
    this.availableDatasources.forEach(ds => {
      options.push({
        value: JSON.stringify({ type: 'datasource', datasourceId: ds.id }),
        label: ds.name,
        group: 'Configured Sources'
      });
    });

    // Previous stage outputs
    for (let i = 0; i < forStageIndex; i++) {
      const stage = this.stages[i];
      const outputs = [
        { key: 'matched', label: 'Matched' },
        { key: 'unmatched_left', label: 'Unmatched Left' },
        { key: 'unmatched_right', label: 'Unmatched Right' }
      ];

      outputs.forEach(output => {
        if (stage.outputs[output.key.replace('_', '')]?.enabled !== false) {
          options.push({
            value: JSON.stringify({
              type: 'stage_output',
              stageId: stage.id,
              outputQuery: output.key
            }),
            label: `${stage.name} → ${output.label}`,
            group: 'Previous Stage Outputs'
          });
        }
      });

      // Named queries
      (stage.resultQueries || []).forEach(query => {
        options.push({
          value: JSON.stringify({
            type: 'stage_output',
            stageId: stage.id,
            outputQuery: query.name
          }),
          label: `${stage.name} → ${query.name}`,
          group: 'Previous Stage Outputs'
        });
      });
    }

    return options;
  }

  /**
   * Get available fields for a stage based on datasource selection
   */
  getAvailableFields(stageIndex) {
    const stage = this.stages[stageIndex];
    const fields = { left: [], right: [] };

    // Get left source fields
    if (stage.datasourceLeft.type === 'datasource') {
      const dsId = stage.datasourceLeft.datasourceId;
      if (dsId && this.schemas[dsId]) {
        fields.left = this.schemas[dsId];
      }
    } else if (stage.datasourceLeft.type === 'stage_output') {
      // For stage outputs, inherit schema from that stage's source
      const sourceStage = this.stages.find(s => s.id === stage.datasourceLeft.stageId);
      if (sourceStage) {
        // Combine fields from both sources of the previous stage
        fields.left = this.getAvailableFields(this.stages.indexOf(sourceStage)).left;
      }
    }

    // Get right source fields
    if (stage.datasourceRight.type === 'datasource') {
      const dsId = stage.datasourceRight.datasourceId;
      if (dsId && this.schemas[dsId]) {
        fields.right = this.schemas[dsId];
      }
    } else if (stage.datasourceRight.type === 'stage_output') {
      const sourceStage = this.stages.find(s => s.id === stage.datasourceRight.stageId);
      if (sourceStage) {
        fields.right = this.getAvailableFields(this.stages.indexOf(sourceStage)).right;
      }
    }

    // Fallback to first and second available schemas
    const schemaKeys = Object.keys(this.schemas);
    if (fields.left.length === 0 && schemaKeys.length > 0) {
      fields.left = this.schemas[schemaKeys[0]] || [];
    }
    if (fields.right.length === 0 && schemaKeys.length > 1) {
      fields.right = this.schemas[schemaKeys[1]] || [];
    } else if (fields.right.length === 0 && schemaKeys.length > 0) {
      fields.right = this.schemas[schemaKeys[0]] || [];
    }

    return fields;
  }

  /**
   * Add new stage
   */
  addStage() {
    const newStage = this.createDefaultStage(this.stages.length + 1);
    this.stages.push(newStage);
    this.activeStageIndex = this.stages.length - 1;

    this.renderTabs();
    this.renderStage(this.activeStageIndex);
    this.saveState();
  }

  /**
   * Delete stage
   */
  deleteStage(index) {
    if (this.stages.length <= 1) {
      App.showNotification('Cannot delete the last stage', 'error');
      return;
    }

    const stageId = this.stages[index].id;

    // Check if any other stage depends on this one
    const dependentStages = this.stages.filter((s, i) => {
      if (i <= index) return false;
      return (s.datasourceLeft.type === 'stage_output' && s.datasourceLeft.stageId === stageId) ||
             (s.datasourceRight.type === 'stage_output' && s.datasourceRight.stageId === stageId);
    });

    if (dependentStages.length > 0) {
      App.showNotification(`Cannot delete: ${dependentStages.length} stage(s) depend on this stage's output`, 'error');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${this.stages[index].name}"?`)) {
      return;
    }

    // Clean up rule engine
    this.ruleEngines.delete(stageId);
    this.dragDropManagers.get(stageId)?.destroy();
    this.dragDropManagers.delete(stageId);

    this.stages.splice(index, 1);

    // Update order
    this.stages.forEach((s, i) => s.order = i + 1);

    // Adjust active index
    if (this.activeStageIndex >= this.stages.length) {
      this.activeStageIndex = this.stages.length - 1;
    }

    this.renderTabs();
    this.renderStage(this.activeStageIndex);
    this.saveState();
  }

  /**
   * Switch to stage
   */
  switchToStage(index) {
    if (index < 0 || index >= this.stages.length) return;

    this.activeStageIndex = index;
    this.renderTabs();
    this.renderStage(index);
  }

  /**
   * Render stage tabs
   */
  renderTabs() {
    const container = document.getElementById(this.tabsId);
    if (!container) return;

    let html = '';
    this.stages.forEach((stage, index) => {
      const isActive = index === this.activeStageIndex;
      html += `
        <div class="stage-tab ${isActive ? 'active' : ''}" data-index="${index}">
          <span class="stage-tab-number">${index + 1}</span>
          <span class="stage-tab-name">${this.escapeHtml(stage.name)}</span>
          ${this.stages.length > 1 ? `
            <span class="stage-tab-close" data-action="delete" data-index="${index}" title="Delete stage">×</span>
          ` : ''}
        </div>
      `;
    });

    html += `
      <button class="btn btn-secondary btn-sm" id="add-stage-btn" style="margin-left: auto;">
        + Add Stage
      </button>
    `;

    container.innerHTML = html;

    // Attach events
    container.querySelectorAll('.stage-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'delete') {
          e.stopPropagation();
          this.deleteStage(parseInt(e.target.dataset.index));
        } else {
          this.switchToStage(parseInt(tab.dataset.index));
        }
      });
    });

    document.getElementById('add-stage-btn')?.addEventListener('click', () => {
      this.addStage();
    });
  }

  /**
   * Render stage content
   */
  renderStage(index) {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const stage = this.stages[index];
    if (!stage) return;

    const dsOptions = this.getDatasourceOptions(index);
    const availableFields = this.getAvailableFields(index);

    container.innerHTML = `
      <div class="stage-panel" data-stage-id="${stage.id}">
        <!-- Stage Configuration -->
        <div class="stage-config-section">
          <h4>Stage Configuration</h4>
          <div class="grid grid-3">
            <div class="form-group">
              <label class="form-label form-label-required">Stage Name</label>
              <input type="text" class="form-control" id="stage-name"
                value="${this.escapeHtml(stage.name)}" placeholder="Stage name">
            </div>
            <div class="form-group">
              <label class="form-label">Reconciliation Mode</label>
              <select class="form-control" id="stage-mode">
                <option value="one_to_one" ${stage.mode === 'one_to_one' ? 'selected' : ''}>One-to-One</option>
                <option value="one_to_many" ${stage.mode === 'one_to_many' ? 'selected' : ''}>One-to-Many</option>
                <option value="many_to_many" ${stage.mode === 'many_to_many' ? 'selected' : ''}>Many-to-Many</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Data Sources -->
        <div class="stage-config-section">
          <h4>Data Sources</h4>
          <div class="grid grid-2">
            <div class="form-group">
              <label class="form-label form-label-required">Left Source</label>
              <select class="form-control" id="stage-left-source">
                ${this.renderDatasourceOptions(dsOptions, stage.datasourceLeft)}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label form-label-required">Right Source</label>
              <select class="form-control" id="stage-right-source">
                ${this.renderDatasourceOptions(dsOptions, stage.datasourceRight)}
              </select>
            </div>
          </div>
        </div>

        <!-- JOIN Conditions -->
        <div class="stage-config-section">
          <h4>JOIN Conditions</h4>
          <div class="alert alert-info mb-3">
            Define how records from the two sources should be matched (like SQL JOIN conditions).
          </div>
          <div id="join-conditions-container">
            ${this.renderJoinConditions(stage, availableFields)}
          </div>
          <button class="btn btn-secondary btn-sm mt-2" id="add-join-btn">
            + Add JOIN Condition
          </button>

          <!-- Deduplication Order -->
          ${this.renderDeduplicationOrderSection(stage, availableFields)}
        </div>

        <!-- Matching Rules (Block Programming) -->
        <div class="stage-config-section">
          <div class="section-header">
            <h4>Matching Rules</h4>
            <button class="btn btn-secondary btn-sm" id="add-rule-btn">
              + Add Rule
            </button>
          </div>
          <div class="alert alert-info mb-3">
            Rules are optional. If no rules are defined, records will be matched based on JOIN conditions only.
            Add rules to validate additional conditions on matched records.
          </div>
          <div id="rules-container">
            ${this.renderRules(stage, availableFields)}
          </div>
        </div>

        <!-- Result Queries -->
        <div class="stage-config-section">
          <h4>Result Queries</h4>
          <div class="alert alert-info mb-3">
            Define named queries to categorize matched records. These can be used as inputs for subsequent stages.
          </div>
          <div id="queries-container">
            ${this.renderResultQueries(stage)}
          </div>
          <button class="btn btn-secondary btn-sm mt-2" id="add-query-btn">
            + Add Query
          </button>
        </div>
      </div>
    `;

    // Initialize block rule engines for all rules
    this.initializeRuleEngines(stage, availableFields);

    // Attach form events
    this.attachStageFormEvents(index);

    // Attach rule events
    this.attachRuleEvents(index);
  }

  /**
   * Render datasource select options
   */
  renderDatasourceOptions(options, selected) {
    const selectedValue = JSON.stringify(selected);
    let html = '';
    let currentGroup = '';

    options.forEach(opt => {
      if (opt.group !== currentGroup) {
        if (currentGroup) html += '</optgroup>';
        html += `<optgroup label="${this.escapeHtml(opt.group)}">`;
        currentGroup = opt.group;
      }
      const isSelected = opt.value === selectedValue;
      html += `<option value='${this.escapeHtml(opt.value)}' ${isSelected ? 'selected' : ''}>${this.escapeHtml(opt.label)}</option>`;
    });

    if (currentGroup) html += '</optgroup>';
    return html;
  }

  /**
   * Render JOIN conditions
   */
  renderJoinConditions(stage, availableFields) {
    if (!stage.joinConditions || stage.joinConditions.length === 0) {
      return '<p class="text-gray">No JOIN conditions defined.</p>';
    }

    return stage.joinConditions.map((join, index) => `
      <div class="join-condition-row" data-index="${index}">
        <select class="form-control" data-field="leftField">
          <option value="">-- Select left field --</option>
          ${availableFields.left.map(f =>
            `<option value="source_left.${f.name}" ${join.leftField === `source_left.${f.name}` ? 'selected' : ''}>${f.name}</option>`
          ).join('')}
        </select>
        <span class="join-condition-equals">=</span>
        <select class="form-control" data-field="rightField">
          <option value="">-- Select right field --</option>
          ${availableFields.right.map(f =>
            `<option value="source_right.${f.name}" ${join.rightField === `source_right.${f.name}` ? 'selected' : ''}>${f.name}</option>`
          ).join('')}
        </select>
        <button class="join-condition-remove" data-action="remove" data-index="${index}" title="Remove">×</button>
      </div>
    `).join('');
  }

  /**
   * Render deduplication order section
   */
  renderDeduplicationOrderSection(stage, availableFields) {
    // Initialize deduplicationOrder if not present
    if (!stage.deduplicationOrder) {
      stage.deduplicationOrder = {
        enabled: false,
        left: [],
        right: []
      };
    }

    const dedup = stage.deduplicationOrder;
    const isEnabled = dedup.enabled;

    return `
      <div class="deduplication-order-section mt-3">
        <label class="checkbox">
          <input type="checkbox" id="dedup-enabled" ${isEnabled ? 'checked' : ''}>
          <span>Handle duplicate matches by ordering</span>
        </label>

        <div id="dedup-config" class="dedup-config-container" style="display: ${isEnabled ? 'block' : 'none'};">
          <div class="alert alert-info mt-2 mb-3" style="font-size: 0.85rem;">
            When multiple records match the JOIN conditions, order by these columns to select the first record.
            Add multiple columns for tie-breaking.
          </div>

          <div class="dedup-columns-grid">
            <!-- Left Source Order -->
            <div class="dedup-column">
              <label class="form-label">Left Source Order</label>
              <div class="dedup-order-list" id="dedup-left-list">
                ${this.renderDeduplicationOrderColumns(dedup.left, 'left', availableFields.left)}
              </div>
              <button class="btn btn-secondary btn-sm mt-2" data-action="add-dedup-column" data-side="left">
                + Add Column
              </button>
            </div>

            <!-- Right Source Order -->
            <div class="dedup-column">
              <label class="form-label">Right Source Order</label>
              <div class="dedup-order-list" id="dedup-right-list">
                ${this.renderDeduplicationOrderColumns(dedup.right, 'right', availableFields.right)}
              </div>
              <button class="btn btn-secondary btn-sm mt-2" data-action="add-dedup-column" data-side="right">
                + Add Column
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render deduplication order columns for one side (left or right)
   */
  renderDeduplicationOrderColumns(columns, side, fields) {
    if (!columns || columns.length === 0) {
      return `<div class="dedup-empty-state text-gray" style="font-size: 0.85rem; padding: var(--spacing-sm);">No ordering columns. Click "Add Column" to add.</div>`;
    }

    const sourcePrefix = side === 'left' ? 'source_left' : 'source_right';

    return columns.map((col, index) => `
      <div class="dedup-order-row" data-index="${index}" data-side="${side}">
        <span class="dedup-order-number">${index + 1}.</span>
        <select class="form-control" data-field="field">
          <option value="">-- Select field --</option>
          ${fields.map(f => {
            const fieldValue = `${sourcePrefix}.${f.name}`;
            return `<option value="${fieldValue}" ${col.field === fieldValue ? 'selected' : ''}>${f.name}</option>`;
          }).join('')}
        </select>
        <select class="form-control dedup-direction-select" data-field="direction">
          <option value="desc" ${col.direction === 'desc' ? 'selected' : ''}>DESC</option>
          <option value="asc" ${col.direction === 'asc' ? 'selected' : ''}>ASC</option>
        </select>
        <button class="dedup-remove-btn" data-action="remove-dedup-column" data-side="${side}" data-index="${index}" title="Remove">×</button>
      </div>
    `).join('');
  }

  /**
   * Render all rules for a stage
   */
  renderRules(stage, availableFields) {
    if (!stage.rules || stage.rules.length === 0) {
      return `
        <div class="rules-empty-state">
          <p class="text-gray">No rules defined. Records will be matched based on JOIN conditions only.</p>
          <p class="text-gray-light">Click "Add Rule" to add validation rules for matched records.</p>
        </div>
      `;
    }

    return stage.rules.map((rule, index) => `
      <div class="rule-card" data-rule-id="${rule.id}" data-rule-index="${index}">
        <div class="rule-card-header">
          <div class="rule-card-header-left">
            <span class="rule-number">${index + 1}</span>
            <input type="text" class="form-control rule-name-input"
              value="${this.escapeHtml(rule.name)}"
              data-field="name"
              placeholder="Rule name">
          </div>
          <div class="rule-card-header-right">
            <select class="form-control rule-severity-select" data-field="severity">
              <option value="error" ${rule.severity === 'error' ? 'selected' : ''}>Error</option>
              <option value="warning" ${rule.severity === 'warning' ? 'selected' : ''}>Warning</option>
            </select>
            <button class="btn btn-outline btn-sm rule-toggle-btn" data-action="toggle" title="Collapse/Expand">
              ▼
            </button>
            <button class="btn btn-outline btn-sm danger" data-action="delete-rule" title="Delete Rule">
              ×
            </button>
          </div>
        </div>
        <div class="rule-card-body">
          <div class="form-group mb-3">
            <input type="text" class="form-control"
              value="${this.escapeHtml(rule.description || '')}"
              data-field="description"
              placeholder="Description (optional)">
          </div>
          <div class="rule-block-editor">
            <div class="block-editor-container block-editor-compact" id="block-editor-${rule.id}">
              <div class="block-toolbox" id="toolbox-${rule.id}"></div>
              <div class="block-canvas-container">
                <div class="block-canvas-toolbar">
                  <div class="block-canvas-toolbar-left">
                    <button class="btn btn-sm btn-outline" id="undo-btn-${rule.id}" title="Undo">↶</button>
                    <button class="btn btn-sm btn-outline" id="redo-btn-${rule.id}" title="Redo">↷</button>
                  </div>
                  <div class="block-canvas-toolbar-right">
                    <div class="expression-preview" id="preview-${rule.id}"></div>
                  </div>
                </div>
                <div class="block-canvas" id="canvas-${rule.id}">
                  <div class="block-canvas-inner" id="expression-${rule.id}"></div>
                  <div class="block-trash" id="trash-${rule.id}">🗑️</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Render result queries
   */
  renderResultQueries(stage) {
    const ruleNames = (stage.rules || []).map(r => r.name);
    const hasRules = ruleNames.length > 0;

    if (!stage.resultQueries || stage.resultQueries.length === 0) {
      return `<p class="text-gray">No result queries defined. Add queries to categorize matched records${hasRules ? ' based on rule results' : ''}.</p>`;
    }

    return stage.resultQueries.map((query, index) => {
      const rulesPassed = query.rulesPassed || [];
      const rulesFailed = query.rulesFailed || [];

      return `
        <div class="result-query-card" data-index="${index}">
          <div class="result-query-header">
            <input type="text" class="form-control" value="${this.escapeHtml(query.name)}"
              data-field="name" placeholder="Query name" style="max-width: 200px; font-weight: 600;">
            <button class="btn btn-outline btn-sm" data-action="delete-query" data-index="${index}">× Delete</button>
          </div>
          <div class="result-query-body">
            <div class="form-group mb-3">
              <label class="form-label">Description</label>
              <input type="text" class="form-control" value="${this.escapeHtml(query.description || '')}"
                data-field="description" placeholder="What does this query filter?">
            </div>

            ${hasRules ? `
              <div class="rule-filters-container">
                <div class="rule-filter-column">
                  <label class="form-label">Rules that must PASS</label>
                  <div class="rule-checkboxes" data-filter-type="pass">
                    ${ruleNames.map(ruleName => `
                      <label class="checkbox">
                        <input type="checkbox" data-rule-name="${this.escapeHtml(ruleName)}"
                          ${rulesPassed.includes(ruleName) ? 'checked' : ''}>
                        <span>${this.escapeHtml(ruleName)}</span>
                      </label>
                    `).join('')}
                  </div>
                </div>
                <div class="rule-filter-column">
                  <label class="form-label">Rules that must FAIL</label>
                  <div class="rule-checkboxes" data-filter-type="fail">
                    ${ruleNames.map(ruleName => `
                      <label class="checkbox">
                        <input type="checkbox" data-rule-name="${this.escapeHtml(ruleName)}"
                          ${rulesFailed.includes(ruleName) ? 'checked' : ''}>
                        <span>${this.escapeHtml(ruleName)}</span>
                      </label>
                    `).join('')}
                  </div>
                </div>
              </div>
              <div class="query-preview mt-2">
                <span class="form-help">${this.generateQueryPreview(rulesPassed, rulesFailed)}</span>
              </div>
            ` : `
              <div class="form-group">
                <label class="form-label">Filter Expression (optional Lua)</label>
                <textarea class="form-control" rows="2" data-field="filter"
                  placeholder="return source_left.status == 'completed'">${query.filter || ''}</textarea>
                <span class="form-help">Lua expression that returns true for records to include</span>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Generate preview text for rule-based query
   */
  generateQueryPreview(rulesPassed, rulesFailed) {
    const parts = [];
    if (rulesPassed && rulesPassed.length > 0) {
      parts.push(`${rulesPassed.join(' AND ')} = PASS`);
    }
    if (rulesFailed && rulesFailed.length > 0) {
      parts.push(`${rulesFailed.join(' AND ')} = FAIL`);
    }
    if (parts.length === 0) {
      return 'All matched rows (no rule filters selected)';
    }
    return `Rows where: ${parts.join(' AND ')}`;
  }

  /**
   * Initialize rule engines for all rules in a stage
   */
  initializeRuleEngines(stage, availableFields) {
    // Clean up existing engines for this stage
    const stagePrefix = `${stage.id}_`;
    for (const [key, manager] of this.dragDropManagers) {
      if (key.startsWith(stagePrefix) || key === stage.id) {
        manager.destroy();
        this.dragDropManagers.delete(key);
      }
    }
    for (const key of this.ruleEngines.keys()) {
      if (key.startsWith(stagePrefix) || key === stage.id) {
        this.ruleEngines.delete(key);
      }
    }

    // Create engine for each rule
    if (stage.rules && stage.rules.length > 0) {
      stage.rules.forEach((rule, index) => {
        this.initializeRuleEngine(rule, stage, availableFields);
      });
    }
  }

  /**
   * Initialize rule engine for a single rule
   */
  initializeRuleEngine(rule, stage, availableFields) {
    const ruleKey = rule.id;

    // Create new engine
    const engine = new BlockRuleEngine({
      containerId: `expression-${rule.id}`,
      toolboxId: `toolbox-${rule.id}`,
      trashId: `trash-${rule.id}`,
      previewId: `preview-${rule.id}`,
      availableFields: availableFields,
      onStateChange: (state) => {
        // Find the rule and update its expression
        const ruleObj = stage.rules.find(r => r.id === rule.id);
        if (ruleObj) {
          ruleObj.expression = state.rootExpression;
          this.saveState();
        }
      }
    });

    engine.initialize(rule.expression);
    this.ruleEngines.set(ruleKey, engine);

    // Create drag drop manager
    const dragDrop = new BlockDragDropManager({
      engine: engine,
      canvasSelector: `#canvas-${rule.id}`,
      toolboxSelector: `#toolbox-${rule.id}`,
      trashSelector: `#trash-${rule.id}`
    });
    this.dragDropManagers.set(ruleKey, dragDrop);

    // Attach undo/redo buttons
    document.getElementById(`undo-btn-${rule.id}`)?.addEventListener('click', () => {
      engine.undo();
    });
    document.getElementById(`redo-btn-${rule.id}`)?.addEventListener('click', () => {
      engine.redo();
    });
  }

  /**
   * Attach form events for stage
   */
  attachStageFormEvents(index) {
    const stage = this.stages[index];

    // Stage name
    document.getElementById('stage-name')?.addEventListener('change', (e) => {
      stage.name = e.target.value;
      this.renderTabs();
      this.saveState();
    });

    // Mode
    document.getElementById('stage-mode')?.addEventListener('change', (e) => {
      stage.mode = e.target.value;
      this.saveState();
    });

    // Datasources
    document.getElementById('stage-left-source')?.addEventListener('change', (e) => {
      stage.datasourceLeft = JSON.parse(e.target.value);
      this.updateRuleEngineFields(index);
      this.saveState();
    });

    document.getElementById('stage-right-source')?.addEventListener('change', (e) => {
      stage.datasourceRight = JSON.parse(e.target.value);
      this.updateRuleEngineFields(index);
      this.saveState();
    });

    // JOIN conditions
    const joinContainer = document.getElementById('join-conditions-container');
    joinContainer?.addEventListener('change', (e) => {
      const row = e.target.closest('.join-condition-row');
      if (!row) return;

      const joinIndex = parseInt(row.dataset.index);
      const field = e.target.dataset.field;

      if (field && stage.joinConditions[joinIndex]) {
        stage.joinConditions[joinIndex][field] = e.target.value;
        this.saveState();
      }
    });

    joinContainer?.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'remove') {
        const joinIndex = parseInt(e.target.dataset.index);
        if (stage.joinConditions.length > 1) {
          stage.joinConditions.splice(joinIndex, 1);
          this.renderStage(index);
          this.saveState();
        } else {
          App.showNotification('At least one JOIN condition is required', 'error');
        }
      }
    });

    document.getElementById('add-join-btn')?.addEventListener('click', () => {
      stage.joinConditions.push({
        id: 'join_' + Date.now(),
        leftField: '',
        rightField: ''
      });
      this.renderStage(index);
      this.saveState();
    });

    // Deduplication order
    document.getElementById('dedup-enabled')?.addEventListener('change', (e) => {
      if (!stage.deduplicationOrder) {
        stage.deduplicationOrder = { enabled: false, left: [], right: [] };
      }
      stage.deduplicationOrder.enabled = e.target.checked;
      document.getElementById('dedup-config').style.display = e.target.checked ? 'block' : 'none';
      this.saveState();
    });

    // Deduplication order - add column buttons
    document.querySelectorAll('[data-action="add-dedup-column"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const side = btn.dataset.side;
        if (!stage.deduplicationOrder) {
          stage.deduplicationOrder = { enabled: true, left: [], right: [] };
        }
        stage.deduplicationOrder[side].push({
          field: '',
          direction: 'desc'
        });
        this.renderStage(index);
        this.saveState();
      });
    });

    // Deduplication order - remove column and field/direction changes
    ['left', 'right'].forEach(side => {
      const listContainer = document.getElementById(`dedup-${side}-list`);
      if (!listContainer) return;

      // Handle changes to field and direction
      listContainer.addEventListener('change', (e) => {
        const row = e.target.closest('.dedup-order-row');
        if (!row) return;

        const colIndex = parseInt(row.dataset.index);
        const field = e.target.dataset.field;

        if (field && stage.deduplicationOrder?.[side]?.[colIndex]) {
          stage.deduplicationOrder[side][colIndex][field] = e.target.value;
          this.saveState();
        }
      });

      // Handle remove button clicks
      listContainer.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'remove-dedup-column') {
          const colIndex = parseInt(e.target.dataset.index);
          if (stage.deduplicationOrder?.[side]) {
            stage.deduplicationOrder[side].splice(colIndex, 1);
            this.renderStage(index);
            this.saveState();
          }
        }
      });
    });

    // Result queries
    const queriesContainer = document.getElementById('queries-container');
    queriesContainer?.addEventListener('change', (e) => {
      const card = e.target.closest('.result-query-card');
      if (!card) return;

      const queryIndex = parseInt(card.dataset.index);
      const query = stage.resultQueries[queryIndex];
      if (!query) return;

      const field = e.target.dataset.field;
      const ruleName = e.target.dataset.ruleName;
      const filterType = e.target.closest('.rule-checkboxes')?.dataset.filterType;

      if (field) {
        // Text input fields
        query[field] = e.target.value;
        this.saveState();
      } else if (ruleName && filterType) {
        // Rule checkbox change
        const isChecked = e.target.checked;

        if (filterType === 'pass') {
          query.rulesPassed = query.rulesPassed || [];
          if (isChecked && !query.rulesPassed.includes(ruleName)) {
            query.rulesPassed.push(ruleName);
          } else if (!isChecked) {
            query.rulesPassed = query.rulesPassed.filter(n => n !== ruleName);
          }
        } else if (filterType === 'fail') {
          query.rulesFailed = query.rulesFailed || [];
          if (isChecked && !query.rulesFailed.includes(ruleName)) {
            query.rulesFailed.push(ruleName);
          } else if (!isChecked) {
            query.rulesFailed = query.rulesFailed.filter(n => n !== ruleName);
          }
        }

        // Update preview
        const previewEl = card.querySelector('.query-preview .form-help');
        if (previewEl) {
          previewEl.textContent = this.generateQueryPreview(query.rulesPassed, query.rulesFailed);
        }

        this.saveState();
      }
    });

    queriesContainer?.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'delete-query') {
        const queryIndex = parseInt(e.target.dataset.index);
        if (confirm('Delete this query?')) {
          stage.resultQueries.splice(queryIndex, 1);
          this.renderStage(index);
          this.saveState();
        }
      }
    });

    document.getElementById('add-query-btn')?.addEventListener('click', () => {
      const queryNum = (stage.resultQueries?.length || 0) + 1;
      stage.resultQueries = stage.resultQueries || [];
      stage.resultQueries.push({
        id: 'query_' + Date.now(),
        name: `query_${queryNum}`,
        description: '',
        filter: '',
        rulesPassed: [],
        rulesFailed: []
      });
      this.renderStage(index);
      this.saveState();
    });
  }

  /**
   * Attach events for rules section
   */
  attachRuleEvents(index) {
    const stage = this.stages[index];

    // Add rule button
    document.getElementById('add-rule-btn')?.addEventListener('click', () => {
      const ruleNum = (stage.rules?.length || 0) + 1;
      stage.rules = stage.rules || [];
      const newRule = this.createDefaultRule(ruleNum);
      stage.rules.push(newRule);
      this.renderStage(index);
      this.saveState();
    });

    // Rules container events
    const rulesContainer = document.getElementById('rules-container');

    rulesContainer?.addEventListener('change', (e) => {
      const card = e.target.closest('.rule-card');
      if (!card) return;

      const ruleId = card.dataset.ruleId;
      const rule = stage.rules.find(r => r.id === ruleId);
      if (!rule) return;

      const field = e.target.dataset.field;
      if (field) {
        const oldName = rule.name;
        rule[field] = e.target.value;

        // If rule name changed, update result queries that reference it
        if (field === 'name' && oldName !== rule.name) {
          this.updateRuleNameInQueries(stage, oldName, rule.name);
          // Re-render to update query checkboxes
          this.renderResultQueriesOnly(stage);
        }

        this.saveState();
      }
    });

    rulesContainer?.addEventListener('click', (e) => {
      const card = e.target.closest('.rule-card');
      if (!card) return;

      const ruleId = card.dataset.ruleId;
      const action = e.target.dataset.action;

      if (action === 'delete-rule') {
        if (stage.rules.length === 1) {
          // Allow deleting last rule - rules are optional
          if (!confirm('Delete this rule? The stage will match based on JOIN conditions only.')) {
            return;
          }
        } else if (!confirm('Delete this rule?')) {
          return;
        }

        // Clean up engine
        this.ruleEngines.delete(ruleId);
        this.dragDropManagers.get(ruleId)?.destroy();
        this.dragDropManagers.delete(ruleId);

        // Remove rule
        const ruleIndex = stage.rules.findIndex(r => r.id === ruleId);
        const deletedRule = stage.rules[ruleIndex];
        stage.rules.splice(ruleIndex, 1);

        // Remove from result queries
        this.removeRuleFromQueries(stage, deletedRule.name);

        this.renderStage(index);
        this.saveState();
      } else if (action === 'toggle') {
        const body = card.querySelector('.rule-card-body');
        const btn = e.target;
        if (body) {
          body.classList.toggle('collapsed');
          btn.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
        }
      }
    });
  }

  /**
   * Update rule name in result queries
   */
  updateRuleNameInQueries(stage, oldName, newName) {
    if (!stage.resultQueries) return;

    stage.resultQueries.forEach(query => {
      if (query.rulesPassed) {
        query.rulesPassed = query.rulesPassed.map(n => n === oldName ? newName : n);
      }
      if (query.rulesFailed) {
        query.rulesFailed = query.rulesFailed.map(n => n === oldName ? newName : n);
      }
    });
  }

  /**
   * Remove deleted rule from result queries
   */
  removeRuleFromQueries(stage, ruleName) {
    if (!stage.resultQueries) return;

    stage.resultQueries.forEach(query => {
      if (query.rulesPassed) {
        query.rulesPassed = query.rulesPassed.filter(n => n !== ruleName);
      }
      if (query.rulesFailed) {
        query.rulesFailed = query.rulesFailed.filter(n => n !== ruleName);
      }
    });
  }

  /**
   * Re-render only the result queries section
   */
  renderResultQueriesOnly(stage) {
    const container = document.getElementById('queries-container');
    if (container) {
      container.innerHTML = this.renderResultQueries(stage);
    }
  }

  /**
   * Update rule engines with new fields
   */
  updateRuleEngineFields(index) {
    const stage = this.stages[index];
    const fields = this.getAvailableFields(index);

    // Update all rule engines for this stage
    if (stage.rules) {
      stage.rules.forEach(rule => {
        const engine = this.ruleEngines.get(rule.id);
        if (engine) {
          engine.setAvailableFields(fields);
        }
      });
    }
  }

  /**
   * Save state
   */
  saveState() {
    this.onStateChange({
      stages: this.stages,
      job: this.jobConfig
    });
  }

  /**
   * Validate all stages
   */
  validate() {
    const errors = [];

    this.stages.forEach((stage, index) => {
      // Check name
      if (!stage.name || stage.name.trim() === '') {
        errors.push(`Stage ${index + 1}: Name is required`);
      }

      // Check datasources
      if (!stage.datasourceLeft.datasourceId && stage.datasourceLeft.type === 'datasource') {
        errors.push(`Stage ${index + 1}: Left source is required`);
      }
      if (!stage.datasourceRight.datasourceId && stage.datasourceRight.type === 'datasource') {
        errors.push(`Stage ${index + 1}: Right source is required`);
      }

      // Check JOIN conditions
      const validJoins = stage.joinConditions.filter(j => j.leftField && j.rightField);
      if (validJoins.length === 0) {
        errors.push(`Stage ${index + 1}: At least one complete JOIN condition is required`);
      }

      // Validate rules (rules are OPTIONAL - empty array is valid)
      if (stage.rules && stage.rules.length > 0) {
        // Check for duplicate rule names
        const ruleNames = stage.rules.map(r => r.name.toLowerCase());
        const duplicates = ruleNames.filter((name, idx) => ruleNames.indexOf(name) !== idx);
        if (duplicates.length > 0) {
          errors.push(`Stage ${index + 1}: Duplicate rule name "${duplicates[0]}"`);
        }

        // Validate each rule
        stage.rules.forEach((rule, ruleIndex) => {
          // Check rule name
          if (!rule.name || rule.name.trim() === '') {
            errors.push(`Stage ${index + 1}, Rule ${ruleIndex + 1}: Name is required`);
          }

          // Validate rule expression using its engine
          const engine = this.ruleEngines.get(rule.id);
          if (engine) {
            const ruleErrors = engine.validate();
            ruleErrors.forEach(err => {
              errors.push(`Stage ${index + 1}, Rule "${rule.name}": ${err.message}`);
            });
          }
        });
      }
    });

    return errors;
  }

  /**
   * Get serialized configuration
   */
  getConfiguration() {
    return {
      stages: this.stages,
      job: this.jobConfig
    };
  }

  /**
   * Escape HTML
   */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StagesManager;
}
