# Data Source Connector (Airbyte Integration)

## 1. Overview

The reconciliation engine uses **Airbyte OSS** as the primary data ingestion layer. Airbyte syncs data from external sources to **S3 as Parquet files**, which Polars reads directly for reconciliation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Data Ingestion Pipeline                               │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                       External Data Sources                            │  │
│  │   Payment    │   Bank    │  Database  │   API    │   Cloud    │   SFTP │  │
│  │   Gateway    │ Statement │  (MySQL)   │  (REST)  │  Storage   │  Files │  │
│  └───────┬──────┴─────┬─────┴─────┬──────┴────┬─────┴─────┬──────┴────┬───┘  │
│          │            │           │           │           │           │      │
│          ▼            ▼           ▼           ▼           ▼           ▼      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Airbyte OSS                                    │  │
│  │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐            │  │
│  │   │   Sources    │    │   Syncs      │    │ Destinations │            │  │
│  │   │ (300+ types) │ →  │ (Scheduled/  │ →  │ (S3 Parquet) │            │  │
│  │   │              │    │  On-demand)  │    │              │            │  │
│  │   └──────────────┘    └──────────────┘    └──────────────┘            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         S3 Storage (Parquet)                           │  │
│  │   s3://bucket/sources/{source_id}/date=YYYY-MM-DD/*.parquet           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                       Polars (Direct Read)                             │  │
│  │   pl.scan_parquet("s3://bucket/sources/{source_id}/*.parquet")        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Architecture

### 2.1 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Airbyte API-driven** | No UI dependency, fully programmable |
| **S3 as destination** | Direct Polars access, columnar format |
| **Parquet format** | Efficient compression, schema preservation |
| **On-demand syncs** | Triggered by Spring Boot before reconciliation |

### 2.2 Data Flow

```
1. CONFIGURATION (Spring Boot)
   User → Dashboard → Spring Boot API → PostgreSQL (data source config)

2. SYNC TRIGGER (Spring Boot → Airbyte API)
   Spring Boot → Airbyte API (POST /connections/{id}/sync)
   Airbyte → External Source → Transform → S3 (Parquet)

3. RECONCILIATION (Polars)
   Polars K8s Job → pl.scan_parquet("s3://...") → Process → Write results

4. MONITORING
   Spring Boot polls Airbyte API for sync status
   Airbyte webhooks (optional) for completion notification
```

## 3. Airbyte API Integration

### 3.1 Spring Boot Airbyte Client

```java
@Service
public class AirbyteService {

    private final WebClient airbyteClient;

    public AirbyteService(@Value("${airbyte.api.url}") String apiUrl) {
        this.airbyteClient = WebClient.builder()
            .baseUrl(apiUrl)
            .defaultHeader("Content-Type", "application/json")
            .build();
    }

    /**
     * Trigger a sync for a connection.
     */
    public Mono<SyncResponse> triggerSync(String connectionId) {
        return airbyteClient.post()
            .uri("/v1/connections/sync")
            .bodyValue(Map.of("connectionId", connectionId))
            .retrieve()
            .bodyToMono(SyncResponse.class);
    }

    /**
     * Get sync job status.
     */
    public Mono<JobStatus> getJobStatus(String jobId) {
        return airbyteClient.get()
            .uri("/v1/jobs/{jobId}", jobId)
            .retrieve()
            .bodyToMono(JobStatus.class);
    }

    /**
     * Create a new source.
     */
    public Mono<Source> createSource(SourceCreate request) {
        return airbyteClient.post()
            .uri("/v1/sources")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(Source.class);
    }

    /**
     * Create a new connection (source → destination).
     */
    public Mono<Connection> createConnection(ConnectionCreate request) {
        return airbyteClient.post()
            .uri("/v1/connections")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(Connection.class);
    }

    /**
     * Get available source definitions (connector catalog).
     */
    public Mono<List<SourceDefinition>> listSourceDefinitions() {
        return airbyteClient.get()
            .uri("/v1/source_definitions")
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<>() {});
    }
}
```

### 3.2 Airbyte API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/sources` | POST | Create a new source |
| `/v1/sources/{id}` | GET | Get source details |
| `/v1/sources/{id}` | PUT | Update source configuration |
| `/v1/connections` | POST | Create source → destination connection |
| `/v1/connections/{id}/sync` | POST | Trigger manual sync |
| `/v1/jobs/{id}` | GET | Get sync job status |
| `/v1/source_definitions` | GET | List available connector types |

### 3.3 Source Configuration

```java
@Data
public class DataSourceConfig {
    private String id;
    private String name;
    private String type;  // "airbyte"
    private AirbyteConfig airbyte;
}

@Data
public class AirbyteConfig {
    private String sourceDefinitionId;  // e.g., "stripe", "postgres"
    private String connectionId;         // Airbyte connection ID
    private Map<String, Object> sourceConfig;  // Connector-specific config
    private String streamName;            // Which stream to sync
    private SyncMode syncMode;            // FULL_REFRESH or INCREMENTAL
}

public enum SyncMode {
    FULL_REFRESH,
    INCREMENTAL
}
```

## 4. S3 Destination Configuration

### 4.1 Airbyte S3 Destination Setup

```json
{
  "destinationDefinitionId": "s3-destination",
  "name": "Reconciliation S3",
  "configuration": {
    "s3_bucket_name": "recon-data",
    "s3_bucket_path": "sources",
    "s3_bucket_region": "us-east-1",
    "format": {
      "format_type": "Parquet",
      "compression_codec": "ZSTD",
      "block_size_mb": 128
    },
    "s3_path_format": "${SOURCE_NAMESPACE}/${STREAM_NAME}/date=${YEAR}-${MONTH}-${DAY}/${PART_NUMBER}.parquet",
    "access_key_id": "${AWS_ACCESS_KEY_ID}",
    "secret_access_key": "${AWS_SECRET_ACCESS_KEY}"
  }
}
```

### 4.2 S3 Bucket Structure

```
s3://recon-data/
└── sources/
    ├── payment_gateway/
    │   ├── transactions/
    │   │   ├── date=2024-03-15/
    │   │   │   ├── 0001.parquet
    │   │   │   └── 0002.parquet
    │   │   └── date=2024-03-16/
    │   │       └── 0001.parquet
    │   └── refunds/
    │       └── date=2024-03-15/
    │           └── 0001.parquet
    ├── bank_statement/
    │   └── transactions/
    │       └── date=2024-03-15/
    │           └── 0001.parquet
    └── internal_ledger/
        └── entries/
            └── date=2024-03-15/
                └── 0001.parquet
```

### 4.3 Parquet File Schema

Airbyte preserves the source schema and adds metadata columns:

```python
# Typical Airbyte output schema
schema = {
    # Source columns
    "transaction_id": pl.Utf8,
    "amount": pl.Float64,
    "currency": pl.Utf8,
    "status": pl.Utf8,
    "created_at": pl.Datetime,

    # Airbyte metadata columns
    "_airbyte_ab_id": pl.Utf8,        # Unique record ID
    "_airbyte_emitted_at": pl.Datetime,  # When Airbyte processed
    "_airbyte_normalized_at": pl.Datetime,
}
```

## 5. Supported Connectors

### 5.1 Fintech-Relevant Connectors

| Category | Connectors |
|----------|------------|
| **Payment Gateways** | Stripe, PayPal, Square, Adyen, Braintree |
| **Banking** | Plaid, Yodlee (via custom), bank-specific APIs |
| **E-commerce** | Shopify, WooCommerce, Magento |
| **Databases** | PostgreSQL, MySQL, MongoDB, SQL Server |
| **Cloud Storage** | S3, GCS, Azure Blob Storage |
| **Files** | SFTP, FTP, Local files |
| **APIs** | Generic HTTP/REST, GraphQL |

### 5.2 Connector Configuration Examples

#### Stripe Source

```json
{
  "sourceDefinitionId": "stripe",
  "name": "Stripe Production",
  "configuration": {
    "account_id": "acct_1234567890",
    "client_secret": "${SECRET:stripe_secret_key}",
    "start_date": "2024-01-01T00:00:00Z",
    "lookback_window_days": 7
  }
}
```

#### PostgreSQL Source

```json
{
  "sourceDefinitionId": "postgres",
  "name": "Internal Ledger",
  "configuration": {
    "host": "ledger-db.internal",
    "port": 5432,
    "database": "ledger",
    "username": "airbyte_reader",
    "password": "${SECRET:ledger_db_password}",
    "ssl_mode": "require",
    "replication_method": {
      "method": "CDC",
      "replication_slot": "airbyte_slot",
      "publication": "airbyte_publication"
    }
  }
}
```

#### SFTP Source (Bank Statements)

```json
{
  "sourceDefinitionId": "sftp-bulk",
  "name": "Bank Statement SFTP",
  "configuration": {
    "host": "sftp.bank.com",
    "port": 22,
    "username": "reconciliation",
    "credentials": {
      "auth_type": "private_key",
      "private_key": "${SECRET:bank_sftp_key}"
    },
    "folder_path": "/statements/daily",
    "file_pattern": "statement_*.csv",
    "file_type": "csv"
  }
}
```

## 6. Sync Orchestration

### 6.1 Pre-Reconciliation Sync

Before running a reconciliation job, Spring Boot triggers data syncs:

```java
@Service
public class ReconciliationOrchestrator {

    private final AirbyteService airbyteService;
    private final K8sJobService k8sJobService;

    /**
     * Execute reconciliation workflow.
     */
    public WorkflowRun execute(String workflowId) {
        Workflow workflow = workflowRepository.findById(workflowId);

        // Step 1: Trigger syncs for all data sources
        List<SyncJob> syncJobs = workflow.getDataSources().stream()
            .map(ds -> triggerSync(ds))
            .toList();

        // Step 2: Wait for syncs to complete
        waitForSyncs(syncJobs);

        // Step 3: Create and run Polars K8s jobs
        return k8sJobService.createWorkflowJobs(workflow);
    }

    private SyncJob triggerSync(DataSource dataSource) {
        String connectionId = dataSource.getAirbyte().getConnectionId();
        SyncResponse response = airbyteService.triggerSync(connectionId).block();
        return new SyncJob(dataSource.getId(), response.getJobId());
    }

    private void waitForSyncs(List<SyncJob> jobs) {
        for (SyncJob job : jobs) {
            pollUntilComplete(job);
        }
    }

    private void pollUntilComplete(SyncJob job) {
        while (true) {
            JobStatus status = airbyteService.getJobStatus(job.getJobId()).block();
            if (status.isComplete()) {
                if (status.isFailed()) {
                    throw new SyncFailedException(job.getDataSourceId(), status.getError());
                }
                return;
            }
            sleep(Duration.ofSeconds(5));
        }
    }
}
```

### 6.2 Scheduled Syncs

For data that should be continuously updated:

```java
@Service
public class ScheduledSyncService {

    @Scheduled(cron = "0 */15 * * * *")  // Every 15 minutes
    public void syncHighFrequencySources() {
        List<DataSource> sources = dataSourceRepository
            .findBySyncFrequency(SyncFrequency.HIGH);

        sources.parallelStream()
            .forEach(ds -> airbyteService.triggerSync(ds.getConnectionId()));
    }

    @Scheduled(cron = "0 0 2 * * *")  // Daily at 2 AM
    public void syncDailySources() {
        List<DataSource> sources = dataSourceRepository
            .findBySyncFrequency(SyncFrequency.DAILY);

        sources.forEach(ds -> airbyteService.triggerSync(ds.getConnectionId()));
    }
}
```

## 7. Polars Integration

### 7.1 Reading Airbyte Output

```python
import polars as pl

def load_source_data(source_id: str, date: str) -> pl.LazyFrame:
    """Load data synced by Airbyte from S3."""

    path = f"s3://recon-data/sources/{source_id}/**/date={date}/*.parquet"

    df = pl.scan_parquet(
        path,
        storage_options={
            "aws_access_key_id": os.environ["AWS_ACCESS_KEY_ID"],
            "aws_secret_access_key": os.environ["AWS_SECRET_ACCESS_KEY"],
            "aws_region": os.environ["AWS_REGION"]
        }
    )

    # Remove Airbyte metadata columns if not needed
    airbyte_cols = [c for c in df.columns if c.startswith("_airbyte_")]
    df = df.drop(airbyte_cols)

    return df
```

### 7.2 Schema Discovery

```python
def discover_schema(source_id: str) -> dict:
    """Discover schema from Airbyte output files."""

    path = f"s3://recon-data/sources/{source_id}/**/*.parquet"

    # Read just the schema (no data)
    df = pl.scan_parquet(path).head(0).collect()

    return {
        "fields": {col: str(dtype) for col, dtype in df.schema.items()},
        "row_count": df.height
    }
```

### 7.3 Incremental Reading

```python
def load_incremental(source_id: str, since: datetime) -> pl.LazyFrame:
    """Load only data synced after a specific time."""

    path = f"s3://recon-data/sources/{source_id}/**/*.parquet"

    df = pl.scan_parquet(path).filter(
        pl.col("_airbyte_emitted_at") > since
    )

    return df
```

## 8. Data Source Configuration UI

### 8.1 Source Creation Flow

``Expression Compiler`
┌─────────────────────────────────────────────────────────────────┐
│                     Add Data Source                              │
│                                                                 │
│  1. Select Connector Type                                       │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│     │   Stripe    │ │  PostgreSQL │ │    SFTP     │            │
│     └─────────────┘ └─────────────┘ └─────────────┘            │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│     │   PayPal    │ │    MySQL    │ │     S3      │            │
│     └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                                 │
│  2. Configure Connection                                        │
│     (Dynamic form based on connector spec)                      │
│     ┌────────────────────────────────────────────┐             │
│     │ API Key: [________________________]        │             │
│     │ Account ID: [____________________]         │             │
│     │ Start Date: [____________________]         │             │
│     └────────────────────────────────────────────┘             │
│                                                                 │
│  3. Select Streams                                              │
│     ☑ balance_transactions                                     │
│     ☐ charges                                                  │
│     ☑ refunds                                                  │
│     ☐ customers                                                │
│                                                                 │
│  4. Configure Sync Schedule                                     │
│     ○ Manual (on-demand)                                       │
│     ● Scheduled: Every [15] minutes                            │
│     ○ Daily at [02:00] UTC                                     │
│                                                                 │
│                    [Test Connection]  [Save]                    │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Data Source Management API

```java
@RestController
@RequestMapping("/api/datasources")
public class DataSourceController {

    @GetMapping("/connector-types")
    public List<ConnectorType> listConnectorTypes() {
        return airbyteService.listSourceDefinitions()
            .map(this::toConnectorType)
            .block();
    }

    @GetMapping("/connector-types/{id}/spec")
    public ConnectorSpec getConnectorSpec(@PathVariable String id) {
        return airbyteService.getSourceDefinitionSpec(id).block();
    }

    @PostMapping
    public DataSource create(@RequestBody CreateDataSourceRequest request) {
        // 1. Create Airbyte source
        Source source = airbyteService.createSource(request.toAirbyteSource()).block();

        // 2. Create Airbyte connection (source → S3)
        Connection connection = airbyteService.createConnection(
            request.toConnection(source.getId(), s3DestinationId)
        ).block();

        // 3. Save to local database
        return dataSourceRepository.save(
            DataSource.builder()
                .name(request.getName())
                .type("airbyte")
                .airbyteSourceId(source.getId())
                .airbyteConnectionId(connection.getId())
                .build()
        );
    }

    @PostMapping("/{id}/sync")
    public SyncStatus triggerSync(@PathVariable String id) {
        DataSource ds = dataSourceRepository.findById(id);
        return airbyteService.triggerSync(ds.getAirbyteConnectionId()).block();
    }

    @GetMapping("/{id}/sync-status")
    public SyncStatus getSyncStatus(@PathVariable String id) {
        DataSource ds = dataSourceRepository.findById(id);
        return airbyteService.getLatestSyncStatus(ds.getAirbyteConnectionId()).block();
    }
}
```

## 9. Monitoring & Observability

### 9.1 Sync Metrics

| Metric | Description |
|--------|-------------|
| `airbyte_sync_duration_seconds` | Time to complete sync |
| `airbyte_sync_records_total` | Records synced per job |
| `airbyte_sync_bytes_total` | Data volume synced |
| `airbyte_sync_failures_total` | Failed sync count |
| `airbyte_sync_last_success` | Timestamp of last successful sync |

### 9.2 Alerting

```yaml
# Prometheus alert rules
groups:
  - name: airbyte
    rules:
      - alert: AirbyteSyncFailed
        expr: increase(airbyte_sync_failures_total[1h]) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Airbyte sync failed for {{ $labels.source }}"

      - alert: AirbyteSyncStale
        expr: time() - airbyte_sync_last_success > 3600
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "No successful sync in over 1 hour for {{ $labels.source }}"

      - alert: AirbyteSyncSlow
        expr: airbyte_sync_duration_seconds > 1800
        for: 5m
        labels:
          severity: info
        annotations:
          summary: "Sync taking over 30 minutes for {{ $labels.source }}"
```

## 10. Error Handling

### 10.1 Sync Failure Handling

```java
@Service
public class SyncErrorHandler {

    public void handleSyncFailure(String connectionId, SyncError error) {
        DataSource ds = dataSourceRepository.findByConnectionId(connectionId);

        // Log the failure
        auditService.log(AuditEvent.builder()
            .type("datasource.sync_failed")
            .resourceId(ds.getId())
            .details(Map.of(
                "error", error.getMessage(),
                "errorCode", error.getCode()
            ))
            .build()
        );

        // Notify if configured
        if (ds.getNotificationConfig() != null) {
            notificationService.sendSyncFailureAlert(ds, error);
        }

        // Retry if transient error
        if (error.isTransient() && ds.getRetryCount() < 3) {
            scheduler.schedule(
                () -> airbyteService.triggerSync(connectionId),
                Duration.ofMinutes(5)
            );
        }
    }
}
```

### 10.2 Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `AUTHENTICATION_FAILED` | Invalid credentials | Update source credentials |
| `RATE_LIMIT_EXCEEDED` | API rate limit hit | Reduce sync frequency |
| `CONNECTION_TIMEOUT` | Network issues | Check connectivity, increase timeout |
| `SCHEMA_MISMATCH` | Source schema changed | Update stream configuration |
| `INSUFFICIENT_PERMISSIONS` | Missing S3 write access | Check IAM policies |
