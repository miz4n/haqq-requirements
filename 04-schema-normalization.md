# Schema Normalization

## 1. Overview

Schema normalization is the process of transforming data from different sources into a common, standardized structure for reconciliation. This involves:
- **Type mapping**: Converting source data types to normalized types
- **Field mapping**: Mapping source field names to standardized field names
- **Type conversion**: Converting values between different type representations
- **Derived fields**: Creating calculated fields from existing data
- **Enum mapping**: Translating categorical values across systems

## 2. Type System

### 2.1 Supported Data Types

The reconciliation engine must support the following normalized data types:

| Type | Description | Example Values | Storage |
|------|-------------|----------------|---------|
| `string` | Text data | `"Hello"`, `"TXN001"` | Variable length |
| `integer` | Whole numbers | `42`, `-100`, `0` | 64-bit signed |
| `decimal` | Fixed-point numbers | `100.50`, `-25.99` | Precision-configurable |
| `boolean` | True/false values | `true`, `false` | 1 bit |
| `date` | Calendar date (no time) | `2024-03-15` | Date only |
| `timestamp` | Date and time | `2024-03-15T10:30:00Z` | With timezone |
| `null` | Absence of value | `null` | Special marker |

### 2.2 Type Precision

For decimal types, precision and scale must be configurable:

```yaml
schema:
  fields:
    - name: amount
      type: decimal
      precision: 19  # Total digits
      scale: 4       # Digits after decimal (e.g., 123456789012345.1234)
```

**Default**: `decimal(19,4)` for financial amounts.

## 3. Field Transformation

Schema normalization handles all transformations through a unified field specification approach. Each field can specify:
- **Simple mapping**: Direct source field mapping
- **Type conversion**: Transformation from source type to target type
- **Inline expressions**: Simple calculations and transformations
- **Lua scripts**: Complex transformation logic

### 3.1 Simple Field Mapping

**Requirement**: Map source field names to normalized schema field names.

**Example**:

**Source A** (Payment Gateway):
```csv
txn_id,txn_amount,txn_currency,txn_status
TXN001,100.50,USD,SUCCESS
```

**Normalized Schema with Source Mapping**:
```yaml
schema:
  name: payment_transaction
  version: 1

  fields:
    # Direct mapping - no transformation
    - name: transaction_id
      type: string
      source: txn_id

    # Type conversion - string to decimal
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      transform: "tonumber(value)"

    # Direct mapping
    - name: currency
      type: string
      source: txn_currency

    # Enum mapping via Lua
    - name: status
      type: string
      source: txn_status
      transform: |
        if value == "SUCCESS" or value == "OK" then
          return "COMPLETED"
        elseif value == "FAILED" then
          return "REJECTED"
        else
          return "UNKNOWN"
        end
```

### 3.2 Nested Field Mapping

**Requirement**: Extract fields from nested JSON structures using dot notation.

**Source** (JSON):
```json
{
  "transaction": {
    "id": "TXN001",
    "payment": {
      "amount": {
        "value": 100.50,
        "currency": "USD"
      }
    }
  }
}
```

**Schema with Nested Mapping**:
```yaml
schema:
  fields:
    - name: transaction_id
      type: string
      source: transaction.id

    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: transaction.payment.amount.value

    - name: currency
      type: string
      source: transaction.payment.amount.currency
```

### 3.3 Constant Values

**Requirement**: Add constant values to normalized schema.

**Use Case**: Source doesn't have a "source_system" field, but we want to track it.

```yaml
schema:
  fields:
    - name: transaction_id
      type: string
      source: txn_id

    - name: amount
      type: decimal
      source: txn_amount

    # Constant field - no source
    - name: source_system
      type: string
      transform: "return 'PAYMENT_GATEWAY'"

    # Constant field
    - name: region
      type: string
      transform: "return 'US'"
```

### 3.4 Derived Fields with Inline Expressions

**Requirement**: Create calculated fields from existing data using inline expressions or Lua scripts.

**Example**: Field concatenation.

**Source**:
```csv
first_name,last_name
John,Doe
```

**Schema with Derived Field**:
```yaml
schema:
  fields:
    - name: first_name
      type: string
      source: first_name

    - name: last_name
      type: string
      source: last_name

    # Derived field - concatenation (inline expression)
    - name: full_name
      type: string
      transform: "row.first_name .. ' ' .. row.last_name"
```

**Result**: `full_name = "John Doe"`

### 3.5 Field Splitting with Lua

**Example**: Split full name into first and last name.

**Source**:
```csv
full_name
John Doe
```

**Schema with Field Splitting**:
```yaml
schema:
  fields:
    - name: full_name
      type: string
      source: full_name

    # Split first name
    - name: first_name
      type: string
      transform: |
        local parts = {}
        for part in string.gmatch(row.full_name, "%S+") do
          table.insert(parts, part)
        end
        return parts[1] or ""

    # Split last name
    - name: last_name
      type: string
      transform: |
        local parts = {}
        for part in string.gmatch(row.full_name, "%S+") do
          table.insert(parts, part)
        end
        return parts[2] or ""
```

### 3.6 Type Conversions

**Requirement**: All type conversions are handled through field transformations using inline expressions or Lua scripts.

**Example**: String to number, number to string, date parsing, boolean conversion.

```yaml
schema:
  fields:
    # String to decimal
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      transform: "tonumber(value)"

    # Number to string with padding
    - name: zip_code_str
      type: string
      source: zip_code
      transform: "string.format('%05d', tonumber(value))"

    # Date parsing with timezone
    - name: transaction_timestamp
      type: timestamp
      source: transaction_date
      transform: |
        -- Parse date string "2024-03-15" to timestamp in America/New_York, then convert to UTC
        local dt = parse_datetime(value, "YYYY-MM-DD", "America/New_York")
        return convert_timezone(dt, "UTC")

    # Boolean conversion from various formats
    - name: is_active
      type: boolean
      source: active_flag
      transform: |
        local v = string.upper(tostring(value))
        if v == "Y" or v == "YES" or v == "1" or v == "TRUE" then
          return true
        elseif v == "N" or v == "NO" or v == "0" or v == "FALSE" then
          return false
        else
          return nil
        end

    # Null handling with default
    - name: fee_amount
      type: decimal
      source: fee
      nullable: true
      transform: |
        if value == nil or value == "" then
          return 0.00  -- Default value
        else
          return tonumber(value)
        end
```

### 3.7 Arithmetic and Calculations

**Example**: Derived fields with calculations.

```yaml
schema:
  fields:
    # Simple arithmetic (inline)
    - name: net_amount
      type: decimal
      transform: "row.amount - row.fee_amount"

    # Percentage calculation (inline)
    - name: fee_percentage
      type: decimal
      precision: 5
      scale: 2
      transform: "(row.fee_amount / row.amount) * 100"

    # Conditional logic (inline)
    - name: review_required
      type: boolean
      transform: "row.amount > 10000"

    # Multi-condition (Lua)
    - name: risk_level
      type: string
      transform: |
        if row.amount > 100000 then
          return "HIGH"
        elseif row.amount > 10000 then
          return "MEDIUM"
        else
          return "LOW"
        end
```

### 3.8 String Manipulation

**Example**: String operations.

```yaml
schema:
  fields:
    # Extract substring (inline)
    - name: transaction_year
      type: string
      transform: "string.sub(row.transaction_id, 1, 4)"

    # Concatenation with formatting (inline)
    - name: display_amount
      type: string
      transform: "row.currency .. ' ' .. string.format('%.2f', row.amount)"
```

### 3.9 Date Arithmetic

**Example**: Date calculations.

```yaml
schema:
  fields:
    # T+2 settlement date (inline)
    - name: expected_settlement_date
      type: date
      transform: "add_days(row.transaction_date, 2)"

    # Days pending (inline)
    - name: days_pending
      type: integer
      transform: "days_between(row.transaction_date, current_date())"

    # Business days calculation (Lua script)
    - name: business_days_to_settlement
      type: integer
      transform: |
        function calculate(row)
          local txn_date = row.transaction_date
          local settle_date = row.settlement_date
          local days = 0
          local current = txn_date

          while current < settle_date do
            local dow = weekday(current)
            if dow >= 1 and dow <= 5 then  -- Mon-Fri
              days = days + 1
            end
            current = add_days(current, 1)
          end

          return days
        end
```

### 3.10 Enum Mapping with Lua

**Requirement**: Enum mapping is handled through Lua transformations.

**Example**: Simple enum mapping.

```yaml
schema:
  fields:
    - name: status
      type: string
      source: txn_status
      transform: |
        local v = string.upper(value)
        if v == "SUCCESS" or v == "OK" or v == "APPROVED" or v == "SETTLED" then
          return "COMPLETED"
        elseif v == "FAILED" or v == "ERROR" or v == "DECLINED" then
          return "REJECTED"
        elseif v == "PENDING" or v == "PROCESSING" then
          return "IN_PROGRESS"
        else
          return "UNKNOWN"  -- Default fallback
        end
```

**Example**: Conditional enum mapping based on other fields.

```yaml
schema:
  fields:
    - name: status
      type: string
      source: txn_status
      transform: |
        local v = string.upper(value)
        local txn_type = row.transaction_type

        if v == "SUCCESS" or v == "OK" then
          if txn_type == "REFUND" then
            return "REFUND_COMPLETED"
          elseif txn_type == "PAYMENT" then
            if row.amount > 10000 then
              return "COMPLETED_HIGH_VALUE"
            else
              return "PAYMENT_COMPLETED"
            end
          else
            return "COMPLETED"
          end
        elseif v == "FAILED" or v == "ERROR" then
          if txn_type == "REFUND" then
            return "REFUND_FAILED"
          else
            return "REJECTED"
          end
        else
          return "UNKNOWN"
        end
```

### 3.11 Complex Transformations with Lua

**Example**: Tiered fee calculation based on amount and currency.

```yaml
schema:
  fields:
    - name: calculated_fee
      type: decimal
      precision: 19
      scale: 4
      transform: |
        function calculate(row)
          local base_fee = 0.0
          local amount = row.amount

          -- Tiered fee structure
          if amount <= 100 then
            base_fee = 2.50
          elseif amount <= 1000 then
            base_fee = 5.00
          else
            base_fee = amount * 0.005  -- 0.5%
          end

          -- Add international fee
          if row.currency ~= "USD" then
            base_fee = base_fee + (amount * 0.01)  -- +1%
          end

          return math.floor(base_fee * 100 + 0.5) / 100  -- Round to 2 decimals
        end
```

## 4. Lua Sandbox Environment

**Requirement**: Lua scripts must execute in a sandboxed environment for security.

**Restrictions**:
- No file I/O operations
- No network operations
- No OS command execution
- Limited memory (configurable, default: 50MB)
- Execution timeout (configurable, default: 5 seconds per row)

**Available Built-in Functions**:
- **Math**: `math.abs()`, `math.ceil()`, `math.floor()`, `round()`, `tonumber()`
- **String**: `string.upper()`, `string.lower()`, `string.sub()`, `string.format()`, `string.gmatch()`
- **Date**: `add_days()`, `add_months()`, `days_between()`, `weekday()`, `parse_datetime()`, `convert_timezone()`, `current_date()`
- **Formatting**: `format_number()`, `format_date()`
- **Type conversion**: `tostring()`, `tonumber()`

**Access to Row Data**:
- Current row fields accessible via `row.field_name`
- Source field accessible via `value` (for fields with `source` specified)
- All fields defined earlier in schema available in `row`

## 5. Schema Versioning

### 5.1 Schema Versions

**Requirement**: Schemas must be versioned independently.

```yaml
schema:
  name: payment_transaction
  version: 2
  created_at: 2024-01-15T10:00:00Z
  updated_at: 2024-03-01T14:30:00Z
  changelog:
    - version: 2
      date: 2024-03-01
      changes: "Added fee_amount field, made merchant_name nullable"
    - version: 1
      date: 2024-01-15
      changes: "Initial schema"
```

### 5.2 Version Immutability

**Requirement**: Once a reconciliation is run using a particular schema version, it will always rerun with that same configuration version.

**Versioning Strategy**:
- Each reconciliation job references a specific schema version (e.g., `payment_gateway_transaction:1`)
- Existing reconciliation jobs continue using their original schema version
- New reconciliation jobs can use updated schema versions
- No backward compatibility concerns - each version is immutable

## 6. Complete Schema Example

### 6.1 Payment Gateway Reconciliation Schema - Source A (Payment Gateway API)

**Example Source Data** (Payment Gateway API JSON):
```json
{
  "txn_id": "TXN0012345678",
  "merchant_ref": "MERCHANT_001",
  "txn_amount": "100.50",
  "txn_currency": "USD",
  "gateway_fee": "2.50",
  "txn_status": "SUCCESS",
  "created_at": "2024-03-15T10:30:00.000Z"
}
```

**Schema for Source A**:
```yaml
schema:
  name: payment_gateway_transaction
  version: 1
  description: "Normalized schema for payment gateway reconciliation - Source A mapping"

  fields:
    # Direct mappings
    - name: transaction_id
      type: string
      source: txn_id
      required: true
      description: "Unique transaction identifier"

    - name: merchant_id
      type: string
      source: merchant_ref
      required: true
      description: "Merchant identifier"

    # Type conversion: string to decimal
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      required: true
      transform: "tonumber(value)"
      description: "Transaction amount"

    - name: currency
      type: string
      source: txn_currency
      required: true
      description: "ISO 4217 currency code"

    # Type conversion with null handling
    - name: fee_amount
      type: decimal
      precision: 19
      scale: 4
      source: gateway_fee
      required: false
      transform: |
        if value == nil or value == "" then
          return 0.00
        else
          return tonumber(value)
        end
      description: "Processing fee"

    # Derived field - calculation
    - name: net_amount
      type: decimal
      precision: 19
      scale: 4
      required: false
      transform: "row.amount - row.fee_amount"
      description: "Amount after fees"

    # Enum mapping via Lua
    - name: status
      type: string
      source: txn_status
      required: true
      transform: |
        local v = string.upper(value)
        if v == "SUCCESS" or v == "OK" or v == "SETTLED" then
          return "COMPLETED"
        elseif v == "FAILED" or v == "ERROR" or v == "DECLINED" then
          return "REJECTED"
        elseif v == "PENDING" or v == "PROCESSING" then
          return "IN_PROGRESS"
        else
          return "UNKNOWN"
        end
      description: "Normalized transaction status"

    # Timestamp conversion (UTC timezone)
    - name: transaction_timestamp
      type: timestamp
      source: created_at
      required: true
      transform: "parse_datetime(value, 'YYYY-MM-DDTHH:mm:ss.SSSZ', 'UTC')"
      description: "Transaction creation time in UTC"

    # Derived field - date arithmetic
    - name: settlement_date
      type: date
      required: false
      transform: "add_days(row.transaction_timestamp, 2)"
      description: "Expected settlement date (T+2)"

    # Derived field - boolean condition
    - name: is_high_value
      type: boolean
      transform: "row.amount >= 10000"
      description: "High value transaction flag"
```

### 6.2 Payment Gateway Reconciliation Schema - Source B (Internal Ledger DB)

**Example Source Data** (Internal Ledger PostgreSQL):
```csv
transaction_id,merchant_id,transaction_amount,currency_code,processing_fee,status_code,created_at
TXN0012345678,MERCHANT_001,100.50,USD,2.50,COMPLETED,2024-03-15 05:30:00
```

**Schema for Source B**:
```yaml
schema:
  name: payment_gateway_transaction
  version: 1
  description: "Normalized schema for payment gateway reconciliation - Source B mapping"

  fields:
    # Direct mappings (already match)
    - name: transaction_id
      type: string
      source: transaction_id
      required: true

    - name: merchant_id
      type: string
      source: merchant_id
      required: true

    # Type conversion: already decimal
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: transaction_amount
      required: true

    - name: currency
      type: string
      source: currency_code
      required: true

    # Type conversion with null handling
    - name: fee_amount
      type: decimal
      precision: 19
      scale: 4
      source: processing_fee
      required: false
      transform: |
        if value == nil or value == "" then
          return 0.00
        else
          return tonumber(value)
        end

    # Derived field - calculation
    - name: net_amount
      type: decimal
      precision: 19
      scale: 4
      required: false
      transform: "row.amount - row.fee_amount"

    # Enum mapping - Source B uses different status codes
    - name: status
      type: string
      source: status_code
      required: true
      transform: |
        local v = string.upper(value)
        -- Source B already uses normalized status codes mostly
        if v == "COMPLETED" or v == "APPROVED" then
          return "COMPLETED"
        elseif v == "REJECTED" or v == "FAILED" then
          return "REJECTED"
        elseif v == "IN_PROGRESS" or v == "PENDING" then
          return "IN_PROGRESS"
        else
          return "UNKNOWN"
        end

    # Timestamp conversion: America/New_York to UTC
    - name: transaction_timestamp
      type: timestamp
      source: created_at
      required: true
      transform: |
        local dt = parse_datetime(value, "YYYY-MM-DD HH:mm:ss", "America/New_York")
        return convert_timezone(dt, "UTC")
      description: "Transaction creation time normalized to UTC"

    # Derived field - date arithmetic
    - name: settlement_date
      type: date
      required: false
      transform: "add_days(row.transaction_timestamp, 2)"

    # Derived field - boolean condition
    - name: is_high_value
      type: boolean
      transform: "row.amount >= 10000"
```

## 7. Validation Rules

### 7.1 Field-Level Validation

**Requirement**: Validate normalized data against schema rules.

```yaml
schema:
  fields:
    - name: amount
      type: decimal
      validation:
        min: 0.01
        max: 1000000.00
        required: true

    - name: currency
      type: string
      validation:
        regex: "^[A-Z]{3}$"
        enum: [USD, EUR, GBP, JPY]

    - name: transaction_id
      type: string
      validation:
        regex: "^TXN[0-9]{10}$"
        unique: true  # Within dataset
```

## 8. Performance Considerations

### 8.1 Lazy Evaluation

**Requirement**: Derived fields evaluated only when needed.

If a derived field is not used in matching rules or output, it should not be calculated.

### 8.2 Parallel Processing

**Requirement**: Field derivations that don't depend on each other can be parallelized.

## 9. Open Questions

2. **Schema Inheritance**: Support schema inheritance (e.g., base transaction schema extended for specific use cases)?

4. **Schema Validation Tools**: Provide CLI tools to validate schema definitions before deployment?

5. **Custom Type Support**: Allow users to define custom data types with validation logic?
