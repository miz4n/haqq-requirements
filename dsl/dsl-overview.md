# Reconciliation DSL Overview
# Version: 2.0

## 1. Introduction

The Reconciliation DSL (Domain-Specific Language) is a YAML-based configuration language that defines all aspects of reconciliation jobs. It provides a declarative, human-readable way to configure:
- Data sources (SFTP, API, PostgreSQL only)
- Schema mappings (Lua transformations)
- Matching rules (JOIN + WHERE pattern)
- Reconciliation workflows (one-to-one mode only)

**Version 2.0 Key Changes**:
- Simplified matching rules (JOIN + WHERE pattern, no specialized configs)
- Lua scripts for all transformations
- One-to-one reconciliation mode only (one-to-many is TODO)
- CSV exports only
- UTC-only timestamps
- PostgreSQL only for database sources
- Removed incremental fetch mode

## 2. Design Principles

### 2.1 Declarative Over Imperative

Users describe **what** they want to reconcile, not **how** to do it.

**Example**:
```yaml
# Declarative (Good) - Version 2.0 Syntax
matching_rules:
  join:
    - left: source_a.transaction_id
      right: source_b.transaction_id
  rules:
    - name: amount_match
      severity: error
      script: |
        return math.abs(source_a.amount - source_b.amount) <= 0.01

# Imperative (Avoid)
steps:
  - load_source_a
  - load_source_b
  - create_hash_table_on_transaction_id
  - for_each_record_in_a_find_in_b
```

### 2.2 Composability

Complex configurations built from simple, reusable components.

**Example**:
```yaml
# Define schema once
schemas:
  payment_schema:
    fields: [...]

# Reuse in multiple reconciliations
reconciliations:
  daily_recon:
    source_a_schema: payment_schema
  monthly_recon:
    source_a_schema: payment_schema
```

### 2.3 Versioning

All configurations are versioned to ensure reproducibility.

```yaml
schema:
  name: payment_schema
  version: 2
```

### 2.4 Validation

DSL validates configurations before execution to catch errors early.

**Validations**:
- Required fields present
- Type correctness
- Reference integrity (schemas, rules exist)
- Circular dependencies

## 3. DSL Structure

### 3.1 Core Components

The DSL consists of four main configuration types:

| Component | Description | File |
|-----------|-------------|------|
| **Data Sources** | Define where data comes from | `data-source-spec.yaml` |
| **Schemas** | Define data structure and transformations | `schema-spec.yaml` |
| **Matching Rules** | Define how to match records | `rules-spec.yaml` |
| **Reconciliations** | Combine sources, schemas, rules | `reconciliation-spec.yaml` |

### 3.2 Configuration Hierarchy

```
Reconciliation Job
├── Source A Configuration
│   ├── Data Source (SFTP/API/DB)
│   └── Schema Mapping
├── Source B Configuration
│   ├── Data Source (SFTP/API/DB)
│   └── Schema Mapping
├── Matching Rules
└── Execution Parameters
```

## 4. YAML Syntax Conventions

### 4.1 Naming Conventions

- **Files**: `kebab-case.yaml` (e.g., `payment-gateway-recon.yaml`)
- **Keys**: `snake_case` (e.g., `reconciliation_unit`, `matching_rules`)
- **Values**: Context-dependent (IDs in UPPER_CASE, names in Title Case)

### 4.2 Comments

```yaml
# Top-level comment describing the entire configuration
reconciliation:
  name: payment_gateway_recon  # Inline comment explaining this field
  # Multi-line comment
  # explaining complex logic
  mode: one_to_one
```

### 4.3 Anchors and References

**YAML Anchors** for reusability:

```yaml
# Define anchor - Version 2.0 uses Lua scripts
amount_tolerance_script: &amount_tolerance
  script: |
    return math.abs(source_a_amount - source_b_amount) <= 0.01

# Reuse anchor
rules:
  - name: gross_amount_match
    severity: error
    <<: *amount_tolerance
    # Uses Lua script for tolerance logic

  - name: net_amount_match
    severity: error
    <<: *amount_tolerance
    # Same Lua script reused
```

### 4.4 Multi-line Strings

```yaml
# Literal block (preserves newlines) - PostgreSQL only
query_template: |
  SELECT
    transaction_id,
    amount,
    currency,
    created_at  -- UTC timestamp only
  FROM transactions
  WHERE DATE(created_at AT TIME ZONE 'UTC') = '{year}-{month}-{day}'

# Folded block (single line)
description: >
  This reconciliation matches internal ledger
  transactions with payment gateway settlements
  on a daily basis using one-to-one mode.
```

### 4.5 Secret References

**Syntax**: `${SECRET:secret_name}`

```yaml
datasource:
  password: ${SECRET:database_password}
  api_key: ${SECRET:gateway_api_key}
```

### 4.6 Template Variables

**Syntax**: `{variable_name}`

```yaml
file_pattern: /data/transactions_{year}{month}{day}.csv
api_url: https://api.gateway.com/settlements?date={year}-{month}-{day}
```

## 5. Configuration Organization

### 5.1 Single File vs Multi-File

**Single File** (Simple reconciliations):
```yaml
# payment-recon.yaml
datasources:
  - ...
schemas:
  - ...
rules:
  - ...
reconciliation:
  ...
```

**Multi-File** (Complex reconciliations):
```
reconciliations/
├── datasources/
│   ├── internal-ledger.yaml
│   └── payment-gateway.yaml
├── schemas/
│   ├── ledger-schema.yaml
│   └── gateway-schema.yaml
├── rules/
│   └── payment-matching-rules.yaml
└── jobs/
    └── daily-payment-recon.yaml
```

### 5.2 Configuration Imports

```yaml
# daily-payment-recon.yaml
imports:
  - datasources/internal-ledger.yaml
  - datasources/payment-gateway.yaml
  - schemas/ledger-schema.yaml
  - rules/payment-matching-rules.yaml

reconciliation:
  name: daily_payment_reconciliation
  source_a: internal_ledger  # Reference imported datasource
  source_a_schema: ledger_schema  # Reference imported schema
  matching_rules: payment_matching_rules  # Reference imported rules
```

## 6. Common Patterns

### 6.1 Template Pattern

**Define reusable templates**:

```yaml
# templates/standard-payment-recon.yaml
template:
  name: standard_payment_reconciliation
  parameters:
    - source_a_name
    - source_b_name
    - tolerance_amount

  reconciliation:
    mode: one_to_one
    source_a: ${source_a_name}
    source_b: ${source_b_name}
    matching_rules:
      - join_on: transaction_id
      - amount_tolerance: ${tolerance_amount}
```

**Use template**:

```yaml
# my-recon.yaml
from_template: standard_payment_reconciliation
parameters:
  source_a_name: internal_ledger
  source_b_name: payment_gateway
  tolerance_amount: 0.05
```

### 6.2 Environment-Specific Configurations

```yaml
# base-config.yaml - PostgreSQL only
datasource:
  type: database
  database_type: postgresql  # Only PostgreSQL supported
  database: transactions_db
  query_template: |
    SELECT * FROM transactions
    WHERE DATE(created_at AT TIME ZONE 'UTC') = '{year}-{month}-{day}'

---
# dev-config.yaml (overrides)
datasource:
  host: localhost
  port: 5432
  username: dev_user
  password: ${SECRET:dev_db_password}

---
# prod-config.yaml (overrides)
datasource:
  host: prod-db.company.com
  port: 5432
  username: prod_readonly
  password: ${SECRET:prod_db_password}
```

### 6.3 Match Group Queries Pattern

Version 2.0 uses named queries for match groups:

```yaml
reconciliation:
  mode: one_to_one  # Only one-to-one supported

  outputs:
    matched:
      store: true
      export:
        format: csv  # CSV only
        path: /results/{run_id}/matched.csv

      # Define named queries for match groups
      queries:
        - name: perfect_matches
          rules_passed: [currency_match, amount_exact, timestamp_exact]

        - name: domestic_with_tolerance
          rules_passed: [currency_match, timestamp_exact]
          rules_failed: [amount_exact]  # Amount outside exact match
          script: |
            -- Additional filter using Lua
            return source_a.currency == 'USD' and
                   math.abs(source_a.amount - source_b.amount) <= 0.01

        - name: international_with_tolerance
          rules_passed: [currency_match, timestamp_exact]
          rules_failed: [amount_exact]
          script: |
            return source_a.currency ~= 'USD' and
                   math.abs(source_a.amount - source_b.amount) <= 0.10
```

## 7. Validation and Linting

### 7.1 JSON Schema Validation

Each DSL component has a corresponding JSON Schema for validation.

**Example**: Validate reconciliation config
```bash
reconciliation-cli validate --config payment-recon.yaml
```

**Output**:
```
✓ Syntax valid
✓ All referenced datasources exist
✓ All referenced schemas exist
✓ All referenced rules exist
✗ Error: Field 'source_a.transaction_id' not found in schema
```

### 7.2 Linting Rules

**Best Practices Linter**:
- Warn on unused datasources
- Warn on deprecated syntax
- Suggest performance optimizations
- Check for common mistakes

**Example**:
```bash
reconciliation-cli lint --config payment-recon.yaml
```

**Output**:
```
Warning: Schema 'old_schema' is marked deprecated, use 'new_schema' instead
Warning: Datasource 'unused_source' defined but not used in any reconciliation
Info: Consider enabling caching for datasource 'slow_api' (avg fetch time: 30s)
```

## 8. DSL Extensions

### 8.1 Lua Transformations (Version 2.0)

All transformations use Lua - no specialized configs:

```yaml
# Schema transformations - Lua only
schema:
  fields:
    # Type conversion
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      transform: "tonumber(value)"

    # Derived field with calculation
    - name: calculated_fee
      type: decimal
      precision: 19
      scale: 4
      transform: 
|
        if row.amount < 100 then
          return 2.50
        else
          return row.amount * 0.029
        end

    # Enum mapping with Lua
    - name: status
      type: string
      source: txn_status
      transform: |
        local v = string.upper(value or "")
        if v == "SUCCESS" or v == "OK" then
          return "COMPLETED"
        elseif v == "FAILED" or v == "ERROR" then
          return "REJECTED"
        else
          return "UNKNOWN"
        end
```

### 8.2 Plugins

**Future**: Support custom DSL extensions via plugins.

```yaml
plugins:
  - name: custom-matcher
    type: matching_rule
    implementation: /path/to/custom_matcher.lua
```

## 9. Version Control Integration

### 9.1 Git Best Practices

```
.
├── .gitignore           # Ignore secrets, local configs
├── README.md
├── datasources/
├── schemas/
├── rules/
├── jobs/
└── secrets.template.yaml  # Template for secrets (no actual values)
```

**.gitignore**:
```
# Never commit secrets
secrets.yaml
*.secret.yaml

# Never commit local configs
local.*.yaml
```

### 9.2 Code Review

**Reviewable Changes**:
- YAML diffs clearly show configuration changes
- Comments in YAML explain business logic
- Version bumps indicate incompatible changes

## 10. Migration and Compatibility

### 10.1 Backward Compatibility

**Minor Version Changes** (v1.1 → v1.2):
- New optional fields
- Deprecated fields (still work, but warn)
- New features

**Major Version Changes** (v1.x → v2.0):
- Breaking changes
- Removed deprecated fields
- Changed semantics

### 10.2 Migration Tools

```bash
# Migrate from v1 to v2
reconciliation-cli migrate --from v1 --to v2 --config old-config.yaml --output new-config.yaml
```

## 11. Documentation Standards

### 11.1 Inline Documentation

```yaml
reconciliation:
  name: payment_gateway_reconciliation
  description: |
    Daily reconciliation of internal payment ledger against
    payment gateway settlement reports.

    Business Owner: Finance Operations Team
    Data Sources:
      - Internal Ledger (PostgreSQL)
      - Payment Gateway API

    Matching Logic:
      - Join on transaction_id
      - Amount must match within $0.01
      - Currency must be exact match

    SLA: Complete by 10 AM daily
    On-Call: finops-oncall@company.com

  version: 3
  created: 2024-01-15
  last_updated: 2024-03-01
  owner: john.doe@company.com
```

### 11.2 External Documentation

Link to detailed docs:

```yaml
reconciliation:
  name: complex_recon
  documentation: https://docs.company.com/reconciliation/complex-recon
```

## 12. Example: Complete DSL Usage (Version 2.0)

**Directory Structure**:
```
reconciliation-configs/
├── datasources/
│   ├── ledger.yaml
│   └── gateway.yaml
├── schemas/
│   └── payment-schema.yaml
├── rules/
│   └── payment-rules.yaml
└── jobs/
    └── daily-payment-recon.yaml
```

**Job Configuration** (`jobs/daily-payment-recon.yaml`):
```yaml
version: 2.0
imports:
  - ../datasources/ledger.yaml
  - ../datasources/gateway.yaml
  - ../schemas/payment-schema.yaml
  - ../rules/payment-rules.yaml

reconciliation:
  name: daily_payment_reconciliation
  description: Daily payment gateway reconciliation
  version: 1

  reconciliation_unit:
    interval: day  # day, hour, or minute
    timezone: UTC  # Only UTC supported

  mode: one_to_one  # Only one-to-one supported

  source_a:
    datasource: internal_ledger
    schema: payment_schema

  source_b:
    datasource: payment_gateway
    schema: payment_schema

  matching_rules: payment_matching_rules

  outputs:
    matched:
      store: true
      export:
        format: csv  # CSV only
        path: /results/{run_id}/matched.csv
      # Define named queries for match groups
      queries:
        - name: perfect_matches
          rules_passed: [currency_match, amount_exact, timestamp_exact]
        - name: warnings
          rules_failed: [timestamp_exact]

    unmatched_left:
      store: true
      export:
        format: csv  # CSV only
        path: /results/{run_id}/unmatched_ledger.csv

    unmatched_right:
      store: true
      export:
        format: csv  # CSV only
        path: /results/{run_id}/unmatched_gateway.csv
```

**Execution**:
```bash
# Validate configuration
reconciliation-cli validate --config jobs/daily-payment-recon.yaml

# Run reconciliation for specific date (UTC)
reconciliation-cli run --config jobs/daily-payment-recon.yaml \
  --datetime-range 2024-03-15T00:00:00Z/2024-03-16T00:00:00Z

# Query results (rule-based queries only)
reconciliation-cli query --run RUN-2024-03-15-001 --category unmatched_left
```

## 13. Summary

The Reconciliation DSL (Version 2.0) provides:
- **Human-readable**: YAML syntax, self-documenting
- **Declarative**: Describe what, not how
- **Composable**: Reusable components
- **Versioned**: Reproducible, auditable
- **Validated**: Early error detection
- **Lua-powered**: All transformations and complex logic use Lua scripts
- **Simplified**: JOIN + WHERE pattern for matching rules
- **Focused**: One-to-one mode only, CSV exports only, UTC only, PostgreSQL only

**Version 2.0 Changes**:
- **Matching Rules**: Simplified to JOIN (equality only) + WHERE (Lua scripts)
- **Schema**: All transformations use Lua (no specialized type conversion configs)
- **Reconciliation Mode**: One-to-one only (one-to-many marked as TODO)
- **Exports**: CSV only (removed parquet, xlsx)
- **Timestamps**: UTC only (no timezone conversions)
- **Database**: PostgreSQL only (removed MySQL, MSSQL, Oracle)
- **Fetch Mode**: Removed incremental fetch
- **Queries**: Named queries for match groups, rule-based filtering only

Next sections provide detailed specs for each DSL component.
