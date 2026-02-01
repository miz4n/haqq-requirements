# Results and Queryability

## 1. Overview

Reconciliation results must be:
- **Queryable**: Filter results by rule match status and result category
- **Explainable**: Every match/mismatch decision is traceable
- **Exportable**: Results can be exported to CSV format
- **Immutable**: Once generated, results cannot be modified
- **Auditable**: Complete audit trail of reconciliation execution

## 2. Result Structure

### 2.1 Result Categories

Every reconciliation produces three primary result sets:

| Category | Description | SQL Equivalent |
|----------|-------------|----------------|
| **Matched** | Records that matched based on rules | INNER JOIN where all rules passed |
| **Unmatched Left** | Records in Source A with no match in Source B | LEFT OUTER JOIN where B is NULL |
| **Unmatched Right** | Records in Source B with no match in Source A | RIGHT OUTER JOIN where A is NULL |

## 3. Rule Match Groups

### 3.1 Definition

**Rule Match Group**: The set of rules that passed/failed for a given record pair.

**Requirement**: Records can be queried by which rules they matched or didn't match.

### 3.2 Match Group Notation

Similar to regex capture groups, each rule match can be tracked:

**Example**: Rules: `R1`, `R2`, `R3`

| Match Group | Description | Rules Passed | Rules Failed |
|-------------|-------------|--------------|--------------|
| `[R1, R2, R3]` | Perfect match | R1, R2, R3 | None |
| `[R1, R2, !R3]` | Partial match | R1, R2 | R3 |
| `[R1, !R2, !R3]` | Weak match | R1 | R2, R3 |
| `[!R1, *, *]` | No match | None | R1 (short-circuit) |

### 3.3 Query by Match Group

**Example Query**: Find all records where amount matched but timestamp didn't.

```sql
SELECT * FROM matched_records
WHERE match_group LIKE '[join_on_id, amount_tolerance, !timestamp_window]'
```

**YAML Query**:
```yaml
query:
  match_group:
    rules_passed:
      - join_on_id
      - amount_tolerance
    rules_failed:
      - timestamp_window
```

### 3.4 Match Group Statistics

**Reconciliation Run Summary**:
```
Match Group Distribution:

[R1, R2, R3]: 9,850 records (98.5%) - Perfect matches
[R1, R2, !R3]: 120 records (1.2%) - Timestamp warning
[R1, !R2, R3]: 25 records (0.25%) - Amount mismatch
[!R1, *, *]: 5 records (0.05%) - ID not found
```

## 4. Queryability

### 4.1 Query Capabilities

The system supports querying reconciliation results by:

| Query Type | Description | Example |
|------------|-------------|---------|
| **Result category** | Select which result set to query | matched, unmatched_left, unmatched_right |
| **Rule match status** | Records that passed/failed specific rules | All records where rule1 passed AND rule2 failed |
| **Boolean combinations** | Combine multiple rule conditions | matched rule1 AND rule2 NOT rule3 |

**Note**: Only rule-based queries are supported. Arbitrary field-based queries, aggregations, and full-text search are not supported.

### 4.2 Query Examples

#### Query 1: Get all matched records

```yaml
query:
  result_category: matched
```

#### Query 2: Get all unmatched records from Source A

```yaml
query:
  result_category: unmatched_left
```

#### Query 3: Get all unmatched records from Source B

```yaml
query:
  result_category: unmatched_right
```

#### Query 4: Get matched records where specific rules passed

```yaml
query:
  result_category: matched
  rules_passed:
    - amount_tolerance
    - currency_match
```

#### Query 5: Get matched records where specific rule failed

```yaml
query:
  result_category: matched
  rules_failed:
    - timestamp_window
```

#### Query 6: Boolean combination - AND operator

```yaml
query:
  result_category: matched
  rules_passed:
    - amount_tolerance
    - currency_match
  rules_failed:
    - timestamp_window
```

This returns records where `amount_tolerance` AND `currency_match` passed AND `timestamp_window` failed.

#### Query 7: Boolean combination - OR operator for passed rules

```yaml
query:
  result_category: matched
  rules_passed_any:
    - reference_match_primary
    - reference_match_secondary
```

This returns records where EITHER `reference_match_primary` OR `reference_match_secondary` passed.

## 5. Explainability

### 5.1 Match Explanation

For every matched record, the system must record:

- **Rule name and version** applied
- **Fields compared** in each rule
- **Values used** from both sources
- **Tolerances applied** (if any)
- **Stage where match occurred** (for multi-stage reconciliation)
- **Execution timestamp**

### 5.2 Detailed Match Report

**Example**:
```
Match Report: MATCH-2024-03-15-0001

Transaction ID: TXN001
Reconciliation Run: RUN-2024-03-15-001
Matched At: 2024-03-15T12:00:05Z

Rule Evaluation:
1. join_on_transaction_id (v1) - PASSED
   - Source A: transaction_id = "TXN001"
   - Source B: transaction_id = "TXN001"
   - Condition: source_a.transaction_id = source_b.transaction_id
   - Result: TRUE

2. amount_tolerance (v1) - PASSED
   - Source A: amount = 100.50
   - Source B: amount = 100.50
   - Condition: abs(source_a.amount - source_b.amount) <= 0.01
   - Difference: 0.00
   - Tolerance: 0.01
   - Result: TRUE

3. currency_match (v1) - PASSED
   - Source A: currency = "USD"
   - Source B: currency = "USD"
   - Condition: source_a.currency = source_b.currency
   - Result: TRUE

4. timestamp_window (v1) - WARNING
   - Source A: created_at = 2024-03-15T10:00:00Z
   - Source B: transaction_time = 2024-03-15T10:15:00Z
   - Condition: abs(source_a.created_at - source_b.transaction_time) <= 600s
   - Difference: 900 seconds (15 minutes)
   - Threshold: 600 seconds (10 minutes)
   - Result: WARN

Overall Result: MATCHED (with 1 warning)
Match Confidence: 0.90
```

### 5.3 Non-Match Explanation

For unmatched records, explain why no match was found:

```
Non-Match Report: UNMATCH-LEFT-2024-03-15-0005

Transaction ID: TXN005
Reconciliation Run: RUN-2024-03-15-001
Source: Source A (Internal Ledger)
Status: Unmatched Left

Reason: No matching record found in Source B

Potential Matches Analyzed:
None found.

Possible Causes:
- Transaction may not have been processed by Source B yet
- Transaction ID may be incorrect or mismatched
- Transaction may have been filtered out during Source B data fetch

Recommendation: Review Source B data for missing transactions
```

## 6. Export Capabilities

### 6.1 Export Formats

**Requirement**: Support exporting results in CSV format only.

| Format | Use Case |
|--------|----------|
| **CSV** | Excel analysis, data import, audit trails |

### 6.2 Export Scope

Users can export the following result categories:

- **Matched records**: All records that passed join and matching rules
- **Unmatched left**: Records from Source A with no match in Source B
- **Unmatched right**: Records from Source B with no match in Source A
- **Filtered by rule status**: Export based on which rules passed/failed

### 6.3 CSV Export Examples

#### Example 1: Export all matched records

**Export Configuration**:
```yaml
export:
  format: csv
  category: matched
  filename: matched_{date}.csv
```

**Output File**: `matched_2024-03-15.csv`
```csv
source_a_transaction_id,source_a_amount,source_a_currency,source_b_transaction_id,source_b_amount,source_b_currency,rules_passed,rules_failed
TXN001,100.50,USD,TXN001,100.50,USD,"join_on_id,amount_tolerance,currency_match",""
TXN002,250.00,EUR,TXN002,250.00,EUR,"join_on_id,amount_tolerance,currency_match","timestamp_window"
```

#### Example 2: Export unmatched left records

**Export Configuration**:
```yaml
export:
  format: csv
  category: unmatched_left
  filename: unmatched_left_{date}.csv
```

**Output File**: `unmatched_left_2024-03-15.csv`
```csv
source_a_transaction_id,source_a_amount,source_a_currency,source_a_status
TXN999,500.00,USD,COMPLETED
TXN998,750.00,EUR,PENDING
```

#### Example 3: Export unmatched right records

**Export Configuration**:
```yaml
export:
  format: csv
  category: unmatched_right
  filename: unmatched_right_{date}.csv
```

**Output File**: `unmatched_right_2024-03-15.csv`
```csv
source_b_transaction_id,source_b_amount,source_b_currency,source_b_status
TXN777,125.00,USD,SUCCESS
```

#### Example 4: Export matched records filtered by rule status

**Export Configuration**:
```yaml
export:
  format: csv
  category: matched
  rules_passed:
    - amount_tolerance
    - currency_match
  rules_failed:
    - timestamp_window
  filename: matched_with_timestamp_warning_{date}.csv
```

This exports only records where `amount_tolerance` and `currency_match` passed but `timestamp_window` failed.

## 7. Result Immutability

### 7.1 Requirement

Once a reconciliation run is complete, results must be immutable:
- Cannot modify matched/unmatched status
- Cannot change rule evaluations
- Cannot delete individual records
- Entire reconciliation run can be archived/deleted, but not edited

### 7.2 Result Versioning

**Requirement**: If reconciliation is re-run with same parameters, create new version.

```yaml
reconciliation_run:
  run_id: RUN-2024-03-15-001
  version: 2  # Second run for same date
  previous_version: RUN-2024-03-15-001-v1
  created_at: 2024-03-15T14:00:00Z
```

### 7.3 Comparison Between Versions

**Requirement**: Allow comparison of results across reconciliation runs.

```yaml
compare:
  run_a: RUN-2024-03-15-001-v1
  run_b: RUN-2024-03-15-001-v2
  output:
    new_matches: 5  # Now matched in v2
    new_unmatches: 3  # Now unmatched in v2
    changed_confidence: 12  # Confidence score changed
```

## 8. Audit Trail

### 8.1 Reconciliation Run Metadata

Every run must record:

```yaml
reconciliation_run:
  run_id: RUN-2024-03-15-001
  reconciliation_config: payment_gateway_recon:v3
  reconciliation_unit:
    date: 2024-03-15
  executed_by: john.doe@company.com
  executed_at: 2024-03-15T12:00:00Z
  execution_duration: 45.3 seconds
  source_a:
    name: internal_ledger
    version: 2
    records_fetched: 10000
    fetch_timestamp: 2024-03-15T12:00:01Z
  source_b:
    name: payment_gateway
    version: 1
    records_fetched: 9995
    fetch_timestamp: 2024-03-15T12:00:10Z
  matching_rules:
    name: payment_rules
    version: 1
  results:
    matched: 9980
    unmatched_left: 15
    unmatched_right: 10
    duplicates_source_a: 5
    duplicates_source_b: 0
    warnings: 125
  status: completed
```

## 9. Performance Considerations

### 9.1 Query Optimization

**Requirement**: Support indexed queries on result categories and rule match status.

**Indexed Fields**:
- Result category (matched, unmatched_left, unmatched_right)
- Rule match status (which rules passed/failed)
- Match ID

### 9.2 Pagination

**Requirement**: Support paginated result retrieval.

```yaml
query:
  result_category: matched
  page_size: 1000
  page: 1
```

### 9.3 Streaming Export

**Requirement**: For large result sets, support streaming export.

```yaml
export:
  format: csv
  category: matched
  streaming: true  # Don't load all results in memory
  chunk_size: 10000
```

## 10. Open Questions

1. **Result Retention**: How long to keep detailed results vs summary statistics?

4. **Result Sharing**: Multi-user access to results with different permission levels?

6. **Machine-Readable Explanations**: Structured explanation format for automated processing?
