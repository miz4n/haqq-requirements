# Data Formats

## 1. Overview

The reconciliation engine must support structured data in two primary formats:
- **CSV** (Comma-Separated Values)
- **JSON** (JavaScript Object Notation)

All data fetched from sources (SFTP, API, DB) must be parseable into a common tabular structure for reconciliation processing.

## 2. CSV Format Support

### 2.1 Configuration Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `delimiter` | string | No | `,` | Field separator character |
| `quote_char` | string | No | `"` | Character used to quote fields |
| `escape_char` | string | No | `\` | Character used to escape special chars |
| `header_row` | boolean | No | `true` | First row contains column names |
| `header_row_index` | integer | No | `0` | Index of header row (0-based) |
| `skip_rows` | integer | No | `0` | Number of rows to skip before header |
| `encoding` | string | No | `UTF-8` | Character encoding |
| `null_values` | array | No | `["", "NULL", "null"]` | Values treated as NULL |
| `trim_whitespace` | boolean | No | `true` | Trim leading/trailing spaces |
| `comment_char` | string | No | `null` | Lines starting with this are ignored |

### 2.2 Basic CSV Example

**File: transactions.csv**
```csv
transaction_id,amount,currency,status,created_at
TXN001,100.50,USD,COMPLETED,2024-03-15T10:30:00Z
TXN002,250.00,EUR,COMPLETED,2024-03-15T10:35:00Z
TXN003,75.25,USD,PENDING,2024-03-15T10:40:00Z
```

**Configuration**:
```yaml
format:
  type: csv
  delimiter: ","
  quote_char: "\""
  header_row: true
  encoding: UTF-8
  trim_whitespace: true
```

### 2.3 Custom Delimiter Examples

#### Tab-Separated Values (TSV)
```csv
transaction_id	amount	currency	status
TXN001	100.50	USD	COMPLETED
TXN002	250.00	EUR	COMPLETED
```

**Configuration**:
```yaml
format:
  type: csv
  delimiter: "\t"
```

#### Pipe-Delimited
```csv
transaction_id|amount|currency|status
TXN001|100.50|USD|COMPLETED
TXN002|250.00|EUR|COMPLETED
```

**Configuration**:
```yaml
format:
  type: csv
  delimiter: "|"
```

#### Semicolon-Delimited (European)
```csv
transaction_id;amount;currency;status
TXN001;100,50;USD;COMPLETED
TXN002;250,00;EUR;COMPLETED
```

**Configuration**:
```yaml
format:
  type: csv
  delimiter: ";"
  decimal_separator: ","
```

### 2.4 Quoted Fields

**File with quoted fields**:
```csv
transaction_id,merchant_name,amount,description
TXN001,"Joe's Coffee Shop",25.50,"Latte, large"
TXN002,"Bob's ""Best"" Bakery",12.00,"Croissant"
TXN003,Alice & Co,100.00,"Consulting services, March 2024"
```

**Configuration**:
```yaml
format:
  type: csv
  delimiter: ","
  quote_char: "\""
  escape_char: "\""  # Doubled quotes escape quotes
```

**Parsed Result**:

| transaction_id | merchant_name | amount | description |
|----------------|---------------|--------|-------------|
| TXN001 | Joe's Coffee Shop | 25.50 | Latte, large |
| TXN002 | Bob's "Best" Bakery | 12.00 | Croissant |
| TXN003 | Alice & Co | 100.00 | Consulting services, March 2024 |

### 2.5 Skip Rows & Header Position

**File with metadata header**:
```csv
# Settlement Report
# Generated: 2024-03-15
# Total Records: 1000

transaction_id,amount,currency,status
TXN001,100.50,USD,COMPLETED
TXN002,250.00,EUR,COMPLETED
```

**Configuration**:
```yaml
format:
  type: csv
  skip_rows: 3
  comment_char: "#"
  header_row: true
  header_row_index: 0  # First row after skipping
```

### 2.6 No Header Row

**File without header**:
```csv
TXN001,100.50,USD,COMPLETED
TXN002,250.00,EUR,COMPLETED
```

**Configuration**:
```yaml
format:
  type: csv
  header_row: false
  column_names:
    - transaction_id
    - amount
    - currency
    - status
```

### 2.7 Encoding Support

**Requirement**: Support common character encodings.

Supported encodings:
- `UTF-8` (default)
- `UTF-16`
- `ISO-8859-1` (Latin-1)
- `Windows-1252`
- `ASCII`

**Example - Latin-1 encoding**:
```yaml
format:
  type: csv
  encoding: ISO-8859-1
```

### 2.8 NULL Value Handling

**File with NULL values**:
```csv
transaction_id,amount,currency,fee,notes
TXN001,100.50,USD,2.50,""
TXN002,250.00,EUR,NULL,Refund processed
TXN003,75.00,USD,,"No fee"
```

**Configuration**:
```yaml
format:
  type: csv
  null_values:
    - ""
    - "NULL"
    - "null"
```

**Parsed Result**:

| transaction_id | amount | currency | fee | notes |
|----------------|--------|----------|-----|-------|
| TXN001 | 100.50 | USD | 2.50 | NULL |
| TXN002 | 250.00 | EUR | NULL | Refund processed |
| TXN003 | 75.00 | USD | NULL | No fee |

**Note**: All numeric values are read as strings during format parsing. Number parsing (including thousands/decimal separators) happens during schema normalization.

### 2.9 Large File Handling

**Requirement**: Handle CSV files up to 10GB efficiently.

**Approach**:
- Stream processing (not load entire file to memory)
- System automatically handles chunking internally based on file size
- Progress reporting for large files

**Note**: Large files are handled automatically by the system. No configuration required - the system detects file size and adopts appropriate streaming strategy.

**Note**: All date/timestamp values are read as strings during format parsing. Date parsing happens during schema normalization.

### 2.10 Error Handling

| Error Type | System Behavior |
|------------|-----------------|
| Malformed row (wrong column count) | Skip row, log warning, continue |
| Encoding error | Fail with encoding error message |
| File empty | Treat as 0 records |

**Strict Mode Option**:
```yaml
format:
  type: csv
  strict_mode: true  # Fail on any parsing error
```

## 3. JSON Format Support

### 3.1 Configuration Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `array_path` | string | No | `null` | JSONPath to array of records |
| `flatten_nested` | boolean | No | `true` | Flatten nested objects |
| `nested_separator` | string | No | `.` | Separator for flattened keys |
| `null_values` | array | No | `[null]` | Values treated as NULL |

### 3.2 Simple JSON Array

**File: transactions.json**
```json
[
  {
    "transaction_id": "TXN001",
    "amount": 100.50,
    "currency": "USD",
    "status": "COMPLETED",
    "created_at": "2024-03-15T10:30:00Z"
  },
  {
    "transaction_id": "TXN002",
    "amount": 250.00,
    "currency": "EUR",
    "status": "COMPLETED",
    "created_at": "2024-03-15T10:35:00Z"
  }
]
```

**Configuration**:
```yaml
format:
  type: json
  array_path: null  # Root is array
```

### 3.3 Nested JSON with Path

**File: response.json**
```json
{
  "status": "success",
  "metadata": {
    "count": 2,
    "generated_at": "2024-03-15T12:00:00Z"
  },
  "data": {
    "transactions": [
      {
        "transaction_id": "TXN001",
        "amount": 100.50,
        "currency": "USD"
      },
      {
        "transaction_id": "TXN002",
        "amount": 250.00,
        "currency": "EUR"
      }
    ]
  }
}
```

**Configuration**:
```yaml
format:
  type: json
  array_path: data.transactions
```

### 3.4 Nested Object Flattening

**File: nested.json**
```json
[
  {
    "transaction_id": "TXN001",
    "amount": {
      "value": 100.50,
      "currency": "USD"
    },
    "merchant": {
      "id": "M001",
      "name": "Coffee Shop",
      "location": {
        "city": "New York",
        "country": "USA"
      }
    }
  }
]
```

**Configuration**:
```yaml
format:
  type: json
  flatten_nested: true
  nested_separator: "."
```

**Flattened Result**:

| transaction_id | amount.value | amount.currency | merchant.id | merchant.name | merchant.location.city | merchant.location.country |
|----------------|--------------|-----------------|-------------|---------------|------------------------|---------------------------|
| TXN001 | 100.50 | USD | M001 | Coffee Shop | New York | USA |

### 3.5 Array Fields

**File: arrays.json**
```json
[
  {
    "transaction_id": "TXN001",
    "amount": 100.50,
    "tags": ["retail", "card_present"],
    "fees": [2.50, 0.30]
  }
]
```

**Array Handling**: All arrays are stringified (converted to JSON strings)

**Result**:

| transaction_id | amount | tags | fees |
|----------------|--------|------|------|
| TXN001 | 100.50 | ["retail", "card_present"] | [2.50, 0.30] |

**Note**: Array explosion (creating multiple rows from array elements) is NOT supported at the format parsing stage. This transformation happens during schema normalization if needed.

### 3.6 Line-Delimited JSON (JSONL/NDJSON)

**File: transactions.jsonl**
```
{"transaction_id": "TXN001", "amount": 100.50, "currency": "USD"}
{"transaction_id": "TXN002", "amount": 250.00, "currency": "EUR"}
{"transaction_id": "TXN003", "amount": 75.25, "currency": "USD"}
```

**Configuration**:
```yaml
format:
  type: jsonl  # Line-delimited JSON
```

**Advantage**: Efficient streaming for large datasets.

**Note**: All JSON values are read as their native JSON types (string, number, boolean, null). Type conversion, date parsing, and data validation happen during schema normalization, NOT during format parsing.

**Note**: Nested objects and arrays are stringified (converted to JSON strings) during parsing.

### 3.7 Large JSON File Handling

**Requirement**: Support streaming JSON for large files.

**Approach**:
- Use JSONL (line-delimited JSON) for large datasets
- System automatically chunks large JSON files internally based on file size
- No configuration required

**Note**: Large JSON files are handled automatically by the system. The system detects file size and adopts appropriate streaming/chunking strategy internally.

## 4. Format-Specific Use Cases

### 4.1 Bank Statement CSV

**File: bank_statement.csv**
```csv
Date,Description,Debit,Credit,Balance
15/03/2024,"Transfer from Account 123",,"5,000.00","25,000.00"
15/03/2024,"Payment to Vendor XYZ","1,250.50",,"23,749.50"
16/03/2024,"Wire Transfer","10,000.00",,"13,749.50"
```

**Configuration**:
```yaml
format:
  type: csv
  delimiter: ","
  null_values: [""]
```

**Note**: Number parsing (thousands separator, decimal separator) and type conversion happen during schema normalization, not format parsing.

### 4.2 Payment Gateway JSON API

**API Response**:
```json
{
  "result": "success",
  "pagination": {
    "page": 1,
    "total_pages": 5
  },
  "settlements": [
    {
      "settlement_id": "SETT001",
      "merchant": {
        "id": "M12345",
        "name": "Coffee Shop Inc"
      },
      "summary": {
        "total_amount": 15250.50,
        "total_fees": 305.01,
        "net_amount": 14945.49,
        "currency": "USD"
      },
      "transaction_count": 128,
      "settlement_date": "2024-03-15"
    }
  ]
}
```

**Configuration**:
```yaml
format:
  type: json
  array_path: settlements
  flatten_nested: true
  nested_separator: "_"
```

**Flattened Fields**:
- `settlement_id`
- `merchant_id`
- `merchant_name`
- `summary_total_amount`
- `summary_total_fees`
- `summary_net_amount`
- `summary_currency`
- `transaction_count`
- `settlement_date`

**Note**: Date parsing happens during schema normalization, not format parsing. The `settlement_date` field is read as a string during format parsing.

## 7. Open Questions

1. **Excel Files**: Direct support for `.xlsx` files without conversion?

2. **Parquet/Avro**: Support for columnar formats for high-performance scenarios?
