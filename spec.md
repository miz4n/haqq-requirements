# Reconciliation Engine - Complete Specification

**Version**: 2.5
**Last Updated**: 2026-02-01
**Status**: Draft

**Changelog v2.5:**
- Fixed: Airbyte tenant isolation - added workspace scoping and isolation models
- Fixed: Sync validation now checks airbyte_sync_history (not just S3 timestamps)
- Fixed: S3 pagination for freshness checks (handles >1000 objects)
- Fixed: Staging paths now include stream_name and sync_id (prevents data mixing)
- Fixed: Airbyte API version pinned (v1, OSS 0.50+)
- Fixed: StagedDataReader uses Parquet metadata for row counts (no double scan)
- Fixed: Removed query_template from reconciliations table (Airbyte-only model)
- Fixed: Clarified credential ownership (Airbyte owns source credentials)
- Fixed: Updated integration tests for Airbyte/S3 staging

**Changelog v2.4:**
- Added Airbyte for data ingestion (300+ connectors)
- Replaced direct SFTP/API/DB connections with S3 staging model
- Data flow: External Sources → Airbyte → S3 (Parquet) → Polars
- Updated architecture diagrams to reflect Airbyte integration
- Added airbyte_sync_history table for data freshness tracking

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Industry Context & Best Practices](#2-industry-context--best-practices)
3. [Core Capabilities](#3-core-capabilities)
4. [Technical Specifications](#4-technical-specifications)
5. [Security & Compliance](#5-security--compliance)
6. [Performance Requirements](#6-performance-requirements)
7. [Architecture Design](#7-architecture-design)
8. [DSL Specification](#8-dsl-specification)
9. [Use Cases](#9-use-cases)
10. [Testing Strategy](#10-testing-strategy)
11. [Risk Analysis](#11-risk-analysis)
12. [Gap Analysis & Future Roadmap](#12-gap-analysis--future-roadmap)
13. [Glossary](#13-glossary)

---

## 1. Executive Summary

### 1.1 Project Overview

The Reconciliation Engine is a mission-critical SaaS platform designed for large fintech systems to perform automated, configurable reconciliation of financial transactions across multiple data sources. The system enables financial institutions to match, verify, and audit transactions with complete traceability and explainability.

### 1.2 Mission Statement

To provide a high-performance, configuration-driven reconciliation platform that empowers financial operations teams to automate transaction matching with complete transparency, auditability, and minimal technical expertise requirements.

### 1.3 Key Business Value Proposition

| Value Area | Description |
|------------|-------------|
| **Operational Efficiency** | Automate manual reconciliation processes, reducing time from hours to seconds |
| **Risk Reduction** | Eliminate human error in transaction matching with rule-based validation |
| **Compliance** | Maintain complete audit trails for regulatory requirements |
| **Scalability** | Handle millions of transactions per reconciliation run (see Performance Requirements for hardware assumptions) |
| **Flexibility** | Configuration-driven approach allows rapid adaptation to new business requirements |

### 1.5 Validated Performance (POC Results)

| Aspect | POC Result | Requirement | Status |
|--------|------------|-------------|--------|
| 1M×1M Performance | 705ms | < 1 second | ✅ Validated |
| Memory Usage | ~100MB | < 2GB | ✅ Validated |
| Rule System | 5 rules evaluated | Up to 5 rules | ✅ Validated |
| Result Categories | 3 buckets | 3 buckets | ✅ Validated |
| Queryability | By rule pass/fail | Required | ✅ Validated |
| Explainability | Per-record audit | Required | ✅ Validated |

### 1.4 Target Users and Personas

#### Financial Controller
- Runs scheduled reconciliations
- Reviews match/mismatch reports
- Investigates exceptions
- Exports results for auditors

#### Reconciliation Analyst
- Configures reconciliation rules
- Adjusts tolerances
- Creates derived fields
- Troubleshoots matching logic

#### System Administrator
- Manages data source connections
- Configures retention policies
- Monitors system performance
- Manages user permissions

#### Integration Engineer
- Writes YAML configurations directly
- Creates custom Polars expressions for complex transformations
- Integrates with external systems via API

---

## 2. Industry Context & Best Practices

### 2.1 Financial Reconciliation Industry Standards

The financial reconciliation industry has evolved significantly with the advent of automation and AI-powered solutions. Key industry standards include:

#### Gartner Financial Reconciliation Solutions
- Emphasis on automated matching algorithms
- Integration with multiple data sources
- Real-time exception management
- Comprehensive audit trails

#### SolveXia Data Reconciliation Best Practices
- Rule-based matching with configurable tolerances
- Multi-format data ingestion (CSV, XML, JSON)
- Exception workflow management
- Regulatory compliance frameworks

### 2.2 AI-Powered Reconciliation Trends

Modern reconciliation platforms leverage AI and machine learning for:

#### HighRadius Transaction Matching Capabilities
- Machine learning-based transaction matching
- Predictive analytics for exception resolution
- Auto-coding of unmatched transactions
- Continuous learning from user corrections

#### BlackLine Transaction Matching Features
- High-volume transaction processing
- Rule-based and ML-assisted matching
- Real-time visibility and dashboards
- Tight ERP integration

### 2.3 Multi-Tenant SaaS Architecture Patterns

Following AWS SaaS Lens best practices:

#### Tenant Isolation Strategies
- **Silo Model**: Dedicated resources per tenant (highest isolation, highest cost)
- **Bridge Model**: Shared infrastructure with logical isolation
- **Pool Model**: Shared resources with data-level isolation (most efficient)

This system implements the **Pool Model** with PostgreSQL Row Level Security (RLS) for complete tenant data isolation while maintaining cost efficiency.

#### AWS Multi-Tenant PostgreSQL RLS Pattern

**Critical Implementation Requirement:** When using connection pooling (e.g., HikariCP, PgBouncer), the `app.current_tenant_id` session variable MUST be set at the start of each request and reset/cleared at the end to prevent tenant data leakage.

```sql
-- Enable RLS on all tables
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;

-- Create policy for tenant isolation
CREATE POLICY tenant_isolation ON reconciliations
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  -- Note: second parameter 'true' returns NULL instead of error if not set
```

**Spring Boot Connection Lifecycle (Required):**
```java
@Component
public class TenantConnectionInterceptor implements HandlerInterceptor {

    @Autowired
    private DataSource dataSource;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String tenantId = extractTenantId(request); // From JWT or header
        try (Connection conn = dataSource.getConnection()) {
            // SET LOCAL scopes to current transaction only - automatically cleared on commit/rollback
            conn.createStatement().execute(
                "SET LOCAL app.current_tenant_id = '" + tenantId + "'"
            );
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                 Object handler, Exception ex) {
        // SET LOCAL is transaction-scoped, but explicitly reset for safety
        try (Connection conn = dataSource.getConnection()) {
            conn.createStatement().execute("RESET app.current_tenant_id");
        }
    }
}
```

**Key Safety Measures:**
- Use `SET LOCAL` (transaction-scoped) instead of `SET` (session-scoped)
- Always reset/clear tenant context after request completion
- Use `current_setting('...', true)` to return NULL instead of error if unset
- Validate tenant_id format (UUID) before setting to prevent injection

### 2.4 High-Performance Matching Engine Algorithms

#### Hash Join Algorithm
- O(n + m) time complexity for matching
- Ideal for equality-based joins on unique keys
- Memory-efficient with streaming support
- Used for 1:1 matching scenarios

#### In-Memory Processing
- Hash maps for rapid key lookups
- Columnar data structures for batch operations
- SIMD operations for numeric comparisons
- Lazy evaluation of derived fields

### 2.5 Python + Polars for High-Performance Data Processing

Python with Polars provides an ideal data processing stack for financial reconciliation:

- **Polars**: Blazing-fast DataFrame library written in Rust, outperforming Pandas by 10-100x
- **Lazy Evaluation**: Query optimization through lazy execution plans
- **Parallel Processing**: Automatic multi-threaded execution
- **Memory Efficient**: Columnar memory format with zero-copy operations
- **SQL-like Syntax**: Familiar expressions for data transformations
- **Kubernetes Native**: Easily containerized for distributed job execution

### 2.6 Industry Sources

- [Gartner Peer Insights - Financial Reconciliation Solutions](https://www.gartner.com/reviews/market/financial-reconciliation-solutions)
- [SolveXia - Data Reconciliation Tools Guide](https://www.solvexia.com/blog/data-reconciliation-tools)
- [AWS - Multi-tenant data isolation with PostgreSQL RLS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [AWS SaaS Lens - Architecture Patterns](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/software-and-architecture-patterns.html)
- [BlackLine - Transaction Matching](https://www.blackline.com/products/financial-close/transaction-matching/)
- [HighRadius - AI Transaction Matching](https://www.highradius.com/product/transaction-matching-software/)

---

## 3. Core Capabilities

### 3.1 Multi-Source Data Ingestion (Airbyte)

Data extraction is handled by **Airbyte**, an open-source ELT platform with 300+ connectors. Data is staged in S3/MinIO for the reconciliation engine to consume.

```
External Sources → Airbyte (ELT) → S3/MinIO (Staging) → Polars (Processing)
```

| Source Type | Airbyte Connector | Staging Format |
|-------------|-------------------|----------------|
| **SFTP** | `source-sftp` | Parquet |
| **REST APIs** | `source-http-request` or custom | Parquet |
| **PostgreSQL** | `source-postgres` | Parquet |
| **MySQL** | `source-mysql` | Parquet |
| **Files (CSV/Excel)** | `source-file` | Parquet |
| **Salesforce, SAP, etc.** | Native connectors | Parquet |

**Benefits of Airbyte Integration:**
- 300+ pre-built, maintained connectors
- Built-in schema detection and evolution
- Incremental sync support
- Connection testing and monitoring
- No custom connector code to maintain

### 3.2 Flexible Matching Rules

The matching system uses a **JOIN + WHERE** pattern inspired by SQL semantics:

```yaml
matching_rules:
  # JOIN: Equality-based record association
  join:
    - left: source_a.transaction_id
      right: source_b.transaction_id

  # WHERE: Additional matching criteria
  rules:
    - name: amount_tolerance
      severity: error
      expression: "abs(source_a.amount - source_b.amount) <= 0.01"
```

All rule expressions are evaluated by Polars during Kubernetes job execution, enabling high-performance parallel processing.

### 3.3 Complete Auditability and Explainability

Every match decision includes:
- Rule name and version applied
- Fields compared in each rule
- Values used from both sources
- Tolerances applied
- Stage where match occurred
- Execution timestamp

### 3.4 High Performance Targets

| Dataset Size | Max Rules | Target Time |
|--------------|-----------|-------------|
| 100K x 100K | 5 | < 100ms |
| 1M x 1M | 5 | < 1s |
| 5M x 5M | 5 | < 10s |
| 10M x 10M | 5 | < 30s |

### 3.5 Multi-Tenant SaaS with Data Isolation

- Complete data segregation between tenants
- PostgreSQL Row Level Security (RLS)
- Tenant-specific encryption keys
- Configurable retention policies per tenant

### 3.6 Configuration-Driven YAML DSL

All reconciliation logic is expressed through declarative YAML:
- Human-readable and version-controllable
- Validated before execution
- Supports template variables and secrets
- Composable and reusable components

---

## 4. Technical Specifications

### 4.1 Reconciliation Units

A **Reconciliation Unit** defines the time-based scope for a reconciliation run.

#### Components

| Component | Description | Example |
|-----------|-------------|---------|
| **dateTimeRange** | Start (inclusive) and end (exclusive) datetime | `2024-03-01T00:00:00Z` to `2024-04-01T00:00:00Z` |
| **interval** | Subdivision pattern | `day`, `hour`, `minute` |
| **timezone** | Time zone for interpretation | `UTC` (required) |

#### Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{year}` | 4-digit year | 2024 |
| `{month}` | 2-digit month | 03 |
| `{day}` | 2-digit day | 15 |
| `{hour}` | 2-digit hour (00-23) | 14 |
| `{minute}` | 2-digit minute (00-59) | 30 |
| `{start_datetime}` | Full range start | 2024-03-01T00:00:00Z |
| `{end_datetime}` | Full range end (exclusive) | 2024-04-01T00:00:00Z |

#### Configuration Example

```yaml
reconciliation_unit:
  interval: day
  timezone: UTC
```

### 4.2 Data Sources (Airbyte + S3 Staging)

Data ingestion uses a **two-phase architecture**:
1. **Extraction Phase**: Airbyte syncs data from external sources to S3 staging
2. **Processing Phase**: Reconciliation jobs read staged data via Polars

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA INGESTION FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐     ┌─────────────┐     ┌───────────────────────────┐ │
│  │ External     │     │   Airbyte   │     │      S3/MinIO             │ │
│  │ Sources      │────▶│   (ELT)     │────▶│   (Staging Area)          │ │
│  │              │     │             │     │                           │ │
│  │ • SFTP       │     │ • 300+      │     │ s3://recon-staging/       │ │
│  │ • REST API   │     │   connectors│     │   └── {tenant_id}/        │ │
│  │ • PostgreSQL │     │ • Scheduled │     │       └── {source_name}/  │ │
│  │ • MySQL      │     │ • Incremental│    │           └── {date}/     │ │
│  │ • Salesforce │     │             │     │               └── *.parquet│ │
│  └──────────────┘     └─────────────┘     └─────────────┬─────────────┘ │
│                                                          │               │
│                       ┌──────────────────────────────────┘               │
│                       ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              Kubernetes Job (Python + Polars)                      │  │
│  │                                                                    │  │
│  │  lf_a = pl.scan_parquet("s3://recon-staging/.../source_a/*.parquet")│  │
│  │  lf_b = pl.scan_parquet("s3://recon-staging/.../source_b/*.parquet")│  │
│  │                                                                    │  │
│  │  # Lazy evaluation - streams data, doesn't load all into memory   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.2.1 Airbyte Connection Configuration

Airbyte connections are configured in Airbyte's UI/API. The reconciliation system references the **staged data location**, not the source connection details.

**Multi-Tenant Airbyte Isolation (CRITICAL):**

| Model | Description | When to Use |
|-------|-------------|-------------|
| **Shared Workspace** | All tenants share one Airbyte workspace, isolated by S3 path prefixes | Cost-efficient, <50 tenants |
| **Per-Tenant Workspace** | Each tenant gets dedicated Airbyte workspace | Strong isolation, enterprise |
| **Per-Tenant Instance** | Dedicated Airbyte deployment per tenant | Maximum isolation, regulated industries |

**Recommended: Shared Workspace with Strict Path Isolation**
```yaml
airbyte:
  # Airbyte deployment configuration
  api_base_url: https://airbyte.internal.company.com
  api_version: "v1"  # Pin to specific API version
  workspace_id: "ws-shared-prod"  # Shared workspace for all tenants

  # Tenant isolation via S3 path prefixes (enforced by destination config)
  tenant_isolation:
    model: shared_workspace
    s3_path_prefix: "{tenant_id}/"  # MUST include tenant_id as first path component
    # Airbyte destination template enforces this pattern
```

**Airbyte Destination Configuration (per tenant connection):**
```yaml
# Configured in Airbyte, not in reconciliation config
airbyte_connection:
  source: source-sftp
  destination: destination-s3
  sync_mode: incremental_append
  schedule: "0 6 * * *"  # Daily at 6 AM UTC
  # Path MUST start with tenant_id for isolation
  destination_path: "{tenant_id}/{stream_name}/{sync_id}/"
  # Sync ID ensures each run is isolated (no mixing historical data)
```

**Supported Airbyte Connectors:**

| Category | Connectors | Notes |
|----------|------------|-------|
| **File Transfer** | SFTP, FTP, S3, GCS, Azure Blob | Host key verification in Airbyte |
| **Databases** | PostgreSQL, MySQL, MSSQL, Oracle, MongoDB | CDC support for incremental |
| **APIs** | REST (generic), Stripe, Salesforce, SAP | OAuth handled by Airbyte |
| **Files** | CSV, Excel, JSON, Parquet | Schema inference |

**Airbyte API Version:** This spec targets Airbyte API v1 (OSS 0.50+). Pin to a specific version in production.

#### 4.2.2 S3 Staging Configuration

The reconciliation system reads from S3 staging area where Airbyte deposits data.

```yaml
datasource:
  name: payment_gateway_settlements
  type: staged  # Reads from S3 staging, not direct connection

  staging:
    # S3/MinIO staging location (written by Airbyte)
    bucket: recon-staging
    # Path includes stream_name and sync_id to prevent mixing historical data
    path_template: "{tenant_id}/payment_gateway/{stream_name}/{sync_id}/"
    format: parquet  # Recommended: columnar, compressed, schema-aware

    # Alternative formats (if Airbyte destination doesn't support Parquet)
    # format: csv
    # csv_options:
    #   delimiter: ","
    #   has_header: true

  # Data freshness requirements
  freshness:
    max_age_hours: 24  # Fail if staged data is older than 24 hours
    require_sync_complete: true  # Ensure Airbyte sync completed successfully

  # Schema mapping (staged columns → normalized names)
  schema:
    fields:
      - name: transaction_id
        source: txn_ref
        type: string
      - name: amount
        source: settlement_amount
        type: decimal
      - name: currency
        source: ccy
        type: string
```

#### 4.2.3 Staging Path Patterns

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `{tenant_id}` | Tenant UUID | `3f1e7e7a-1b7c-4a6e-9f0b-2b0d0c0c3e21` | **Yes** |
| `{stream_name}` | Airbyte stream name | `settlements` | **Yes** |
| `{sync_id}` | Airbyte sync job ID | `job-12345` | **Yes** |
| `{source_name}` | Airbyte source identifier | `payment_gateway` | Optional |
| `{year}` | 4-digit year | `2024` | Optional |
| `{month}` | 2-digit month | `03` | Optional |
| `{day}` | 2-digit day | `15` | Optional |

**Recommended Path Template:**
```
{tenant_id}/{source_name}/{stream_name}/{sync_id}/
```

Including `{sync_id}` is **critical** to prevent mixing data from different sync runs (especially for incremental syncs).

**Example S3 Structure (Airbyte output):**
```
s3://recon-staging/
├── 3f1e7e7a-1b7c-4a6e-9f0b-2b0d0c0c3e21/    # tenant UUID (NOT tenant-001)
│   ├── payment_gateway/
│   │   └── settlements/                       # stream_name from Airbyte
│   │       ├── job-12345/                     # sync_id - isolates each run
│   │       │   ├── data_0.parquet
│   │       │   └── data_1.parquet
│   │       └── job-12346/                     # next sync run
│   │           └── data_0.parquet
│   └── bank_ledger/
│       └── transactions/
│           └── job-12350/
│               └── data_0.parquet
└── 8a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d/    # another tenant UUID
    └── ...
```

**Reconciliation reads from a specific sync_id** (usually the latest successful sync from `airbyte_sync_history`).

#### 4.2.4 Data Freshness Validation

Before running reconciliation, the system validates staged data using **airbyte_sync_history** (not just S3 timestamps):

```python
from datetime import datetime, timedelta
from typing import Optional
import boto3
from sqlalchemy import text

def validate_staged_data(
    db_session,
    data_source_id: str,
    bucket: str,
    max_age_hours: int,
    require_sync_complete: bool = True
) -> dict:
    """
    Validate staged data freshness using Airbyte sync history.

    Returns:
        dict with 'sync_id', 'output_path', 'completed_at'

    Raises:
        SyncNotFoundError: No successful sync found
        StaleDataError: Latest sync is too old
        SyncIncompleteError: Sync still running or failed
    """

    # Step 1: Check airbyte_sync_history for latest successful sync
    if require_sync_complete:
        result = db_session.execute(text("""
            SELECT airbyte_job_id, output_path, completed_at, status
            FROM airbyte_sync_history
            WHERE data_source_id = :data_source_id
              AND status = 'succeeded'
            ORDER BY completed_at DESC
            LIMIT 1
        """), {"data_source_id": data_source_id}).fetchone()

        if not result:
            raise SyncNotFoundError(f"No successful sync found for data source {data_source_id}")

        sync_id, output_path, completed_at, status = result

        # Check freshness against sync completion time (not S3 timestamp)
        age = datetime.now(completed_at.tzinfo) - completed_at
        if age > timedelta(hours=max_age_hours):
            raise StaleDataError(
                f"Latest sync completed {age.total_seconds()/3600:.1f} hours ago "
                f"(max: {max_age_hours}h)"
            )

    # Step 2: Verify S3 data exists (with pagination for >1000 objects)
    s3 = boto3.client('s3')
    paginator = s3.get_paginator('list_objects_v2')

    file_count = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=output_path):
        if 'Contents' in page:
            file_count += len(page['Contents'])

    if file_count == 0:
        raise StagingDataNotFoundError(
            f"Sync {sync_id} succeeded but no data at s3://{bucket}/{output_path}"
        )

    return {
        "sync_id": sync_id,
        "output_path": output_path,
        "completed_at": completed_at,
        "file_count": file_count
    }
```

**Validation Steps:**
1. Query `airbyte_sync_history` for latest **succeeded** sync (not running/failed)
2. Check sync `completed_at` against `max_age_hours` threshold
3. Verify S3 data exists at `output_path` (with pagination for large datasets)
4. Return sync metadata for use in reconciliation job

#### 4.2.5 Airbyte Sync Triggering (Optional)

The reconciliation API can trigger Airbyte syncs before running jobs:

```yaml
reconciliation:
  name: daily_payment_recon

  # Trigger Airbyte sync before reconciliation
  pre_sync:
    enabled: true
    sources:
      - airbyte_connection_id: "conn-payment-gateway"
      - airbyte_connection_id: "conn-bank-ledger"
    wait_for_completion: true
    timeout_minutes: 30
```

**API Integration:**
```python
# Trigger Airbyte sync via API
POST /api/v1/connections/{connection_id}/sync
Authorization: Bearer {airbyte_api_token}

# Poll for completion
GET /api/v1/jobs/{job_id}
```

#### 4.2.6 Staged Data Reader Interface

```python
from dataclasses import dataclass
from typing import Optional
import polars as pl
import pyarrow.parquet as pq

@dataclass
class StagedDataConfig:
    bucket: str
    path_template: str
    format: str  # 'parquet', 'csv', 'json'
    freshness_hours: int = 24

@dataclass
class StagedDataResult:
    data: pl.LazyFrame  # Lazy for streaming large datasets
    row_count: Optional[int]  # None if not available without full scan
    staged_at: datetime
    source_files: list[str]
    sync_id: str

class StagedDataReader:
    """Reads data from S3 staging area (populated by Airbyte)."""

    def __init__(self, config: StagedDataConfig, s3_client):
        self.config = config
        self.s3 = s3_client

    def read(self, sync_metadata: dict) -> StagedDataResult:
        """
        Read staged data using sync metadata from validate_staged_data().

        Args:
            sync_metadata: dict with 'sync_id', 'output_path', 'completed_at'
        """
        path = sync_metadata['output_path']
        s3_uri = f"s3://{self.config.bucket}/{path}"

        # Read as LazyFrame (streaming, memory-efficient)
        if self.config.format == 'parquet':
            lf = pl.scan_parquet(f"{s3_uri}/*.parquet")
            # Get row count from Parquet metadata (no data scan needed)
            row_count = self._get_parquet_row_count(path)
        elif self.config.format == 'csv':
            lf = pl.scan_csv(f"{s3_uri}/*.csv")
            # CSV requires scan for row count - defer to avoid double read
            row_count = None  # Will be computed during processing if needed
        else:
            raise ValueError(f"Unsupported format: {self.config.format}")

        return StagedDataResult(
            data=lf,
            row_count=row_count,
            staged_at=sync_metadata['completed_at'],
            source_files=self._list_files(path),
            sync_id=sync_metadata['sync_id']
        )

    def _get_parquet_row_count(self, path: str) -> int:
        """Get row count from Parquet metadata without reading data."""
        # Parquet stores row count in file footer metadata
        # This is O(number of files), not O(number of rows)
        total_rows = 0
        for file_path in self._list_files(path):
            pf = pq.ParquetFile(f"s3://{self.config.bucket}/{file_path}")
            total_rows += pf.metadata.num_rows
        return total_rows
```

**Performance Note:** For Parquet files, row count is read from file metadata (O(files), not O(rows)). For CSV files, row count is deferred to avoid double-scanning the data.

#### 4.2.7 Why Parquet for Staging?

| Feature | Parquet | CSV | JSON |
|---------|---------|-----|------|
| **Columnar storage** | ✅ Yes | ❌ No | ❌ No |
| **Compression** | ✅ Snappy/Zstd | ❌ None | ❌ None |
| **Schema preservation** | ✅ Yes | ❌ No | ⚠️ Partial |
| **Polars lazy scan** | ✅ Optimized | ⚠️ Less efficient | ⚠️ Less efficient |
| **Predicate pushdown** | ✅ Yes | ❌ No | ❌ No |
| **Typical size (1M rows)** | ~50MB | ~200MB | ~300MB |

**Recommendation:** Always use Parquet for staging. Airbyte's S3 destination supports Parquet output.

### 4.3 Data Formats

#### 4.3.1 CSV Parsing

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `delimiter` | string | `,` | Field separator |
| `quote_char` | string | `"` | Quote character |
| `escape_char` | string | `\` | Escape character |
| `header_row` | boolean | `true` | First row contains headers |
| `skip_rows` | integer | `0` | Rows to skip before header |
| `encoding` | string | `UTF-8` | Character encoding |
| `null_values` | array | `["", "NULL"]` | Values treated as NULL |
| `trim_whitespace` | boolean | `true` | Trim leading/trailing spaces |

```yaml
format:
  type: csv
  delimiter: ","
  quote_char: "\""
  header_row: true
  encoding: UTF-8
  null_values: ["", "NULL", "null"]
  trim_whitespace: true
```

#### 4.3.2 JSON Parsing

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `array_path` | string | `null` | JSONPath to array of records |
| `flatten_nested` | boolean | `true` | Flatten nested objects |
| `nested_separator` | string | `.` | Separator for flattened keys |

```yaml
format:
  type: json
  array_path: data.transactions
  flatten_nested: true
  nested_separator: "_"
```

#### 4.3.3 Compression Support

- **gzip** (.gz) - Most common
- **zip** (.zip) - Archive format
- **bzip2** (.bz2) - Higher compression

### 4.4 Schema Normalization

#### 4.4.0 Dynamic Schema System (Schema-on-Read)

**Key Design Decision:** No canonical/global schema. Each reconciliation defines its own normalized schema via field mappings at runtime.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Schema Model                                  │
├─────────────────────────────────────────────────────────────────┤
│  Each Reconciliation Config defines its OWN "normalized schema" │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Reconciliation: "bkash_bank_daily"                      │    │
│  │ Source A: txn_ref → transaction_id                      │    │
│  │ Source B: reference_no → transaction_id                 │    │
│  │ Common Schema: { transaction_id, amount, currency }     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Reconciliation: "visa_network_auth"                     │    │
│  │ Source A: auth_code → txn_id                            │    │
│  │ Source B: arn → txn_id                                  │    │
│  │ Common Schema: { txn_id, pan_suffix, amount }           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  NO GLOBAL SCHEMA - Each config is self-contained               │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- No schema migration needed when adding new reconciliations
- Each reconciliation is completely self-contained
- Different sources can use completely different field names
- Field mappings are explicit and auditable

#### 4.4.1 Type System

| Type | Description | Example Values |
|------|-------------|----------------|
| `string` | Text data | `"Hello"`, `"TXN001"` |
| `integer` | Whole numbers (64-bit signed) | `42`, `-100` |
| `decimal` | Fixed-point numbers | `100.50`, `-25.99` |
| `boolean` | True/false values | `true`, `false` |
| `date` | Calendar date (no time) | `2024-03-15` |
| `timestamp` | Date and time with timezone | `2024-03-15T10:30:00Z` |

**Decimal Precision**:
```yaml
- name: amount
  type: decimal
  precision: 19  # Total digits
  scale: 4       # Digits after decimal
```

#### 4.4.2 Polars Expression-Based Transformations

All transformations use Polars expressions executed in Python Kubernetes jobs:

```yaml
schema:
  fields:
    # Type conversion
    - name: amount
      type: decimal
      precision: 19
      scale: 4
      source: txn_amount
      transform: "pl.col('txn_amount').cast(pl.Decimal(19, 4))"

    # Enum mapping using when/then/otherwise
    - name: status
      type: string
      source: txn_status
      transform: |
        pl.when(pl.col('txn_status').str.to_uppercase().is_in(['SUCCESS', 'OK']))
          .then(pl.lit('COMPLETED'))
          .when(pl.col('txn_status').str.to_uppercase() == 'FAILED')
          .then(pl.lit('REJECTED'))
          .otherwise(pl.lit('UNKNOWN'))

    # Derived field
    - name: net_amount
      type: decimal
      transform: "pl.col('amount') - pl.col('fee_amount')"

    # Date parsing with timezone conversion
    - name: transaction_timestamp
      type: timestamp
      source: created_at
      transform: |
        pl.col('created_at')
          .str.strptime(pl.Datetime, '%Y-%m-%d %H:%M:%S')
          .dt.replace_time_zone('America/New_York')
          .dt.convert_time_zone('UTC')
```

#### 4.4.3 Polars Expression Environment

**Security Model for User Transforms:**

User-provided Polars expressions are **arbitrary code execution risks** if evaluated unsafely. The following safeguards are mandatory:

| Safeguard | Implementation |
|-----------|----------------|
| **Container Isolation** | Each job runs in ephemeral Kubernetes pod with no network egress |
| **Resource Limits** | Hard limits on CPU (4 cores), memory (2GB), and execution time (10 min) |
| **Restricted Builtins** | Python `exec()`/`eval()` wrapped with restricted globals (no `__import__`, `open`, `os`, `subprocess`) |
| **Allowlist-Only Functions** | Only approved Polars expression functions permitted (see list below) |
| **AST Validation** | Pre-parse expressions and reject any non-Polars constructs (function calls, imports, file I/O) |
| **Read-Only Data** | Job containers mount source data as read-only volumes |
| **No Secrets in Environment** | Database credentials passed only to loader, not to expression evaluator |

**Expression Validation Pipeline:**
```python
import ast
import polars as pl

ALLOWED_POLARS_METHODS = {
    # Math
    'abs', 'ceil', 'floor', 'round', 'sqrt', 'log', 'exp',
    # String
    'str.to_uppercase', 'str.to_lowercase', 'str.slice',
    'str.replace', 'str.contains', 'str.starts_with', 'str.ends_with',
    # Date
    'dt.offset_by', 'dt.strptime', 'dt.convert_time_zone', 'dt.weekday',
    'dt.year', 'dt.month', 'dt.day', 'dt.hour', 'dt.minute',
    # Conditional
    'when', 'then', 'otherwise', 'is_in', 'is_null', 'is_not_null',
    # Aggregation
    'sum', 'mean', 'count', 'min', 'max', 'first', 'last',
}

FORBIDDEN_CONSTRUCTS = {'Import', 'Call', 'Attribute'}  # Non-Polars calls

def validate_expression(expr_str: str) -> bool:
    """Validate expression contains only allowed Polars operations."""
    try:
        tree = ast.parse(expr_str, mode='eval')
        # Walk AST and verify all calls are in ALLOWED_POLARS_METHODS
        # Reject any import, open(), exec(), eval(), os.*, subprocess.*
        return _validate_ast_node(tree)
    except SyntaxError:
        return False
```

**Execution Context**:
- Runs in isolated Kubernetes jobs (Python containers)
- Resource limits enforced by Kubernetes (CPU, memory)
- Timeout controlled by job deadline
- Read-only access to source data
- **No network egress** (NetworkPolicy blocks all outbound)
- **No persistent storage** (ephemeral pods only)

**Available Polars Functions (Allowlist)**:
- **Math**: `abs()`, `ceil()`, `floor()`, `round()`, arithmetic operators
- **String**: `str.to_uppercase()`, `str.to_lowercase()`, `str.slice()`, `str.replace()`, `str.contains()`
- **Date**: `dt.offset_by()`, `dt.strptime()`, `dt.convert_time_zone()`, `dt.weekday()`
- **Conditional**: `when()`, `then()`, `otherwise()`, `is_in()`, `is_null()`
- **Aggregation**: `sum()`, `mean()`, `count()`, `min()`, `max()`

**Explicitly Forbidden**:
- `exec()`, `eval()`, `compile()` (Python builtins)
- `open()`, `read()`, `write()` (file operations)
- `import`, `__import__()` (module loading)
- `os.*`, `subprocess.*`, `sys.*` (system access)
- Network operations (requests, urllib, socket)

#### 4.4.4 Validation Rules

```yaml
validation:
  min: 0.01
  max: 1000000.00
  required: true
  regex: "^[A-Z]{3}$"
  enum: [USD, EUR, GBP, JPY]
  unique: true  # Within dataset
```

### 4.5 Matching Rules

#### 4.5.1 JOIN Conditions

Equality-based joins only (operator `=` is implicit):

**Single Column Join**:
```yaml
join:
  - left: source_a.transaction_id
    right: source_b.transaction_id
```

**Multi-Column Join**:
```yaml
join:
  - left: source_a.merchant_id
    right: source_b.merchant_id
  - left: source_a.transaction_date
    right: source_b.transaction_date
```

**Join with Transformations**:
```yaml
join:
  - left: upper(trim(source_a.reference))
    right: upper(trim(source_b.reference))
```

Available functions: `upper()`, `lower()`, `trim()`, `abs()`

#### 4.5.2 Match Rules

**Comparison Operators**:

| Operator | Description |
|----------|-------------|
| `=` | Equal to |
| `!=` | Not equal to |
| `<` | Less than |
| `<=` | Less than or equal |
| `>` | Greater than |
| `>=` | Greater than or equal |

**Comparison Rule**:
```yaml
rules:
  - name: currency_match
    severity: error
    left: source_a.currency
    operator: "="
    right: source_b.currency
```

**Boolean Operators**:

```yaml
# AND - All operands must be true
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

# OR - At least one operand must be true
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

# NOT - Single operand must be false
- name: not_test_transaction
  severity: error
  operator: NOT
  operand:
    left: source_a.is_test
    operator: "="
    right: true
```

**Polars Expression Rules**:
```yaml
rules:
  - name: amount_tolerance
    severity: error
    expression: "(pl.col('source_a.amount') - pl.col('source_b.amount')).abs() <= 0.01"

  - name: settlement_window
    severity: warning
    expression: |
      (pl.col('source_b.settlement_date') - pl.col('source_a.transaction_date'))
        .dt.days()
        .is_between(0, 3)
```

#### 4.5.3 Severity Levels

| Severity | Behavior | Use Case |
|----------|----------|----------|
| `error` | Must match for overall match | Critical fields (ID, amount) |
| `warning` | Record warnings but allow match | Non-critical (timestamps, descriptions) |
| `info` | Informational only | Audit trail, debugging |

#### 4.5.4 Rule Versioning

```yaml
matching_rules:
  name: payment_gateway_rules
  version: 3
  changelog:
    - version: 3
      date: 2024-03-01
      changes: "Increased amount tolerance from $0.01 to $0.05"
```

#### 4.5.5 Rule Statistics

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
```

### 4.6 Reconciliation Modes

#### 4.6.1 One-to-One Mode (Current Scope)

- Each record in Source A matches at most one record in Source B
- Join keys must be unique in both datasets
- Duplicate keys are flagged as errors (by default)

```yaml
reconciliation:
  mode: one_to_one
  duplicate_handling:
    action: error  # or 'warning', 'take_first', 'take_last'
    report: true
    # REQUIRED when action is 'take_first' or 'take_last':
    order_by:
      - field: source_a.created_at
        direction: asc
      - field: source_b.transaction_date
        direction: asc
```

**Duplicate Handling Actions:**

| Action | Behavior | `order_by` Required |
|--------|----------|---------------------|
| `error` | Fail the job with duplicate key error | No |
| `warning` | Log warning, emit all duplicates as unmatched | No |
| `take_first` | Keep first record per `order_by`, discard others | **Yes** |
| `take_last` | Keep last record per `order_by`, discard others | **Yes** |

**Deterministic Ordering Requirement:**
When using `take_first` or `take_last`, the `order_by` field is **mandatory** to ensure deterministic, reproducible results. Without explicit ordering, record selection would depend on database/file read order, which is non-deterministic.

```yaml
# Example: Take the most recent transaction when duplicates exist
duplicate_handling:
  action: take_last
  order_by:
    - field: source_a.updated_at
      direction: asc  # Last = most recent updated_at
```

**Possible Outcomes**:
- **Matched**: One record from A matches one record from B
- **Unmatched Left**: Record in A with no match in B
- **Unmatched Right**: Record in B with no match in A
- **Duplicate in Source A/B**: Multiple records with same join key (when action=error/warning)

#### 4.6.2 Future Modes (TODO)

- **One-to-Many**: One parent matches multiple children (e.g., invoice vs line items)
- **Many-to-Many**: Complex scenarios with multiple matches in both directions

### 4.7 Results & Queryability

#### 4.7.1 Result Categories

| Category | Description | SQL Equivalent |
|----------|-------------|----------------|
| **Matched** | Records that matched based on rules | INNER JOIN where all rules passed |
| **Unmatched Left** | Records in Source A with no match | LEFT OUTER JOIN where B is NULL |
| **Unmatched Right** | Records in Source B with no match | RIGHT OUTER JOIN where A is NULL |

#### 4.7.2 Rule Match Groups

Records can be queried by which rules passed/failed:

```yaml
query:
  result_category: matched
  rules_passed:
    - amount_tolerance
    - currency_match
  rules_failed:
    - timestamp_window
```

#### 4.7.3 Named Queries

Define named queries in stage outputs:

```yaml
outputs:
  matched:
    queries:
      - name: perfect_matches
        rules_passed: [amount_exact, currency_match, timestamp_exact]

      - name: timestamp_warnings
        rules_passed: [amount_exact, currency_match]
        rules_failed: [timestamp_exact]
```

#### 4.7.4 Export Formats

Currently supported: **CSV only**

```yaml
export:
  format: csv
  category: matched
  filename: matched_{date}.csv
```

#### 4.7.5 Immutability Guarantees

- Results cannot be modified after generation
- Re-runs create new versions
- Complete audit trail maintained

### 4.8 Multi-Stage Workflows

#### 4.8.1 DAG-Based Workflow Execution

Workflows are directed acyclic graphs (DAGs) of reconciliation stages:

```yaml
workflow:
  name: three_way_reconciliation
  stages:
    - name: stage_1_ledger_gateway
      source_a: internal_ledger
      source_b: payment_gateway
      matching_rules: ledger_gateway_rules
      output: ledger_gateway_matched

    - name: stage_2_gateway_bank
      source_a: payment_gateway
      source_b: bank_statement
      matching_rules: gateway_bank_rules
      output: gateway_bank_matched

    - name: stage_3_consolidation
      dependencies:
        - stage_1_ledger_gateway
        - stage_2_gateway_bank
      source_a: ledger_gateway_matched
      source_b: gateway_bank_matched
      matching_rules: consolidation_rules
```

#### 4.8.2 Stage Dependencies

- **Independent**: Run in parallel
- **Sequential**: Output of one feeds into the next
- **Conditional**: Execute based on previous stage results

#### 4.8.3 Stage Input from Previous Outputs

```yaml
stage:
  name: exception_analysis
  inputs:
    source_a:
      type: stage_output
      stage: strict_matching
      output_category: matched
      query: timestamp_warnings  # Reference named query
```

#### 4.8.4 Patch Management

Apply corrections to source data without modifying originals:

```yaml
source:
  patches:
    enabled: true
    patch_source:
      # Patches are staged in S3 (uploaded manually or via Airbyte)
      bucket: recon-staging
      path_template: "{tenant_id}/patches/{source_name}/{year}-{month}-{day}/"
      format: csv
  patch_priority: latest
  patch_conflict_resolution:
    strategy: latest  # or 'earliest', 'error'
```

**Patch File Structure**:
```csv
patch_type,transaction_id,field,corrected_value,reason
UPDATE,TXN001,amount,100.50,"Amount correction"
ADD,TXN999,amount,500.00,"Missing transaction"
DELETE,TXN003,,,"Duplicate removal"
```

---

## 5. Security & Compliance

### 5.1 Authentication

#### 5.1.1 OAuth 2.0

**Supported Flows**:
- Authorization Code Flow (web application login)
- Client Credentials Flow (API/service-to-service)

```yaml
authentication:
  provider: oauth2
  authorization_endpoint: https://auth.company.com/oauth/authorize
  token_endpoint: https://auth.company.com/oauth/token
  userinfo_endpoint: https://auth.company.com/oauth/userinfo
  client_id: ${SECRET:oauth_client_id}
  client_secret: ${SECRET:oauth_client_secret}
  scopes:
    - reconciliation:read
    - reconciliation:write
    - reconciliation:admin
```

#### 5.1.2 JWT Token Management

```json
{
  "sub": "user@company.com",
  "tenant_id": "3f1e7e7a-1b7c-4a6e-9f0b-2b0d0c0c3e21",
  "roles": ["reconciliation_analyst"],
  "iat": 1710499800,
  "exp": 1710503400,
  "scope": "reconciliation:read reconciliation:write"
}
```

### 5.2 Authorization

#### 5.2.1 Role-Based Access Control (RBAC)

**Predefined Roles**:

| Role | Permissions |
|------|-------------|
| `reconciliation_viewer` | View results, export data |
| `reconciliation_analyst` | Run reconciliations, create queries |
| `reconciliation_admin` | Configure sources, rules, schemas |
| `system_admin` | Full system access, tenant management |

#### 5.2.2 Granular Permissions

| Permission | Description |
|------------|-------------|
| `reconciliation:read` | View configurations and results |
| `reconciliation:write` | Create/modify configurations |
| `reconciliation:execute` | Run reconciliations |
| `reconciliation:delete` | Delete reconciliations and results |
| `datasource:read/write/test` | Data source management |
| `schema:read/write` | Schema management |
| `rules:read/write` | Rule management |
| `user:read/write` | User management |
| `audit:read` | View audit logs |

#### 5.2.3 Resource-Level Permissions

```yaml
reconciliation:
  name: payment_gateway_recon
  owner: john.doe@company.com
  permissions:
    - user: jane.smith@company.com
      level: read
    - role: reconciliation_analyst
      level: execute
```

### 5.3 Multi-Tenancy

**Isolation Model:** This system uses the **Pool Model** with PostgreSQL Row Level Security (RLS) - all tenants share the same database schema with data isolation enforced at the row level via RLS policies. This is NOT a per-tenant schema model.

#### 5.3.1 Complete Data Isolation

```yaml
tenant:
  tenant_id: 3f1e7e7a-1b7c-4a6e-9f0b-2b0d0c0c3e21
  name: "Acme Financial Services"
  isolation:
    model: pool          # Shared schema with RLS (NOT per-tenant schema)
    data_encryption: tenant_specific_key
    storage_path: s3://bucket/tenants/3f1e7e7a/  # Object storage only
```

**Why Pool Model?**
- Cost-efficient: Single database instance serves all tenants
- Simpler operations: No per-tenant schema migrations
- RLS provides strong isolation without separate schemas

#### 5.3.2 PostgreSQL Row Level Security

```sql
-- All tables have tenant_id column (shared schema)
CREATE TABLE reconciliations (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name VARCHAR(255),
  ...
);

-- Row-level security policy enforces isolation
CREATE POLICY tenant_isolation ON reconciliations
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- IMPORTANT: Every query is automatically filtered by tenant_id via RLS
-- No application code changes needed for multi-tenancy
```

### 5.4 Credential Security

#### 5.4.0 Credential Ownership Boundaries

With the Airbyte integration, credential management is split between two systems:

| System | Owns Credentials For | Storage Location |
|--------|---------------------|------------------|
| **Airbyte** | Source connections (SFTP, API, databases) | Airbyte's encrypted config DB |
| **Reconciliation Engine** | S3 access, internal APIs, user auth | PostgreSQL + Secrets Manager |

**Important:** The reconciliation engine does NOT store source credentials (database passwords, SFTP keys, API tokens). These are managed entirely within Airbyte. The reconciliation engine only stores:
- S3/MinIO access credentials (for reading staged data)
- Airbyte API token (for triggering syncs)
- OAuth credentials (for user authentication)

#### 5.4.1 Encryption at Rest

```yaml
encryption:
  algorithm: AES-256-GCM
  key_management: AWS KMS  # or HashiCorp Vault
  key_rotation: automatic
  rotation_period: 90 days
```

**Encrypted Fields (Reconciliation Engine only):**
- S3/MinIO access keys
- Airbyte API token
- OAuth client secrets (for user auth)
- Tenant-specific encryption keys

**Managed by Airbyte (not stored here):**
- Database passwords
- SFTP private keys
- Source API keys and tokens

#### 5.4.2 External Secret Management

**Supported Providers**:
- HashiCorp Vault
- AWS Secrets Manager
- Azure Key Vault
- GCP Secret Manager

```yaml
# Secret reference syntax
password: ${SECRET:aws:payment_gateway_password}
api_key: ${SECRET:vault:api_keys/payment_gateway}
```

#### 5.4.3 Automatic Credential Rotation

```yaml
credential_rotation:
  enabled: true
  rotation_schedule: 90 days
  notification:
    before_expiry: 7 days
```

### 5.5 Compliance

#### 5.5.1 SOC 2 Requirements

- Audit logging of all data access
- Encryption at rest and in transit
- Access controls and RBAC
- Data retention policies
- Incident response procedures

#### 5.5.2 GDPR Compliance

- Data subject access requests (export user's data)
- Right to deletion
- Data processing agreements
- Data breach notification

```yaml
gdpr:
  enabled: true
  data_subject_access:
    max_response_time: 30 days
  right_to_deletion:
    supported: true
    retention_override: false  # Cannot delete audit logs
```

#### 5.5.3 PCI DSS Considerations

When handling card data:
- Cardholder data masking (show last 4 digits)
- Restricted access to card data
- Regular security audits
- Encrypted transmission and storage

### 5.6 Audit Logging

**Logged Events**:
- User login/logout
- Failed authentication attempts
- Permission changes
- Data source access
- Reconciliation execution
- Query execution
- Data exports
- Configuration changes
- Secret access

```yaml
audit_log:
  event_id: AUDIT-2024-03-15-0001
  timestamp: 2024-03-15T12:00:00Z
  tenant_id: 3f1e7e7a-1b7c-4a6e-9f0b-2b0d0c0c3e21
  user_id: john.doe@company.com
  event_type: reconciliation_executed
  action: execute
  resource_type: reconciliation
  resource_id: payment_gateway_recon
  source_ip: 192.168.1.100
  result: success
```

**Retention**: 7 years (immutable, append-only)

---

## 6. Performance Requirements

### 6.1 Throughput Targets

**Reference Hardware (Single Kubernetes Job Pod):**
- CPU: 4 cores (AMD EPYC or Intel Xeon, 2.5GHz+)
- Memory: 2GB RAM
- Storage: SSD-backed ephemeral storage
- Network: 1Gbps+ internal cluster network

| Dataset Size | Max Rules | Target Time | Notes |
|--------------|-----------|-------------|-------|
| 100K x 100K | 5 | < 100ms | Single pod |
| 1M x 1M | 5 | < 1s | Single pod (POC validated: 705ms) |
| 5M x 5M | 5 | < 10s | Single pod with spill-to-disk |
| 10M x 10M | 5 | < 30s | Single pod with streaming/chunked processing |

**Important Notes:**
- Targets assume pre-loaded data (network fetch time excluded)
- 10M x 10M requires streaming/chunked join implementation to fit within 2GB memory
- Larger datasets may require horizontal scaling (multiple pods) in future versions

**Breakdown for 1M x 1M**:
- Data Loading: < 200ms per source
- Schema Normalization: < 100ms
- Join Operation: < 300ms
- Rule Evaluation: < 400ms

### 6.2 Resource Limits

#### Per-Job Limits

```yaml
resource_limits:
  max_memory: 2GB       # Kubernetes pod memory limit
  max_cpu_cores: 4      # Kubernetes pod CPU limit
  max_execution_time: 600s  # 10 minutes (Kubernetes job deadline)
  max_source_records: 10000000  # 10M per source (streaming required for >1M)
```

**Memory Scaling Strategy:**
| Dataset Size | Memory Strategy |
|--------------|-----------------|
| < 1M records | Full in-memory processing |
| 1M - 5M records | Polars lazy evaluation with streaming |
| 5M - 10M records | Chunked processing with disk spill |
| > 10M records | Future: distributed processing (Spark/Dask) |

#### Concurrency Limits

```yaml
concurrency:
  max_concurrent_jobs_per_tenant: 5
  max_concurrent_jobs_system: 50
  queue_size: 100
  queue_timeout: 3600s
```

### 6.3 API Response Times

| Operation | Target | Maximum |
|-----------|--------|---------|
| List reconciliations | < 100ms | < 500ms |
| Get reconciliation config | < 50ms | < 200ms |
| Test data source | < 2s | < 5s |
| Submit job | < 100ms | < 500ms |
| Query results (1K records) | < 200ms | < 1s |
| Export results (10K records) | < 5s | < 30s |

### 6.4 Optimization Strategies

#### 6.4.1 Hash Join Algorithms

```mermaid
Phase 1: Build Index
  - Stream Source A records
  - Build HashMap: key → record
  - O(n) time, O(n) space

Phase 2: Probe & Match
  - Stream Source B records
  - Lookup in HashMap
  - Evaluate matching rules
  - O(m) time

Phase 3: Remainder
  - Emit unused HashMap entries as unmatched_left
  - O(n) time
```

#### 6.4.2 Auto-Indexing on Join Keys

```yaml
optimization:
  auto_index: true
  index_fields:
    - source_a.transaction_id
    - source_b.transaction_id
```

**Index Types**:
- Hash index for equality joins
- B-tree index for range queries
- Bloom filter for existence checks

#### 6.4.3 Lazy Evaluation

Derived fields computed only when needed:
- If field not used in rules or output, skip computation
- If rule fails early, skip subsequent field calculations

#### 6.4.4 Early Termination

```yaml
matching_rules:
  optimization:
    early_termination: true  # Stop on first error rule failure
```

#### 6.4.5 Caching

```yaml
caching:
  enabled: true
  backend: redis
  ttl:
    configurations: 3600s  # 1 hour
    results: 300s  # 5 minutes
  eviction_policy: LRU
```

**Cached Items**:
- Data source configurations
- Schema definitions
- Matching rules
- Job configuration JSON
- Lookup tables (enums, calendars)

### 6.5 Edge Cases & Error Handling

#### 6.5.1 Data Loading Edge Cases

| # | Scenario | Detection | Handling | User Message |
|---|----------|-----------|----------|--------------|
| 1 | SFTP host unreachable | Connection timeout | Retry 3x with exponential backoff | "Cannot connect to SFTP server. Check host and firewall." |
| 2 | Invalid credentials | Auth failure | Fail fast | "Authentication failed. Verify username/password/key." |
| 3 | File not found | 404/missing | Fail with pattern | "File not found: settlement_20240315.csv (pattern: settlement_{date}.csv)" |
| 4 | Empty file | 0 bytes | Warning, empty DF | "Source file is empty. Proceeding with 0 records." |
| 5 | Corrupted CSV | Parse error | Fail with line # | "CSV parse error at line 1542: Unexpected quote character" |
| 6 | Encoding mismatch | Decode error | Auto-detect, retry | "Detected encoding: ISO-8859-1 (configured: UTF-8). Converting." |
| 7 | API pagination incomplete | Count mismatch | Retry pagination | "API returned 9,500 records but reported 10,000 total. Retrying." |
| 8 | Rate limited (429) | HTTP 429 | Backoff + retry | "Rate limited. Waiting 60s before retry." |
| 9 | Database timeout | Query timeout | Cancel + fail | "Query timed out after 600s. Consider adding indexes." |
| 10 | SSL certificate error | SSL verify fail | Fail (security) | "SSL certificate verification failed. Cannot proceed." |

#### 6.5.2 Schema Normalization Edge Cases

| # | Scenario | Detection | Handling | User Message |
|---|----------|-----------|----------|--------------|
| 11 | Source field missing (required) | Column check | Fail at validation | "Required field 'transaction_id' not found in source." |
| 12 | Source field missing (optional) | Column check | Return NULL/default | "Optional field 'fee' not found. Using default: 0.0" |
| 13 | Type conversion failure | Cast exception | Per-row error | "Cannot convert 'abc' to decimal at row 1523" |
| 14 | Decimal overflow | Out of range | Fail | "Value 99999999999999999.99 exceeds maximum precision" |
| 15 | Invalid date format | Parse failure | Try alternatives | "Date '15-03-2024' doesn't match format 'YYYY-MM-DD'. Trying 'DD-MM-YYYY'." |
| 16 | Timezone ambiguity | No TZ info | Assume config | "No timezone in timestamp. Assuming UTC per configuration." |
| 17 | Enum value not mapped | Unknown value | Use default or error | "Unknown status 'PARTIAL'. Mapping to 'UNKNOWN'." |
| 18 | Derived field division by zero | Runtime error | NULL result | "Division by zero in derived field 'fee_rate'. Setting to NULL." |
| 19 | String truncation | Length exceeded | Truncate + warn | "Field 'description' truncated from 1500 to 500 characters." |
| 20 | Coalesce all NULL | All sources NULL | Return NULL/default | "All coalesce sources NULL for 'reference_id'. Using default." |
| 21 | Transform returns wrong type | Type check | Cast or error | "Transform for 'amount' returned string, expected decimal." |
| 22 | Join key type mismatch | Pre-flight validation | Fail before execution | "Join key 'transaction_id' type mismatch: string vs integer" |
| 23 | Schema drift between runs | Compare with last run | Warning + continue | "Schema changed: field 'new_field' added since last run." |

#### 6.5.3 Matching Engine Edge Cases

| # | Scenario | Detection | Handling | User Message |
|---|----------|-----------|----------|--------------|
| 24 | Duplicate join key in Source A | Group by count > 1 | Configurable | "5 duplicate transaction_ids found in Source A. Action: ERROR" |
| 25 | Duplicate join key in Source B | Group by count > 1 | Configurable | "3 duplicate transaction_ids found in Source B. Action: WARNING" |
| 26 | NULL join key | IS NULL check | Exclude from join | "47 records with NULL join key excluded from matching." |
| 27 | 100% unmatched | Match count = 0 | Warning | "No records matched. Verify join key mapping." |
| 28 | Memory exceeded | OOM detection | Fail gracefully | "Job exceeded 2GB memory limit. Consider partitioning." |
| 29 | Type mismatch in rule | Different types | Auto-cast or fail | "Cannot compare string 'amount' with numeric 'amount_b'" |
| 30 | NaN in numeric comparison | isnan check | Treat as mismatch | "NaN value in amount comparison. Treating as mismatch." |
| 31 | Infinity in calculation | isinf check | Treat as error | "Infinite value detected in fee calculation." |

#### 6.5.4 Multi-Tenancy Edge Cases

| # | Scenario | Detection | Handling | User Message |
|---|----------|-----------|----------|--------------|
| 32 | Missing tenant_id header | Header check | Reject request | "Missing X-Tenant-ID header" (401) |
| 33 | Tenant not found | DB lookup | Reject request | "Tenant not found" (404) |
| 34 | Cross-tenant data access | RLS policy | Block + audit | Silent block, audit log entry |
| 35 | Tenant suspended | Status check | Reject request | "Tenant account suspended. Contact support." |
| 36 | Tenant quota exceeded | Counter check | Reject job | "Monthly job limit (1000) exceeded." |

#### 6.5.5 Job Execution Edge Cases

| # | Scenario | Detection | Handling | User Message |
|---|----------|-----------|----------|--------------|
| 37 | Job timeout (10 min) | Timer | Cancel job | "Job exceeded 10 minute limit. Consider smaller date range." |
| 38 | Worker crash mid-job | Heartbeat timeout | Mark failed, cleanup | "Job failed unexpectedly. Partial results discarded." |
| 39 | Concurrent job limit hit | Counter | Queue or reject | "5 jobs already running. Job queued (position: 3)" |
| 40 | S3 upload failure | Put exception | Retry 3x | "Failed to upload results. Retrying..." |
| 41 | Job cancelled by user | Cancel signal | Cleanup | "Job cancelled. Partial results discarded." |

---

## 7. Architecture Design

### 7.1 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Data Ingestion** | Airbyte (OSS) | 300+ connectors, handles SFTP/API/DB extraction |
| **API Server** | Spring Boot 3.x (Java 21) | Enterprise-grade, robust ecosystem |
| **Database** | PostgreSQL 15+ | Single source of truth, JSONB, RLS |
| **Job Execution** | Kubernetes Jobs | Scalable, isolated job execution |
| **Data Processing** | Python 3.11+ + Polars | High-performance DataFrame operations |
| **Web Dashboard** | React + TypeScript | Component-based, typed |
| **Visual Builder** | React + Custom | Block programming UI |
| **Object Storage** | MinIO / S3 | S3-compatible, staging + result storage |
| **Caching** | Redis | Config cache, rate limiting |
| **Monitoring** | Prometheus + Grafana | K8s-native observability |
| **Logging** | Loki + Promtail | Log aggregation |
| **Tracing** | Jaeger / Tempo | Distributed tracing |

### 7.2 Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      External Data Sources                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐   │
│  │   SFTP   │  │ REST API │  │ Database │  │ SaaS (Stripe,  │   │
│  │  Servers │  │ Endpoints│  │ (PG/MySQL│  │  Salesforce)   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘   │
└───────┼─────────────┼─────────────┼────────────────┼────────────┘
        │             │             │                │
        └─────────────┴──────┬──────┴────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Airbyte (Data Ingestion)                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  • 300+ Pre-built Connectors                              │   │
│  │  • Scheduled/Triggered Syncs                              │   │
│  │  • Schema Detection & Evolution                           │   │
│  │  • Incremental Sync Support                               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼ (Parquet files)
┌─────────────────────────────────────────────────────────────────┐
│                   S3 / MinIO (Staging Area)                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  s3://recon-staging/{tenant_id}/{source}/{date}/*.parquet │   │
│  │  • Columnar format for efficient reads                    │   │
│  │  • Partitioned by tenant and date                         │   │
│  │  • Airbyte writes here, Polars reads from here            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌───────────────────────────────┐  ┌──────────────────────────────┐
│   Presentation Layer          │  │   Kubernetes Job Execution    │
│  ┌─────────────────────────┐  │  │  ┌────────────────────────┐  │
│  │   Web Dashboard         │  │  │  │ Python + Polars        │  │
│  │  (React + TypeScript)   │  │  │  │ Container              │  │
│  ├─────────────────────────┤  │  │  │                        │  │
│  │   Visual Rule Builder   │  │  │  │ • Read from S3 Staging │  │
│  │  (Block Programming)    │  │  │  │ • Apply Schema Mapping │  │
│  └─────────────────────────┘  │  │  │ • Execute Matching     │  │
└───────────────────────────────┘  │  │ • Write Results        │  │
        │                          │  └────────────────────────┘  │
        ▼                          └──────────────────────────────┘
┌───────────────────────────────┐                │
│   API Gateway                 │                │
│  ┌──────────┐ ┌─────────────┐ │                │
│  │   Auth   │ │Rate Limiting│ │                │
│  └──────────┘ └─────────────┘ │                │
└───────────────────────────────┘                │
        │                                         │
        ▼                                         │
┌─────────────────────────────────────────────────────────────────┐
│                  Spring Boot API Server                          │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │  Config API  │  │    Run API     │  │    Reports API      │  │
│  │  (CRUD Jobs) │  │ (Trigger Jobs) │  │ (Results/Explain)   │  │
│  └──────────────┘  └────────────────┘  └─────────────────────┘  │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │  Job Manager │  │  Airbyte API   │  │  Webhook Handler    │  │
│  │  (Scheduler) │  │  (Sync Trigger)│  │  (Job Callbacks)    │  │
│  └──────────────┘  └────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL (Single Source of Truth)          │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │  Job Configs │  │  Job Runs      │  │  Match Results      │  │
│  │  (JSONB)     │  │  (Status)      │  │  (Explanations)     │  │
│  └──────────────┘  └────────────────┘  └─────────────────────┘  │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │ Staging Refs │  │  Schemas       │  │  Audit Logs         │  │
│  │ (S3 Paths)   │  │  (Versions)    │  │  (Immutable)        │  │
│  └──────────────┘  └────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Matching Engine Flow (Python + Polars)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Spring Boot Server                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  1. Receive job trigger (API/Schedule)                    │   │
│  │  2. (Optional) Trigger Airbyte sync and wait              │   │
│  │  3. Fetch job config from PostgreSQL                      │   │
│  │  4. Validate staged data freshness in S3                  │   │
│  │  5. Create Kubernetes Job with config as env/configmap    │   │
│  │  6. Monitor job status via K8s API                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              Kubernetes Job (Python + Polars Container)          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Phase 1: Data Loading (from S3 Staging)                  │   │
│  │  - lf_a = pl.scan_parquet("s3://staging/.../source_a/")   │   │
│  │  - lf_b = pl.scan_parquet("s3://staging/.../source_b/")   │   │
│  │  - Lazy loading (no memory load until .collect())         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                 │
│                                ▼                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Phase 2: Schema Normalization                            │   │
│  │  - Apply Polars expressions for type conversion           │   │
│  │  - Apply enum mappings (when/then/otherwise)              │   │
│  │  - Create derived fields                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                 │
│                                ▼                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Phase 3: Hash Join                                       │   │
│  │  - Polars join on key columns (lazy evaluation)           │   │
│  │  - O(n + m) complexity with hash-based join               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                 │
│                                ▼                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Phase 4: Rule Evaluation                                 │   │
│  │  - Evaluate Polars expressions for each rule              │   │
│  │  - Track pass/fail per rule for explainability            │   │
│  │  - Apply severity levels (error, warning, info)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                 │
│                                ▼                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Phase 5: Result Writing                                  │   │
│  │  - Write matched/unmatched to PostgreSQL                  │   │
│  │  - Write explanations to PostgreSQL                       │   │
│  │  - Export large results to S3 (optional)                  │   │
│  │  - Update job status in PostgreSQL                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Outputs                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Matched    │  │  Unmatched   │  │  Unmatched   │           │
│  │   Records    │  │    Left      │  │    Right     │           │
│  │ (PostgreSQL) │  │ (PostgreSQL) │  │ (PostgreSQL) │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Explanations │  │  CSV Export  │                             │
│  │ (PostgreSQL) │  │    (S3)      │                             │
│  └──────────────┘  └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3.1 Dynamic Query Builder Implementation

The matching engine uses a dynamic query template that allows users to define arbitrary join clauses, conditions, and ordering. In `one_to_one` mode, uniqueness is enforced upstream via duplicate detection and `duplicate_handling`; the query builder does not apply a global `LIMIT`.

#### Query Specification Format

Users provide a specification defining the query structure:

```python
spec = {
    # Join pairs: (left_col_in_A, right_col_in_B)
    "join": [
        ("trxnId", "transactionId"),
        ("amount", "amount")
    ],

    # Conditions: (left_ref, operator, right_ref_or_literal)
    # References use "A.<col>" or "B.<col>" prefix
    "conditions": [
        ("A.Status", "==", "B.Status"),
        ("A.Remarks", "==", "B.Desc")
    ],

    # Order by: list of (ref, descending_bool)
    "order_by": [
        ("A.Timestamp", True),
        ("B.dateTime", True)
    ],

    # Join type (configurable)
    "how": "inner"
}
```

#### Dynamic Query Template Implementation

```python
import polars as pl
from typing import Any

def _prefix_all(lf: pl.LazyFrame, prefix: str) -> pl.LazyFrame:
    """Renames every column -> '{prefix}{col}' to prevent A/B collisions."""
    return lf.rename({c: f"{prefix}{c}" for c in lf.columns})

def _q(ref: str) -> str:
    """Convert 'A.col' -> 'A__col', 'B.col' -> 'B__col' for internal naming."""
    table, col = ref.split(".", 1)
    return f"{table}__{col}"

# Supported comparison operators
_OPS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "<":  lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">":  lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
}

def build_query(
    lf_a: pl.LazyFrame,
    lf_b: pl.LazyFrame,
    *,
    join_pairs: list[tuple[str, str]],                 # [(A_col, B_col), ...]
    conditions: list[tuple[str, str, Any]] | None,     # [(left_ref, op, right_ref_or_literal), ...]
    order_by: list[tuple[str, bool]] | None,           # [(ref, desc_bool), ...]
    how: str = "inner",
) -> pl.LazyFrame:
    """
    Build a dynamic Polars query with:
    - Configurable join keys (1 or more)
    - Configurable conditions (0 or more, ANDed together)
    - Configurable ordering (0 or more columns)
    - No global LIMIT; one_to_one enforced via uniqueness checks/duplicate_handling
    """
    # Prefix all columns to avoid naming collisions
    A = _prefix_all(lf_a, "A__")
    B = _prefix_all(lf_b, "B__")

    # Build join key lists
    left_on  = [f"A__{a_col}" for a_col, _ in join_pairs]
    right_on = [f"B__{b_col}" for _, b_col in join_pairs]

    # Perform join
    q = A.join(B, left_on=left_on, right_on=right_on, how=how)

    # Apply conditions (0..N, combined with AND)
    if conditions:
        exprs = []
        for left_ref, op, right in conditions:
            left_expr = pl.col(_q(left_ref))

            # Check if right side is a column reference or literal
            # PARSING RULES:
            #   - Strings starting with "A." or "B." followed by a column name
            #     are interpreted as column references (e.g., "A.status", "B.amount")
            #   - All other values are literals
            #   - To use a literal that looks like a column ref (e.g., "A.B Corp"),
            #     wrap it in a dict: {"literal": "A.B Corp"}
            if isinstance(right, dict) and "literal" in right:
                # Explicit literal escape
                right_expr = pl.lit(right["literal"])
            elif isinstance(right, str) and ("." in right) and (right.split(".", 1)[0] in ("A", "B")):
                right_expr = pl.col(_q(right))
            else:
                right_expr = pl.lit(right)

            exprs.append(_OPS[op](left_expr, right_expr))

        # AND all conditions together
        q = q.filter(pl.all_horizontal(*exprs))

    # Apply ordering (optional)
    if order_by:
        by = [pl.col(_q(ref)) for ref, _ in order_by]
        desc = [desc_bool for _, desc_bool in order_by]
        q = q.sort(by, descending=desc)

    # Return full join result; one_to_one enforcement happens upstream
    return q
```

#### Usage Example

```python
# Source A: Internal ledger
lf_a = pl.scan_csv("ledger.csv")
# Columns: trxnId, amount, Status, Remarks, Timestamp

# Source B: External settlement
lf_b = pl.scan_csv("settlement.csv")
# Columns: transactionId, amount, Status, Desc, dateTime

# Build the query dynamically based on user specification
q = build_query(
    lf_a,
    lf_b,
    join_pairs=[
        ("trxnId", "transactionId"),
        ("amount", "amount")
    ],
    conditions=[
        ("A.Status", "==", "B.Status"),
        ("A.Remarks", "==", "B.Desc"),
    ],
    order_by=[
        ("A.Timestamp", True),   # True = descending
        ("B.dateTime", True)
    ],
    how="inner",
)

# Execute and get result (0 or 1 row)
result = q.collect()
```

#### YAML DSL Mapping

The YAML configuration maps directly to this query builder:

```yaml
matching_rules:
  # Maps to join_pairs
  join:
    - left: source_a.trxnId
      right: source_b.transactionId
    - left: source_a.amount
      right: source_b.amount

  # Maps to conditions
  rules:
    - name: status_match
      severity: error
      left: source_a.Status
      operator: "="
      right: source_b.Status

    - name: remarks_match
      severity: error
      left: source_a.Remarks
      operator: "="
      right: source_b.Desc

  # Maps to order_by
  ordering:
    - field: source_a.Timestamp
      direction: desc
    - field: source_b.dateTime
      direction: desc

  # one_to_one mode; enforce uniqueness via duplicate_handling
  mode: one_to_one
```

#### Query Builder Features

| Feature | Description | User Configurable |
|---------|-------------|-------------------|
| **Join Keys** | 1 or more column pairs for joining | ✅ Yes |
| **Conditions** | 0 or more comparison conditions (ANDed) | ✅ Yes |
| **Operators** | `==`, `!=`, `<`, `<=`, `>`, `>=` | ✅ Yes |
| **Column vs Literal** | Conditions can compare columns or literals | ✅ Yes |
| **Order By** | 0 or more columns with asc/desc | ✅ Yes |
| **Limit** | Not applied globally; one_to_one enforced via uniqueness checks/duplicate_handling | ❌ Fixed |
| **Join Type** | inner, left, right, outer | ✅ Yes |

#### Column Reference vs Literal Value Parsing

**Parsing Rule:** Strings matching pattern `(source_a|source_b|A|B).<column_name>` are interpreted as column references. All other values are literals.

**Ambiguity Problem:** A literal string like `"A.B Corporation"` would be incorrectly parsed as column reference `A.B` in source A.

**Solution:** Use the `literal:` wrapper to force literal interpretation:

```yaml
rules:
  # Column reference (compares source_a.vendor to source_b.vendor)
  - name: vendor_match
    left: source_a.vendor
    operator: "="
    right: source_b.vendor

  # Literal string (compares source_a.company to the string "A.B Corp")
  - name: company_check
    left: source_a.company
    operator: "="
    right:
      literal: "A.B Corp"  # Forces literal interpretation

  # Literal number
  - name: amount_threshold
    left: source_a.amount
    operator: ">"
    right: 1000  # Numbers are always literals

  # Literal with quotes (alternative syntax in expressions)
  - name: status_check
    expression: "pl.col('source_a.status') == pl.lit('A.PENDING')"
```

#### Extended Operators (Polars Expressions)

For complex conditions, users can provide Polars expressions directly:

```python
# Extended operators for tolerance matching
_EXTENDED_OPS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "<":  lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">":  lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "tolerance": lambda a, b, t: (a - b).abs() <= t,
    "contains": lambda a, b: a.str.contains(b),
    "starts_with": lambda a, b: a.str.starts_with(b),
    "ends_with": lambda a, b: a.str.ends_with(b),
    "is_in": lambda a, values: a.is_in(values),
}

# Example: Amount tolerance condition
conditions = [
    ("A.amount", "tolerance", "B.amount", 0.01),  # Within 0.01
    ("A.currency", "==", "B.currency"),
]
```

#### Performance Characteristics

- **Lazy Evaluation**: Query plan is optimized before execution
- **Predicate Pushdown**: Filters pushed to scan level when possible
- **Parallel Execution**: Polars automatically parallelizes operations
- **Memory Efficient**: Streaming execution for large datasets
- **Zero Copy**: Column operations avoid unnecessary data copies

### 7.4 Deployment Architecture

**Kubernetes-Native Deployment**:
- Spring Boot server as Deployment (replicated for HA)
- PostgreSQL as StatefulSet (single source of truth)
- Python reconciliation jobs as Kubernetes Jobs (ephemeral)
- Redis for caching (optional)
- S3/MinIO for large file storage

**Spring Boot Server Scaling**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reconciliation-api
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: reconciliation-api:latest
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
```

**Python Job Template**:
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: recon-job-${job_id}
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 600  # 10 minute timeout
  template:
    spec:
      containers:
      - name: polars-engine
        image: reconciliation-engine:latest
        resources:
          requests:
            memory: "2Gi"
            cpu: "2"
          limits:
            memory: "4Gi"
            cpu: "4"
        env:
        - name: JOB_ID
          value: "${job_id}"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
      restartPolicy: Never
```

### 7.5 Database Schema (PostgreSQL - Single Source of Truth)

#### 7.5.1 Schema Storage Strategy

**Decision:** Store dynamic schemas as **JSONB** in PostgreSQL with:
- Full schema flexibility (no rigid table structure)
- JSON Schema validation at application layer
- JSONB indexing for queryable fields
- Version history for audit trail

**Why JSONB over Normalized Tables:**

| Aspect | JSONB Approach | Normalized Tables |
|--------|---------------|-------------------|
| Flexibility | ✅ Any schema structure | ❌ Requires migrations |
| Versioning | ✅ Store complete snapshots | ❌ Complex change tracking |
| Querying | ✅ JSONB operators + GIN indexes | ✅ Native SQL |
| Validation | Application layer (JSON Schema) | Database constraints |
| Complexity | ✅ Simple | ❌ Many join tables |

#### 7.5.2 Core Tables

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════
-- TENANTS (outside RLS - managed by system)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'active',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- DATA SOURCES - Airbyte staging references (not direct connections)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'staged',  -- 'staged' (Airbyte), 'inline' (for testing)

    -- Airbyte references (managed in Airbyte, not here)
    airbyte_workspace_id VARCHAR(255),     -- For multi-tenant isolation
    airbyte_connection_id VARCHAR(255),    -- Specific connection within workspace

    -- S3 Staging configuration
    staging_config JSONB NOT NULL,
    /*
    Example staging_config JSONB:
    {
        "bucket": "recon-staging",
        "path_template": "{tenant_id}/{source_name}/{stream_name}/{sync_id}/",
        "format": "parquet",
        "freshness": {
            "max_age_hours": 24,
            "require_sync_complete": true
        }
    }
    Note: sync_id is resolved from airbyte_sync_history at runtime
    */

    -- Format config (CSV parsing options if format is CSV)
    format_config JSONB,

    -- Metadata
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,      -- From Airbyte sync status
    last_sync_status VARCHAR(50),  -- 'succeeded', 'failed', 'running'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255),

    UNIQUE(tenant_id, name)
);

-- ═══════════════════════════════════════════════════════════════════
-- AIRBYTE SYNC TRACKING - Monitor data freshness
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE airbyte_sync_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    airbyte_job_id VARCHAR(255) NOT NULL,

    status VARCHAR(50) NOT NULL,  -- 'running', 'succeeded', 'failed', 'cancelled'
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    records_synced BIGINT,
    bytes_synced BIGINT,

    -- S3 output location for this sync
    output_path TEXT,

    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- SCHEMAS - Dynamic field mapping definitions (JSONB)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    description TEXT,

    -- ┌─────────────────────────────────────────────────────────────┐
    -- │ FIELD MAPPINGS STORED AS JSONB                              │
    -- │ Structure matches YAML schema definition                    │
    -- └─────────────────────────────────────────────────────────────┘
    fields JSONB NOT NULL,
    /*
    Example fields JSONB:
    [
        {
            "source": "txn_ref",
            "target": "transaction_id",
            "type": "string",
            "required": true
        },
        {
            "source": "amount_cents",
            "target": "amount",
            "type": "decimal",
            "precision": 19,
            "scale": 4,
            "transform": "pl.col('amount_cents') / 100"
        },
        {
            "source": "status_code",
            "target": "status",
            "type": "string",
            "transform": "pl.when(pl.col('status_code') == 'SUCCESS').then(pl.lit('COMPLETED')).otherwise(pl.lit('PENDING'))"
        },
        {
            "target": "net_amount",
            "type": "decimal",
            "derived": true,
            "transform": "pl.col('amount') - pl.col('fee')"
        }
    ]
    */

    -- Validation rules
    validations JSONB,
    /*
    Example validations JSONB:
    [
        {"field": "amount", "min": 0.01, "max": 10000000},
        {"field": "currency", "enum": ["BDT", "USD", "EUR"]},
        {"field": "transaction_id", "pattern": "^[A-Z0-9]{8,30}$", "unique": true}
    ]
    */

    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255),

    UNIQUE(tenant_id, name, version)
);

-- ═══════════════════════════════════════════════════════════════════
-- MATCHING RULES - Join conditions and rule definitions (JSONB)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE matching_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    description TEXT,

    -- ┌─────────────────────────────────────────────────────────────┐
    -- │ JOIN CONDITIONS                                             │
    -- └─────────────────────────────────────────────────────────────┘
    join_conditions JSONB NOT NULL,
    /*
    Example join_conditions JSONB:
    [
        {"left": "transaction_id", "right": "transaction_id"},
        {"left": "amount", "right": "amount"}
    ]
    */

    -- ┌─────────────────────────────────────────────────────────────┐
    -- │ MATCHING RULES                                              │
    -- └─────────────────────────────────────────────────────────────┘
    rules JSONB NOT NULL,
    /*
    Example rules JSONB:
    [
        {
            "name": "currency_match",
            "severity": "error",
            "left": "source_a.currency",
            "operator": "=",
            "right": "source_b.currency"
        },
        {
            "name": "amount_tolerance",
            "severity": "error",
            "expression": "(pl.col('source_a.amount') - pl.col('source_b.amount')).abs() <= 0.01"
        },
        {
            "name": "status_check",
            "severity": "warning",
            "operator": "OR",
            "operands": [
                {"left": "source_a.status", "operator": "=", "right": "source_b.status"},
                {"left": "source_a.status", "operator": "=", "right": "'PENDING'"}
            ]
        }
    ]
    */

    -- Ordering for tie-breaking
    ordering JSONB,
    /*
    Example ordering JSONB:
    [
        {"field": "source_a.timestamp", "direction": "desc"},
        {"field": "source_b.created_at", "direction": "desc"}
    ]
    */

    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255),

    UNIQUE(tenant_id, name, version)
);

-- ═══════════════════════════════════════════════════════════════════
-- RECONCILIATIONS - Complete job configuration
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE reconciliations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    description TEXT,

    -- Mode configuration
    mode VARCHAR(50) NOT NULL DEFAULT 'one_to_one',

    -- Source A configuration (references staged data, not direct connections)
    source_a_datasource_id UUID REFERENCES data_sources(id),
    source_a_schema_id UUID REFERENCES schemas(id),
    -- Note: No query_template - data comes from Airbyte staging, not direct DB queries

    -- Source B configuration
    source_b_datasource_id UUID REFERENCES data_sources(id),
    source_b_schema_id UUID REFERENCES schemas(id),

    -- Matching rules reference
    matching_rules_id UUID REFERENCES matching_rules(id),

    -- OR: Inline full config as JSONB (for self-contained configs)
    full_config JSONB,
    /*
    Alternative: Store entire YAML config as JSONB
    This allows complete flexibility and versioning
    */

    -- Output configuration
    output_config JSONB,
    /*
    Example output_config JSONB:
    {
        "matched": {
            "store": true,
            "export": {"format": "csv", "path": "s3://bucket/{run_id}/matched.csv"},
            "queries": [
                {"name": "perfect_matches", "rules_passed": ["currency_match", "amount_tolerance"]}
            ]
        },
        "unmatched_left": {"store": true, "export": {"format": "csv"}},
        "unmatched_right": {"store": true, "export": {"format": "csv"}}
    }
    */

    -- Reconciliation unit
    recon_unit_interval VARCHAR(50) DEFAULT 'day',
    recon_unit_timezone VARCHAR(50) DEFAULT 'UTC',

    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255),

    UNIQUE(tenant_id, name, version)
);

-- ═══════════════════════════════════════════════════════════════════
-- RECONCILIATION RUNS - Job execution records
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    reconciliation_id UUID NOT NULL REFERENCES reconciliations(id),

    -- Snapshot of config at run time (immutable)
    config_snapshot JSONB NOT NULL,

    -- Time range
    recon_start TIMESTAMPTZ NOT NULL,
    recon_end TIMESTAMPTZ NOT NULL,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    k8s_job_name VARCHAR(255),

    -- Timing
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,

    -- Statistics
    source_a_count INTEGER,
    source_b_count INTEGER,
    matched_count INTEGER,
    unmatched_left_count INTEGER,
    unmatched_right_count INTEGER,

    -- Rule statistics
    rule_stats JSONB,
    /*
    Example rule_stats JSONB:
    {
        "currency_match": {"passed": 9950, "failed": 50, "pass_rate": 0.995},
        "amount_tolerance": {"passed": 9800, "failed": 200, "avg_diff": 0.02}
    }
    */

    -- Error handling
    error_message TEXT,
    error_details JSONB,

    -- Output paths
    output_paths JSONB,
    /*
    Example output_paths JSONB:
    {
        "matched": "s3://bucket/runs/uuid/matched.csv",
        "unmatched_left": "s3://bucket/runs/uuid/unmatched_left.csv",
        "unmatched_right": "s3://bucket/runs/uuid/unmatched_right.csv"
    }
    */

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- MATCH RESULTS - Individual match records (partitioned)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE match_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES reconciliation_runs(id),
    tenant_id UUID NOT NULL,

    -- Category
    category VARCHAR(50) NOT NULL,  -- 'matched', 'unmatched_left', 'unmatched_right'

    -- Source data (complete records)
    source_a_data JSONB,
    source_b_data JSONB,

    -- Rule evaluation results
    rules_passed TEXT[],
    rules_failed TEXT[],

    -- Detailed explanation
    explanation JSONB,
    /*
    Example explanation JSONB:
    {
        "summary": "Matched with 1 warning",
        "rules": [
            {"name": "currency_match", "passed": true, "left_value": "BDT", "right_value": "BDT"},
            {"name": "amount_tolerance", "passed": true, "left_value": 100.50, "right_value": 100.49, "diff": 0.01},
            {"name": "status_check", "passed": false, "left_value": "COMPLETED", "right_value": "PENDING"}
        ]
    }
    */

    created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY LIST (tenant_id);

-- PARTITION MANAGEMENT STRATEGY:
-- LIST partitioning by tenant_id requires explicit partition creation per tenant.
-- For systems with many tenants (100+), consider:
--   1. Use RANGE partitioning on created_at (time-based) with RLS on tenant_id
--   2. Use default partition to catch new tenants, then migrate to dedicated partitions
--   3. Implement automated partition creation in tenant onboarding workflow
--
-- Example: Create partition for new tenant
-- CREATE TABLE match_results_tenant_abc123 PARTITION OF match_results
--   FOR VALUES IN ('abc123-uuid');
--
-- For scaling beyond ~100 tenants:
--   - Consider HASH partitioning for more even distribution
--   - Or abandon partitioning in favor of proper indexes + RLS

-- ═══════════════════════════════════════════════════════════════════
-- SCHEMA VERSION HISTORY - For audit trail
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE schema_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schema_id UUID NOT NULL REFERENCES schemas(id),
    version INTEGER NOT NULL,
    fields JSONB NOT NULL,
    validations JSONB,
    change_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255),

    UNIQUE(schema_id, version)
);
```

#### 7.5.3 JSONB Indexes for Query Performance

```sql
-- GIN indexes for JSONB querying
CREATE INDEX idx_schemas_fields_gin ON schemas USING GIN (fields);
CREATE INDEX idx_matching_rules_gin ON matching_rules USING GIN (rules);
CREATE INDEX idx_reconciliations_config_gin ON reconciliations USING GIN (full_config);

-- Functional indexes for common queries
CREATE INDEX idx_schemas_field_targets ON schemas
    USING GIN ((fields -> 'target'));

-- Expression index for finding schemas with specific field types
CREATE INDEX idx_schemas_field_types ON schemas
    USING GIN (
        (SELECT jsonb_agg(f->>'type') FROM jsonb_array_elements(fields) f)
    );

-- Index for querying by source field names
CREATE INDEX idx_schemas_source_fields ON schemas
    USING GIN (
        (SELECT jsonb_agg(f->>'source') FROM jsonb_array_elements(fields) f WHERE f->>'source' IS NOT NULL)
    );
```

#### 7.5.4 Row Level Security

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE matching_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;

-- Create isolation policies
CREATE POLICY tenant_isolation ON data_sources
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON schemas
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON matching_rules
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON reconciliations
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON reconciliation_runs
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON match_results
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

#### 7.5.5 JSONB Query Examples

```sql
-- Find all schemas with a 'transaction_id' target field
SELECT * FROM schemas
WHERE fields @> '[{"target": "transaction_id"}]';

-- Find schemas with decimal fields having precision > 10
SELECT * FROM schemas
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(fields) f
    WHERE f->>'type' = 'decimal'
    AND (f->>'precision')::int > 10
);

-- Find matching rules with tolerance-based expressions
SELECT * FROM matching_rules
WHERE rules::text LIKE '%tolerance%';

-- Get all field mappings for a schema as a table
SELECT
    s.name as schema_name,
    f->>'source' as source_field,
    f->>'target' as target_field,
    f->>'type' as field_type,
    f->>'transform' as transform_expression
FROM schemas s,
     jsonb_array_elements(s.fields) f
WHERE s.id = 'schema-uuid';

-- Find schemas where a specific source field is used
SELECT * FROM schemas
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(fields) f
    WHERE f->>'source' = 'amount_cents'
);
```

#### 7.5.6 Application Layer: YAML ↔ JSONB Conversion

```python
import yaml
import json
from dataclasses import dataclass, asdict
from typing import Any

@dataclass
class FieldMapping:
    target: str
    type: str
    source: str | None = None
    sources: list[str] | None = None
    transform: str | None = None
    format: str | None = None
    formats: list[str] | None = None
    precision: int | None = None
    scale: int | None = None
    required: bool = False
    derived: bool = False
    coalesce: bool = False
    default: Any = None

@dataclass
class SchemaConfig:
    fields: list[FieldMapping]
    validations: list[dict] | None = None

class SchemaService:
    """Service for managing schema configurations in PostgreSQL."""

    def yaml_to_jsonb(self, yaml_content: str) -> dict:
        """Convert YAML schema definition to JSONB-ready dict."""
        parsed = yaml.safe_load(yaml_content)
        # Validate against JSON Schema here
        self._validate_schema(parsed)
        return parsed

    def jsonb_to_yaml(self, jsonb_data: dict) -> str:
        """Convert JSONB schema back to YAML for display/export."""
        return yaml.dump(jsonb_data, default_flow_style=False, sort_keys=False)

    def save_schema(self, tenant_id: str, name: str, yaml_content: str) -> str:
        """Save or update a schema, creating new version if exists."""
        jsonb_data = self.yaml_to_jsonb(yaml_content)

        # Check for existing schema
        existing = self.db.execute("""
            SELECT id, version FROM schemas
            WHERE tenant_id = %s AND name = %s AND is_active = true
            ORDER BY version DESC LIMIT 1
        """, (tenant_id, name)).fetchone()

        if existing:
            new_version = existing['version'] + 1
            # Archive old version
            self.db.execute("""
                INSERT INTO schema_versions (schema_id, version, fields, validations, created_by)
                SELECT id, version, fields, validations, %s
                FROM schemas WHERE id = %s
            """, (current_user, existing['id']))
        else:
            new_version = 1

        # Insert/update schema
        schema_id = self.db.execute("""
            INSERT INTO schemas (tenant_id, name, version, fields, validations, created_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, name, version)
            DO UPDATE SET fields = EXCLUDED.fields,
                          validations = EXCLUDED.validations,
                          updated_at = NOW()
            RETURNING id
        """, (
            tenant_id,
            name,
            new_version,
            json.dumps(jsonb_data.get('fields', [])),
            json.dumps(jsonb_data.get('validations', [])),
            current_user
        )).fetchone()['id']

        return schema_id

    def get_schema_for_polars(self, schema_id: str) -> list[FieldMapping]:
        """Load schema from DB and convert to FieldMapping objects."""
        row = self.db.execute("""
            SELECT fields, validations FROM schemas WHERE id = %s
        """, (schema_id,)).fetchone()

        return [FieldMapping(**f) for f in row['fields']]

    def _validate_schema(self, schema_dict: dict) -> None:
        """Validate schema against JSON Schema definition."""
        from jsonschema import validate, ValidationError

        SCHEMA_JSON_SCHEMA = {
            "type": "object",
            "properties": {
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["target", "type"],
                        "properties": {
                            "source": {"type": "string"},
                            "target": {"type": "string"},
                            "type": {"enum": ["string", "integer", "decimal", "boolean", "date", "timestamp"]},
                            "transform": {"type": "string"},
                            "required": {"type": "boolean"},
                            "derived": {"type": "boolean"}
                        }
                    }
                }
            },
            "required": ["fields"]
        }

        validate(instance=schema_dict, schema=SCHEMA_JSON_SCHEMA)
```

#### 7.5.7 Spring Boot Entity Mapping

```java
@Entity
@Table(name = "schemas")
public class Schema {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Integer version;

    // JSONB columns mapped with Hibernate Types
    @Type(JsonBinaryType.class)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<FieldMappingDto> fields;

    @Type(JsonBinaryType.class)
    @Column(columnDefinition = "jsonb")
    private List<ValidationRuleDto> validations;

    // ... timestamps, etc.
}

@Data
public class FieldMappingDto {
    private String source;
    private String target;
    private String type;
    private String transform;
    private Integer precision;
    private Integer scale;
    private Boolean required;
    private Boolean derived;
    private Boolean coalesce;
    private List<String> sources;
    private List<String> formats;
    private Object defaultValue;
}
```

### 7.6 API Endpoints

#### 7.6.1 RESTful API Design

```yaml
# Authentication
POST   /auth/login              # OAuth2 login
POST   /auth/refresh            # Refresh token
POST   /auth/logout             # Logout

# Data Sources
GET    /api/v1/data-sources              # List all
POST   /api/v1/data-sources              # Create
GET    /api/v1/data-sources/{id}         # Get details
PUT    /api/v1/data-sources/{id}         # Update
DELETE /api/v1/data-sources/{id}         # Delete
POST   /api/v1/data-sources/{id}/test    # Test connection
POST   /api/v1/data-sources/{id}/preview # Preview data (first 100 rows)

# Reconciliations
GET    /api/v1/reconciliations           # List all
POST   /api/v1/reconciliations           # Create
GET    /api/v1/reconciliations/{id}      # Get details
PUT    /api/v1/reconciliations/{id}      # Update (creates new version)
DELETE /api/v1/reconciliations/{id}      # Delete
POST   /api/v1/reconciliations/{id}/validate  # Validate config
POST   /api/v1/reconciliations/{id}/dry-run   # Test run without saving

# Jobs
GET    /api/v1/jobs                      # List jobs
POST   /api/v1/jobs                      # Submit new job
GET    /api/v1/jobs/{id}                 # Get job status
DELETE /api/v1/jobs/{id}                 # Cancel job

# Results
GET    /api/v1/jobs/{id}/results         # Get results summary
GET    /api/v1/jobs/{id}/matched         # Query matched records
GET    /api/v1/jobs/{id}/unmatched-left  # Query unmatched left
GET    /api/v1/jobs/{id}/unmatched-right # Query unmatched right
GET    /api/v1/jobs/{id}/stats           # Rule statistics
GET    /api/v1/jobs/{id}/explain/{record_id}  # Explain single match
POST   /api/v1/jobs/{id}/export          # Export to CSV
```

#### 7.6.2 Request/Response Examples

**Submit Job:**
```json
POST /api/v1/jobs
{
  "reconciliation_id": "uuid-...",
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
  "job_id": "uuid-...",
  "status": "pending",
  "estimated_duration_seconds": 45,
  "queue_position": 0
}
```

**Query Results with Filters:**
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
      "amount_b": 99.49,
      "rule_amount_tolerance_passed": false,
      "rule_currency_match_passed": true,
      "amount_diff": 1.01
    }
  ]
}
```

### 7.7 Monitoring & Observability

#### 7.7.1 Key Metrics

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| `reconhub_job_duration_seconds` | Histogram | p99 > 60s |
| `reconhub_job_memory_bytes` | Gauge | > 1.8GB |
| `reconhub_jobs_pending` | Gauge | > 50 |
| `reconhub_jobs_failed_total` | Counter | > 5/hour |
| `reconhub_api_latency_seconds` | Histogram | p99 > 500ms |
| `reconhub_db_connections_active` | Gauge | > 80% of pool |

#### 7.7.2 Prometheus Alerts

```yaml
groups:
  - name: reconhub
    rules:
      - alert: HighJobFailureRate
        expr: rate(reconhub_jobs_failed_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High job failure rate detected"

      - alert: JobQueueBacklog
        expr: reconhub_jobs_pending > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Job queue backlog growing"

      - alert: SlowReconciliation
        expr: histogram_quantile(0.99, reconhub_job_duration_seconds_bucket) > 120
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Reconciliation jobs taking too long"
```

---

## 8. DSL Specification

### 8.1 Design Principles

| Principle | Description |
|-----------|-------------|
| **Declarative** | Describe what to reconcile, not how |
| **Composable** | Build complex configs from simple components |
| **Versioned** | All configurations versioned for reproducibility |
| **Validated** | Early error detection before execution |

### 8.2 Version 2.0 Key Simplifications

| Aspect | Decision |
|--------|----------|
| **Data Ingestion** | Airbyte (S3 staging, no custom connectors) |
| **API Server** | Spring Boot (Java 21) with PostgreSQL |
| **Job Execution** | Kubernetes Jobs with Python + Polars |
| **Database** | PostgreSQL only (single source of truth) |
| **Matching Mode** | One-to-one only (one-to-many is TODO) |
| **Export Format** | CSV only (removed Parquet, XLSX) |
| **Timestamps** | UTC only |
| **Transformations** | Polars expressions (no embedded scripting) |
| **Matching Pattern** | JOIN + WHERE with Polars expressions |

### 8.3 Complete Example

```yaml
version: 2.0

reconciliation:
  name: daily_payment_reconciliation
  description: Daily payment gateway reconciliation
  version: 1

  reconciliation_unit:
    interval: day
    timezone: UTC

  mode: one_to_one

  # Optional: Trigger Airbyte sync before reconciliation
  pre_sync:
    enabled: true
    sources:
      - airbyte_connection_id: "conn-internal-ledger"
      - airbyte_connection_id: "conn-payment-gateway"
    wait_for_completion: true
    timeout_minutes: 30

  source_a:
    # Data is staged by Airbyte in S3 (no direct DB connection here)
    datasource:
      type: staged
      name: internal_ledger  # References data_sources table
    staging:
      bucket: recon-staging
      # Path uses sync_id from latest successful airbyte_sync_history entry
      path_template: "{tenant_id}/internal_ledger/{stream_name}/{sync_id}/"
      format: parquet
      freshness:
        max_age_hours: 24
        require_sync_complete: true  # Validate via airbyte_sync_history
    schema:
      fields:
        - name: transaction_id
          type: string
          source: transaction_id
        - name: amount
          type: decimal
          precision: 19
          scale: 4
          source: amount
        - name: currency
          type: string
          source: currency
        - name: status
          type: string
          source: status
          transform: |
            pl.when(pl.col('status') == 'COMPLETED')
              .then(pl.lit('SUCCESS'))
              .otherwise(pl.lit('PENDING'))

  source_b:
    # Data is staged by Airbyte in S3 (no direct API connection here)
    datasource:
      type: staged
      name: payment_gateway  # References data_sources table
    staging:
      bucket: recon-staging
      path_template: "{tenant_id}/payment_gateway/{stream_name}/{sync_id}/"
      format: parquet
      freshness:
        max_age_hours: 24
        require_sync_complete: true
    schema:
      fields:
        - name: transaction_id
          type: string
          source: txn_id
        - name: amount
          type: decimal
          source: gross_amount
          transform: "pl.col('gross_amount').cast(pl.Decimal(19, 4))"
        - name: currency
          type: string
          source: currency
        - name: status
          type: string
          source: txn_status
          transform: |
            pl.when(pl.col('txn_status').str.to_uppercase().is_in(['SUCCESS', 'OK']))
              .then(pl.lit('SUCCESS'))
              .otherwise(pl.lit('PENDING'))

  matching_rules:
    join:
      - left: source_a.transaction_id
        right: source_b.transaction_id

    rules:
      - name: currency_match
        severity: error
        left: source_a.currency
        operator: "="
        right: source_b.currency

      - name: amount_tolerance
        severity: error
        expression: "(pl.col('source_a.amount') - pl.col('source_b.amount')).abs() <= 0.01"

      - name: status_check
        severity: warning
        left: source_a.status
        operator: "="
        right: source_b.status

  outputs:
    matched:
      store: true  # Store in PostgreSQL
      export:
        format: csv
        path: s3://results/{run_id}/matched.csv
      queries:
        - name: perfect_matches
          rules_passed: [currency_match, amount_tolerance, status_check]
        - name: status_warnings
          rules_passed: [currency_match, amount_tolerance]
          rules_failed: [status_check]

    unmatched_left:
      store: true
      export:
        format: csv
        path: s3://results/{run_id}/unmatched_ledger.csv

    unmatched_right:
      store: true
      export:
        format: csv
        path: s3://results/{run_id}/unmatched_gateway.csv
```

---

## 9. Use Cases

### 9.1 Payment Gateway Reconciliation

**Business Need**: Match internal payment records with gateway settlement reports.

**Key Challenges**:
- Gateway may round amounts differently
- Timestamps may differ slightly
- Fee calculations may vary

**Configuration**:
```yaml
matching_rules:
  join:
    - left: source_a.transaction_id
      right: source_b.transaction_ref

  rules:
    - name: amount_tolerance
      severity: error
      expression: "(pl.col('source_a.amount') - pl.col('source_b.gross_amount')).abs() <= 0.05"

    - name: currency_match
      severity: error
      left: source_a.currency
      operator: "="
      right: source_b.currency

    - name: fee_validation
      severity: warning
      expression: |
        ((pl.col('source_b.gross_amount') * 0.029 + 0.30) - pl.col('source_b.fee_amount')).abs() <= 0.05
```

### 9.2 Bank Statement Reconciliation

**Business Need**: Match internal ledger entries with bank statement lines.

**Key Challenges**:
- No common transaction ID (must join on date + amount)
- Amounts must match exactly
- Descriptions may vary

**Configuration**:
```yaml
matching_rules:
  # Composite key join (no common ID)
  join:
    - left: source_a.transaction_date
      right: source_b.value_date
    - left: source_a.amount
      right: source_b.amount

  rules:
    - name: currency_match
      severity: error
      left: source_a.currency
      operator: "="
      right: source_b.currency

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

### 9.3 Card Network Reconciliation

**Business Need**: Match issuer transactions with Visa/Mastercard files.

**Configuration**:
```yaml
matching_rules:
  # Multi-column join with hashed PAN
  join:
    - left: hash(source_a.card_number)
      right: hash(source_b.pan)
    - left: source_a.transaction_date
      right: source_b.transaction_date

  rules:
    - name: amount_tolerance
      severity: error
      expression: "(pl.col('source_a.amount') - pl.col('source_b.transaction_amount')).abs() <= 0.01"

    - name: interchange_fee_validation
      severity: warning
      expression: |
        (pl.when(pl.col('source_b.card_type') == 'CREDIT')
           .then(pl.col('source_b.transaction_amount') * 0.0175)
           .when(pl.col('source_b.card_type') == 'DEBIT')
           .then((pl.col('source_b.transaction_amount') * 0.0050).clip(upper_bound=0.21))
           .otherwise(pl.lit(0.0))
         - pl.col('source_b.interchange_fee')).abs() <= 0.02
```

### 9.4 Trade Settlement Reconciliation

**Business Need**: Match executed trades with clearinghouse confirmations.

**Configuration**:
```yaml
matching_rules:
  join:
    - left: source_a.trade_id
      right: source_b.trade_ref

  rules:
    - name: exact_quantity_match
      severity: error
      left: source_a.quantity
      operator: "="
      right: source_b.quantity

    - name: price_tolerance
      severity: error
      expression: |
        (pl.col('source_a.price') - pl.col('source_b.price')).abs() <= (pl.col('source_a.price') * 0.0001)

    - name: settlement_date_window
      severity: warning
      expression: |
        (pl.col('source_b.settlement_date') - pl.col('source_a.trade_date'))
          .dt.total_days()
          .is_between(0, 3)
```

**Note**: Business day calculation requires a custom Python function in the Polars job that accounts for market holidays.

---

## 10. Testing Strategy

### 10.1 Test Pyramid

```
                    ┌─────────────────┐
                    │   E2E Tests     │  5%
                    │  (Playwright)   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │      Integration Tests       │  25%
              │   (pytest + testcontainers)  │
              └──────────────┬───────────────┘
                             │
       ┌─────────────────────┴─────────────────────┐
       │              Unit Tests                    │  70%
       │             (pytest + hypothesis)         │
       └───────────────────────────────────────────┘
```

### 10.2 Test Categories

#### Unit Tests
- Schema normalization transformations
- Rule expression generation
- Type conversion functions
- YAML parsing and validation

#### Integration Tests
- S3 staging reader with LocalStack/MinIO
- Airbyte sync status validation with mock airbyte_sync_history
- Data freshness validation (stale data, missing sync, failed sync)
- Full reconciliation flow with staged Parquet data
- Airbyte API integration (sync trigger, status polling)

#### Performance Tests
- 1M×1M benchmark (must pass < 1s)
- Memory usage validation (< 2GB)
- Concurrent job handling

#### Security Tests
- RLS tenant isolation verification
- JWT validation edge cases
- SQL injection prevention

### 10.3 Test Data Generators

```python
import polars as pl
import pytest
from hypothesis import given, strategies as st

@pytest.fixture
def sample_transactions(n: int = 1000):
    """Generate realistic transaction data."""
    import random
    return pl.DataFrame({
        "txn_id": [f"TXN{i:010d}" for i in range(n)],
        "amount": [round(random.uniform(10, 100000), 2) for _ in range(n)],
        "currency": random.choices(["BDT", "USD", "EUR"], k=n),
        "status": random.choices(["COMPLETED", "PENDING", "FAILED"], k=n),
        "timestamp": pl.date_range(
            datetime(2024, 3, 15), datetime(2024, 3, 16), n, eager=True
        ),
    })

@given(
    amount_a=st.floats(min_value=0.01, max_value=1e10),
    amount_b=st.floats(min_value=0.01, max_value=1e10),
    tolerance=st.floats(min_value=0.001, max_value=1.0),
)
def test_tolerance_rule_symmetry(amount_a, amount_b, tolerance):
    """Tolerance check should be symmetric."""
    result_ab = abs(amount_a - amount_b) <= tolerance
    result_ba = abs(amount_b - amount_a) <= tolerance
    assert result_ab == result_ba
```

---

## 11. Risk Analysis

### 11.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Polars performance regression | Low | High | Pin version, benchmark in CI |
| Memory exhaustion on large jobs | Medium | High | Streaming mode, chunk processing |
| Database connection exhaustion | Medium | Medium | Connection pooling, limits |
| S3 availability issues | Low | Medium | Retry with backoff, fallback to local |
| Kubernetes job scheduling delays | Medium | Medium | Priority classes, resource quotas |

### 11.2 Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Secret exposure in logs | Low | Critical | Structured logging, redaction |
| Tenant data leak | Low | Critical | RLS + testing, audit logging |
| Job stuck forever | Medium | Medium | Timeout enforcement, dead letter queue |
| Disk space exhaustion | Medium | Medium | Retention policies, monitoring |
| Configuration drift | Medium | Medium | GitOps, config versioning |

### 11.3 Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Performance degradation at scale | Medium | High | Load testing, capacity planning |
| Feature creep delaying MVP | High | Medium | Strict phase boundaries |
| Integration complexity | Medium | Medium | Standard protocols, good docs |
| Regulatory non-compliance | Low | High | SOC 2, GDPR controls from start |

---

## 12. Gap Analysis & Future Roadmap

### 12.1 Critical Gaps (Phase 1)

| Gap | Priority | Description |
|-----|----------|-------------|
| Scheduled Reconciliation | HIGH | Auto-run on cron schedule |
| Fuzzy String Matching | HIGH | Match similar merchant names |
| Duplicate Detection | HIGH | Detect duplicates within sources |
| Configuration Wizard | HIGH | Guided setup for non-technical users |
| Data Preview | HIGH | Preview data before configuration |
| Rule Testing Sandbox | HIGH | Test rules on sample data |
| Email Notifications | HIGH | Alert on completion/failure |
| Dry Run Mode | HIGH | Test configurations without storing |
| Cloud Storage (S3, Azure) | HIGH | Modern data storage support |

### 12.2 Important Gaps (Phase 2)

| Gap | Priority | Description |
|-----|----------|-------------|
| Excel File Support | MEDIUM | Direct .xlsx parsing |
| XML Format Support | MEDIUM | For legacy banking systems |
| Fixed-Width Format | MEDIUM | For mainframe systems |
| Reconciliation Templates | MEDIUM | Pre-built configurations |
| Exception Assignment | MEDIUM | Assign unmatched for investigation |
| Trend Analysis | MEDIUM | Match rate over time |
| Reconciliation Comparison | MEDIUM | Compare different runs |
| Message Queue (Kafka) | MEDIUM | Near-real-time reconciliation |
| Advanced Lookups | MEDIUM | Lookup tables in transformations |

### 12.3 Nice-to-Have (Phase 3+)

| Gap | Priority | Description |
|-----|----------|-------------|
| ML-Based Matching | LOW | Similarity scoring |
| Visual Workflow Builder | LOW | Drag-and-drop workflows |
| Real-Time Monitoring | LOW | Live progress dashboards |
| Webhook Data Sources | LOW | Event-driven ingestion |
| Advanced Collaboration | LOW | Comments, change requests |
| Distributed Execution | LOW | For massive datasets (100M+) |
| Data Lineage | LOW | Full lineage tracking |

### 12.4 Out of Scope

- Full dispute management workflow (basic exception tracking only)
- Real-time streaming reconciliation (batch/on-demand only)
- Multi-currency and FX rate handling
- Machine learning-based matching suggestions
- External system integrations beyond data fetch (no write-back)
- Payment processing
- Fraud detection

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **Break** | An unmatched or discrepant record requiring investigation |
| **Derived Field** | A calculated field created from existing fields using Polars expressions |
| **Enum Mapping** | Translation of categorical values between systems (e.g., "SUCCESS" → "COMPLETED") |
| **Explainability** | The ability to trace and understand every match decision |
| **Hash Join** | An O(n+m) algorithm for matching records based on key equality |
| **Join Key** | Field(s) used to match records across sources |
| **Kubernetes Job** | Ephemeral container workload for running reconciliation processing |
| **LazyFrame** | Polars lazy evaluation structure for query optimization |
| **Match Group** | The set of rules that passed/failed for a given record pair |
| **One-to-One** | Matching mode where each record matches at most one other record |
| **Patch** | A correction applied to source data for re-reconciliation |
| **Polars** | High-performance DataFrame library for Python, used for data processing |
| **RBAC** | Role-Based Access Control - authorization based on user roles |
| **Recon Unit** | Time period parameters defining the scope of a reconciliation |
| **Reconciliation** | The process of comparing two datasets to identify matches and discrepancies |
| **RLS** | Row Level Security - PostgreSQL feature for tenant data isolation |
| **Rule Match Group** | Set of rules that matched/failed for a given record pair |
| **Schema** | Normalized representation of data structure with type definitions |
| **Single Source of Truth** | PostgreSQL database as the authoritative data store for all configurations and results |
| **Spring Boot** | Java framework for the API server handling job orchestration |
| **Stage** | A single reconciliation operation in a multi-stage workflow |
| **Tenant** | An isolated customer organization in the multi-tenant system |
| **Tolerance** | An acceptable variance in numeric comparisons (e.g., amounts within $0.01) |
| **Workflow** | A DAG (directed acyclic graph) of reconciliation stages |

---

## Appendix A: Field Mapping Reference

### A.1 Complete Field Mapping Options

```yaml
schema:
  fields:
    # ─────────────────────────────────────────────────────────────
    # BASIC: Simple rename
    # ─────────────────────────────────────────────────────────────
    - source: txn_ref           # Column in raw data
      target: transaction_id    # Normalized name
      type: string
      required: true            # Fail if missing

    # ─────────────────────────────────────────────────────────────
    # TYPE CONVERSION: Decimal with precision
    # ─────────────────────────────────────────────────────────────
    - source: amount
      target: amount
      type: decimal
      precision: 19             # Total digits
      scale: 4                  # Digits after decimal

    # ─────────────────────────────────────────────────────────────
    # TRANSFORM: Arithmetic (cents → dollars)
    # ─────────────────────────────────────────────────────────────
    - source: amount_cents
      target: amount
      type: decimal
      transform: "pl.col('amount_cents') / 100"

    # ─────────────────────────────────────────────────────────────
    # ENUM MAPPING: Via Polars when/then/otherwise
    # ─────────────────────────────────────────────────────────────
    - source: status_code
      target: status
      type: string
      transform: |
        pl.when(pl.col('status_code') == 'SUCCESS')
          .then(pl.lit('COMPLETED'))
          .when(pl.col('status_code') == 'FAIL')
          .then(pl.lit('FAILED'))
          .when(pl.col('status_code') == 'PEND')
          .then(pl.lit('PENDING'))
          .otherwise(pl.lit('UNKNOWN'))

    # ─────────────────────────────────────────────────────────────
    # DATE: With explicit format
    # ─────────────────────────────────────────────────────────────
    - source: created_at
      target: timestamp
      type: timestamp
      format: "%Y-%m-%dT%H:%M:%SZ"
      timezone: UTC

    # ─────────────────────────────────────────────────────────────
    # DATE: Multiple formats (try in order)
    # ─────────────────────────────────────────────────────────────
    - source: settle_date
      target: settlement_date
      type: date
      formats:
        - "%Y-%m-%d"
        - "%d/%m/%Y"
        - "%m-%d-%Y"
        - "%Y%m%d"

    # ─────────────────────────────────────────────────────────────
    # DERIVED: Computed from other normalized fields
    # ─────────────────────────────────────────────────────────────
    - target: net_amount
      type: decimal
      derived: true
      transform: "pl.col('amount') - pl.col('fee')"

    - target: fee_rate
      type: decimal
      derived: true
      transform: |
        pl.when(pl.col('amount') > 0)
          .then(pl.col('fee') / pl.col('amount'))
          .otherwise(pl.lit(0.0))

    # ─────────────────────────────────────────────────────────────
    # COALESCE: First non-null from multiple columns
    # ─────────────────────────────────────────────────────────────
    - sources:
        - primary_ref
        - secondary_ref
        - fallback_ref
      target: reference_id
      type: string
      coalesce: true

    # ─────────────────────────────────────────────────────────────
    # STRING EXTRACTION: Last 4 digits
    # ─────────────────────────────────────────────────────────────
    - source: card_number
      target: card_suffix
      type: string
      transform: "pl.col('card_number').str.slice(-4)"

    # ─────────────────────────────────────────────────────────────
    # BOOLEAN: With custom parsing
    # ─────────────────────────────────────────────────────────────
    - source: is_refund
      target: is_refund
      type: boolean
      transform: |
        pl.col('is_refund').str.to_uppercase().is_in(['Y', 'YES', '1', 'TRUE'])

    # ─────────────────────────────────────────────────────────────
    # DEFAULT VALUE: When source is NULL
    # ─────────────────────────────────────────────────────────────
    - source: fee_amount
      target: fee
      type: decimal
      default: 0.0

    # ─────────────────────────────────────────────────────────────
    # CONDITIONAL: Different logic based on value
    # ─────────────────────────────────────────────────────────────
    - source: amount
      target: amount_normalized
      type: decimal
      transform: |
        pl.when(pl.col('currency') == 'JPY')
          .then(pl.col('amount'))  # JPY has no decimals
          .otherwise(pl.col('amount') / 100)  # Other currencies in cents

  # ─────────────────────────────────────────────────────────────
  # VALIDATIONS: Post-normalization checks
  # ─────────────────────────────────────────────────────────────
  validations:
    - field: amount
      rules:
        - min: 0.01
        - max: 10000000

    - field: currency
      rules:
        - enum: [BDT, USD, EUR, GBP, JPY, INR]

    - field: transaction_id
      rules:
        - pattern: "^[A-Z0-9]{8,30}$"
        - unique: true

    - field: timestamp
      rules:
        - not_future: true
        - not_before: "2020-01-01"
```

### A.2 Complete Reconciliation Example (Different Schemas)

```yaml
version: "2.0"

reconciliation:
  name: bkash_partner_bank_daily
  description: Daily reconciliation - bKash API vs Partner Bank DB

  reconciliation_unit:
    interval: day
    timezone: UTC

  mode: one_to_one
  duplicate_handling:
    action: error
    report: true

  # ═══════════════════════════════════════════════════════════════
  # SOURCE A: bKash (staged via Airbyte from bKash API)
  # Raw fields: txn_ref, amount, currency, status, created_at
  # Airbyte connection: source-http-request → destination-s3
  # ═══════════════════════════════════════════════════════════════
  source_a:
    datasource:
      type: staged
      name: bkash_settlements  # References data_sources table
    staging:
      bucket: recon-staging
      path_template: "{tenant_id}/bkash/{stream_name}/{sync_id}/"
      format: parquet
      freshness:
        max_age_hours: 24
        require_sync_complete: true

    schema:
      fields:
        - source: txn_ref
          target: transaction_id
          type: string
          required: true

        - source: amount
          target: amount
          type: decimal
          precision: 19
          scale: 4

        - source: currency
          target: currency
          type: string

        - source: status
          target: status
          type: string
          transform: |
            pl.when(pl.col('status').str.to_uppercase() == 'SUCCESS')
              .then(pl.lit('COMPLETED'))
              .when(pl.col('status').str.to_uppercase() == 'FAILED')
              .then(pl.lit('FAILED'))
              .otherwise(pl.lit('PENDING'))

        - source: created_at
          target: timestamp
          type: timestamp
          format: "%Y-%m-%dT%H:%M:%SZ"

        - source: fee_amount
          target: fee
          type: decimal
          default: 0.0

  # ═══════════════════════════════════════════════════════════════
  # SOURCE B: Partner Bank (staged via Airbyte from PostgreSQL)
  # Raw fields: reference_no, amount_paisa, ccy, settlement_status
  # Airbyte connection: source-postgres → destination-s3
  # COMPLETELY DIFFERENT column names and formats!
  # ═══════════════════════════════════════════════════════════════
  source_b:
    datasource:
      type: staged
      name: partner_bank_settlements  # References data_sources table
    staging:
      bucket: recon-staging
      path_template: "{tenant_id}/partner_bank/{stream_name}/{sync_id}/"
      format: parquet
      freshness:
        max_age_hours: 24
        require_sync_complete: true

    # Source B schema mapping - DIFFERENT raw names, SAME targets
    schema:
      fields:
        - source: reference_no
          target: transaction_id    # Same target as source_a
          type: string
          required: true

        - source: amount_paisa
          target: amount            # Same target, but needs /100
          type: decimal
          transform: "pl.col('amount_paisa') / 100"

        - source: ccy
          target: currency          # Same target
          type: string

        - source: settlement_status
          target: status            # Same target, different enum values
          type: string
          transform: |
            pl.when(pl.col('settlement_status') == 'SETTLED')
              .then(pl.lit('COMPLETED'))
              .when(pl.col('settlement_status') == 'REJECTED')
              .then(pl.lit('FAILED'))
              .otherwise(pl.lit('PENDING'))

        - source: settle_time
          target: timestamp
          type: timestamp

        - source: bank_fee
          target: fee
          type: decimal
          transform: "pl.col('bank_fee') / 100"
          default: 0.0

  # ═══════════════════════════════════════════════════════════════
  # MATCHING RULES: Use TARGET field names (post-normalization)
  # ═══════════════════════════════════════════════════════════════
  matching_rules:
    join:
      - left: transaction_id
        right: transaction_id

    rules:
      - name: currency_match
        severity: error
        left: source_a.currency
        operator: "="
        right: source_b.currency
        description: Currency must match exactly

      - name: amount_tolerance
        severity: error
        expression: "(pl.col('source_a.amount') - pl.col('source_b.amount')).abs() <= 1.0"
        description: Amount must match within 1 BDT tolerance

      - name: fee_tolerance
        severity: warning
        expression: "(pl.col('source_a.fee') - pl.col('source_b.fee')).abs() <= 0.50"
        description: Fee should match within 0.50 BDT

  outputs:
    matched:
      store: true
      export:
        format: csv
        path: /results/{run_id}/matched.csv
      queries:
        - name: perfect_matches
          rules_passed: [currency_match, amount_tolerance, fee_tolerance]
        - name: amount_mismatches
          rules_passed: [currency_match]
          rules_failed: [amount_tolerance]

    unmatched_left:
      store: true
      export:
        format: csv
        path: /results/{run_id}/unmatched_bkash.csv

    unmatched_right:
      store: true
      export:
        format: csv
        path: /results/{run_id}/unmatched_bank.csv
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.3 | 2026-02-01 | Reconciliation Team | Added: Complete Database Schema for dynamic field mappings (Section 7.5), JSONB storage strategy, indexes, YAML↔JSONB conversion |
| 2.2 | 2026-02-01 | Reconciliation Team | Added: Dynamic Query Builder Implementation (Section 7.3.1) with configurable join, conditions, ordering |
| 2.1 | 2026-02-01 | Reconciliation Team | Added: POC validation results, Dynamic Schema System, Edge Cases & Error Handling, API Endpoints, Monitoring & Observability, Testing Strategy, Risk Analysis, Field Mapping Reference Appendix |
| 2.0 | 2026-02-01 | Reconciliation Team | Architecture redesign: Spring Boot + PostgreSQL + Kubernetes + Python/Polars |
| 1.0 | 2026-02-01 | Reconciliation Team | Initial comprehensive specification |

---

## References

1. [Gartner Peer Insights - Financial Reconciliation Solutions](https://www.gartner.com/reviews/market/financial-reconciliation-solutions)
2. [SolveXia - Data Reconciliation Tools Guide](https://www.solvexia.com/blog/data-reconciliation-tools)
3. [AWS - Multi-tenant data isolation with PostgreSQL RLS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
4. [AWS SaaS Lens - Architecture Patterns](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/software-and-architecture-patterns.html)
5. [BlackLine - Transaction Matching](https://www.blackline.com/products/financial-close/transaction-matching/)
6. [HighRadius - AI Transaction Matching](https://www.highradius.com/product/transaction-matching-software/)
