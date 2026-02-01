# Matching Rules

## 1. Overview

Matching rules define the logic for determining whether two records from different data sources represent the same business entity or transaction. Rules work like SQL JOIN with WHERE clauses:
- **Join conditions**: Equality-based joins on one or more key fields
- **Match rules**: Expressions using operators or Lua scripts
- **Dynamic**: Configurable without code changes
- **Composable**: Combine expressions using AND/OR/NOT operators
- **Versioned**: Track changes to matching logic over time
- **Inherently ordered**: Rules execute in declaration order (top to bottom)

## 2. Core Requirements

### 2.1 Rule Structure

Matching rules consist of two parts:

1. **Join conditions** (required): Define how to join source_a and source_b records
   - Always equality-based (`=` is implicit)
   - Can be single or multi-column joins

2. **Match rules** (optional): Define additional matching criteria
   - Execute in declaration order (top to bottom)
   - Can use comparison operators, boolean operators (AND/OR/NOT), or Lua scripts
   - Each rule has a severity level

### 2.2 Rule Expressions

Rules are expressions that can be:

| Expression Type | Description | Example |
|----------------|-------------|---------|
| **Comparison** | Compare two values | `left: source_a.currency, operator: "=", right: source_b.currency` |
| **Lua Script** | Custom logic | `script: \|...` |
| **Boolean Operator** | Combine expressions | `operator: AND, operands: [...]` |

### 2.3 Rule Evaluation Order

**Requirement**: Rules execute in the order they are declared (top to bottom in YAML).

```yaml
matching_rules:
  rules:
    - name: currency_match  # Executes first
      severity: error
      left: source_a.currency
      operator: "="
      right: source_b.currency

    - name: amount_tolerance  # Executes second
      severity: error
      script: |
        return math.abs(source_a.amount - source_b.amount) <= 0.01

    - name: status_check  # Executes third
      severity: warning
      left: source_a.status
      operator: "="
      right: source_b.status
```

**Evaluation Logic**:
1. Rules execute in declaration order
2. If **error** rule fails → record pair marked as non-matching
3. If **warning** rule fails → record pair marked as matched with warning
4. Record pair must satisfy all **error** rules to be considered a match

### 2.4 Rule Severity Levels

| Severity | Behavior | Use Case |
|----------|----------|----------|
| `error` | Must match for overall match | Critical fields (ID, amount) |
| `warning` | Record warnings but allow match | Non-critical discrepancies (timestamps, descriptions) |
| `info` | Informational only, no impact | Audit trail, debugging |

### 2.5 Rule Versioning

**Requirement**: All rule configurations must be versioned.

```yaml
matching_rules:
  name: payment_gateway_rules
  version: 3
  created_at: 2024-01-15T10:00:00Z
  updated_at: 2024-03-01T14:30:00Z
  changelog:
    - version: 3
      date: 2024-03-01
      changes: "Increased amount tolerance from $0.01 to $0.05"
    - version: 2
      date: 2024-02-01
      changes: "Added time window rule for timestamp matching"
    - version: 1
      date: 2024-01-15
      changes: "Initial ruleset"
```

## 3. Join Conditions

### 3.1 Single Column Join

**Requirement**: Join records on a single key field using equality.

```yaml
matching_rules:
  join:
    - left: source_a.transaction_id
      right: source_b.transaction_id
```

**Equivalent SQL**:
```sql
JOIN source_b ON source_a.transaction_id = source_b.transaction_id
```

**Note**: Operator `=` is implicit for joins (only equality joins supported).

### 3.2 Multi-Column Join

**Requirement**: Join on multiple key fields (composite key).

```yaml
matching_rules:
  join:
    - left: source_a.merchant_id
      right: source_b.merchant_id
    - left: source_a.transaction_date
      right: source_b.transaction_date
```

**Equivalent SQL**:
```sql
JOIN source_b
  ON source_a.merchant_id = source_b.merchant_id
  AND source_a.transaction_date = source_b.transaction_date
```

### 3.3 Join with Transformations

**Requirement**: Apply functions to join keys (e.g., case-insensitive, trimmed).

```yaml
matching_rules:
  join:
    - left: upper(trim(source_a.reference_number))
      right: upper(trim(source_b.reference_number))
```

**Available Functions**: `upper()`, `lower()`, `trim()`, `abs()`

### 3.4 Deduplication Ordering

**Requirement**: When JOIN conditions produce multiple matching records (duplicates), define ordering to select which record to use.

**Use Case**: A payment gateway may have multiple records for the same transaction (e.g., status updates). Use deduplication ordering to select the latest record.

**Configuration**:
```yaml
matching_rules:
  join:
    - left: source_a.transaction_id
      right: source_b.transaction_id

  # When multiple records match, order by these fields and take first
  deduplication_order:
    left:
      - field: source_a.updated_at
        direction: desc
      - field: source_a.id
        direction: asc  # Tie-breaker
    right:
      - field: source_b.created_at
        direction: desc
```

**Behavior**:
1. JOIN conditions are evaluated first
2. If multiple records match on either side:
   - Records are ordered by specified fields
   - First record after ordering is used for matching
   - Remaining duplicates are tracked separately
3. Ordering supports multiple columns for tie-breaking
4. Each side (left/right) can have independent ordering rules

**Example**: Select latest payment status
```yaml
deduplication_order:
  left:
    - field: source_a.status_timestamp
      direction: desc  # Most recent first
  right:
    - field: source_b.updated_at
      direction: desc
    - field: source_b.sequence_number
      direction: desc  # Tie-breaker if same timestamp
```

## 4. Comparison Operators

### 4.1 Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equal to | `left: source_a.currency, operator: "=", right: source_b.currency` |
| `!=` | Not equal to | `left: source_a.status, operator: "!=", right: "CANCELLED"` |
| `<` | Less than | `left: source_a.amount, operator: "<", right: 1000` |
| `<=` | Less than or equal | `left: source_a.amount, operator: "<=", right: 1000` |
| `>` | Greater than | `left: source_a.amount, operator: ">", right: 100` |
| `>=` | Greater than or equal | `left: source_a.amount, operator: ">=", right: 100` |

### 4.2 Comparison Rule Structure

```yaml
rules:
  - name: currency_match
    severity: error
    left: source_a.currency
    operator: "="
    right: source_b.currency
```

### 4.3 Arithmetic in Comparisons

**Example**: Compare calculated values.

```yaml
rules:
  - name: net_amount_match
    severity: error
    left: source_a.gross_amount - source_a.fee
    operator: "="
    right: source_b.net_amount
```

**Supported Arithmetic**: `+`, `-`, `*`, `/`

### 4.4 Functions in Comparisons

**Example**: Case-insensitive comparison.

```yaml
rules:
  - name: case_insensitive_status
    severity: error
    left: upper(source_a.status)
    operator: "="
    right: upper(source_b.status)
```

**Available Functions**: `upper()`, `lower()`, `trim()`, `abs()`

## 5. Boolean Operators

### 5.1 AND Operator

**Requirement**: All operands must evaluate to true.

```yaml
rules:
  - name: complete_match
    severity: error
    operator: AND
    operands:
      - left: source_a.currency
        operator: "="
        right: source_b.currency
      - left: source_a.amount
        operator: "="
        right: source_b.amount
      - left: source_a.status
        operator: "="
        right: "COMPLETED"
```

### 5.2 OR Operator

**Requirement**: At least one operand must evaluate to true.

```yaml
rules:
  - name: reference_match
    severity: error
    operator: OR
    operands:
      - left: source_a.primary_ref
        operator: "="
        right: source_b.reference_id
      - left: source_a.secondary_ref
        operator: "="
        right: source_b.reference_id
```

### 5.3 NOT Operator

**Requirement**: Single operand must evaluate to false.

```yaml
rules:
  - name: not_test_transaction
    severity: error
    operator: NOT
    operand:
      left: source_a.is_test
      operator: "="
      right: true
```

**Note**: `operand` is singular (not `operands`) for NOT.

### 5.4 Nested Boolean Operators

**Requirement**: Operators can be nested arbitrarily.

**Example**: `(currency_match AND amount_match) OR override_flag`

```yaml
rules:
  - name: advanced_match
    severity: error
    operator: OR
    operands:
      - operator: AND
        operands:
          - left: source_a.currency
            operator: "="
            right: source_b.currency
          - left: source_a.amount
            operator: "="
            right: source_b.amount
      - left: source_a.override_match
        operator: "="
        right: true
```

## 6. Lua Script Rules

### 6.1 Simple Lua Rule

**Requirement**: Use Lua scripts for complex logic that can't be expressed with operators.

**Example**: Tolerance-based amount matching.

```yaml
rules:
  - name: amount_tolerance
    severity: error
    script: |
      return math.abs(source_a.amount - source_b.amount) <= 0.01
```

### 6.2 Complex Logic with Lua

**Example**: Tiered fee validation.

```yaml
rules:
  - name: custom_fee_validation
    severity: error
    script: |
      -- Calculate expected fee (tiered)
      local expected_fee = 0.0
      if source_a.amount <= 100 then
        expected_fee = 2.50
      elseif source_a.amount <= 1000 then
        expected_fee = 5.00
      else
        expected_fee = source_a.amount * 0.005
      end

      -- Check if actual fee matches expected (with tolerance)
      return math.abs(expected_fee - source_b.fee_amount) <= 0.10
```

### 6.3 Multi-Condition Lua Rule

**Example**: Settlement validation with multiple checks.

```yaml
rules:
  - name: settlement_validation
    severity: error
    script: |
      -- Must match on transaction ID
      if source_a.transaction_id ~= source_b.transaction_id then
        return false
      end

      -- Amount must match within tolerance
      if math.abs(source_a.amount - source_b.amount) > 0.01 then
        return false
      end

      -- Currency must match
      if source_a.currency ~= source_b.currency then
        return false
      end

      -- Settlement must be T+0 to T+3
      local days_diff = days_between(source_a.transaction_date, source_b.settlement_date)
      if days_diff < 0 or days_diff > 3 then
        return false
      end

      return true
```

### 6.4 Conditional Tolerance Based on Field Values

**Example**: Different tolerance for domestic vs international.

```yaml
rules:
  - name: conditional_tolerance
    severity: error
    script: |
      -- Higher tolerance for international transactions
      local tolerance = 0.01
      if source_a.currency ~= "USD" then
        tolerance = 0.10
      end

      -- Check amount within dynamic tolerance
      return math.abs(source_a.amount - source_b.amount) <= tolerance
```

### 6.5 Time Window Matching with Lua

**Example**: Match timestamps within 5 minutes.

```yaml
rules:
  - name: timestamp_window
    severity: warning
    script: |
      local diff_seconds = math.abs(timestamp_diff(source_a.transaction_timestamp, source_b.created_timestamp))
      return diff_seconds <= 300  -- 5 minutes = 300 seconds
```

### 6.6 Business Day Calculation

**Example**: Settlement within 2 business days.

```yaml
rules:
  - name: settlement_within_business_days
    severity: warning
    script: |
      local bus_days = business_days_between(source_a.transaction_date, source_b.settlement_date, "US_BANKING")
      return bus_days >= 0 and bus_days <= 2
```

### 6.7 Lua Sandbox Environment

**Requirement**: Lua scripts execute in a sandboxed environment.

**Restrictions**:
- No file I/O operations
- No network operations
- No OS command execution
- Limited memory (configurable, default: 50MB)
- Execution timeout (configurable, default: 5 seconds per row pair)

**Available Built-in Functions**:
- **Math**: `math.abs()`, `math.ceil()`, `math.floor()`, `tonumber()`
- **String**: `string.upper()`, `string.lower()`, `string.sub()`, `string.format()`
- **Date/Time**: `days_between()`, `business_days_between()`, `timestamp_diff()`, `weekday()`
- **Type conversion**: `tostring()`, `tonumber()`

**Access to Row Data**:
- Source A fields accessible via `source_a.field_name`
- Source B fields accessible via `source_b.field_name`

## 7. Real-World Fintech Scenarios

### 7.1 Payment Gateway Reconciliation

**Business Need**: Match internal payment records with gateway settlement reports.

**Key Challenges**:
- Gateway may round amounts differently
- Timestamps may differ slightly
- Fee calculations may vary

**Reconciliation Rules**:
```yaml
matching_rules:
  name: payment_gateway_reconciliation
  version: 1

  # Join on transaction ID
  join:
    - left: source_a.transaction_id
      right: source_b.transaction_ref

  # Match rules (execute in order)
  rules:
    # Amount tolerance (gateway may round)
    - name: amount_tolerance
      severity: error
      script: |
        return math.abs(source_a.amount - source_b.gross_amount) <= 0.05

    # Currency must match exactly
    - name: currency_match
      severity: error
      left: source_a.currency
      operator: "="
      right: source_b.currency

    # Fee validation (warning only)
    - name: fee_validation
      severity: warning
      script: |
        local expected_fee = source_b.gross_amount * 0.029 + 0.30
        local actual_fee = source_b.fee_amount
        local diff = math.abs(expected_fee - actual_fee)

        if diff > 0.05 then
          -- Fee mismatch warning will be logged
          return false
        end

        return true

    # Timestamp window (within 10 minutes)
    - name: timestamp_window
      severity: warning
      script: |
        local diff_seconds = math.abs(timestamp_diff(source_a.created_at, source_b.transaction_time))
        return diff_seconds <= 600  -- 10 minutes
```

### 7.2 Bank Statement Reconciliation

**Business Need**: Match internal ledger entries with bank statement lines.

**Key Challenges**:
- No common transaction ID (must join on date + amount)
- Amounts must match exactly
- Descriptions may vary

**Reconciliation Rules**:
```yaml
matching_rules:
  name: bank_statement_reconciliation
  version: 2

  # Join on date AND amount (composite key, no common ID)
  join:
    - left: source_a.transaction_date
      right: source_b.value_date
    - left: source_a.amount
      right: source_b.amount

  # Match rules
  rules:
    # Currency must match
    - name: currency_match
      severity: error
      left: source_a.currency
      operator: "="
      right: source_b.currency

    # Reference match (warning - either field can match)
    - name: reference_match
      severity: warning
      operator: OR
      operands:
        - left: upper(trim(source_a.reference))
          operator: "="
          right: upper(trim(source_b.reference))
        - left: source_a.check_number
          operator: "="
          right: source_b.check_number
```

### 7.3 Merchant Settlement Reconciliation

**Business Need**: Verify merchant payouts match aggregated transactions.

**Key Challenges**:
- Settlement is aggregated (sum of transactions)
- Fees may be deducted
- Chargebacks and refunds affect net amount

**Note**: This is a one-to-many reconciliation scenario (covered in separate requirements).

### 7.4 Card Network Reconciliation

**Business Need**: Match issuer processor transactions with card network (Visa/Mastercard) interchange files.

**Key Challenges**:
- Different transaction IDs
- Must match on card number, amount, and date (composite key)
- Interchange fees may vary

```yaml
matching_rules:
  name: card_network_reconciliation
  version: 1

  # Multi-column join (no common transaction ID)
  join:
    - left: hash(source_a.card_number)  # Hash for security
      right: hash(source_b.pan)
    - left: source_a.transaction_date
      right: source_b.transaction_date

  # Match rules
  rules:
    # Amount tolerance (small variance allowed)
    - name: amount_tolerance
      severity: error
      script: |
        return math.abs(source_a.amount - source_b.transaction_amount) <= 0.01

    # Merchant match (warning only)
    - name: merchant_match
      severity: warning
      left: source_a.merchant_id
      operator: "="
      right: source_b.merchant_id

    # Interchange fee validation
    - name: interchange_fee_validation
      severity: warning
      script: |
        -- Calculate expected fee based on card type
        local expected_fee = 0.0

        if source_b.card_type == "CREDIT" then
          expected_fee = source_b.transaction_amount * 0.0175  -- 1.75%
        elseif source_b.card_type == "DEBIT" then
          expected_fee = math.min(source_b.transaction_amount * 0.0050, 0.21)  -- 0.50% capped at $0.21
        end

        local actual_fee = source_b.interchange_fee
        local diff = math.abs(expected_fee - actual_fee)

        return diff <= 0.02
```

### 7.5 Trade Settlement Reconciliation

**Business Need**: Match executed trades with clearinghouse confirmations.

**Key Challenges**:
- May have different transaction IDs (use primary or fallback)
- Quantity and price must match exactly
- Settlement date may vary (T+1, T+2, T+3 business days)

**Reconciliation Rules**:
```yaml
matching_rules:
  name: trade_settlement_reconciliation
  version: 1

  # Join on trade_id
  join:
    - left: source_a.trade_id
      right: source_b.trade_ref

  # Match rules
  rules:
    # Exact quantity match
    - name: exact_quantity_match
      severity: error
      left: source_a.quantity
      operator: "="
      right: source_b.quantity

    # Price tolerance (0.01% - very tight for trades)
    - name: price_tolerance
      severity: error
      script: |
        local tolerance = source_a.price * 0.0001  -- 0.01%
        return math.abs(source_a.price - source_b.price) <= tolerance

    # Settlement date window (T+0 to T+3 business days)
    - name: settlement_date_window
      severity: warning
      script: |
        local bus_days = business_days_between(source_a.trade_date, source_b.settlement_date, "NYSE")
        return bus_days >= 0 and bus_days <= 3
```

## 8. Rule Optimization

### 8.1 Rule Indexing

**Requirement**: System should build indexes on join key fields for performance.

```yaml
matching_rules:
  optimization:
    index_fields:
      - source_a.transaction_id
      - source_b.transaction_id
```

### 8.2 Early Termination

**Requirement**: Stop evaluating rules once a critical error rule fails.

```yaml
matching_rules:
  optimization:
    early_termination: true  # Stop on first error rule failure
```

### 8.3 Rule Statistics

**Requirement**: Track rule match rates for optimization.

**Output Example**:
```
Rule Match Statistics - Reconciliation Run 2024-03-15

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

## 9. Open Questions

1. **Machine Learning Rules**: Should the system support ML-based matching (fuzzy matching, similarity scores)?

2. **Rule Testing**: Provide sandbox environment to test rules against sample data before deployment?

3. **Rule Templates**: Pre-built rule templates for common fintech scenarios?
