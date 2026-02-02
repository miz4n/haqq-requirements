# Test Data for Reconciliation Engine

## Overview

This folder contains sample test data for validating the reconciliation engine across all business requirement scenarios, including a multi-stage 3-source reconciliation.

## Data Sources

| Source | File | Description | Key Fields |
|--------|------|-------------|------------|
| **Source A** | `source_a_internal_ledger.csv` | Company's internal transaction ledger | `transaction_id`, `reference_number`, `amount` |
| **Source B** | `source_b_payment_gateway.csv` | Payment gateway (Stripe/PayPal) | `txn_id`, `ref_num`, `amt` |
| **Source C** | `source_c_bank_statement.csv` | Bank statement records | `bank_ref`, `credit_amount`, `net_amount` |

## Multi-Stage Reconciliation Scenario

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Multi-Stage Reconciliation Flow                         │
│                     ((A ⋈ B).matched ⋈ C)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Stage 1: Internal Ledger ⋈ Payment Gateway                            │
│   ┌─────────────┐     JOIN ON      ┌─────────────┐                      │
│   │  Source A   │  reference_number │  Source B   │                      │
│   │  (Ledger)   │ ════════════════► │  (Gateway)  │                      │
│   └─────────────┘    = ref_num      └─────────────┘                      │
│          │                                │                              │
│          ▼                                ▼                              │
│   ┌─────────────┐                  ┌─────────────┐                      │
│   │ Unmatched A │                  │ Unmatched B │                      │
│   │ (13,14,15)  │                  │ (16,17,18)  │                      │
│   └─────────────┘                  └─────────────┘                      │
│                    │                                                     │
│                    ▼                                                     │
│             ┌─────────────┐                                             │
│             │  Matched    │                                             │
│             │   A + B     │                                             │
│             └──────┬──────┘                                             │
│                    │                                                     │
│   Stage 2: (A+B).matched ⋈ Bank Statement                               │
│                    │      JOIN ON       ┌─────────────┐                 │
│                    │  reference_number  │  Source C   │                 │
│                    └──════════════════► │   (Bank)    │                 │
│                         = bank_ref      └─────────────┘                 │
│                              │                 │                         │
│                              ▼                 ▼                         │
│                       ┌─────────────┐  ┌─────────────┐                  │
│                       │ Unmatched   │  │ Unmatched C │                  │
│                       │ A+B (19,20) │  │ (35,36,37)  │                  │
│                       └─────────────┘  └─────────────┘                  │
│                              │                                           │
│                              ▼                                           │
│                       ┌─────────────┐                                   │
│                       │  Matched    │                                   │
│                       │  A + B + C  │                                   │
│                       │ (31,32,33)  │                                   │
│                       └─────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Test Cases by Category

### 1. Perfect Matches (TXN001-005)

All three sources have matching records with identical amounts and currencies.

| Ref | A Amount | B Amount | C Credit | Currency | Expected |
|-----|----------|----------|----------|----------|----------|
| REF-001 | 100.00 | 100.00 | 100.00 | USD | Full 3-way match |
| REF-002 | 250.50 | 250.50 | 250.50 | USD | Full 3-way match |
| REF-003 | 500.00 | 500.00 | 500.00 | EUR | Full 3-way match |
| REF-004 | 1000.00 | 1000.00 | 1000.00 | USD | Full 3-way match |
| REF-005 | 75.25 | 75.25 | 75.25 | GBP | Full 3-way match |

### 2. Amount Tolerance Scenarios (TXN006-008)

| Ref | A Amount | B Amount | Difference | Rule (±0.01) | Expected |
|-----|----------|----------|------------|--------------|----------|
| REF-006 | 199.99 | 199.99 | 0.00 | PASS | Exact match |
| REF-007 | 299.99 | 300.00 | 0.01 | PASS | Within tolerance |
| REF-008 | 399.99 | 400.50 | 0.51 | FAIL | Outside tolerance |

### 3. Currency Mismatch (TXN009-010)

| Ref | A Currency | B Currency | Expected |
|-----|------------|------------|----------|
| REF-009 | USD | EUR | Currency rule FAIL |
| REF-010 | EUR | GBP | Currency rule FAIL |

### 4. Date Discrepancy (TXN011-012)

| Ref | A Date | B Date | Difference | Expected |
|-----|--------|--------|------------|----------|
| REF-011 | 2024-03-15 | 2024-03-16 | 1 day | May pass with tolerance |
| REF-012 | 2024-03-15 | 2024-03-18 | 3 days | Likely fail |

### 5. Unmatched Records - No B Match (TXN013-015)

Records exist in Source A but have no corresponding record in Source B.

| A Transaction | A Amount | B Record | Expected |
|---------------|----------|----------|----------|
| TXN013 | 125.00 | None | Unmatched Left |
| TXN014 | 175.00 | None | Unmatched Left |
| TXN015 | 225.00 | None | Unmatched Left |

### 6. Unmatched Records - No A Match (TXN016-018)

Records exist in Source B but have no corresponding record in Source A.

| B Transaction | B Amount | A Record | Expected |
|---------------|----------|----------|----------|
| PG016 | 275.00 | None | Unmatched Right |
| PG017 | 325.00 | None | Unmatched Right |
| PG018 | 375.00 | None | Unmatched Right |

### 7. A+B Matched, No Bank Record (TXN019-020)

Records match between A and B, but no corresponding bank statement entry.

| Ref | A+B Status | C Record | Expected |
|-----|------------|----------|----------|
| REF-019 | Matched | None | Stage 2 Unmatched Left |
| REF-020 | Matched | None | Stage 2 Unmatched Left |

### 8. Duplicate Records in Source A (TXN021-022)

| A Transaction | Count | Amounts | Expected |
|---------------|-------|---------|----------|
| TXN021 | 2 | 800.00, 800.00 | Duplicate - same amount |
| TXN022 | 2 | 900.00, 900.05 | Duplicate - different amounts |

### 9. Duplicate Records in Source B (TXN023-024)

| B Transaction | Count | Amounts | Expected |
|---------------|-------|---------|----------|
| PG023 | 2 | 850.00, 850.00 | Duplicate - same amount |
| PG024 | 2 | 875.00, 875.10 | Duplicate - different amounts |

### 10. String Normalization (TXN025-026)

| Ref | A ref_number | B ref_num | Normalization Needed |
|-----|--------------|-----------|---------------------|
| 025 | `ref-025` (lowercase) | `REF-025` | Case normalization |
| 026 | `  REF-026  ` (whitespace) | `REF-026` | Trim whitespace |

### 11. Null/Missing Values (TXN027-028)

| Ref | Issue | Expected |
|-----|-------|----------|
| REF-027 | Null `merchant_id` in B | Handle null gracefully |
| REF-028 | Null `amount` in A | Null comparison handling |

### 12. Partial Rule Pass (TXN029-030)

| Ref | Amount Match | Currency Match | Expected |
|-----|--------------|----------------|----------|
| REF-029 | PASS (850.00 = 850.00) | FAIL (USD ≠ EUR) | Matched with exceptions |
| REF-030 | FAIL (950.00 ≠ 960.00) | PASS (EUR = EUR) | Matched with exceptions |

### 13. Multi-Stage Full Match (TXN031-032)

| Ref | A Amount | B Amount | C Credit | Stage 1 | Stage 2 |
|-----|----------|----------|----------|---------|---------|
| REF-031 | 1100.00 | 1100.00 | 1100.00 | Match | Match |
| REF-032 | 1200.00 | 1200.00 | 1200.00 | Match | Match |

### 14. Multi-Stage Partial (TXN033-034)

| Ref | A Amount | B Amount | C Credit | Stage 1 | Stage 2 | Issue |
|-----|----------|----------|----------|---------|---------|-------|
| REF-033 | 1300.00 | 1300.00 | 1350.00 | Match | FAIL | Bank has different amount |
| REF-034 | 1400.00 | 1400.00 | None | Match | Unmatched | No bank record |

### 15. Bank-Only Records (REF-035-037)

Records exist only in Source C (bank) with no corresponding A+B match.

| Bank Ref | Credit Amount | A+B Match | Expected |
|----------|---------------|-----------|----------|
| REF-035 | 1500.00 | None | Stage 2 Unmatched Right |
| REF-036 | 1600.00 | None | Stage 2 Unmatched Right |
| REF-037 | 1700.00 | None | Stage 2 Unmatched Right |

---

## Field Mappings

### Stage 1: A ⋈ B

| Source A Field | Source B Field | Join/Compare |
|----------------|----------------|--------------|
| `reference_number` | `ref_num` | JOIN key |
| `amount` | `amt` | Tolerance rule |
| `currency` | `ccy` | Exact match rule |
| `transaction_date` | `txn_date` | Date rule |

### Stage 2: (A+B).matched ⋈ C

| Stage 1 Field | Source C Field | Join/Compare |
|---------------|----------------|--------------|
| `reference_number` | `bank_ref` | JOIN key |
| `amount` | `credit_amount` | Tolerance rule |
| `currency` | `currency` | Exact match rule |

---

## Sample Reconciliation Rules

### Stage 1 Rules (A vs B)

```yaml
rules:
  - name: amount_tolerance
    expression: "(pl.col('amount') - pl.col('amt')).abs() <= 0.01"
    severity: error

  - name: currency_match
    expression: "pl.col('currency') == pl.col('ccy')"
    severity: error

  - name: date_match
    expression: "(pl.col('transaction_date') - pl.col('txn_date')).dt.total_days().abs() <= 1"
    severity: warning
```

### Stage 2 Rules (A+B vs C)

```yaml
rules:
  - name: bank_amount_match
    expression: "(pl.col('amount') - pl.col('credit_amount')).abs() <= 0.01"
    severity: error

  - name: bank_currency_match
    expression: "pl.col('currency') == pl.col('currency_right')"
    severity: error
```

---

## Expected Results Summary

### Stage 1: A ⋈ B

| Category | Count | Transaction IDs |
|----------|-------|-----------------|
| Matched | 22 | 001-012, 019-022, 025-034 |
| Unmatched Left (A only) | 3 | 013, 014, 015 |
| Unmatched Right (B only) | 5 | 016, 017, 018, 023, 024 |

### Stage 2: (A+B).matched ⋈ C

| Category | Count | Transaction IDs |
|----------|-------|-----------------|
| Full 3-way Match | 18 | 001-012, 021, 025-027, 029-032 |
| Matched with Exceptions | 2 | 028, 033 |
| Unmatched Left (A+B only) | 2 | 019, 020 |
| Unmatched Right (C only) | 3 | 035, 036, 037 |

---
