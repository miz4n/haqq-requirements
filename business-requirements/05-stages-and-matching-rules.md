# Stages and Matching Rules

## 1. Overview

The reconciliation engine uses a **multi-stage workflow** where each stage reconciles two data sources using **JOIN conditions** and optional **matching rules**. This document covers:

- **Stages**: Individual reconciliation units with JOIN conditions and rules
- **Matching Rules**: Composable expressions that validate matched record pairs
- **Workflows**: Orchestration of multiple stages with dependencies
- **Result Queries**: Named filters for routing matched records to subsequent stages

### 1.1 Key Concepts

| Concept | Description |
|---------|-------------|
| **Stage** | A single reconciliation operation between two data sources |
| **JOIN Condition** | Equality-based condition to match records (like SQL JOIN) |
| **Matching Rule** | Composable expression to validate matched pairs |
| **Result Query** | Named filter based on which rules passed/failed |
| **Workflow** | Directed acyclic graph (DAG) of stages |

### 1.2 Stage-Centric Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        STAGE                                │
├─────────────────────────────────────────────────────────────┤
│  Data Sources: Left Source ←→ Right Source                  │
│                                                             │
│  JOIN Conditions:                                           │
│    source_left.transaction_id = source_right.transaction_id │
│                                                             │
│  Deduplication Order:                                       │
│    Left: updated_at DESC, id ASC                            │
│    Right: created_at DESC                                   │
│                                                             │
│  Matching Rules:                                            │
│    1. currency_match (error): currency_a = currency_b       │
│    2. amount_tolerance (error): ABS(amt_a - amt_b) <= 0.01  │
│    3. timestamp_window (warning): DATE_DIFF(...) <= 300    │
│                                                             │
│  Result Queries:                                            │
│    - perfect_matches: all rules PASS                        │
│    - timestamp_warnings: rules 1,2 PASS, rule 3 FAIL        │
│                                                             │
│  Outputs: matched, unmatched_left, unmatched_right,         │
│           duplicates_left, duplicates_right                 │
└─────────────────────────────────────────────────────────────┘
```

## 2. Stage Configuration

### 2.1 Stage Definition

```yaml
stage:
  id: stage_001
  name: ledger_gateway_reconciliation
  description: "Reconcile internal ledger with payment gateway"
  order: 1
  mode: one_to_one  # one_to_one | one_to_many | many_to_many

  # Data sources
  datasource_left:
    type: datasource
    datasource_id: internal_ledger
  datasource_right:
    type: datasource
    datasource_id: payment_gateway

  # JOIN conditions (required)
  join_conditions:
    - left_field: source_left.transaction_id
      right_field: source_right.transaction_ref

  # Deduplication ordering (optional)
  deduplication_order:
    enabled: true
    left:
      - field: source_left.updated_at
        direction: desc
      - field: source_left.id
        direction: asc
    right:
      - field: source_right.created_at
        direction: desc

  # Matching rules (optional)
  rules:
    - name: currency_match
      severity: error
      expression: { ... }
    - name: amount_tolerance
      severity: error
      expression: { ... }

  # Result queries (optional)
  result_queries:
    - name: perfect_matches
      rules_passed: [currency_match, amount_tolerance]

  # Outputs
  outputs:
    matched:
      enabled: true
      path: /results/{run_id}/stage1_matched.csv
    unmatched_left:
      enabled: true
      path: /results/{run_id}/stage1_unmatched_left.csv
    unmatched_right:
      enabled: true
      path: /results/{run_id}/stage1_unmatched_right.csv
    duplicates_left:
      enabled: true
      path: /results/{run_id}/stage1_duplicates_left.csv
    duplicates_right:
      enabled: true
      path: /results/{run_id}/stage1_duplicates_right.csv
```

### 2.2 Data Sources

Stage inputs can be:
1. **Configured data sources** from Step 2 (Data Sources)
2. **Previous stage outputs** (matched, unmatched_left, unmatched_right)
3. **Named query results** from previous stages

**Example: Using previous stage output**
```yaml
stage:
  name: exception_analysis
  order: 2

  datasource_left:
    type: stage_output
    stage_id: stage_001
    output_query: unmatched_left

  datasource_right:
    type: stage_output
    stage_id: stage_001
    output_query: unmatched_right
```

**Example: Using named query result**
```yaml
stage:
  name: timestamp_warning_analysis
  order: 2

  datasource_left:
    type: stage_output
    stage_id: stage_001
    output_query: timestamp_warnings  # Named query from stage_001
```

### 2.3 JOIN Conditions

**Requirement**: Define how records from two sources should be matched (like SQL JOIN).

**Single Column JOIN**:
```yaml
join_conditions:
  - left_field: source_left.transaction_id
    right_field: source_right.transaction_id
```

**Multi-Column JOIN** (composite key):
```yaml
join_conditions:
  - left_field: source_left.merchant_id
    right_field: source_right.merchant_id
  - left_field: source_left.transaction_date
    right_field: source_right.transaction_date
```

**Note**: JOIN conditions are always equality-based (`=` is implicit).

### 2.4 Deduplication Ordering

**Requirement**: When JOIN conditions produce multiple matching records, define ordering to select which record to use.

**Use Case**: A payment gateway may have multiple records for the same transaction (e.g., status updates). Use deduplication ordering to select the latest record.

```yaml
deduplication_order:
  enabled: true
  left:
    - field: source_left.updated_at
      direction: desc  # Most recent first
    - field: source_left.id
      direction: asc   # Tie-breaker
  right:
    - field: source_right.created_at
      direction: desc
    - field: source_right.sequence_number
      direction: desc  # Tie-breaker if same timestamp
```

**Behavior**:
1. JOIN conditions are evaluated first
2. If multiple records match on either side:
   - Records are ordered by specified fields
   - First record after ordering is used for matching
   - Remaining duplicates are tracked in `duplicates_left` / `duplicates_right` outputs
3. Ordering supports multiple columns for tie-breaking
4. Each side (left/right) can have independent ordering rules

## 3. Composable Expression Model

### 3.1 Expression Block Types

Matching rules use a composable expression model where expressions can contain other expressions:

| Block Type | Category | Slots/Children | Operators |
|------------|----------|----------------|-----------|
| `comparison` | comparison | `left`, `right` (expressions) | `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `IN` |
| `boolean` | boolean | `children` (array of expressions) | `AND`, `OR`, `NOT` |
| `field_reference` | field | - (leaf node) | - |
| `literal` | literal | - (leaf node) | string, number, boolean, null |
| `function` | function | `arguments` (array of expressions) | ABS, MIN, MAX, ROUND, etc. |
| `arithmetic` | arithmetic | `left`, `right` (expressions) | `+`, `-`, `*`, `/` |

### 3.2 Available Functions

| Function | Args | Description |
|----------|------|-------------|
| `ABS` | 1 | Absolute value |
| `MIN` | n | Minimum value (variable args) |
| `MAX` | n | Maximum value (variable args) |
| `ROUND` | 2 | Round to precision |
| `FLOOR` | 1 | Round down |
| `CEIL` | 1 | Round up |
| `UPPER` | 1 | Uppercase string |
| `LOWER` | 1 | Lowercase string |
| `TRIM` | 1 | Remove whitespace |
| `COALESCE` | n | First non-null (variable args) |
| `DATE_DIFF` | 3 | Date difference (date1, date2, unit) |

### 3.3 Expression Examples

**Simple Comparison** (field = field):
```yaml
expression:
  type: comparison
  operator: "="
  left: { type: field_reference, field: source_left.currency }
  right: { type: field_reference, field: source_right.currency }
```

**Nested Expression** (ABS(field - field) <= literal):
```yaml
expression:
  type: comparison
  operator: "<="
  left:
    type: function
    name: ABS
    arguments:
      - type: arithmetic
        operator: "-"
        left: { type: field_reference, field: source_left.amount }
        right: { type: field_reference, field: source_right.amount }
  right: { type: literal, value: 0.01, value_type: number }
```

**Boolean Combination** (AND with multiple conditions):
```yaml
expression:
  type: boolean
  operator: AND
  children:
    - type: comparison
      operator: "="
      left: { type: field_reference, field: source_left.currency }
      right: { type: field_reference, field: source_right.currency }
    - type: comparison
      operator: "<="
      left:
        type: function
        name: ABS
        arguments:
          - type: arithmetic
            operator: "-"
            left: { type: field_reference, field: source_left.amount }
            right: { type: field_reference, field: source_right.amount }
      right: { type: literal, value: 0.01, value_type: number }
```

**Time Window** (DATE_DIFF with ABS):
```yaml
expression:
  type: comparison
  operator: "<="
  left:
    type: function
    name: ABS
    arguments:
      - type: function
        name: DATE_DIFF
        arguments:
          - { type: field_reference, field: source_left.transaction_timestamp }
          - { type: field_reference, field: source_right.created_timestamp }
          - { type: literal, value: "seconds", value_type: string }
  right: { type: literal, value: 300, value_type: number }  # 5 minutes
```

### 3.4 Python Functions for Complex Logic

For logic that cannot be expressed as composable expressions (tiered fees, business day calculations), use Python functions:

```yaml
functions:
  validate_tiered_fee:
    type: function
    decorator: "@numba.jit(nopython=True)"
    code: |
      def validate_tiered_fee(amount_a: float, fee_b: float) -> bool:
          if amount_a <= 100:
              expected_fee = 2.50
          elif amount_a <= 1000:
              expected_fee = 5.00
          else:
              expected_fee = amount_a * 0.005
          return abs(expected_fee - fee_b) <= 0.10

  check_business_days:
    type: function
    code: |
      import numpy as np

      def check_business_days(start_date, end_date, min_days: int, max_days: int) -> bool:
          bus_days = np.busday_count(start_date, end_date)
          return min_days <= bus_days <= max_days

# Reference in rule
rules:
  - name: fee_validation
    severity: error
    expression:
      type: function
      name: validate_tiered_fee
      arguments:
        - { type: field_reference, field: source_left.amount }
        - { type: field_reference, field: source_right.fee_amount }
```

### 3.5 Execution Environment

| Expression Type | Description | Performance |
|-----------------|-------------|-------------|
| Composable blocks | Tree-based expressions | Translated to Polars - runs in Rust |
| Python function | Custom Python function | JIT compiled with Numba |

**Execution Limits**:
- Timeout per batch: 30 seconds
- Maximum memory: 500MB

## 4. Matching Rules

### 4.1 Rule Structure

Each rule has:
- **name**: Unique identifier within the stage
- **description**: Human-readable description (optional)
- **severity**: `error` or `warning`
- **expression**: Composable expression tree

```yaml
rules:
  - name: currency_match
    description: "Currencies must match exactly"
    severity: error
    expression:
      type: comparison
      operator: "="
      left: { type: field_reference, field: source_left.currency }
      right: { type: field_reference, field: source_right.currency }

  - name: amount_tolerance
    description: "Amount difference within $0.01"
    severity: error
    expression:
      type: comparison
      operator: "<="
      left:
        type: function
        name: ABS
        arguments:
          - type: arithmetic
            operator: "-"
            left: { type: field_reference, field: source_left.amount }
            right: { type: field_reference, field: source_right.amount }
      right: { type: literal, value: 0.01, value_type: number }

  - name: timestamp_window
    description: "Timestamps within 5 minutes"
    severity: warning
    expression:
      type: comparison
      operator: "<="
      left:
        type: function
        name: ABS
        arguments:
          - type: function
            name: DATE_DIFF
            arguments:
              - { type: field_reference, field: source_left.created_at }
              - { type: field_reference, field: source_right.transaction_time }
              - { type: literal, value: "seconds", value_type: string }
      right: { type: literal, value: 300, value_type: number }
```

### 4.2 Rule Evaluation Order

**Requirement**: Rules execute in the order they are declared (top to bottom).

**Evaluation Logic**:
1. Rules execute in declaration order
2. If **error** rule fails → record pair marked as non-matching
3. If **warning** rule fails → record pair marked as matched with warning
4. Record pair must satisfy all **error** rules to be considered a match

### 4.3 Rule Severity Levels

| Severity | Behavior | Use Case |
|----------|----------|----------|
| `error` | Must match for overall match | Critical fields (ID, amount) |
| `warning` | Record warnings but allow match | Non-critical discrepancies (timestamps) |

### 4.4 Rules are Optional

Rules are optional. If no rules are defined, records will be matched based on JOIN conditions only. This is useful for simple reconciliations where the JOIN key is sufficient.

```yaml
stage:
  name: simple_reconciliation
  join_conditions:
    - left_field: source_left.id
      right_field: source_right.id
  rules: []  # No additional validation rules
```

## 5. Result Queries

### 5.1 What are Result Queries?

Result queries are named filters that categorize matched records based on which rules passed or failed. They enable routing specific record groups to subsequent stages.

### 5.2 Query Definition

```yaml
result_queries:
  - name: perfect_matches
    description: "All rules passed"
    rules_passed: [currency_match, amount_tolerance, timestamp_window]
    rules_failed: []

  - name: timestamp_warnings
    description: "Amount matched but timestamp outside window"
    rules_passed: [currency_match, amount_tolerance]
    rules_failed: [timestamp_window]

  - name: amount_warnings
    description: "Currency matched but amount differs"
    rules_passed: [currency_match, timestamp_window]
    rules_failed: [amount_tolerance]
```

### 5.3 Using Queries in Subsequent Stages

```yaml
# Stage 1 defines queries
stage:
  name: stage_1
  result_queries:
    - name: timestamp_warnings
      rules_passed: [currency_match, amount_tolerance]
      rules_failed: [timestamp_window]

# Stage 2 uses the query result
stage:
  name: timestamp_analysis
  datasource_left:
    type: stage_output
    stage_id: stage_1
    output_query: timestamp_warnings  # Only records with timestamp warnings
```

### 5.4 Query Caching

**Requirement**: Query results should be cached to avoid re-execution when multiple stages reference the same query.

```yaml
result_queries:
  - name: high_value_warnings
    rules_passed: [currency_match]
    rules_failed: [amount_tolerance]
    cache: true  # Cache for the workflow run
```

## 6. Stage Outputs

### 6.1 Output Categories

Each stage produces these output categories:

| Category | Description |
|----------|-------------|
| `matched` | Records that matched JOIN conditions and passed all error rules |
| `unmatched_left` | Left source records with no match |
| `unmatched_right` | Right source records with no match |
| `duplicates_left` | Left source duplicates (when deduplication is enabled) |
| `duplicates_right` | Right source duplicates (when deduplication is enabled) |

### 6.2 Output Schema

**Matched Output Schema**:
```yaml
schema:
  fields:
    - name: source_left_transaction_id
      type: string
    - name: source_left_amount
      type: decimal
    - name: source_left_currency
      type: string
    - name: source_right_transaction_id
      type: string
    - name: source_right_amount
      type: decimal
    - name: source_right_currency
      type: string
    - name: match_id
      type: string
    - name: rules_passed
      type: string  # Comma-separated list
    - name: rules_failed
      type: string  # Comma-separated list
    - name: matched_at
      type: timestamp
    - name: duplicate_count_left
      type: integer
    - name: duplicate_count_right
      type: integer
```

**Duplicate Records Schema**:
```yaml
schema:
  fields:
    - name: original_record_id
      type: string
      description: "ID of the record that was selected"
    - name: duplicate_record_id
      type: string
      description: "ID of this duplicate record"
    - name: join_key_values
      type: string
      description: "Values used in JOIN condition"
    - name: ordering_field_values
      type: string
      description: "Values of fields used for ordering"
    - name: reason
      type: string
      description: "Why this was not selected (e.g., 'older timestamp')"
```

### 6.3 Output Storage

```yaml
outputs:
  matched:
    enabled: true
    storage:
      type: csv
      path: /results/{run_id}/stage1_matched.csv
  unmatched_left:
    enabled: true
    storage:
      type: csv
      path: /results/{run_id}/stage1_unmatched_left.csv
  duplicates_left:
    enabled: true
    storage:
      type: csv
      path: /results/{run_id}/stage1_duplicates_left.csv
```

## 7. Workflows

### 7.1 Workflow Definition

A workflow is a directed acyclic graph (DAG) of stages:

```yaml
workflow:
  name: three_way_reconciliation
  version: 1
  description: "Ledger vs Gateway vs Bank"

  execution_mode: parallel  # sequential | parallel

  stages:
    - name: ledger_vs_gateway
      order: 1
      dependencies: []

    - name: gateway_vs_bank
      order: 1
      dependencies: []

    - name: consolidation
      order: 2
      dependencies: [ledger_vs_gateway, gateway_vs_bank]
```

### 7.2 Execution Modes

**Sequential**: Stages run one after another
```yaml
execution_mode: sequential
```

**Parallel**: Independent stages run concurrently
```yaml
execution_mode: parallel
# stage_1 and stage_2 run in parallel
# stage_3 waits for both to complete
```

### 7.3 Stage Dependencies

```yaml
stage:
  name: consolidation
  order: 3
  dependencies:
    - ledger_vs_gateway
    - gateway_vs_bank

  condition:  # Only run if previous stages succeeded
    - stage: ledger_vs_gateway
      status: completed
    - stage: gateway_vs_bank
      status: completed
```

### 7.4 Conditional Stage Execution

```yaml
stage:
  name: exception_handling
  order: 2

  condition:
    type: threshold
    expression:
      type: comparison
      operator: ">"
      left:
        type: arithmetic
        operator: "/"
        left: { type: field_reference, field: stage_1.unmatched_left.count }
        right: { type: field_reference, field: stage_1.total_records }
      right: { type: literal, value: 0.05, value_type: number }
```

**Meaning**: Only run this stage if > 5% of records are unmatched.

### 7.5 Error Handling

```yaml
workflow:
  error_handling:
    on_stage_failure:
      action: stop  # stop | continue | skip_dependents
      notify:
        - john.doe@company.com
      retry:
        max_attempts: 3
        backoff: exponential
```

### 7.6 Workflow Monitoring

```yaml
workflow_execution:
  workflow_id: WORKFLOW-2024-03-15-001
  started_at: 2024-03-15T12:00:00Z
  status: in_progress

  stages:
    - name: ledger_vs_gateway
      status: completed
      started_at: 2024-03-15T12:00:00Z
      completed_at: 2024-03-15T12:00:30Z
      duration: 30s
      records_processed: 10000
      duplicates:
        left: 150
        right: 87

    - name: gateway_vs_bank
      status: in_progress
      progress: 45%
      records_processed: 4500
```

## 8. Real-World Examples

### 8.1 Payment Gateway Reconciliation

```yaml
workflow:
  name: payment_gateway_reconciliation
  version: 1

  stages:
    - name: ledger_vs_gateway
      order: 1

      datasource_left:
        type: datasource
        datasource_id: internal_ledger
      datasource_right:
        type: datasource
        datasource_id: payment_gateway

      join_conditions:
        - left_field: source_left.transaction_id
          right_field: source_right.transaction_ref

      deduplication_order:
        enabled: true
        left:
          - field: source_left.updated_at
            direction: desc
        right:
          - field: source_right.created_at
            direction: desc

      functions:
        validate_gateway_fee:
          type: function
          code: |
            def validate_gateway_fee(gross_amount: float, fee_amount: float) -> bool:
                expected_fee = gross_amount * 0.029 + 0.30
                return abs(expected_fee - fee_amount) <= 0.05

      rules:
        - name: amount_tolerance
          severity: error
          expression:
            type: comparison
            operator: "<="
            left:
              type: function
              name: ABS
              arguments:
                - type: arithmetic
                  operator: "-"
                  left: { type: field_reference, field: source_left.amount }
                  right: { type: field_reference, field: source_right.gross_amount }
            right: { type: literal, value: 0.05, value_type: number }

        - name: currency_match
          severity: error
          expression:
            type: comparison
            operator: "="
            left: { type: field_reference, field: source_left.currency }
            right: { type: field_reference, field: source_right.currency }

        - name: fee_validation
          severity: warning
          expression:
            type: function
            name: validate_gateway_fee
            arguments:
              - { type: field_reference, field: source_right.gross_amount }
              - { type: field_reference, field: source_right.fee_amount }

        - name: timestamp_window
          severity: warning
          expression:
            type: comparison
            operator: "<="
            left:
              type: function
              name: ABS
              arguments:
                - type: function
                  name: DATE_DIFF
                  arguments:
                    - { type: field_reference, field: source_left.created_at }
                    - { type: field_reference, field: source_right.transaction_time }
                    - { type: literal, value: "seconds", value_type: string }
            right: { type: literal, value: 600, value_type: number }

      result_queries:
        - name: perfect_matches
          rules_passed: [amount_tolerance, currency_match, fee_validation, timestamp_window]

        - name: fee_warnings
          rules_passed: [amount_tolerance, currency_match]
          rules_failed: [fee_validation]

        - name: timestamp_warnings
          rules_passed: [amount_tolerance, currency_match]
          rules_failed: [timestamp_window]

      outputs:
        matched:
          enabled: true
          path: /results/{run_id}/matched.csv
        unmatched_left:
          enabled: true
          path: /results/{run_id}/unmatched_ledger.csv
        unmatched_right:
          enabled: true
          path: /results/{run_id}/unmatched_gateway.csv
        duplicates_left:
          enabled: true
          path: /results/{run_id}/duplicates_ledger.csv
        duplicates_right:
          enabled: true
          path: /results/{run_id}/duplicates_gateway.csv
```

### 8.2 Three-Way Reconciliation

```yaml
workflow:
  name: three_way_reconciliation
  version: 1
  execution_mode: parallel

  stages:
    # Stage 1: Ledger vs Gateway (runs in parallel with Stage 2)
    - name: ledger_vs_gateway
      order: 1
      dependencies: []

      datasource_left:
        type: datasource
        datasource_id: internal_ledger
      datasource_right:
        type: datasource
        datasource_id: payment_gateway

      join_conditions:
        - left_field: source_left.transaction_id
          right_field: source_right.transaction_ref

      rules:
        - name: amount_match
          severity: error
          expression:
            type: comparison
            operator: "<="
            left:
              type: function
              name: ABS
              arguments:
                - type: arithmetic
                  operator: "-"
                  left: { type: field_reference, field: source_left.amount }
                  right: { type: field_reference, field: source_right.amount }
            right: { type: literal, value: 0.05, value_type: number }

    # Stage 2: Gateway vs Bank (runs in parallel with Stage 1)
    - name: gateway_vs_bank
      order: 1
      dependencies: []

      datasource_left:
        type: datasource
        datasource_id: payment_gateway
      datasource_right:
        type: datasource
        datasource_id: bank_statement

      join_conditions:
        - left_field: source_left.bank_reference
          right_field: source_right.reference

      rules:
        - name: amount_match
          severity: error
          expression:
            type: comparison
            operator: "="
            left: { type: field_reference, field: source_left.net_amount }
            right: { type: field_reference, field: source_right.amount }

    # Stage 3: Consolidate matched records
    - name: consolidation
      order: 2
      dependencies: [ledger_vs_gateway, gateway_vs_bank]

      datasource_left:
        type: stage_output
        stage_id: ledger_vs_gateway
        output_query: matched
      datasource_right:
        type: stage_output
        stage_id: gateway_vs_bank
        output_query: matched

      join_conditions:
        - left_field: source_left.source_right_transaction_ref
          right_field: source_right.source_left_transaction_ref

      rules: []  # JOIN only - no additional rules

      outputs:
        matched:
          name: three_way_matched
          description: "Records matched across all three sources"
        unmatched_left:
          name: ledger_gateway_only
          description: "Matched ledger/gateway but not in bank"
        unmatched_right:
          name: gateway_bank_only
          description: "Matched gateway/bank but not in ledger"
```

### 8.3 Exception Re-Reconciliation

```yaml
workflow:
  name: exception_re_reconciliation
  version: 1
  execution_mode: sequential

  stages:
    # Stage 1: Strict matching
    - name: strict_matching
      order: 1

      datasource_left:
        type: datasource
        datasource_id: source_a
      datasource_right:
        type: datasource
        datasource_id: source_b

      join_conditions:
        - left_field: source_left.id
          right_field: source_right.id

      rules:
        - name: exact_amount
          severity: error
          expression:
            type: comparison
            operator: "="
            left: { type: field_reference, field: source_left.amount }
            right: { type: field_reference, field: source_right.amount }

        - name: exact_date
          severity: error
          expression:
            type: comparison
            operator: "="
            left: { type: field_reference, field: source_left.date }
            right: { type: field_reference, field: source_right.date }

    # Stage 2: Relaxed matching on unmatched
    - name: relaxed_matching
      order: 2
      dependencies: [strict_matching]

      datasource_left:
        type: stage_output
        stage_id: strict_matching
        output_query: unmatched_left
      datasource_right:
        type: stage_output
        stage_id: strict_matching
        output_query: unmatched_right

      join_conditions:
        - left_field: source_left.id
          right_field: source_right.id

      rules:
        - name: amount_tolerance
          severity: error
          expression:
            type: comparison
            operator: "<="
            left:
              type: function
              name: ABS
              arguments:
                - type: arithmetic
                  operator: "-"
                  left: { type: field_reference, field: source_left.amount }
                  right: { type: field_reference, field: source_right.amount }
            right: { type: literal, value: 1.00, value_type: number }  # $1 tolerance

        - name: date_window
          severity: error
          expression:
            type: comparison
            operator: "<="
            left:
              type: function
              name: ABS
              arguments:
                - type: function
                  name: DATE_DIFF
                  arguments:
                    - { type: field_reference, field: source_left.date }
                    - { type: field_reference, field: source_right.date }
                    - { type: literal, value: "days", value_type: string }
            right: { type: literal, value: 3, value_type: number }  # 3 day window

    # Stage 3: Manual review queue
    - name: manual_review
      order: 3
      dependencies: [relaxed_matching]

      condition:
        type: threshold
        expression:
          type: comparison
          operator: ">"
          left: { type: field_reference, field: relaxed_matching.unmatched_left.count }
          right: { type: literal, value: 0, value_type: number }

      datasource_left:
        type: stage_output
        stage_id: relaxed_matching
        output_query: unmatched_left
      datasource_right:
        type: stage_output
        stage_id: relaxed_matching
        output_query: unmatched_right

      # Fuzzy matching for manual review
      join_conditions:
        - left_field: source_left.reference
          right_field: source_right.reference

      rules: []  # All joined pairs go to manual review
```

## 9. Rule Versioning

**Requirement**: All rule configurations must be versioned.

```yaml
workflow:
  name: payment_reconciliation
  version: 3
  created_at: 2024-01-15T10:00:00Z
  updated_at: 2024-03-01T14:30:00Z

  changelog:
    - version: 3
      date: 2024-03-01
      changes: "Increased amount tolerance from $0.01 to $0.05"
    - version: 2
      date: 2024-02-01
      changes: "Added timestamp window rule"
    - version: 1
      date: 2024-01-15
      changes: "Initial workflow"
```

## 10. Optimization

### 10.1 Indexing

**Requirement**: System should build indexes on JOIN key fields.

```yaml
stage:
  optimization:
    index_fields:
      - source_left.transaction_id
      - source_right.transaction_id
```

### 10.2 Early Termination

**Requirement**: Stop evaluating rules once a critical error rule fails.

```yaml
stage:
  optimization:
    early_termination: true  # Stop on first error rule failure
```

### 10.3 Rule Statistics

Track rule match rates for optimization:

```
Rule Match Statistics - Stage: ledger_vs_gateway

Total Record Pairs Evaluated: 125,000

Rule: amount_tolerance
  Matched: 124,500 (99.6%)
  Failed: 350 (0.28%)
  Avg Difference: $0.02

Rule: currency_match
  Matched: 124,850 (100%)
  Failed: 0 (0%)

Rule: timestamp_window
  Matched: 123,000 (98.4%)
  Failed: 1,850 (1.48%)
  Avg Time Difference: 3.2 minutes
```

## 11. Patch Management

### 11.1 What are Patches?

Patches are corrections or additions to source data applied during reconciliation without modifying the original data source.

### 11.2 Patch Application

```yaml
datasource:
  name: internal_ledger
  patches:
    enabled: true
    patch_sources:
      - type: sftp
        file_pattern: /patches/ledger_patch_{year}{month}{day}.csv
      - type: manual
        file: /manual_patches/corrections.csv
    patch_priority: latest
```

### 11.3 Patch Audit Trail

```yaml
reconciliation_run:
  patches_applied:
    - source: internal_ledger
      patch_file: /patches/ledger_patch_20240315.csv
      patch_timestamp: 2024-03-15T08:00:00Z
      records_updated: 5
      records_added: 1
      records_deleted: 2
```

## 12. Open Questions

1. **Machine Learning Rules**: Should the system support ML-based matching (fuzzy matching, similarity scores)?

2. **Rule Testing**: Provide sandbox environment to test rules against sample data before deployment?

3. **Workflow Templates**: Pre-built workflow templates for common patterns?

4. **Checkpointing**: Save intermediate state to resume from failure point?

5. **Workflow Visualization**: UI to visualize workflow DAG and execution progress?
