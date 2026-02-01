# Data Sources

## 1. Overview

Data sources are the origins of data to be reconciled. The system must support three types of data sources:
- **SFTP**: File-based data retrieved via SSH File Transfer Protocol
- **API**: REST APIs providing JSON or CSV responses
- **Database**: Direct SQL query execution against relational databases

All data sources follow a common interface pattern, making them pluggable without requiring changes to the reconciliation engine core.

## 2. Core Requirements

### 2.1 Plugin Architecture

**Requirement**: New data source types can be added without modifying reconciliation engine code.

Each data source must implement:
- `connect()`: Establish connection using credentials
- `fetch(reconciliation_unit)`: Retrieve data for given time period
- `validate()`: Test connection and configuration
- `disconnect()`: Clean up resources
- `compress()/decompress()`: Handle data compression (gzip, zip, bzip2)
- `encrypt()/decrypt()`: Handle data encryption (TLS/SSL, file encryption)
- `paginate()`: Handle pagination for large datasets

### 2.2 Configuration Versioning

**Requirement**: All data source configurations must be versioned.

- Each configuration change creates a new version
- Reconciliation jobs reference specific data source version
- Historical reconciliations remain reproducible

### 2.3 Credential Security

**Requirement**: All sensitive credentials must be encrypted at rest.

- Passwords, private keys, API tokens stored encrypted
- Encryption keys managed separately from configuration
- Support for external secret management systems (vault integration)

### 2.4 Connection Pooling & Reuse

**Requirement**: For databases and persistent connections, support connection pooling.

- Avoid re-establishing connections for every reconciliation
- Configurable pool size and timeout settings
- Graceful handling of connection failures with retry logic

### 2.5 Common Data Source Features

**Requirement**: All data sources must support compression, encryption, and encoding handling.

#### Compression

Supported compression formats:
- **gzip** (.gz) - Most common for APIs and files
- **zip** (.zip) - Archive format with multiple file support
- **bzip2** (.bz2) - Higher compression ratio

**Application**:
- SFTP: Compressed files automatically detected and decompressed
- API: Compressed HTTP responses (Accept-Encoding: gzip)
- Database: Not applicable (native binary protocol)

**Configuration**:
```yaml
compression:
  enabled: true
  format: gzip  # or zip, bzip2, auto-detect
```

#### Encryption

Supported encryption methods:
- **TLS/SSL** - Transport layer encryption for connections
- **File encryption** - Encrypted files (AES-256, GPG)
- **End-to-end encryption** - Application-level encryption

**Application**:
- SFTP: SSH protocol provides encryption, optional file-level encryption
- API: HTTPS (TLS) for transport encryption
- Database: SSL/TLS connections

**Configuration**:
```yaml
encryption:
  transport: tls  # SSL/TLS for connection
  file_encryption:  # Optional: for encrypted files
    enabled: true
    algorithm: aes-256
    key: ${SECRET:encryption_key}
```

#### Encoding

Supported text encodings:
- **UTF-8** (default) - Unicode support
- **ISO-8859-1** (Latin-1) - Western European
- **UTF-16** - Unicode with BOM
- **ASCII** - 7-bit ASCII
- **Windows-1252** - Windows Western European

**Application**:
- SFTP: File content encoding
- API: Response body encoding (Content-Type header)
- Database: Client encoding configuration

**Configuration**:
```yaml
encoding: UTF-8  # Default for all text-based sources
```

**Note**: These features are implemented in the common interface (section 2.1) and available to all data source types.

## 3. SFTP Data Sources

### 3.1 Configuration Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `host` | string | Yes | SFTP server hostname or IP | `sftp.paymentgateway.com` |
| `port` | integer | No | SSH port (default 22) | `22` |
| `username` | string | Yes | SSH username | `recon_user` |
| `password` | string | Conditional | Password authentication | `********` |
| `private_key` | string | Conditional | SSH private key (PEM format) | `-----BEGIN RSA PRIVATE KEY-----...` |
| `private_key_passphrase` | string | No | Passphrase for encrypted key | `********` |
| `directory` | string | Yes | Base directory path | `/data/settlements` |
| `file_pattern` | string | Yes | File pattern with recon unit templates | `settlement_{year}{month}{day}.csv` |
| `encoding` | string | No | File encoding (default UTF-8) | `UTF-8`, `ISO-8859-1` |
| `compression` | string | No | File compression | `none`, `gzip`, `zip` |

### 3.2 Authentication Methods

The system must support:

1. **Password Authentication**
   ```yaml
   username: recon_user
   password: ${SECRET:sftp_password}
   ```

2. **Private Key Authentication**
   ```yaml
   username: recon_user
   private_key: ${SECRET:sftp_private_key}
   ```

3. **Private Key with Passphrase**
   ```yaml
   username: recon_user
   private_key: ${SECRET:sftp_private_key}
   private_key_passphrase: ${SECRET:key_passphrase}
   ```

### 3.3 File Pattern Matching

**Requirement**: Support wildcards and reconciliation unit templates.

**Examples**:

1. **Single File (Daily)**
   ```
   Pattern: /data/settlements/settlement_{year}{month}{day}.csv
   Unit: 2024-03-15
   → Fetches: /data/settlements/settlement_20240315.csv
   ```

2. **Multiple Files (Wildcard)**
   ```
   Pattern: /data/transactions/{year}/{month}/txn_*.csv
   Unit: 2024-03
   → Fetches all: /data/transactions/2024/03/txn_*.csv
   ```

3. **Compressed Files**
   ```
   Pattern: /data/reports/daily_{year}{month}{day}.csv.gz
   Unit: 2024-03-15
   → Fetches and decompresses: /data/reports/daily_20240315.csv.gz
   ```

### 3.4 Multiple File Handling

**Requirement**: When pattern matches multiple files, system must:
- Fetch all matching files
- Concatenate data (treating as single dataset)
- Order is not preserved after aggregation

**Example**:
```
Pattern: /data/hourly/txn_{year}{month}{day}_{hour}00.csv
Unit: 2024-03-15 (daily)
→ Fetches: txn_20240315_0000.csv, txn_20240315_0100.csv, ..., txn_20240315_2300.csv
→ Concatenates all 24 files
```

### 3.5 Error Handling

| Error Condition | System Behavior |
|-----------------|-----------------|
| File not found | Warning logged, proceed with 0 records |
| Connection timeout | Retry 3 times with exponential backoff, then fail |
| Authentication failure | Fail immediately, alert administrator |
| Malformed file | Fail with validation error details |
| Partial file (still uploading) | Configurable: wait, fail, or use partial data |

### 3.6 Use Case Examples

#### Example 1: Daily Payment Gateway Settlement

```yaml
type: sftp
name: payment_gateway_settlements
version: 1
connection:
  host: sftp.gateway.com
  port: 22
  username: recon_readonly
  private_key: ${SECRET:gateway_sftp_key}

fetch:
  directory: /settlements/daily
  file_pattern: settlement_{year}{month}{day}.csv
  encoding: UTF-8
  compression: none

metadata:
  description: Daily settlement files from payment gateway
  data_availability: "09:00 UTC next day"
  retention_days: 90
```

#### Example 2: Hourly Transaction Files

```yaml
type: sftp
name: internal_transactions_hourly
version: 2
connection:
  host: internal-sftp.company.com
  port: 2222
  username: reconciliation
  password: ${SECRET:internal_sftp_password}

fetch:
  directory: /exports/transactions/{year}/{month}
  file_pattern: transactions_{year}{month}{day}_{hour}*.csv.gz
  encoding: UTF-8
  compression: gzip
```

## 4. API Data Sources

### 4.1 Configuration Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `base_url` | string | Yes | API base URL | `https://api.paymentgateway.com` |
| `endpoint` | string | Yes | Endpoint path with templates | `/v1/settlements` |
| `method` | string | No | HTTP method (default GET) | `GET`, `POST` |
| `auth_type` | string | Yes | Authentication type | `bearer`, `api_key`, `basic`, `oauth2` |
| `auth_credentials` | object | Yes | Auth credentials (type-specific) | See examples |
| `headers` | map | No | Additional HTTP headers | `{"Accept": "application/json"}` |
| `query_params` | map | Yes | Query parameters with templates | `{"date": "{year}-{month}-{day}"}` |
| `request_body` | object | No | Request body for POST | JSON object |
| `timeout_seconds` | integer | No | Request timeout (default 30) | `60` |
| `rate_limit` | object | No | Rate limiting configuration | See 4.4 |
| `pagination` | object | No | Pagination handling | See 4.5 |

### 4.2 Authentication Methods

#### Bearer Token
```yaml
auth_type: bearer
auth_credentials:
  token: ${SECRET:api_bearer_token}
```

#### API Key (Header)
```yaml
auth_type: api_key
auth_credentials:
  header_name: X-API-Key
  api_key: ${SECRET:api_key}
```

#### API Key (Query Parameter)
```yaml
auth_type: api_key
auth_credentials:
  param_name: apikey
  api_key: ${SECRET:api_key}
```

#### Basic Authentication
```yaml
auth_type: basic
auth_credentials:
  username: api_user
  password: ${SECRET:api_password}
```

#### OAuth 2.0 Client Credentials
```yaml
auth_type: oauth2
auth_credentials:
  grant_type: client_credentials
  token_url: https://auth.gateway.com/oauth/token
  client_id: ${SECRET:oauth_client_id}
  client_secret: ${SECRET:oauth_client_secret}
  scope: reconciliation:read
```

### 4.3 Query Parameter Templates

**Requirement**: Support reconciliation unit substitution in query parameters.

**Example 1: Date Range**
```yaml
endpoint: /v1/transactions
query_params:
  start_date: "{year}-{month}-{day}T00:00:00Z"
  end_date: "{year}-{month}-{day|add_days:1}T00:00:00Z"  # Exclusive end
  status: completed
```
Note: `end_date` is exclusive

**Example 2: Epoch Timestamps**
```yaml
endpoint: /v1/reports/settlements
query_params:
  from: "{date|epoch}"
  to: "{date|end_of_day|epoch}"
```

### 4.4 Rate Limiting

**Requirement**: Respect API provider rate limits to avoid throttling.

```yaml
rate_limit:
  requests_per_second: 10
  requests_per_minute: 500
  retry_on_429: true
  retry_max_attempts: 5
  retry_backoff: exponential
```

**Behavior**:
- System tracks request rate internally
- Automatically throttles requests to stay within limits
- On HTTP 429 (Too Many Requests), retry with backoff
- On repeated 429 after max retries, fail with clear error

### 4.5 Pagination Handling

**Requirement**: Automatically handle paginated API responses.

#### Offset-based Pagination
```yaml
pagination:
  type: offset
  page_size: 1000
  offset_param: offset
  limit_param: limit
  total_count_field: response.total_count
```

**Example API Calls**:
```
GET /transactions?offset=0&limit=1000
GET /transactions?offset=1000&limit=1000
GET /transactions?offset=2000&limit=1000
...
```

#### Page-based Pagination
```yaml
pagination:
  type: page
  page_size: 100
  page_param: page
  total_pages_field: response.pagination.total_pages
```

#### Cursor-based Pagination
```yaml
pagination:
  type: cursor
  page_size: 500
  cursor_param: cursor
  next_cursor_field: response.next_cursor
```

**Example API Calls**:
```
GET /transactions?cursor=initial
→ Response: {"data": [...], "next_cursor": "abc123"}
GET /transactions?cursor=abc123
→ Response: {"data": [...], "next_cursor": "def456"}
...
```

### 4.6 Response Data Extraction

**Requirement**: Support extracting data from nested JSON responses.

```yaml
response_data_path: response.data.transactions
```

**Example Response**:
```json
{
  "status": "success",
  "response": {
    "data": {
      "transactions": [
        {"id": "TXN001", "amount": 100.00},
        {"id": "TXN002", "amount": 250.00}
      ]
    },
    "metadata": {"count": 2}
  }
}
```
→ Extracts array at `response.data.transactions`

### 4.7 Error Handling

| HTTP Status | System Behavior |
|-------------|-----------------|
| 200-299 | Success, process response |
| 400 | Bad request, fail with error details |
| 401 | Unauthorized, check credentials, fail |
| 403 | Forbidden, check permissions, fail |
| 404 | Not found, treat as 0 records with warning |
| 429 | Rate limited, retry with backoff |
| 500-599 | Server error, retry 3 times, then fail |
| Timeout | Retry 3 times with backoff, then fail |

### 4.8 Use Case Examples

#### Example 1: Payment Gateway API (Simple)

```yaml
type: api
name: payment_gateway_api
version: 1

connection:
  base_url: https://api.paymentgateway.com
  endpoint: /v2/settlements
  method: GET
  auth_type: bearer
  auth_credentials:
    token: ${SECRET:gateway_api_token}
  timeout_seconds: 60

query_params:
  settlement_date: "{year}-{month}-{day}"
  format: json

response:
  data_path: data.settlements
```

#### Example 2: Paginated Transaction API

```yaml
type: api
name: transaction_history_api
version: 3

connection:
  base_url: https://internal-api.company.com
  endpoint: /api/v1/transactions
  method: GET
  auth_type: api_key
  auth_credentials:
    header_name: X-API-Key
    api_key: ${SECRET:transaction_api_key}

query_params:
  from_date: "{year}-{month}-{day}T00:00:00Z"
  to_date: "{year}-{month}-{day|add_days:1}T00:00:00Z"  # Exclusive end
  status: settled

pagination:
  type: cursor
  page_size: 1000
  cursor_param: next_token
  next_cursor_field: pagination.next_token

rate_limit:
  requests_per_second: 20
  retry_on_429: true

response:
  data_path: results
```

#### Example 3: POST Request with Body

```yaml
type: api
name: settlement_report_api
version: 1

connection:
  base_url: https://reports.gateway.com
  endpoint: /api/reports/generate
  method: POST
  auth_type: oauth2
  auth_credentials:
    grant_type: client_credentials
    token_url: https://auth.gateway.com/token
    client_id: ${SECRET:oauth_client_id}
    client_secret: ${SECRET:oauth_client_secret}

request_body:
  report_type: settlement
  date_range:
    start: "{year}-{month}-{day}"
    end: "{year}-{month}-{day}"
  format: json
  include_fees: true

response:
  data_path: report.data
```

## 5. Database Data Sources

### 5.1 Configuration Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `database_type` | string | Yes | Database engine | `postgresql` |
| `host` | string | Yes | Database server hostname | `db.company.com` |
| `port` | integer | No | Database port (type-specific default) | `5432` |
| `database` | string | Yes | Database name | `transactions_db` |
| `username` | string | Yes | Database username | `recon_readonly` |
| `password` | string | Yes | Database password | `${SECRET:db_password}` |
| `schema` | string | No | Schema name (if applicable) | `public` |
| `query_template` | string | Yes | SQL query with recon unit templates | See examples |
| `count_query_template` | string | Yes | SQL COUNT query to determine data size | See examples |
| `connection_pool_size` | integer | No | Max connections (default 5) | `10` |
| `query_timeout_seconds` | integer | No | Query timeout (default 300) | `600` |
| `ssl_enabled` | boolean | No | Use SSL/TLS (default false) | `true` |
| `ssl_cert` | string | No | SSL certificate | `${SECRET:db_ssl_cert}` |

### 5.2 Supported Database Types

The system must support:
- **PostgreSQL** (12+)

### 5.3 Query Templates

**Requirement**: Support reconciliation unit parameter substitution in SQL queries.

**Example 1: Simple Date Filter**
```sql
SELECT
  transaction_id,
  amount,
  currency,
  status,
  created_at
FROM transactions
WHERE DATE(created_at) = '{year}-{month}-{day}'
  AND status = 'COMPLETED'
ORDER BY transaction_id
```

**Example 2: Date Range with Time Zone**
```sql
SELECT
  settlement_id,
  merchant_id,
  total_amount,
  fee_amount,
  net_amount,
  settlement_date
FROM merchant_settlements
WHERE settlement_date >= '{year}-{month}-{day} 00:00:00'::timestamp
  AND settlement_date < ('{year}-{month}-{day}'::date + interval '1 day')::timestamp  -- Exclusive end
  AND settlement_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'
ORDER BY settlement_id
```

**Example 3: Aggregated Query**
```sql
SELECT
  merchant_id,
  DATE(transaction_date) as txn_date,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount,
  SUM(fee) as total_fees
FROM payment_transactions
WHERE transaction_date >= '{year}-{month}-01'
  AND transaction_date < '{year}-{month|add:1}-01'
GROUP BY merchant_id, DATE(transaction_date)
```

**Example 4: Count Query with Value Query**

Count query to determine data size before fetching:
```sql
SELECT COUNT(*)
FROM transactions
WHERE DATE(created_at) = '{year}-{month}-{day}'
  AND status = 'COMPLETED'
```

Value query to fetch actual data:
```sql
SELECT
  transaction_id,
  amount,
  currency,
  status,
  created_at
FROM transactions
WHERE DATE(created_at) = '{year}-{month}-{day}'
  AND status = 'COMPLETED'
ORDER BY transaction_id
```

**Usage**: The system executes the count query first to determine the number of rows. Based on the count result, it automatically adopts an appropriate fetch strategy (streaming vs. in-memory) without requiring user configuration.

### 5.4 Connection Pooling

**Requirement**: Maintain persistent connection pool for database sources.

```yaml
connection_pool:
  min_size: 2
  max_size: 10
  idle_timeout_seconds: 300
  max_lifetime_seconds: 1800
```

**Behavior**:
- Connections established lazily
- Reused across multiple reconciliation runs
- Automatically closed after idle timeout
- Health checks performed before query execution

### 5.5 Read-Only Access

**Requirement**: Database users should have read-only permissions.

**Best Practice**:
```sql
-- PostgreSQL example
CREATE ROLE recon_readonly;
GRANT CONNECT ON DATABASE transactions_db TO recon_readonly;
GRANT USAGE ON SCHEMA public TO recon_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO recon_readonly;
```

System should validate permissions during data source configuration test.

### 5.6 Query Result Limits

**Requirement**: Protect against unbounded result sets.

```yaml
query_limits:
  max_rows: 10000000  # 10M rows
  warn_threshold: 5000000  # Warn at 5M
  timeout_seconds: 600
```

If query exceeds max_rows, fail with error suggesting query optimization or data partitioning.

### 5.7 Error Handling

| Error Condition | System Behavior |
|-----------------|-----------------|
| Connection timeout | Retry 3 times, then fail |
| Authentication failure | Fail immediately |
| Query syntax error | Fail with SQL error details |
| Query timeout | Fail, suggest query optimization |
| Connection lost mid-query | Retry query once, then fail |

### 5.8 Use Case Examples

#### Example 1: PostgreSQL Transaction Query

```yaml
type: database
name: internal_ledger_postgres
version: 2

connection:
  database_type: postgresql
  host: ledger-db.internal.company.com
  port: 5432
  database: ledger
  schema: public
  username: recon_user
  password: ${SECRET:ledger_db_password}
  ssl_enabled: true

query_template: |
  SELECT
    transaction_id,
    account_id,
    transaction_type,
    amount,
    currency,
    status,
    created_at,
    updated_at
  FROM transactions
  WHERE DATE(created_at AT TIME ZONE 'UTC') = '{year}-{month}-{day}'
    AND status IN ('COMPLETED', 'SETTLED')
  ORDER BY transaction_id

connection_pool:
  min_size: 2
  max_size: 8

query_limits:
  max_rows: 5000000
  timeout_seconds: 300
```

## 6. Common Features Across All Source Types

### 6.1 Data Source Testing

**Requirement**: Provide "Test Connection" functionality.

For each source type:
- **SFTP**: Verify connection, list files in directory
- **API**: Execute sample request, validate response structure
- **Database**: Execute `SELECT 1` or equivalent, verify permissions

### 6.2 Data Preview

**Requirement**: Allow users to preview data before configuring reconciliation.

```yaml
preview:
  enabled: true
  sample_rows: 100
  reconciliation_unit:
    date: 2024-03-15
```

Returns first 100 rows for manual inspection.

### 6.3 Metadata & Documentation

Each data source configuration should include:

```yaml
metadata:
  name: payment_gateway_settlements
  description: Daily settlement files from payment gateway partner
  owner_team: Finance Operations
  contact_email: finops@company.com
  data_classification: Confidential
  retention_policy: 90 days
  data_availability: "Daily at 09:00 UTC"
  sla: "99.5% uptime"
```

### 6.4 Change Tracking

**Requirement**: Track all configuration changes with audit log.

```yaml
version: 3
created_at: 2024-01-15T10:00:00Z
created_by: john.doe@company.com
updated_at: 2024-03-01T14:30:00Z
updated_by: jane.smith@company.com
change_summary: "Updated query to include fee_amount field"
```

### 6.5 Incremental Fetch Support

**Requirement**: Support fetching only changed/new records.

```yaml
incremental:
  enabled: true
  watermark_field: updated_at
  watermark_type: timestamp
  initial_watermark: 2024-01-01T00:00:00Z
```

System tracks last successful watermark value and uses it in next fetch.

## 7. Secret Management

### 7.1 Secret References

**Requirement**: Never store plaintext credentials in configuration.

**Syntax**: `${SECRET:secret_name}`

**Example**:
```yaml
password: ${SECRET:sftp_password}
api_key: ${SECRET:gateway_api_key}
```

### 7.2 External Secret Providers

Support integration with:
- Environment variables
- HashiCorp Vault
- AWS Secrets Manager
- Azure Key Vault
- GCP Secret Manager

## 8. Open Questions

1. **Cloud Storage**: Should we support S3, Azure Blob, GCS as direct data sources (beyond SFTP)?
