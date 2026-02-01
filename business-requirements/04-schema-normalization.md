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

Schema normalization handles all transformations through a unified field specification approach using **Polars expressions** and **Python functions**.

### Transform Types

| Type | Description | Performance | Use Case |
|------|-------------|-------------|----------|
| `expression` | Direct Polars expression | Fastest (vectorized, runs in Rust) | Most transformations |
| `function` | Python function with `@numba.jit` | Fast (JIT compiled) | Complex business logic |

Each field can specify:
- **Simple mapping**: Direct source field mapping (no transform needed)
- **Type conversion**: Using Polars `cast()` expressions
- **Polars expressions**: Vectorized transformations using Polars API
- **Python functions**: Numba-decorated functions for complex logic

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

    # Type conversion - string to decimal (Polars expression)
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      transform:
        type: expression
        expr: pl.col("txn_amount").cast(pl.Decimal(precision=19, scale=4))

    # Direct mapping
    - name: currency
      type: string
      source: txn_currency

    # Enum mapping (Polars when/then/otherwise)
    - name: status
      type: string
      source: txn_status
      transform:
        type: expression
        expr: |
          pl.when(pl.col("txn_status").is_in(["SUCCESS", "OK"]))
            .then(pl.lit("COMPLETED"))
            .when(pl.col("txn_status") == "FAILED")
            .then(pl.lit("REJECTED"))
            .otherwise(pl.lit("UNKNOWN"))
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

    # Constant field - no source (Polars literal)
    - name: source_system
      type: string
      transform:
        type: expression
        expr: pl.lit("PAYMENT_GATEWAY")

    # Constant field
    - name: region
      type: string
      transform:
        type: expression
        expr: pl.lit("US")
```

### 3.4 Derived Fields with Polars Expressions

**Requirement**: Create calculated fields from existing data using Polars expressions.

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

    # Derived field - concatenation (Polars expression)
    - name: full_name
      type: string
      transform:
        type: expression
        expr: pl.concat_str([pl.col("first_name"), pl.lit(" "), pl.col("last_name")])
```

**Result**: `full_name = "John Doe"`

### 3.5 Field Splitting with Polars

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

    # Split first name (Polars string split)
    - name: first_name
      type: string
      transform:
        type: expression
        expr: pl.col("full_name").str.split(" ").list.get(0).fill_null("")

    # Split last name
    - name: last_name
      type: string
      transform:
        type: expression
        expr: pl.col("full_name").str.split(" ").list.get(1).fill_null("")
```

### 3.6 Type Conversions

**Requirement**: All type conversions are handled through Polars expressions.

**Example**: String to number, number to string, date parsing, boolean conversion.

```yaml
schema:
  fields:
    # String to decimal (Polars cast)
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      transform:
        type: expression
        expr: pl.col("txn_amount").cast(pl.Decimal(precision=19, scale=4))

    # Number to string with padding (Polars format)
    - name: zip_code_str
      type: string
      source: zip_code
      transform:
        type: expression
        expr: pl.col("zip_code").cast(pl.Int64).cast(pl.Utf8).str.zfill(5)

    # Date parsing with timezone (Polars strptime + dt operations)
    - name: transaction_timestamp
      type: timestamp
      source: transaction_date
      transform:
        type: expression
        expr: |
          pl.col("transaction_date")
            .str.strptime(pl.Datetime, "%Y-%m-%d")
            .dt.replace_time_zone("America/New_York")
            .dt.convert_time_zone("UTC")

    # Boolean conversion from various formats (Polars when/then)
    - name: is_active
      type: boolean
      source: active_flag
      transform:
        type: expression
        expr: |
          pl.when(pl.col("active_flag").str.to_uppercase().is_in(["Y", "YES", "1", "TRUE"]))
            .then(pl.lit(True))
            .when(pl.col("active_flag").str.to_uppercase().is_in(["N", "NO", "0", "FALSE"]))
            .then(pl.lit(False))
            .otherwise(pl.lit(None))

    # Null handling with default (Polars fill_null)
    - name: fee_amount
      type: decimal
      source: fee
      nullable: true
      transform:
        type: expression
        expr: |
          pl.col("fee")
            .cast(pl.Decimal(precision=19, scale=4), strict=False)
            .fill_null(pl.lit(0.00))
```

### 3.7 Arithmetic and Calculations

**Example**: Derived fields with calculations.

```yaml
schema:
  fields:
    # Simple arithmetic (Polars expression)
    - name: net_amount
      type: decimal
      transform:
        type: expression
        expr: pl.col("amount") - pl.col("fee_amount")

    # Percentage calculation (Polars expression)
    - name: fee_percentage
      type: decimal
      precision: 5
      scale: 2
      transform:
        type: expression
        expr: (pl.col("fee_amount") / pl.col("amount")) * 100

    # Conditional logic (Polars expression)
    - name: review_required
      type: boolean
      transform:
        type: expression
        expr: pl.col("amount") > 10000

    # Multi-condition (Polars when/then)
    - name: risk_level
      type: string
      transform:
        type: expression
        expr: |
          pl.when(pl.col("amount") > 100000).then(pl.lit("HIGH"))
            .when(pl.col("amount") > 10000).then(pl.lit("MEDIUM"))
            .otherwise(pl.lit("LOW"))
```

### 3.8 String Manipulation

**Example**: String operations.

```yaml
schema:
  fields:
    # Extract substring (Polars expression)
    - name: transaction_year
      type: string
      transform:
        type: expression
        expr: pl.col("transaction_id").str.slice(0, 4)

    # Concatenation with formatting (Polars expression)
    - name: display_amount
      type: string
      transform:
        type: expression
        expr: |
          pl.concat_str([
            pl.col("currency"),
            pl.lit(" "),
            pl.col("amount").cast(pl.Float64).round(2).cast(pl.Utf8)
          ])
```

### 3.9 Date Arithmetic

**Example**: Date calculations.

```yaml
schema:
  # Define reusable functions
  functions:
    business_days_between:
      type: function
      decorator: numba.jit(nopython=True)
      code: |
        def business_days_between(start_date: int, end_date: int) -> int:
            """Calculate business days between two dates (as ordinals)."""
            days = 0
            current = start_date
            while current < end_date:
                # weekday: 0=Mon, 6=Sun
                weekday = (current + 3) % 7  # Adjust for ordinal
                if weekday < 5:  # Mon-Fri
                    days += 1
                current += 1
            return days

  fields:
    # T+2 settlement date (Polars expression)
    - name: expected_settlement_date
      type: date
      transform:
        type: expression
        expr: pl.col("transaction_date") + pl.duration(days=2)

    # Days pending (Polars expression)
    - name: days_pending
      type: integer
      transform:
        type: expression
        expr: (pl.lit(datetime.date.today()) - pl.col("transaction_date")).dt.total_days()

    # Business days calculation (Numba function for complex logic)
    - name: business_days_to_settlement
      type: integer
      transform:
        type: function
        name: business_days_between
        args: [transaction_date, settlement_date]
```

**Alternative using numpy for business days** (simpler, no Numba needed):
```yaml
schema:
  fields:
    - name: business_days_to_settlement
      type: integer
      transform:
        type: expression
        expr: |
          # Using numpy's busday_count via map_batches
          pl.struct(["transaction_date", "settlement_date"]).map_batches(
            lambda s: pl.Series(np.busday_count(
              s.struct["transaction_date"].to_numpy().astype("datetime64[D]"),
              s.struct["settlement_date"].to_numpy().astype("datetime64[D]")
            ))
          )
```

### 3.10 Enum Mapping with Polars

**Requirement**: Enum mapping is handled through Polars `when/then/otherwise` expressions.

**Example**: Simple enum mapping.

```yaml
schema:
  fields:
    - name: status
      type: string
      source: txn_status
      transform:
        type: expression
        expr: |
          pl.when(pl.col("txn_status").str.to_uppercase().is_in(["SUCCESS", "OK", "APPROVED", "SETTLED"]))
            .then(pl.lit("COMPLETED"))
            .when(pl.col("txn_status").str.to_uppercase().is_in(["FAILED", "ERROR", "DECLINED"]))
            .then(pl.lit("REJECTED"))
            .when(pl.col("txn_status").str.to_uppercase().is_in(["PENDING", "PROCESSING"]))
            .then(pl.lit("IN_PROGRESS"))
            .otherwise(pl.lit("UNKNOWN"))
```

**Example**: Conditional enum mapping based on other fields.

```yaml
schema:
  fields:
    - name: status
      type: string
      source: txn_status
      transform:
        type: expression
        expr: |
          # Complex conditional logic using nested when/then
          pl.when(
            pl.col("txn_status").str.to_uppercase().is_in(["SUCCESS", "OK"]) &
            (pl.col("transaction_type") == "REFUND")
          ).then(pl.lit("REFUND_COMPLETED"))
          .when(
            pl.col("txn_status").str.to_uppercase().is_in(["SUCCESS", "OK"]) &
            (pl.col("transaction_type") == "PAYMENT") &
            (pl.col("amount") > 10000)
          ).then(pl.lit("COMPLETED_HIGH_VALUE"))
          .when(
            pl.col("txn_status").str.to_uppercase().is_in(["SUCCESS", "OK"]) &
            (pl.col("transaction_type") == "PAYMENT")
          ).then(pl.lit("PAYMENT_COMPLETED"))
          .when(
            pl.col("txn_status").str.to_uppercase().is_in(["SUCCESS", "OK"])
          ).then(pl.lit("COMPLETED"))
          .when(
            pl.col("txn_status").str.to_uppercase().is_in(["FAILED", "ERROR"]) &
            (pl.col("transaction_type") == "REFUND")
          ).then(pl.lit("REFUND_FAILED"))
          .when(
            pl.col("txn_status").str.to_uppercase().is_in(["FAILED", "ERROR"])
          ).then(pl.lit("REJECTED"))
          .otherwise(pl.lit("UNKNOWN"))
```

### 3.11 Complex Transformations with Python Functions

For complex business logic that cannot be expressed in Polars expressions, use Python functions decorated with `@numba.jit` for performance.

**Example**: Tiered fee calculation based on amount and currency.

```yaml
schema:
  # Define reusable functions with Numba JIT compilation
  functions:
    calculate_tiered_fee:
      type: function
      decorator: numba.jit(nopython=True)
      code: |
        def calculate_tiered_fee(amount: float, is_usd: bool) -> float:
            """Calculate tiered fee based on amount and currency."""
            # Tiered fee structure
            if amount <= 100:
                base_fee = 2.50
            elif amount <= 1000:
                base_fee = 5.00
            else:
                base_fee = amount * 0.005  # 0.5%

            # Add international fee
            if not is_usd:
                base_fee = base_fee + (amount * 0.01)  # +1%

            # Round to 2 decimals
            return round(base_fee * 100) / 100

  fields:
    - name: calculated_fee
      type: decimal
      precision: 19
      scale: 4
      transform:
        type: function
        name: calculate_tiered_fee
        args: [amount, "currency == 'USD'"]
```

**Usage in Polars**:
```python
import numba
import polars as pl

@numba.jit(nopython=True)
def calculate_tiered_fee(amount: float, is_usd: bool) -> float:
    if amount <= 100:
        base_fee = 2.50
    elif amount <= 1000:
        base_fee = 5.00
    else:
        base_fee = amount * 0.005

    if not is_usd:
        base_fee = base_fee + (amount * 0.01)

    return round(base_fee * 100) / 100

# Apply using map_elements
df = df.with_columns(
    pl.struct(["amount", "currency"])
      .map_elements(
          lambda row: calculate_tiered_fee(row["amount"], row["currency"] == "USD"),
          return_dtype=pl.Float64
      )
      .alias("calculated_fee")
)
```

## 4. Python/Polars Execution Environment

**Requirement**: Transformations execute in a Python environment with Polars as the data processing framework.

### 4.1 Transform Types

| Type | Description | Performance | Use Case |
|------|-------------|-------------|----------|
| `expression` | Direct Polars expression | **Fastest** - vectorized, runs in Rust | 80-90% of transformations |
| `function` | Python function with `@numba.jit` | **Fast** - JIT compiled | Complex business logic |

### 4.2 Polars Expression Type

Polars expressions are evaluated natively in Rust, providing maximum performance:

```yaml
transform:
  type: expression
  expr: pl.col("amount").cast(pl.Decimal(precision=19, scale=4))
```

**Available Polars Operations**:
- **Type casting**: `.cast()` for type conversion
- **String ops**: `.str.to_uppercase()`, `.str.strip_chars()`, `.str.split()`, `.str.slice()`
- **Math ops**: arithmetic operators, `.abs()`, `.round()`
- **Date/Time**: `.dt.total_days()`, `+ pl.duration()`, `.dt.convert_time_zone()`
- **Conditionals**: `pl.when().then().otherwise()`, `.is_in()`, `.is_null()`
- **Null handling**: `.fill_null()`, `.coalesce()`

### 4.3 Python Function Type

For complex logic, use Numba-decorated Python functions:

```yaml
functions:
  my_function:
    type: function
    decorator: numba.jit(nopython=True)
    code: |
      def my_function(arg1: float, arg2: bool) -> float:
          # Complex logic here
          return result
```

**Execution via Polars**:
- `map_elements()`: Row-by-row function application
- `map_batches()`: Batch function application (faster for array operations)

### 4.4 Resource Limits

```yaml
execution:
  limits:
    timeout_per_batch: 30s      # Max execution time per batch
    max_memory: 500MB           # Memory limit for transformations
    max_batch_size: 100000      # Rows per batch for map_batches
```

### 4.5 Access to Row Data

- **In expressions**: Use `pl.col("field_name")` to reference columns
- **In functions**: Row data passed as arguments defined in `args`
- **Cross-field references**: All columns available in the DataFrame context

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

    # Type conversion: string to decimal (Polars expression)
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      required: true
      transform:
        type: expression
        expr: pl.col("txn_amount").cast(pl.Decimal(precision=19, scale=4))
      description: "Transaction amount"

    - name: currency
      type: string
      source: txn_currency
      required: true
      description: "ISO 4217 currency code"

    # Type conversion with null handling (Polars expression)
    - name: fee_amount
      type: decimal
      precision: 19
      scale: 4
      source: gateway_fee
      required: false
      transform:
        type: expression
        expr: pl.col("gateway_fee").cast(pl.Decimal(precision=19, scale=4), strict=False).fill_null(0.00)
      description: "Processing fee"

    # Derived field - calculation (Polars expression)
    - name: net_amount
      type: decimal
      precision: 19
      scale: 4
      required: false
      transform:
        type: expression
        expr: pl.col("amount") - pl.col("fee_amount")
      description: "Amount after fees"

    # Enum mapping (Polars when/then/otherwise)
    - name: status
      type: string
      source: txn_status
      required: true
      transform:
        type: expression
        expr: |
          pl.when(pl.col("txn_status").str.to_uppercase().is_in(["SUCCESS", "OK", "SETTLED"]))
            .then(pl.lit("COMPLETED"))
            .when(pl.col("txn_status").str.to_uppercase().is_in(["FAILED", "ERROR", "DECLINED"]))
            .then(pl.lit("REJECTED"))
            .when(pl.col("txn_status").str.to_uppercase().is_in(["PENDING", "PROCESSING"]))
            .then(pl.lit("IN_PROGRESS"))
            .otherwise(pl.lit("UNKNOWN"))
      description: "Normalized transaction status"

    # Timestamp conversion (Polars strptime - already UTC)
    - name: transaction_timestamp
      type: timestamp
      source: created_at
      required: true
      transform:
        type: expression
        expr: pl.col("created_at").str.strptime(pl.Datetime, "%Y-%m-%dT%H:%M:%S%.fZ")
      description: "Transaction creation time in UTC"

    # Derived field - date arithmetic (Polars duration)
    - name: settlement_date
      type: date
      required: false
      transform:
        type: expression
        expr: (pl.col("transaction_timestamp") + pl.duration(days=2)).dt.date()
      description: "Expected settlement date (T+2)"

    # Derived field - boolean condition (Polars expression)
    - name: is_high_value
      type: boolean
      transform:
        type: expression
        expr: pl.col("amount") >= 10000
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

    # Type conversion with null handling (Polars expression)
    - name: fee_amount
      type: decimal
      precision: 19
      scale: 4
      source: processing_fee
      required: false
      transform:
        type: expression
        expr: pl.col("processing_fee").cast(pl.Decimal(precision=19, scale=4), strict=False).fill_null(0.00)

    # Derived field - calculation (Polars expression)
    - name: net_amount
      type: decimal
      precision: 19
      scale: 4
      required: false
      transform:
        type: expression
        expr: pl.col("amount") - pl.col("fee_amount")

    # Enum mapping - Source B uses different status codes (Polars when/then)
    - name: status
      type: string
      source: status_code
      required: true
      transform:
        type: expression
        expr: |
          pl.when(pl.col("status_code").str.to_uppercase().is_in(["COMPLETED", "APPROVED"]))
            .then(pl.lit("COMPLETED"))
            .when(pl.col("status_code").str.to_uppercase().is_in(["REJECTED", "FAILED"]))
            .then(pl.lit("REJECTED"))
            .when(pl.col("status_code").str.to_uppercase().is_in(["IN_PROGRESS", "PENDING"]))
            .then(pl.lit("IN_PROGRESS"))
            .otherwise(pl.lit("UNKNOWN"))

    # Timestamp conversion: America/New_York to UTC (Polars datetime)
    - name: transaction_timestamp
      type: timestamp
      source: created_at
      required: true
      transform:
        type: expression
        expr: |
          pl.col("created_at")
            .str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S")
            .dt.replace_time_zone("America/New_York")
            .dt.convert_time_zone("UTC")
      description: "Transaction creation time normalized to UTC"

    # Derived field - date arithmetic (Polars duration)
    - name: settlement_date
      type: date
      required: false
      transform:
        type: expression
        expr: (pl.col("transaction_timestamp") + pl.duration(days=2)).dt.date()

    # Derived field - boolean condition (Polars expression)
    - name: is_high_value
      type: boolean
      transform:
        type: expression
        expr: pl.col("amount") >= 10000
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
