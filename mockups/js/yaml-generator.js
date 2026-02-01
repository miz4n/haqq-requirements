/**
 * YAML Generator
 * Generates YAML configuration from the reconciliation config state
 */

const YAMLGenerator = {
  /**
   * Generate complete YAML configuration
   */
  generateComplete(config) {
    const sections = [];

    // Generate data sources - support both new (dataSources array) and old (sourceA/sourceB) formats
    if (config.dataSources && config.dataSources.length > 0) {
      config.dataSources.forEach((ds, index) => {
        sections.push(this.generateDataSource(ds, ds.name || `source_${index + 1}`));
      });
    } else {
      if (config.sourceA) {
        sections.push(this.generateDataSource(config.sourceA, 'source_a'));
      }
      if (config.sourceB) {
        sections.push(this.generateDataSource(config.sourceB, 'source_b'));
      }
    }

    // Generate schemas - support both new (schemas array) and old (schemaA/schemaB) formats
    if (config.schemas && config.schemas.length > 0) {
      config.schemas.forEach(schema => {
        if (schema.fields && schema.fields.length > 0) {
          sections.push(this.generateSchema(schema));
        }
      });
    } else {
      if (config.schemaA) {
        sections.push(this.generateSchema(config.schemaA));
      }
      if (config.schemaB) {
        sections.push(this.generateSchema(config.schemaB));
      }
    }

    // Generate stages (new format) or matching rules (old format)
    if (config.stages && config.stages.length > 0) {
      sections.push(this.generateStages(config));
    } else if (config.matchingRules) {
      sections.push(this.generateMatchingRules(config.matchingRules));
    }

    // Generate reconciliation job
    const jobConfig = config.job || config.reconciliation;
    if (jobConfig && config.reconUnit) {
      sections.push(this.generateReconciliationJob(config));
    }

    return sections.join('\n---\n');
  },

  /**
   * Generate data source YAML
   */
  generateDataSource(source, sourceName) {
    const lines = ['datasource:'];
    lines.push(`  name: ${source.name || sourceName}`);
    lines.push(`  type: ${source.type}`);
    lines.push(`  version: 1`);

    if (source.description) {
      lines.push(`  description: "${source.description}"`);
    }

    lines.push('');
    lines.push('  connection:');

    if (source.type === 'sftp') {
      lines.push(`    host: ${source.host}`);
      lines.push(`    port: ${source.port || 22}`);
      lines.push(`    username: ${source.username}`);
      if (source.authType === 'password') {
        lines.push(`    password: \${SECRET:${source.name}_password}`);
      } else {
        lines.push(`    private_key: \${SECRET:${source.name}_private_key}`);
      }
      lines.push(`    timeout: ${source.timeout || 30}`);
      lines.push('');
      lines.push('  fetch:');
      lines.push(`    directory: ${source.directory}`);
      lines.push(`    file_pattern: "${source.filePattern}"`);
      lines.push(`    encoding: ${source.encoding || 'UTF-8'}`);
      lines.push(`    compression: ${source.compression || 'none'}`);
    }
    else if (source.type === 'api') {
      lines.push(`    base_url: ${source.baseUrl}`);
      lines.push(`    endpoint: ${source.endpoint}`);
      lines.push(`    method: ${source.method || 'GET'}`);
      lines.push(`    auth_type: ${source.authType}`);
      lines.push('    auth_credentials:');
      if (source.authType === 'bearer') {
        lines.push(`      token: \${SECRET:${source.name}_api_token}`);
      } else if (source.authType === 'api_key') {
        lines.push(`      header_name: X-API-Key`);
        lines.push(`      api_key: \${SECRET:${source.name}_api_key}`);
      }
      if (source.queryParams) {
        lines.push('    query_params:');
        Object.entries(source.queryParams).forEach(([key, value]) => {
          lines.push(`      ${key}: "${value}"`);
        });
      }
      lines.push(`    timeout_seconds: ${source.timeout || 60}`);
    }
    else if (source.type === 'postgresql') {
      lines.push(`    database_type: postgresql  # Only PostgreSQL supported`);
      lines.push(`    host: ${source.host}`);
      lines.push(`    port: ${source.port || 5432}`);
      lines.push(`    database: ${source.database}`);
      lines.push(`    schema: ${source.schema || 'public'}`);
      lines.push(`    username: ${source.username}`);
      lines.push(`    password: \${SECRET:${source.name}_db_password}`);
      lines.push(`    ssl_enabled: ${source.sslEnabled !== false}`);
      lines.push('');
      lines.push('  # IMPORTANT: All timestamps must be in UTC');
      lines.push('  query_template: |');
      const queryLines = (source.query || '').split('\n');
      queryLines.forEach(line => {
        lines.push(`    ${line}`);
      });
    }

    lines.push('');
    lines.push('  format:');
    lines.push(`    type: ${source.formatType || 'tabular'}`);

    if (source.formatType === 'csv') {
      lines.push(`    delimiter: "${source.delimiter || ','}"`);
      lines.push(`    header_row: ${source.headerRow !== false}`);
      if (source.skipRows) {
        lines.push(`    skip_rows: ${source.skipRows}`);
      }
    } else if (source.formatType === 'json') {
      if (source.arrayPath) {
        lines.push(`    array_path: ${source.arrayPath}`);
      }
      lines.push(`    flatten_nested: ${source.flattenNested !== false}`);
    }

    return lines.join('\n');
  },

  /**
   * Generate schema YAML
   */
  generateSchema(schema) {
    const lines = ['schema:'];
    lines.push(`  name: ${schema.name}`);
    lines.push(`  version: ${schema.version || 1}`);

    if (schema.description) {
      lines.push(`  description: "${schema.description}"`);
    }

    lines.push('');
    lines.push('  fields:');

    (schema.fields || []).forEach(field => {
      lines.push(`    - name: ${field.name}`);
      lines.push(`      type: ${field.type}`);

      if (field.precision) {
        lines.push(`      precision: ${field.precision}`);
      }
      if (field.scale) {
        lines.push(`      scale: ${field.scale}`);
      }

      lines.push(`      required: ${field.required !== false}`);

      if (field.source && field.source !== field.name) {
        lines.push(`      source: ${field.source}`);
      }

      if (field.transform) {
        if (field.transform.includes('\n')) {
          lines.push('      transform: |');
          field.transform.split('\n').forEach(line => {
            lines.push(`        ${line}`);
          });
        } else {
          lines.push(`      transform: "${field.transform}"`);
        }
      }

      if (field.default !== undefined) {
        lines.push(`      default: ${field.default}`);
      }

      lines.push('');
    });

    return lines.join('\n');
  },

  /**
   * Generate matching rules YAML
   */
  generateMatchingRules(rules) {
    const lines = ['matching_rules:'];
    lines.push(`  name: ${rules.name || 'matching_rules'}`);
    lines.push(`  version: ${rules.version || 1}`);

    if (rules.description) {
      lines.push(`  description: "${rules.description}"`);
    }

    lines.push('');
    lines.push('  # Join: Equality only, = operator is implicit');
    lines.push('  join:');

    (rules.join || []).forEach(join => {
      lines.push(`    - left: ${join.left}`);
      lines.push(`      right: ${join.right}`);
    });

    lines.push('');
    lines.push('  # Rules execute in declaration order');
    lines.push('  rules:');

    (rules.rules || []).forEach(rule => {
      lines.push(`    - name: ${rule.name}`);
      lines.push(`      severity: ${rule.severity || 'error'}`);

      if (rule.description) {
        lines.push(`      description: "${rule.description}"`);
      }

      if (rule.type === 'script' || rule.script) {
        lines.push('      script: |');
        const scriptLines = (rule.script || '').split('\n');
        scriptLines.forEach(line => {
          lines.push(`        ${line}`);
        });
      } else if (rule.type === 'comparison' && rule.left && rule.right) {
        lines.push(`      left: ${rule.left}`);
        lines.push(`      operator: "${rule.operator || '='}"`);
        lines.push(`      right: ${rule.right}`);
      } else if (rule.type === 'boolean' && rule.operands) {
        lines.push(`      operator: ${rule.operator}`);
        if (rule.operator === 'NOT') {
          lines.push('      operand:');
          this._generateRuleCondition(lines, rule.operand, '        ');
        } else {
          lines.push('      operands:');
          rule.operands.forEach(operand => {
            lines.push('        -');
            this._generateRuleCondition(lines, operand, '          ');
          });
        }
      }

      lines.push('');
    });

    return lines.join('\n');
  },

  /**
   * Helper to generate nested rule conditions
   */
  _generateRuleCondition(lines, condition, indent) {
    if (condition.script) {
      lines.push(`${indent}script: |`);
      condition.script.split('\n').forEach(line => {
        lines.push(`${indent}  ${line}`);
      });
    } else if (condition.left && condition.right) {
      lines.push(`${indent}left: ${condition.left}`);
      lines.push(`${indent}operator: "${condition.operator || '='}"`);
      lines.push(`${indent}right: ${condition.right}`);
    }
  },

  /**
   * Generate stages YAML (new format with multiple named rules)
   */
  generateStages(config) {
    const lines = ['stages:'];

    (config.stages || []).forEach((stage, stageIndex) => {
      lines.push(`  - name: ${stage.name}`);
      lines.push(`    order: ${stage.order || stageIndex + 1}`);
      lines.push(`    mode: ${stage.mode || 'one_to_one'}`);

      // Datasources
      lines.push('');
      lines.push('    datasource_left:');
      if (stage.datasourceLeft.type === 'datasource') {
        const dsName = this._getDatasourceName(config, stage.datasourceLeft.datasourceId);
        lines.push(`      type: datasource`);
        lines.push(`      name: ${dsName}`);
      } else {
        lines.push(`      type: stage_output`);
        lines.push(`      stage_id: ${stage.datasourceLeft.stageId}`);
        lines.push(`      output: ${stage.datasourceLeft.outputQuery}`);
      }

      lines.push('    datasource_right:');
      if (stage.datasourceRight.type === 'datasource') {
        const dsName = this._getDatasourceName(config, stage.datasourceRight.datasourceId);
        lines.push(`      type: datasource`);
        lines.push(`      name: ${dsName}`);
      } else {
        lines.push(`      type: stage_output`);
        lines.push(`      stage_id: ${stage.datasourceRight.stageId}`);
        lines.push(`      output: ${stage.datasourceRight.outputQuery}`);
      }

      // JOIN conditions
      lines.push('');
      lines.push('    # JOIN conditions (equality only, = operator implicit)');
      lines.push('    join_conditions:');
      (stage.joinConditions || []).forEach(join => {
        if (join.leftField && join.rightField) {
          lines.push(`      - left: ${join.leftField}`);
          lines.push(`        right: ${join.rightField}`);
        }
      });

      // Deduplication ordering (when multiple matches exist)
      if (stage.deduplicationOrder?.enabled) {
        const hasLeftColumns = stage.deduplicationOrder.left?.length > 0;
        const hasRightColumns = stage.deduplicationOrder.right?.length > 0;

        if (hasLeftColumns || hasRightColumns) {
          lines.push('');
          lines.push('    # Deduplication ordering (when multiple matches exist)');
          lines.push('    deduplication_order:');

          if (hasLeftColumns) {
            lines.push('      left:');
            stage.deduplicationOrder.left.forEach(col => {
              if (col.field) {
                lines.push(`        - field: ${col.field}`);
                lines.push(`          direction: ${col.direction || 'desc'}`);
              }
            });
          }

          if (hasRightColumns) {
            lines.push('      right:');
            stage.deduplicationOrder.right.forEach(col => {
              if (col.field) {
                lines.push(`        - field: ${col.field}`);
                lines.push(`          direction: ${col.direction || 'desc'}`);
              }
            });
          }
        }
      }

      // Matching rules (optional)
      if (stage.rules && stage.rules.length > 0) {
        lines.push('');
        lines.push('    # Matching rules (optional - empty means JOIN-only matching)');
        lines.push('    rules:');
        stage.rules.forEach(rule => {
          lines.push(`      - name: ${rule.name}`);
          lines.push(`        severity: ${rule.severity || 'error'}`);
          if (rule.description) {
            lines.push(`        description: "${rule.description}"`);
          }
          // Generate expression
          if (rule.expression) {
            const exprStr = this._expressionToString(rule.expression);
            if (exprStr) {
              lines.push(`        expression: "${exprStr}"`);
            }
          }
          lines.push('');
        });
      } else {
        lines.push('');
        lines.push('    # No matching rules - stage uses JOIN-only matching');
        lines.push('    rules: []');
      }

      // Result queries
      if (stage.resultQueries && stage.resultQueries.length > 0) {
        lines.push('');
        lines.push('    result_queries:');
        stage.resultQueries.forEach(query => {
          lines.push(`      - name: ${query.name}`);
          if (query.description) {
            lines.push(`        description: "${query.description}"`);
          }
          if (query.rulesPassed && query.rulesPassed.length > 0) {
            lines.push(`        rules_passed: [${query.rulesPassed.join(', ')}]`);
          }
          if (query.rulesFailed && query.rulesFailed.length > 0) {
            lines.push(`        rules_failed: [${query.rulesFailed.join(', ')}]`);
          }
          if (query.filter) {
            lines.push('        filter: |');
            query.filter.split('\n').forEach(line => {
              lines.push(`          ${line}`);
            });
          }
          lines.push('');
        });
      }

      // Outputs
      lines.push('');
      lines.push('    outputs:');
      if (stage.outputs?.unmatchedLeft?.enabled !== false) {
        lines.push('      unmatched_left:');
        lines.push(`        path: ${stage.outputs?.unmatchedLeft?.path || `/results/{run_id}/stage${stageIndex + 1}_unmatched_left.csv`}`);
      }
      if (stage.outputs?.unmatchedRight?.enabled !== false) {
        lines.push('      unmatched_right:');
        lines.push(`        path: ${stage.outputs?.unmatchedRight?.path || `/results/{run_id}/stage${stageIndex + 1}_unmatched_right.csv`}`);
      }
      if (stage.outputs?.matched?.enabled !== false) {
        lines.push('      matched:');
        lines.push(`        path: ${stage.outputs?.matched?.path || `/results/{run_id}/stage${stageIndex + 1}_matched.csv`}`);
      }

      lines.push('');
    });

    return lines.join('\n');
  },

  /**
   * Get datasource name by ID
   */
  _getDatasourceName(config, dsId) {
    if (config.dataSources) {
      const ds = config.dataSources.find(d => d.id === dsId);
      return ds?.name || dsId;
    }
    if (dsId === 'source_a') return config.sourceA?.name || 'source_a';
    if (dsId === 'source_b') return config.sourceB?.name || 'source_b';
    return dsId;
  },

  /**
   * Convert block expression AST to string representation
   */
  _expressionToString(expr) {
    if (!expr) return '';

    switch (expr.type) {
      case 'comparison':
        const left = this._expressionToString(expr.left);
        const right = this._expressionToString(expr.right);
        return `${left} ${expr.operator} ${right}`;

      case 'boolean':
        if (expr.operator === 'NOT') {
          const operand = this._expressionToString(expr.operand || expr.children?.[0]);
          return `NOT (${operand})`;
        }
        const children = (expr.children || [])
          .filter(c => c)
          .map(c => this._expressionToString(c));
        return children.join(` ${expr.operator} `);

      case 'field_reference':
        return `${expr.source}.${expr.fieldName}`;

      case 'literal':
        if (expr.valueType === 'string') return `"${expr.value}"`;
        return String(expr.value);

      case 'arithmetic':
        const aLeft = this._expressionToString(expr.left);
        const aRight = this._expressionToString(expr.right);
        return `(${aLeft} ${expr.operator} ${aRight})`;

      case 'function':
        const args = (expr.arguments || []).map(a => this._expressionToString(a)).join(', ');
        return `${expr.functionName}(${args})`;

      default:
        return '';
    }
  },

  /**
   * Generate reconciliation job YAML (new format)
   */
  generateReconciliationJob(config) {
    const jobConfig = config.job || config.reconciliation || {};
    const reconUnit = config.reconUnit || {};

    const lines = ['reconciliation_job:'];
    lines.push(`  name: ${jobConfig.name || 'reconciliation_job'}`);
    lines.push(`  version: 1`);

    if (jobConfig.description) {
      lines.push(`  description: "${jobConfig.description}"`);
    }

    lines.push('');
    lines.push('  reconciliation_unit:');
    lines.push(`    interval: ${reconUnit.interval || 'day'}`);
    lines.push(`    timezone: UTC`);

    if (jobConfig.schedule) {
      lines.push('');
      lines.push('  schedule:');
      lines.push(`    enabled: true`);
      lines.push(`    cron: "${jobConfig.schedule.cron}"`);
      lines.push(`    timezone: UTC`);
      if (jobConfig.schedule.autoRange) {
        lines.push(`    auto_generate_range: ${jobConfig.schedule.autoRange}`);
      }
    }

    return lines.join('\n');
  },

  /**
   * Generate reconciliation job YAML (old format)
   */
  generateReconciliation(config) {
    const recon = config.reconciliation;
    const reconUnit = config.reconUnit;

    const lines = ['reconciliation:'];
    lines.push(`  name: ${recon.name || 'daily_reconciliation'}`);
    lines.push(`  version: ${recon.version || 1}`);

    if (recon.description) {
      lines.push(`  description: "${recon.description}"`);
    }

    lines.push('');
    lines.push(`  mode: one_to_one  # Only one-to-one supported`);
    lines.push('');
    lines.push('  # Reconciliation unit');
    lines.push('  reconciliation_unit:');
    lines.push(`    interval: ${reconUnit.interval}  # day, hour, or minute`);
    lines.push(`    timezone: UTC  # Only UTC supported`);

    lines.push('');
    lines.push('  # Runtime execution passes dateTimeRange (start inclusive, end exclusive):');
    lines.push('  # Example: --datetime-range 2024-03-15T00:00:00Z/2024-03-16T00:00:00Z');

    if (recon.schedule) {
      lines.push('');
      lines.push('  schedule:');
      lines.push(`    enabled: ${recon.schedule.enabled !== false}`);
      lines.push(`    cron: "${recon.schedule.cron}"`);
      lines.push(`    timezone: UTC`);
      if (recon.schedule.autoGenerateRange) {
        lines.push(`    auto_generate_range: ${recon.schedule.autoGenerateRange}`);
      }
    }

    lines.push('');
    lines.push('  source_a:');
    lines.push(`    datasource: ${config.sourceA?.name || 'source_a'}:1`);
    lines.push(`    schema: ${config.schemaA?.name || 'schema_a'}:1`);

    lines.push('');
    lines.push('  source_b:');
    lines.push(`    datasource: ${config.sourceB?.name || 'source_b'}:1`);
    lines.push(`    schema: ${config.schemaB?.name || 'schema_b'}:1`);

    lines.push('');
    lines.push(`  matching_rules: ${config.matchingRules?.name || 'matching_rules'}:1`);

    lines.push('');
    lines.push('  outputs:');

    // Matched output
    lines.push('    matched:');
    lines.push('      store: true');
    lines.push('      export:');
    lines.push('        format: csv  # CSV only');
    lines.push(`        path: ${recon.outputs?.matched?.path || '/results/{run_id}/matched.csv'}`);

    if (recon.outputs?.matched?.queries?.length > 0) {
      lines.push('');
      lines.push('      # Named queries for match groups');
      lines.push('      queries:');
      recon.outputs.matched.queries.forEach(query => {
        lines.push(`        - name: ${query.name}`);
        if (query.description) {
          lines.push(`          description: "${query.description}"`);
        }
        if (query.rulesPassed?.length > 0) {
          lines.push(`          rules_passed: [${query.rulesPassed.join(', ')}]`);
        }
        if (query.rulesFailed?.length > 0) {
          lines.push(`          rules_failed: [${query.rulesFailed.join(', ')}]`);
        }
        if (query.script) {
          lines.push('          script: |');
          query.script.split('\n').forEach(line => {
            lines.push(`            ${line}`);
          });
        }
        lines.push('');
      });
    }

    // Unmatched left
    lines.push('    unmatched_left:');
    lines.push('      store: true');
    lines.push('      export:');
    lines.push('        format: csv  # CSV only');
    lines.push(`        path: ${recon.outputs?.unmatchedLeft?.path || '/results/{run_id}/unmatched_left.csv'}`);

    lines.push('');
    // Unmatched right
    lines.push('    unmatched_right:');
    lines.push('      store: true');
    lines.push('      export:');
    lines.push('        format: csv  # CSV only');
    lines.push(`        path: ${recon.outputs?.unmatchedRight?.path || '/results/{run_id}/unmatched_right.csv'}`);

    return lines.join('\n');
  },

  /**
   * Syntax highlight YAML (simple regex-based)
   */
  highlightYAML(yaml) {
    return yaml
      .split('\n')
      .map(line => {
        // Comments
        if (line.trim().startsWith('#')) {
          return `<span class="yaml-comment">${this.escapeHtml(line)}</span>`;
        }

        // Keys and values
        const keyMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
        if (keyMatch) {
          const indent = keyMatch[1];
          const key = keyMatch[2];
          const value = keyMatch[3];

          let highlightedValue = this.escapeHtml(value);

          // Highlight strings
          if (value.match(/^["'].*["']$/)) {
            highlightedValue = `<span class="yaml-string">${highlightedValue}</span>`;
          }
          // Highlight numbers
          else if (value.match(/^-?\d+(\.\d+)?$/)) {
            highlightedValue = `<span class="yaml-number">${highlightedValue}</span>`;
          }
          // Highlight booleans
          else if (value.match(/^(true|false)$/i)) {
            highlightedValue = `<span class="yaml-boolean">${highlightedValue}</span>`;
          }

          return `${indent}<span class="yaml-key">${this.escapeHtml(key)}</span>: ${highlightedValue}`;
        }

        return this.escapeHtml(line);
      })
      .join('\n');
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = YAMLGenerator;
}
