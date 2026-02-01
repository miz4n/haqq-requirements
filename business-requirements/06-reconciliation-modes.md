# Reconciliation Modes

## 1. Overview

The reconciliation engine currently supports one primary reconciliation mode:
- **One-to-One**: Each record in Source A matches at most one record in Source B

**TODO**: Future versions will support:
- **One-to-Many**: Each record in Source A can match multiple records in Source B (or vice versa)
- **Many-to-Many**: Complex scenarios with multiple matches in both directions

## 2. One-to-One Reconciliation

### 2.1 Definition

**One-to-One** mode assumes a 1:1 cardinality relationship between sources:
- Each transaction in Source A should have exactly one matching transaction in Source B
- Join keys must be unique in both datasets
- Duplicate keys are flagged as errors

### 2.2 Use Cases

- **Payment Gateway Reconciliation**: One internal transaction = One gateway settlement
- **Bank Statement Reconciliation**: One ledger entry = One bank statement line
- **Trade Confirmation**: One executed trade = One clearinghouse confirmation

### 2.3 Duplicate Key Handling

**Requirement**: If join keys are not unique, flag as duplicate error.

**Example**:

**Source A** (Internal Ledger):
```csv
transaction_id,amount
TXN001,100.00
TXN001,100.00  # Duplicate!
TXN002,200.00
```

**Source B** (Gateway):
```csv
transaction_id,amount
TXN001,100.00
TXN002,200.00
```

**Result**:
- TXN001 flagged as duplicate in Source A
- Reconciliation fails or creates warning depending on configuration

**Configuration**:
```yaml
reconciliation:
  mode: one_to_one
  duplicate_handling:
    action: error  # or 'warning' or 'take_first' or 'take_last'
    report: true
```

### 2.4 One-to-One Match Results

**Possible Outcomes**:
- **Matched**: One record from A matches one record from B
- **Unmatched Left**: Record in A with no match in B
- **Unmatched Right**: Record in B with no match in A
- **Duplicate in Source A**: Multiple records in A with same join key
- **Duplicate in Source B**: Multiple records in B with same join key

### 2.5 Example Configuration

```yaml
reconciliation:
  name: payment_gateway_recon
  mode: one_to_one
  source_a: internal_ledger
  source_b: payment_gateway
  matching_rules: payment_rules_v1

  duplicate_handling:
    check_duplicates: true
    duplicate_keys_action: error
    report_duplicates: true
```

### 2.6 Example Output

**Reconciliation Summary**:
```
Reconciliation: payment_gateway_recon
Date: 2024-03-15
Mode: One-to-One

Source A (Internal Ledger): 10,000 records
Source B (Payment Gateway): 9,995 records

Results:
  Matched: 9,980 records (99.8%)
  Unmatched Left: 15 records (0.15%)
  Unmatched Right: 10 records (0.10%)
  Duplicate in Source A: 5 records (0.05%)
  Duplicate in Source B: 0 records (0%)
```

## 3. Mode Selection Guidelines

### 3.1 Decision Matrix

| Business Scenario | Mode |
|-------------------|------|
| Payment gateway settlement | One-to-One |
| Bank statement reconciliation | One-to-One |
| Trade confirmation | One-to-One |

**TODO**: Future modes and scenarios:
- One-to-Many: Merchant settlement vs transactions, Invoice payments, Order shipments
- Many-to-Many: Payment allocations, Complex multi-source reconciliations

### 3.2 Configuration Validation

**Requirement**: System validates mode selection against data cardinality.

**Example**:
- If mode is `one_to_one`, warn if duplicate keys detected during preview

## 4. Performance Considerations

### 4.1 One-to-One Performance

**Characteristics**:
- Fast: Direct hash join on unique keys
- Memory efficient: No grouping required
- Scalable: O(N + M) complexity

## 5. Validation & Error Handling

### 5.1 Pre-Reconciliation Validation

**Requirement**: Validate data before reconciliation.

**One-to-One Checks**:
- Check for duplicate join keys in both sources
- Estimate match rate based on key overlap

### 5.2 Reconciliation Warnings

| Warning Type | Description |
|--------------|-------------|
| `high_duplicate_rate` | > 5% of records are duplicates |
| `low_match_rate` | < 50% of records matched |

## 6. Open Questions

1. **Dynamic Mode Selection**: Should system auto-detect mode based on data cardinality?

2. **Mixed Mode**: Support different modes for different record subsets (e.g., one-to-one for domestic, one-to-many for international)?
