# API Contracts

## 1. Overview

The reconciliation engine exposes a RESTful API built with Spring Boot. All endpoints use the `/api/v1/` versioning prefix.

```
Base URL: https://api.reconhub.example.com/api/v1
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

## 2. Authentication

```yaml
# Authentication endpoints (no /api/v1 prefix)
POST   /auth/login              # OAuth2 login
POST   /auth/refresh            # Refresh token
POST   /auth/logout             # Logout
```

## 3. Data Sources API

### 3.1 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/data-sources` | List all data sources |
| POST | `/api/v1/data-sources` | Create new data source |
| GET | `/api/v1/data-sources/{id}` | Get data source details |
| PUT | `/api/v1/data-sources/{id}` | Update data source |
| DELETE | `/api/v1/data-sources/{id}` | Delete data source |
| POST | `/api/v1/data-sources/{id}/test` | Test connection |
| POST | `/api/v1/data-sources/{id}/preview` | Preview data (first 100 rows) |

### 3.2 List Data Sources

```json
GET /api/v1/data-sources?limit=20&offset=0

Response 200:
{
  "total": 5,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "id": "ds-uuid-...",
      "name": "payment_gateway",
      "type": "postgresql",
      "airbyte_connection_id": "conn-abc123",
      "status": "active",
      "last_sync_at": "2024-03-15T06:00:00Z",
      "created_at": "2024-01-10T14:30:00Z"
    }
  ]
}
```

### 3.3 Create Data Source

```json
POST /api/v1/data-sources
{
  "name": "payment_gateway",
  "type": "postgresql",
  "airbyte_connection_id": "conn-abc123",
  "schema": {
    "fields": [
      {"name": "transaction_id", "type": "string"},
      {"name": "amount", "type": "decimal"},
      {"name": "currency", "type": "string"},
      {"name": "timestamp", "type": "datetime"}
    ]
  }
}

Response 201:
{
  "id": "ds-uuid-...",
  "name": "payment_gateway",
  "type": "postgresql",
  "status": "active",
  "created_at": "2024-03-15T10:00:00Z"
}
```

### 3.4 Get Data Source

```json
GET /api/v1/data-sources/{id}

Response 200:
{
  "id": "ds-uuid-...",
  "name": "payment_gateway",
  "type": "postgresql",
  "airbyte_connection_id": "conn-abc123",
  "status": "active",
  "schema": {
    "fields": [
      {"name": "transaction_id", "type": "string"},
      {"name": "amount", "type": "decimal"},
      {"name": "currency", "type": "string"},
      {"name": "timestamp", "type": "datetime"}
    ]
  },
  "last_sync_at": "2024-03-15T06:00:00Z",
  "created_at": "2024-01-10T14:30:00Z",
  "updated_at": "2024-03-14T09:15:00Z"
}
```

### 3.5 Test Connection

```json
POST /api/v1/data-sources/{id}/test

Response 200:
{
  "success": true,
  "latency_ms": 45,
  "message": "Connection successful"
}

Response 400:
{
  "success": false,
  "error": "Connection refused",
  "details": "Unable to connect to host:5432"
}
```

### 3.6 Preview Data

```json
POST /api/v1/data-sources/{id}/preview

Response 200:
{
  "row_count": 100,
  "columns": ["transaction_id", "amount", "currency", "timestamp"],
  "data": [
    ["TXN001", 100.50, "USD", "2024-03-15T10:00:00Z"],
    ["TXN002", 250.00, "EUR", "2024-03-15T10:01:00Z"]
  ]
}
```

## 4. Reconciliations API

### 4.1 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/reconciliations` | List all reconciliations |
| POST | `/api/v1/reconciliations` | Create new reconciliation |
| GET | `/api/v1/reconciliations/{id}` | Get reconciliation details |
| PUT | `/api/v1/reconciliations/{id}` | Update (creates new version) |
| DELETE | `/api/v1/reconciliations/{id}` | Delete reconciliation |
| POST | `/api/v1/reconciliations/{id}/validate` | Validate configuration |
| POST | `/api/v1/reconciliations/{id}/dry-run` | Test run without saving |

### 4.2 List Reconciliations

```json
GET /api/v1/reconciliations?limit=20&offset=0&status=active

Response 200:
{
  "total": 12,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "id": "recon-uuid-...",
      "name": "daily_payment_reconciliation",
      "description": "Daily payment gateway reconciliation",
      "version": 3,
      "status": "active",
      "last_run_at": "2024-03-15T06:00:00Z",
      "last_run_status": "completed",
      "created_at": "2024-01-10T14:30:00Z"
    }
  ]
}
```

### 4.3 Create Reconciliation

```json
POST /api/v1/reconciliations
{
  "name": "daily_payment_reconciliation",
  "description": "Daily payment gateway reconciliation",
  "source_a": {
    "datasource_id": "ds-uuid-a",
    "filters": {}
  },
  "source_b": {
    "datasource_id": "ds-uuid-b",
    "filters": {}
  },
  "join_keys": {
    "left": ["transaction_id"],
    "right": ["txn_id"]
  },
  "rules": [
    {
      "name": "amount_tolerance",
      "expression": "(pl.col('amount') - pl.col('amount_right')).abs() <= 0.01",
      "severity": "error"
    },
    {
      "name": "currency_match",
      "expression": "pl.col('currency') == pl.col('currency_right')",
      "severity": "error"
    }
  ],
  "schedule": {
    "cron": "0 6 * * *",
    "timezone": "UTC"
  }
}

Response 201:
{
  "id": "recon-uuid-...",
  "name": "daily_payment_reconciliation",
  "version": 1,
  "status": "active",
  "created_at": "2024-03-15T10:00:00Z"
}
```

### 4.4 Get Reconciliation

```json
GET /api/v1/reconciliations/{id}

Response 200:
{
  "id": "recon-uuid-...",
  "name": "daily_payment_reconciliation",
  "description": "Daily payment gateway reconciliation",
  "version": 3,
  "status": "active",
  "source_a": {
    "datasource_id": "ds-uuid-a",
    "datasource_name": "internal_ledger",
    "filters": {}
  },
  "source_b": {
    "datasource_id": "ds-uuid-b",
    "datasource_name": "payment_gateway",
    "filters": {}
  },
  "join_keys": {
    "left": ["transaction_id"],
    "right": ["txn_id"]
  },
  "rules": [
    {
      "name": "amount_tolerance",
      "expression": "(pl.col('amount') - pl.col('amount_right')).abs() <= 0.01",
      "severity": "error"
    }
  ],
  "schedule": {
    "cron": "0 6 * * *",
    "timezone": "UTC"
  },
  "stats": {
    "total_runs": 45,
    "successful_runs": 43,
    "failed_runs": 2,
    "avg_duration_ms": 12500
  },
  "created_at": "2024-01-10T14:30:00Z",
  "updated_at": "2024-03-14T09:15:00Z"
}
```

### 4.5 Update Reconciliation

```json
PUT /api/v1/reconciliations/{id}
{
  "name": "daily_payment_reconciliation",
  "description": "Updated description",
  "rules": [...]
}

Response 200:
{
  "id": "recon-uuid-...",
  "version": 4,
  "updated_at": "2024-03-15T10:30:00Z"
}
```

### 4.6 Validate Configuration

```json
POST /api/v1/reconciliations/{id}/validate

Response 200:
{
  "valid": true,
  "warnings": [],
  "errors": []
}

Response 400:
{
  "valid": false,
  "warnings": [],
  "errors": [
    {
      "field": "rules[0].expression",
      "message": "Invalid Polars expression: unknown column 'amnt'"
    }
  ]
}
```

### 4.7 Dry Run

```json
POST /api/v1/reconciliations/{id}/dry-run
{
  "sample_size": 1000,
  "date_range": {
    "start": "2024-03-15T00:00:00Z",
    "end": "2024-03-15T23:59:59Z"
  }
}

Response 200:
{
  "sample_size": 1000,
  "matched": 850,
  "unmatched_left": 75,
  "unmatched_right": 75,
  "rule_statistics": {
    "amount_tolerance": {"passed": 900, "failed": 100},
    "currency_match": {"passed": 980, "failed": 20}
  }
}
```

## 5. Jobs API

### 5.1 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/jobs` | List jobs |
| POST | `/api/v1/jobs` | Submit new job |
| GET | `/api/v1/jobs/{id}` | Get job status |
| DELETE | `/api/v1/jobs/{id}` | Cancel job |

### 5.2 List Jobs

```json
GET /api/v1/jobs?limit=20&offset=0&status=completed

Response 200:
{
  "total": 156,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "job_id": "job-uuid-...",
      "reconciliation_id": "recon-uuid-...",
      "reconciliation_name": "daily_payment_reconciliation",
      "status": "completed",
      "started_at": "2024-03-15T06:00:00Z",
      "completed_at": "2024-03-15T06:00:45Z",
      "duration_seconds": 45
    }
  ]
}
```

### 5.3 Submit Job

```json
POST /api/v1/jobs
{
  "reconciliation_id": "recon-uuid-...",
  "date_range": {
    "start": "2024-03-15T00:00:00Z",
    "end": "2024-03-16T00:00:00Z"
  },
  "options": {
    "dry_run": false,
    "notify_on_complete": true
  }
}

Response 202:
{
  "job_id": "job-uuid-...",
  "status": "pending",
  "estimated_duration_seconds": 45,
  "queue_position": 0
}
```

### 5.4 Get Job Status

```json
GET /api/v1/jobs/{id}

Response 200:
{
  "job_id": "job-uuid-...",
  "reconciliation_id": "recon-uuid-...",
  "status": "running",
  "progress": {
    "records_processed": 25000,
    "total_records": 50000,
    "percent_complete": 50
  },
  "started_at": "2024-03-15T06:00:00Z",
  "completed_at": null
}
```

Job status values: `pending`, `running`, `completed`, `failed`, `cancelled`

### 5.5 Cancel Job

```json
DELETE /api/v1/jobs/{id}

Response 200:
{
  "job_id": "job-uuid-...",
  "status": "cancelling",
  "message": "Cancellation requested"
}
```

## 6. Results API

### 6.1 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/jobs/{id}/results` | Get results summary |
| GET | `/api/v1/jobs/{id}/matched` | Query matched records |
| GET | `/api/v1/jobs/{id}/unmatched-left` | Query unmatched left |
| GET | `/api/v1/jobs/{id}/unmatched-right` | Query unmatched right |
| GET | `/api/v1/jobs/{id}/stats` | Rule statistics |
| GET | `/api/v1/jobs/{id}/explain/{record_id}` | Explain single match |
| POST | `/api/v1/jobs/{id}/export` | Export to CSV |

### 6.2 Results Summary

```json
GET /api/v1/jobs/{id}/results

Response 200:
{
  "job_id": "job-uuid-...",
  "reconciliation_id": "recon-uuid-...",
  "summary": {
    "total_left": 25000,
    "total_right": 25500,
    "matched": 24000,
    "unmatched_left": 1000,
    "unmatched_right": 1500,
    "match_rate": 0.96
  },
  "rule_statistics": {
    "amount_tolerance": {"passed": 23500, "failed": 500},
    "currency_match": {"passed": 24800, "failed": 200}
  },
  "completed_at": "2024-03-15T06:00:45Z"
}
```

### 6.3 Query Matched Records

```json
GET /api/v1/jobs/{id}/matched?rules_failed=amount_tolerance&limit=100&offset=0

Response 200:
{
  "total": 523,
  "limit": 100,
  "offset": 0,
  "data": [
    {
      "transaction_id": "TXN001",
      "amount": 100.50,
      "amount_right": 99.49,
      "rule_amount_tolerance_passed": false,
      "rule_currency_match_passed": true,
      "amount_diff": 1.01
    }
  ]
}
```

### 6.4 Query Unmatched Records

```json
GET /api/v1/jobs/{id}/unmatched-left?limit=100&offset=0

Response 200:
{
  "total": 1000,
  "limit": 100,
  "offset": 0,
  "data": [
    {
      "transaction_id": "TXN999",
      "amount": 500.00,
      "currency": "USD",
      "timestamp": "2024-03-15T10:00:00Z"
    }
  ]
}
```

### 6.5 Rule Statistics

```json
GET /api/v1/jobs/{id}/stats

Response 200:
{
  "job_id": "job-uuid-...",
  "rules": [
    {
      "name": "amount_tolerance",
      "passed": 23500,
      "failed": 500,
      "pass_rate": 0.979
    },
    {
      "name": "currency_match",
      "passed": 24800,
      "failed": 200,
      "pass_rate": 0.992
    }
  ]
}
```

### 6.6 Explain Match

```json
GET /api/v1/jobs/{id}/explain/{record_id}

Response 200:
{
  "record_id": "TXN001",
  "match_status": "matched_with_exceptions",
  "left_record": {
    "transaction_id": "TXN001",
    "amount": 100.50,
    "currency": "USD"
  },
  "right_record": {
    "txn_id": "TXN001",
    "amount": 99.49,
    "currency": "USD"
  },
  "rule_results": [
    {
      "rule": "amount_tolerance",
      "passed": false,
      "expected": "difference <= 0.01",
      "actual": "difference = 1.01"
    },
    {
      "rule": "currency_match",
      "passed": true,
      "expected": "currencies equal",
      "actual": "USD == USD"
    }
  ]
}
```

### 6.7 Export to CSV

Export format is **CSV only**.

```json
POST /api/v1/jobs/{id}/export
{
  "category": "matched",
  "filters": {
    "rules_failed": ["amount_tolerance"]
  },
  "columns": ["transaction_id", "amount", "amount_right", "amount_diff"]
}

Response 200:
{
  "download_url": "https://storage.example.com/exports/job-uuid-matched.csv",
  "expires_at": "2024-03-15T12:00:00Z",
  "record_count": 523,
  "file_size_bytes": 45678
}
```

**CSV Output Format:**
```csv
transaction_id,amount,amount_right,amount_diff
TXN001,100.50,99.49,1.01
TXN002,250.00,249.95,0.05
```

## 7. Common Response Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async operation) |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict (e.g., duplicate name) |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

## 8. Pagination

All list endpoints support pagination:

```json
GET /api/v1/jobs?limit=20&offset=40&sort=created_at&order=desc

Response 200:
{
  "total": 150,
  "limit": 20,
  "offset": 40,
  "data": [...]
}
```

## 9. Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [
      {
        "field": "date_range.start",
        "message": "Start date must be before end date"
      }
    ]
  },
  "request_id": "req-uuid-...",
  "timestamp": "2024-03-15T10:00:00Z"
}
```

### 9.1 Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request body validation failed |
| `DATASOURCE_NOT_FOUND` | Data source ID does not exist |
| `RECONCILIATION_NOT_FOUND` | Reconciliation ID does not exist |
| `JOB_NOT_FOUND` | Job ID does not exist |
| `JOB_ALREADY_RUNNING` | Cannot start new job |
| `DATASOURCE_ERROR` | Failed to connect to data source |
| `RULE_COMPILATION_ERROR` | Invalid Polars expression |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
