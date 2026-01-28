# API Contracts

## 1. Overview

The reconciliation engine exposes a RESTful API for:
- Job configuration management
- Execution control
- Results and explanations retrieval

Base URL: `/api/v1`

## 2. Authentication

All endpoints require authentication via JWT bearer token:

```http
Authorization: Bearer <token>
```

## 3. Configuration API

### 3.1 List Jobs

```http
GET /api/v1/jobs
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Page size (default: 20, max: 100) |
| `offset` | integer | Pagination offset |
| `search` | string | Search by name |
| `status` | string | Filter by status |

**Response:**
```json
{
  "total": 45,
  "limit": 20,
  "offset": 0,
  "jobs": [
    {
      "id": "job_abc123",
      "name": "Daily Bank Reconciliation",
      "description": "Reconcile ledger with bank statement",
      "status": "active",
      "version": 3,
      "lastRunAt": "2024-03-15T06:00:00Z",
      "lastRunStatus": "completed",
      "createdAt": "2024-01-10T14:30:00Z",
      "updatedAt": "2024-03-14T09:15:00Z"
    }
  ]
}
```

### 3.2 Create Job

```http
POST /api/v1/jobs
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Daily Bank Reconciliation",
  "description": "Reconcile internal ledger with bank statement",
  "dataSources": [
    {
      "id": "internal_ledger",
      "name": "Internal Ledger",
      "type": "postgresql",
      "config": {
        "connectionString": "${LEDGER_DB_URL}",
        "query": "SELECT * FROM transactions WHERE date = :run_date"
      }
    },
    {
      "id": "bank_statement",
      "name": "Bank Statement",
      "type": "sftp",
      "config": {
        "host": "sftp.bank.com",
        "path": "/statements/{date}.csv"
      }
    }
  ],
  "stages": [
    {
      "id": "stage_main",
      "name": "Main Reconciliation",
      "order": 1,
      "mode": "one_to_one",
      "datasourceLeft": {
        "type": "datasource",
        "datasourceId": "internal_ledger"
      },
      "datasourceRight": {
        "type": "datasource",
        "datasourceId": "bank_statement"
      },
      "joinConditions": [
        {
          "leftField": "transaction_id",
          "rightField": "ref_number"
        }
      ],
      "matchingRule": {
        "type": "boolean",
        "operator": "AND",
        "children": [
          {
            "type": "comparison",
            "left": { "type": "field", "source": "left", "name": "amount" },
            "operator": "=",
            "right": { "type": "field", "source": "right", "name": "amount" }
          }
        ]
      }
    }
  ],
  "schedule": {
    "cron": "0 6 * * *",
    "timezone": "UTC"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "job_xyz789",
  "name": "Daily Bank Reconciliation",
  "version": 1,
  "status": "active",
  "createdAt": "2024-03-15T10:00:00Z"
}
```

### 3.3 Get Job

```http
GET /api/v1/jobs/{jobId}
```

**Response:**
```json
{
  "id": "job_abc123",
  "name": "Daily Bank Reconciliation",
  "description": "Reconcile ledger with bank statement",
  "status": "active",
  "version": 3,
  "config": {
    "dataSources": [...],
    "stages": [...],
    "schedule": {...}
  },
  "stats": {
    "totalRuns": 45,
    "successfulRuns": 43,
    "failedRuns": 2,
    "avgDurationMs": 12500
  },
  "createdAt": "2024-01-10T14:30:00Z",
  "updatedAt": "2024-03-14T09:15:00Z"
}
```

### 3.4 Update Job

```http
PUT /api/v1/jobs/{jobId}
Content-Type: application/json
```

**Request Body:** Same as Create Job

**Response (200 OK):**
```json
{
  "id": "job_abc123",
  "version": 4,
  "updatedAt": "2024-03-15T10:30:00Z"
}
```

### 3.5 Delete Job

```http
DELETE /api/v1/jobs/{jobId}
```

**Response (204 No Content)**

### 3.6 Validate Job Configuration

```http
POST /api/v1/jobs/validate
Content-Type: application/json
```

**Request Body:** Same as Create Job

**Response:**
```json
{
  "valid": true,
  "warnings": [
    {
      "path": "stages[0].matchingRule",
      "message": "Rule has no tolerance for amount comparison"
    }
  ],
  "errors": []
}
```

Or with errors:
```json
{
  "valid": false,
  "warnings": [],
  "errors": [
    {
      "path": "stages[0].datasourceLeft.datasourceId",
      "code": "DATASOURCE_NOT_FOUND",
      "message": "Data source 'invalid_source' not found"
    }
  ]
}
```

## 4. Execution API

### 4.1 Run Job

```http
POST /api/v1/jobs/{jobId}/run
Content-Type: application/json
```

**Request Body (optional):**
```json
{
  "parameters": {
    "run_date": "2024-03-15"
  },
  "dryRun": false
}
```

**Response (202 Accepted):**
```json
{
  "runId": "run_def456",
  "jobId": "job_abc123",
  "status": "pending",
  "startedAt": null,
  "estimatedDuration": 15000
}
```

### 4.2 Get Run Status

```http
GET /api/v1/runs/{runId}
```

**Response:**
```json
{
  "runId": "run_def456",
  "jobId": "job_abc123",
  "status": "running",
  "progress": {
    "currentStage": "stage_main",
    "stageProgress": 65,
    "overallProgress": 45,
    "recordsProcessed": 125000,
    "estimatedRemaining": 8500
  },
  "stages": [
    {
      "stageId": "stage_main",
      "status": "running",
      "startedAt": "2024-03-15T06:00:15Z",
      "metrics": {
        "leftRecords": 150000,
        "rightRecords": 148500,
        "matchedSoFar": 98000,
        "unmatchedLeftSoFar": 12000,
        "unmatchedRightSoFar": 8500
      }
    }
  ],
  "startedAt": "2024-03-15T06:00:00Z",
  "completedAt": null
}
```

### 4.3 Cancel Run

```http
POST /api/v1/runs/{runId}/cancel
```

**Response (200 OK):**
```json
{
  "runId": "run_def456",
  "status": "cancelling",
  "message": "Cancellation requested"
}
```

### 4.4 List Runs

```http
GET /api/v1/runs
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `jobId` | string | Filter by job ID |
| `status` | string | Filter by status |
| `startDate` | datetime | Filter by start date |
| `endDate` | datetime | Filter by end date |
| `limit` | integer | Page size |
| `offset` | integer | Pagination offset |

**Response:**
```json
{
  "total": 156,
  "runs": [
    {
      "runId": "run_def456",
      "jobId": "job_abc123",
      "jobName": "Daily Bank Reconciliation",
      "status": "completed",
      "summary": {
        "matched": 145000,
        "unmatchedLeft": 2500,
        "unmatchedRight": 1500,
        "matchRate": 96.7
      },
      "durationMs": 12450,
      "startedAt": "2024-03-15T06:00:00Z",
      "completedAt": "2024-03-15T06:00:12Z"
    }
  ]
}
```

## 5. Results API

### 5.1 Get Run Results Summary

```http
GET /api/v1/runs/{runId}/results
```

**Response:**
```json
{
  "runId": "run_def456",
  "jobId": "job_abc123",
  "status": "completed",
  "summary": {
    "totalLeftRecords": 150000,
    "totalRightRecords": 148500,
    "matched": 145000,
    "unmatchedLeft": 2500,
    "unmatchedRight": 1500,
    "matchFailed": 2000,
    "matchRate": 96.67,
    "processingTime": 12450
  },
  "stages": [
    {
      "stageId": "stage_main",
      "stageName": "Main Reconciliation",
      "metrics": {
        "leftRecords": 150000,
        "rightRecords": 148500,
        "matched": 145000,
        "unmatchedLeft": 2500,
        "unmatchedRight": 1500,
        "matchFailed": 2000,
        "matchRate": 96.67
      },
      "outputs": {
        "matched": {
          "count": 145000,
          "downloadUrl": "/api/v1/runs/run_def456/stages/stage_main/matched"
        },
        "unmatchedLeft": {
          "count": 2500,
          "downloadUrl": "/api/v1/runs/run_def456/stages/stage_main/unmatched-left"
        },
        "unmatchedRight": {
          "count": 1500,
          "downloadUrl": "/api/v1/runs/run_def456/stages/stage_main/unmatched-right"
        }
      }
    }
  ],
  "completedAt": "2024-03-15T06:00:12Z"
}
```

### 5.2 Download Matched Records

```http
GET /api/v1/runs/{runId}/stages/{stageId}/matched
Accept: text/csv
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | `csv` or `json` (default: csv) |
| `limit` | integer | Max records (for preview) |

**Response (CSV):**
```csv
left_transaction_id,left_amount,left_currency,right_ref_number,right_amount,right_currency,match_result
TXN-001,100.50,USD,REF-001,100.50,USD,MATCHED
TXN-002,250.00,USD,REF-002,250.00,USD,MATCHED
```

### 5.3 Download Unmatched Records

```http
GET /api/v1/runs/{runId}/stages/{stageId}/unmatched-left
GET /api/v1/runs/{runId}/stages/{stageId}/unmatched-right
```

Same parameters and format as matched records.

### 5.4 Get Match Explanations

```http
GET /api/v1/runs/{runId}/explanations
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `stageId` | string | Filter by stage |
| `result` | string | Filter by result (MATCHED, MATCH_FAILED, etc.) |
| `limit` | integer | Page size (default: 100) |
| `offset` | integer | Pagination offset |

**Response:**
```json
{
  "total": 2000,
  "explanations": [
    {
      "id": "exp_abc123",
      "stageId": "stage_main",
      "result": "MATCH_FAILED",
      "leftKey": { "transaction_id": "TXN-500" },
      "rightKey": { "ref_number": "REF-500" },
      "summary": "Amount mismatch: $100.50 vs $105.00",
      "leftRecord": {
        "transaction_id": "TXN-500",
        "amount": 100.50,
        "currency": "USD"
      },
      "rightRecord": {
        "ref_number": "REF-500",
        "amount": 105.00,
        "currency": "USD"
      }
    }
  ]
}
```

### 5.5 Get Single Explanation Detail

```http
GET /api/v1/explanations/{explanationId}
```

**Response:**
```json
{
  "id": "exp_abc123",
  "runId": "run_def456",
  "stageId": "stage_main",
  "result": "MATCH_FAILED",
  "leftKey": { "transaction_id": "TXN-500" },
  "rightKey": { "ref_number": "REF-500" },
  "leftRecord": {
    "transaction_id": "TXN-500",
    "amount": 100.50,
    "currency": "USD",
    "date": "2024-03-15"
  },
  "rightRecord": {
    "ref_number": "REF-500",
    "amount": 105.00,
    "currency": "USD",
    "date": "2024-03-15"
  },
  "ruleEvaluations": [
    {
      "ruleName": "Currency Match",
      "result": "PASSED",
      "leftValue": "USD",
      "rightValue": "USD",
      "humanText": "Currency matches: USD = USD"
    },
    {
      "ruleName": "Amount Match",
      "result": "FAILED",
      "leftValue": 100.50,
      "rightValue": 105.00,
      "humanText": "Amount mismatch: $100.50 != $105.00 (difference: $4.50)"
    }
  ],
  "summaryText": "Match failed: Amount mismatch ($4.50 difference)"
}
```

### 5.6 Export Explanations

```http
POST /api/v1/runs/{runId}/explanations/export
Content-Type: application/json
```

**Request Body:**
```json
{
  "format": "csv",
  "filter": {
    "result": ["MATCH_FAILED"],
    "stageId": "stage_main"
  },
  "fields": ["leftKey", "rightKey", "result", "summaryText"]
}
```

**Response (202 Accepted):**
```json
{
  "exportId": "export_xyz",
  "status": "processing",
  "estimatedRecords": 2000
}
```

### 5.7 Get Export Status

```http
GET /api/v1/exports/{exportId}
```

**Response:**
```json
{
  "exportId": "export_xyz",
  "status": "completed",
  "format": "csv",
  "recordCount": 2000,
  "fileSize": 256000,
  "downloadUrl": "/api/v1/exports/export_xyz/download",
  "expiresAt": "2024-03-16T10:00:00Z"
}
```

## 6. Rules API

### 6.1 Validate Rule Expression

```http
POST /api/v1/rules/validate
Content-Type: application/json
```

**Request Body:**
```json
{
  "rule": {
    "type": "comparison",
    "left": { "type": "field", "source": "left", "name": "amount" },
    "operator": "=",
    "right": { "type": "field", "source": "right", "name": "amount" }
  },
  "leftSchema": {
    "fields": [
      { "name": "amount", "type": "decimal" }
    ]
  },
  "rightSchema": {
    "fields": [
      { "name": "amount", "type": "decimal" }
    ]
  }
}
```

**Response:**
```json
{
  "valid": true,
  "warnings": [],
  "errors": []
}
```

### 6.2 Preview Rule (Dry Run)

```http
POST /api/v1/rules/preview
Content-Type: application/json
```

**Request Body:**
```json
{
  "rule": {...},
  "sampleData": {
    "left": [
      { "amount": 100.50, "currency": "USD" }
    ],
    "right": [
      { "amount": 100.48, "currency": "USD" }
    ]
  }
}
```

**Response:**
```json
{
  "results": [
    {
      "leftIndex": 0,
      "rightIndex": 0,
      "result": "MATCHED",
      "explanation": {
        "rules": [
          {
            "name": "Amount Tolerance",
            "result": "PASSED",
            "humanText": "Amount difference ($0.02) within tolerance ($0.05)"
          }
        ]
      }
    }
  ]
}
```

## 7. Error Responses

### 7.1 Error Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid job configuration",
    "details": [
      {
        "path": "stages[0].matchingRule",
        "message": "Rule expression is required"
      }
    ],
    "requestId": "req_abc123"
  }
}
```

### 7.2 HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async operation started) |
| 204 | No Content (successful delete) |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict (e.g., job already running) |
| 422 | Unprocessable Entity |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

### 7.3 Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request body validation failed |
| `JOB_NOT_FOUND` | Job ID does not exist |
| `RUN_NOT_FOUND` | Run ID does not exist |
| `JOB_ALREADY_RUNNING` | Cannot start new run |
| `DATASOURCE_ERROR` | Failed to connect to data source |
| `RULE_COMPILATION_ERROR` | Invalid rule expression |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
