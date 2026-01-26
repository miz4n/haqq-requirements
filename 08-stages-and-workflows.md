# Stages and Workflows

## 1. Overview

Multi-stage reconciliation allows complex reconciliation workflows where:
- The output of one reconciliation becomes the input to the next stage
- Multiple data sources can be reconciled in sequence
- Complex many-to-many relationships can be resolved

## 2. Core Concepts

### 2.1 What is a Stage?

A **stage** is a single reconciliation operation between two data sources. Stages can be:
- **Independent**: Run in parallel with no dependencies
- **Sequential**: Output of one stage feeds into the next
- **Conditional**: Execute based on previous stage results

### 2.2 Multi-Stage Workflow

A **workflow** is a directed acyclic graph (DAG) of reconciliation stages.

**Example**: Three-way reconciliation
```
Stage 1: Ledger vs Gateway → Result A
Stage 2: Gateway vs Bank → Result B
Stage 3: Result A vs Result B → Final Result
```

## 3. Use Cases

### 3.1 Three-Way Reconciliation

**Business Need**: Reconcile internal ledger, payment gateway, and bank statement.

**Workflow**:
```yaml
workflow:
  name: three_way_reconciliation
  stages:
    - name: stage_1_ledger_gateway
      source_a: internal_ledger
      source_b: payment_gateway
      matching_rules: ledger_gateway_rules
      output: ledger_gateway_matched

    - name: stage_2_gateway_bank
      source_a: payment_gateway
      source_b: bank_statement
      matching_rules: gateway_bank_rules
      output: gateway_bank_matched

    - name: stage_3_consolidation
      source_a: ledger_gateway_matched
      source_b: gateway_bank_matched
      matching_rules: consolidation_rules
      output: final_reconciliation
```

**Result**: Records matched across all three sources.

### 3.2 Many-to-Many via Intermediate Table

**TODO**: This use case requires one-to-many reconciliation mode, which will be implemented in a future version.

**Business Need**: Reconcile payments to invoices with many-to-many relationship.

**Approach**: Use payment allocations as intermediate table (requires one-to-many mode).

### 3.3 Hierarchical Reconciliation

**TODO**: This use case requires one-to-many reconciliation mode with aggregation, which will be implemented in a future version.

**Business Need**: Reconcile orders → line items → shipments.

**Approach**: Multi-level aggregation from shipments to line items to orders (requires one-to-many mode).

### 3.4 Exception Re-Reconciliation

**Business Need**: Re-reconcile unmatched records with relaxed rules.

**Workflow**:
```yaml
workflow:
  name: exception_re_reconciliation
  stages:
    - name: stage_1_strict_matching
      source_a: source_a_data
      source_b: source_b_data
      matching_rules: strict_rules
      output: strict_results

    - name: stage_2_relaxed_matching
      source_a: strict_results.unmatched_left
      source_b: strict_results.unmatched_right
      matching_rules: relaxed_rules
      output: relaxed_results

    - name: stage_3_manual_review
      source_a: relaxed_results.unmatched_left
      source_b: relaxed_results.unmatched_right
      matching_rules: fuzzy_matching_rules
      output: manual_review_queue
```

## 4. Stage Configuration

### 4.1 Stage Definition

```yaml
stage:
  name: ledger_gateway_reconciliation
  description: "Reconcile internal ledger with payment gateway"
  order: 1  # Execution order

  inputs:
    source_a:
      type: data_source
      source: internal_ledger
      reconciliation_unit:
        date: 2024-03-15
    source_b:
      type: data_source
      source: payment_gateway
      reconciliation_unit:
        date: 2024-03-15

  processing:
    mode: one_to_one
    matching_rules: ledger_gateway_rules:v1
    schema_a: ledger_schema:v2
    schema_b: gateway_schema:v1

  outputs:
    matched:
      store: true
      export: matched_ledger_gateway.csv
    unmatched_left:
      store: true
      export: unmatched_ledger.csv
    unmatched_right:
      store: true
      export: unmatched_gateway.csv

  dependencies: []  # No dependencies, runs first
```

### 4.2 Dependent Stage

```yaml
stage:
  name: consolidation
  order: 3

  inputs:
    source_a:
      type: stage_output
      stage: ledger_gateway_reconciliation
      output_category: matched
    source_b:
      type: stage_output
      stage: gateway_bank_reconciliation
      output_category: matched

  processing:
    mode: one_to_one
    matching_rules: consolidation_rules:v1

  dependencies:
    - ledger_gateway_reconciliation
    - gateway_bank_reconciliation

  condition:  # Only run if previous stages succeeded
    - stage: ledger_gateway_reconciliation
      status: completed
    - stage: gateway_bank_reconciliation
      status: completed
```

### 4.3 Conditional Stage Execution

```yaml
stage:
  name: exception_handling
  order: 2

  condition:
    type: threshold
    expression: |
      (stage_1_strict_matching.unmatched_left.count / stage_1_strict_matching.total_records) > 0.05

  inputs:
    source_a:
      type: stage_output
      stage: stage_1_strict_matching
      output_category: unmatched_left
    source_b:
      type: stage_output
      stage: stage_1_strict_matching
      output_category: unmatched_right

  processing:
    mode: one_to_one
    matching_rules: relaxed_rules:v1
```

**Meaning**: Only run this stage if > 5% of records are unmatched in stage 1.

## 5. Stage Outputs as Data Sources

### 5.1 Output Storage

**Requirement**: Stage outputs must be stored and accessible as data sources for subsequent stages.

**Storage Options**:
- **In-memory**: Fast, but limited by memory (default for small datasets)
- **CSV files**: Persistent, simple format for intermediate results
- **Database table**: Queryable, good for complex queries

**Configuration**:
```yaml
stage:
  outputs:
    matched:
      storage:
        type: csv
        path: /reconciliation/runs/{run_id}/stage_1/matched.csv
    unmatched_left:
      storage:
        type: csv
        path: /reconciliation/runs/{run_id}/stage_1/unmatched_left.csv
```

### 5.2 Output Schema

**Requirement**: Stage output schema is combination of both source schemas plus match metadata.

**Example**:

**Source A Schema**: `transaction_id`, `amount`, `currency`
**Source B Schema**: `transaction_id`, `amount`, `currency`, `fee`

**Stage Output Schema** (matched):
```yaml
schema:
  fields:
    - name: source_a_transaction_id
      type: string
    - name: source_a_amount
      type: decimal
    - name: source_a_currency
      type: string
    - name: source_b_transaction_id
      type: string
    - name: source_b_amount
      type: decimal
    - name: source_b_currency
      type: string
    - name: source_b_fee
      type: decimal
    - name: match_id
      type: string
    - name: rules_passed
      type: string  # Comma-separated list of rules that passed
    - name: rules_failed
      type: string  # Comma-separated list of rules that failed
    - name: matched_at
      type: timestamp
```

### 5.3 Output Queries

**Requirement**: Outputs can define named queries (match group filters) that can be referenced by subsequent stages.

**Example**:
```yaml
stage:
  name: stage_1_reconciliation
  outputs:
    matched:
      storage:
        type: csv
        path: stage_1_matched.csv
      queries:
        # Define named queries for specific match groups
        - name: timestamp_warnings
          rules_passed:
            - amount_exact
            - currency_match
          rules_failed:
            - timestamp_window

        - name: amount_warnings
          rules_passed:
            - currency_match
            - timestamp_window
          rules_failed:
            - amount_exact

        - name: perfect_matches
          rules_passed:
            - amount_exact
            - currency_match
            - timestamp_window
```

**Note**: These named queries become available for use in subsequent stage inputs.

## 6. Using Query Results in Stages

### 6.1 Overview

Stage inputs can reference named queries defined in stage outputs to select specific subsets of reconciliation results based on rule match status (match groups). This allows complex workflows where subsequent stages process only records matching specific criteria.

**Match Group**: The combination of rules that passed/failed for a record. Stage outputs define named queries for match groups, and stage inputs reference these queries by name.

### 6.2 Referencing Named Queries in Stage Inputs

**Requirement**: Stage inputs reference named queries defined in previous stage outputs.

**Example 1**: Reference a named query

```yaml
# Stage 1 defines the query
stage:
  name: stage_1_reconciliation
  outputs:
    matched:
      storage:
        type: csv
        path: stage_1_matched.csv
      queries:
        - name: timestamp_warnings
          rules_passed: [amount_exact, currency_match]
          rules_failed: [timestamp_window]

# Stage 2 references the query
stage:
  name: exception_analysis
  order: 2
  inputs:
    source_a:
      type: stage_output
      stage: stage_1_reconciliation
      output_category: matched
      query: timestamp_warnings  # Reference by name
```

This stage will only process matched records with match group `[amount_exact✓, currency_match✓, timestamp_window✗]`.

**Example 2**: Reference different queries for different inputs

```yaml
stage:
  name: cross_validation
  order: 3
  inputs:
    source_a:
      type: stage_output
      stage: stage_1_reconciliation
      output_category: matched
      query: perfect_matches  # Only perfect matches from stage 1

    source_b:
      type: stage_output
      stage: stage_2_reconciliation
      output_category: matched
      query: high_confidence  # High confidence from stage 2
```

### 6.3 Match Group Query Operators

**Supported query operators for filtering stage inputs by match groups**:

| Query Field | Description | Match Group Pattern | Example |
|-------------|-------------|---------------------|---------|
| `result_category` | Select matched, unmatched_left, or unmatched_right | N/A | `matched` |
| `rules_passed` | Records where all listed rules passed (AND logic) | `[R1✓, R2✓, ...]` | `[rule1, rule2]` |
| `rules_failed` | Records where all listed rules failed (AND logic) | `[R1✗, R2✗, ...]` | `[rule3]` |
| `rules_passed_any` | Records where any listed rule passed (OR logic) | `[R1✓ OR R2✓ ...]` | `[rule1, rule2]` |

**Note**: These operators query the match group metadata stored in stage outputs (see Section 5.2 - `rules_passed` and `rules_failed` fields).

### 6.4 Complete Example: Exception Re-Reconciliation with Named Queries

**Scenario**: Three-tier reconciliation using named queries to route records by match groups

```yaml
workflow:
  name: tiered_reconciliation
  stages:
    # Stage 1: Strict matching - defines output queries for different match groups
    - name: strict_matching
      order: 1
      inputs:
        source_a:
          type: data_source
          source: internal_ledger
        source_b:
          type: data_source
          source: payment_gateway
      processing:
        mode: one_to_one
        matching_rules: strict_rules:v1  # Includes: amount_exact, currency_match, timestamp_window
      outputs:
        matched:
          storage:
            type: csv
            path: stage_1_matched.csv
          queries:
            # Define queries for different match groups
            - name: timestamp_warnings
              rules_passed: [amount_exact, currency_match]
              rules_failed: [timestamp_window]
              # Match group: [amount_exact✓, currency_match✓, timestamp_window✗]

            - name: amount_warnings
              rules_passed: [currency_match, timestamp_window]
              rules_failed: [amount_exact]
              # Match group: [amount_exact✗, currency_match✓, timestamp_window✓]

            - name: perfect_matches
              rules_passed: [amount_exact, currency_match, timestamp_window]
              # Match group: [amount_exact✓, currency_match✓, timestamp_window✓]

        unmatched_left:
          storage:
            type: csv
            path: stage_1_unmatched_left.csv

        unmatched_right:
          storage:
            type: csv
            path: stage_1_unmatched_right.csv

    # Stage 2: Process timestamp warnings - references named query
    - name: timestamp_warning_analysis
      order: 2
      dependencies: [strict_matching]
      inputs:
        source_a:
          type: stage_output
          stage: strict_matching
          output_category: matched
          query: timestamp_warnings  # Reference the named query
      processing:
        mode: one_to_one
        matching_rules: timestamp_analysis_rules:v1

    # Stage 3: Process amount warnings - references different named query
    - name: amount_tolerance_retry
      order: 2
      dependencies: [strict_matching]
      inputs:
        source_a:
          type: stage_output
          stage: strict_matching
          output_category: matched
          query: amount_warnings  # Reference the named query
      processing:
        mode: one_to_one
        matching_rules: amount_tolerance_rules:v1

    # Stage 4: Relaxed matching on fully unmatched records
    - name: relaxed_matching
      order: 3
      dependencies: [strict_matching]
      inputs:
        source_a:
          type: stage_output
          stage: strict_matching
          output_category: unmatched_left
        source_b:
          type: stage_output
          stage: strict_matching
          output_category: unmatched_right
      processing:
        mode: one_to_one
        matching_rules: relaxed_rules:v1
```

**Result**: Named queries defined in stage 1 outputs enable clean routing of specific match groups to different stages for targeted exception handling.

### 6.5 Query Result Caching

**Requirement**: Named query results should be cached to avoid re-executing queries when multiple stages reference the same query.

```yaml
stage:
  name: stage_1
  outputs:
    matched:
      queries:
        - name: high_value_warnings
          rules_passed: [amount_exact, currency_match]
          rules_failed: [timestamp_window]
          cache: true  # Cache this query result for the workflow run

# Multiple stages can reference the same cached query
stage:
  name: stage_2
  inputs:
    source_a:
      type: stage_output
      stage: stage_1
      output_category: matched
      query: high_value_warnings  # Uses cached result

stage:
  name: stage_3
  inputs:
    source_a:
      type: stage_output
      stage: stage_1
      output_category: matched
      query: high_value_warnings  # Reuses same cached result
```

**Benefit**: Query is executed once when first referenced, then cached results are reused by subsequent stages.

## 7. Patch Management

### 7.1 What are Patches?

**Patches** are corrections or additions to source data that are applied during reconciliation without modifying the original data source.

**Use Case**: A transaction was recorded incorrectly in the source system, but can't be fixed directly. A patch provides the corrected data.

### 7.2 Patch File Structure

**Patch File** (`patch_2024-03-15.csv`):
```csv
patch_type,transaction_id,field,corrected_value,reason
UPDATE,TXN001,amount,100.50,"Amount was recorded as 100.00, should be 100.50"
UPDATE,TXN002,currency,EUR,"Currency was USD, should be EUR"
ADD,TXN999,amount,500.00,"Missing transaction from source"
DELETE,TXN003,,,,"Duplicate transaction, should be excluded"
```

### 7.3 Patch Application

**Configuration**:
```yaml
source:
  name: internal_ledger
  type: database
  query: "SELECT * FROM transactions WHERE date = '{date}'"

  patches:
    enabled: true
    patch_sources:
      - type: sftp
        file_pattern: /patches/ledger_patch_{year}{month}{day}.csv
      - type: manual
        file: /manual_patches/2024-03-15-corrections.csv

  patch_priority: latest  # If multiple patches for same record, use latest
```

**Patch Application Order**:
1. Fetch data from primary source
2. Apply patches in order of priority
3. Handle conflicts (multiple patches for same record)
4. Proceed with reconciliation

### 7.4 Patch Conflict Resolution

**Scenario**: Two patches update the same field for the same record.

**Patch 1**:
```csv
UPDATE,TXN001,amount,100.50,"Initial correction"
```

**Patch 2**:
```csv
UPDATE,TXN001,amount,100.75,"Further correction"
```

**Resolution Strategies**:
```yaml
patch_conflict_resolution:
  strategy: latest  # Options: latest, earliest, merge, error
```

- **latest**: Use Patch 2 (`amount = 100.75`)
- **earliest**: Use Patch 1 (`amount = 100.50`)
- **error**: Fail reconciliation, require manual resolution

### 7.5 Patch Audit Trail

**Requirement**: Track all patches applied during reconciliation.

```yaml
reconciliation_run:
  patches_applied:
    - source: internal_ledger
      patch_file: /patches/ledger_patch_20240315.csv
      patch_timestamp: 2024-03-15T08:00:00Z
      records_updated: 5
      records_added: 1
      records_deleted: 2
      changes:
        - record_id: TXN001
          patch_type: UPDATE
          field: amount
          old_value: 100.00
          new_value: 100.50
          reason: "Amount was recorded as 100.00, should be 100.50"
```

### 7.6 Patch Versioning

**Requirement**: Patches are versioned and tied to reconciliation runs.

```yaml
patch:
  patch_id: PATCH-2024-03-15-001
  version: 1
  source: internal_ledger
  created_by: jane.smith@company.com
  created_at: 2024-03-15T08:00:00Z
  approved_by: john.doe@company.com
  approved_at: 2024-03-15T09:00:00Z
  applied_in_runs:
    - RUN-2024-03-15-001
    - RUN-2024-03-15-002
```

## 8. Workflow Execution

### 8.1 Execution Modes

**Sequential Execution**: Stages run one after another
```yaml
workflow:
  execution_mode: sequential
  stages:
    - stage_1
    - stage_2
    - stage_3
```

**Parallel Execution**: Independent stages run concurrently
```yaml
workflow:
  execution_mode: parallel
  stages:
    - name: stage_1_ledger_gateway
      dependencies: []
    - name: stage_2_gateway_bank
      dependencies: []
    - name: stage_3_consolidation
      dependencies: [stage_1_ledger_gateway, stage_2_gateway_bank]
```

**Execution Flow**:
1. `stage_1` and `stage_2` run in parallel
2. `stage_3` waits for both to complete
3. `stage_3` runs with outputs from `stage_1` and `stage_2`

### 8.2 Error Handling

**Requirement**: Define behavior when a stage fails.

```yaml
workflow:
  error_handling:
    on_stage_failure:
      action: stop  # Options: stop, continue, skip_dependents
      notify:
        - john.doe@company.com
      retry:
        max_attempts: 3
        backoff: exponential
```

**Behaviors**:
- **stop**: Stop entire workflow
- **continue**: Continue with other independent stages
- **skip_dependents**: Skip stages that depend on failed stage

### 8.3 Workflow Monitoring

**Requirement**: Track workflow execution progress.

```yaml
workflow_execution:
  workflow_id: WORKFLOW-2024-03-15-001
  started_at: 2024-03-15T12:00:00Z
  status: in_progress

  stages:
    - name: stage_1_ledger_gateway
      status: completed
      started_at: 2024-03-15T12:00:00Z
      completed_at: 2024-03-15T12:00:30Z
      duration: 30s
      records_processed: 10000

    - name: stage_2_gateway_bank
      status: completed
      started_at: 2024-03-15T12:00:00Z
      completed_at: 2024-03-15T12:00:45Z
      duration: 45s
      records_processed: 9995

    - name: stage_3_consolidation
      status: in_progress
      started_at: 2024-03-15T12:00:50Z
      progress: 45%
      records_processed: 4500
      estimated_completion: 2024-03-15T12:01:20Z
```

## 9. Complete Workflow Example

### 9.1 Payment Gateway Three-Way Reconciliation

**Business Need**: Ensure internal ledger, payment gateway, and bank statement all agree.

```yaml
workflow:
  name: payment_three_way_reconciliation
  version: 1
  description: "Three-way reconciliation: Ledger vs Gateway vs Bank"

  reconciliation_unit:
    date: 2024-03-15

  execution_mode: sequential

  stages:
    # Stage 1: Internal Ledger vs Payment Gateway
    - name: ledger_vs_gateway
      order: 1
      inputs:
        source_a:
          type: data_source
          source: internal_ledger:v2
        source_b:
          type: data_source
          source: payment_gateway:v1
      processing:
        mode: one_to_one
        schema_a: ledger_schema:v1
        schema_b: gateway_schema:v1
        matching_rules: ledger_gateway_rules:v2
      outputs:
        matched:
          storage:
            type: csv
            path: stage_1_matched.csv
        unmatched_left:
          storage:
            type: csv
            path: stage_1_unmatched_ledger.csv
        unmatched_right:
          storage:
            type: csv
            path: stage_1_unmatched_gateway.csv

    # Stage 2: Payment Gateway vs Bank Statement
    - name: gateway_vs_bank
      order: 2
      inputs:
        source_a:
          type: data_source
          source: payment_gateway:v1
        source_b:
          type: data_source
          source: bank_statement:v1
      processing:
        mode: one_to_one
        schema_a: gateway_schema:v1
        schema_b: bank_schema:v1
        matching_rules: gateway_bank_rules:v1
      outputs:
        matched:
          storage:
            type: csv
            path: stage_2_matched.csv
        unmatched_left:
          storage:
            type: csv
            path: stage_2_unmatched_gateway.csv
        unmatched_right:
          storage:
            type: csv
            path: stage_2_unmatched_bank.csv

    # Stage 3: Consolidate - Find records matched in both stages
    - name: three_way_consolidation
      order: 3
      dependencies:
        - ledger_vs_gateway
        - gateway_vs_bank
      inputs:
        source_a:
          type: stage_output
          stage: ledger_vs_gateway
          output_category: matched
        source_b:
          type: stage_output
          stage: gateway_vs_bank
          output_category: matched
      processing:
        mode: one_to_one
        matching_rules: consolidation_rules:v1
      outputs:
        matched:
          name: three_way_matched
          description: "Records matched across all three sources"
        unmatched_left:
          name: ledger_gateway_only
          description: "Matched in ledger/gateway but not in bank"
        unmatched_right:
          name: gateway_bank_only
          description: "Matched in gateway/bank but not in ledger"

  final_outputs:
    - name: three_way_matched
      stage: three_way_consolidation
      category: matched
      export:
        format: csv
        filename: three_way_matched_{date}.csv

    - name: exceptions
      type: aggregated
      sources:
        - stage: ledger_vs_gateway
          category: unmatched_left
        - stage: ledger_vs_gateway
          category: unmatched_right
        - stage: three_way_consolidation
          category: unmatched_left
        - stage: three_way_consolidation
          category: unmatched_right
      export:
        format: csv
        filename: exceptions_{date}.csv
```

## 10. Open Questions

2. **Workflow Templates**: Pre-built workflow templates for common patterns?

4. **Checkpointing**: Save intermediate state to resume from failure point?

5. **Workflow Visualization**: UI to visualize workflow DAG and execution progress?
