# Multi-Stage Workflows

## 1. Overview

Multi-stage workflows enable complex reconciliation scenarios where:
- Multiple data sources need to be reconciled
- Stages depend on outputs from previous stages
- Results flow through a directed acyclic graph (DAG)

Workflows are orchestrated by **Spring Boot** and executed as **Kubernetes Jobs** running **Polars** for data processing.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Multi-Stage Workflow Execution                        │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     Spring Boot Orchestrator                            │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │ │
│  │   │ Parse DAG    │→ │ Schedule Jobs│→ │ Monitor & Track Progress │    │ │
│  │   │ Dependencies │  │ via K8s API  │  │ Handle Failures          │    │ │
│  │   └──────────────┘  └──────────────┘  └──────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       Kubernetes Jobs (Polars)                          │ │
│  │                                                                         │ │
│  │   ┌────────────┐    ┌────────────┐    ┌────────────┐                   │ │
│  │   │  Stage 1   │    │  Stage 2   │    │  Stage 3   │                   │ │
│  │   │  K8s Job   │    │  K8s Job   │    │  K8s Job   │                   │ │
│  │   │            │    │            │    │            │                   │ │
│  │   │ Read S3    │    │ Read S3    │    │ Read S3    │                   │ │
│  │   │ Join+Rules │    │ Join+Rules │    │ Join+Rules │                   │ │
│  │   │ Write S3   │    │ Write S3   │    │ Write S3   │                   │ │
│  │   └─────┬──────┘    └─────┬──────┘    └─────┬──────┘                   │ │
│  │         │                 │                 │                           │ │
│  └─────────┼─────────────────┼─────────────────┼───────────────────────────┘ │
│            │                 │                 │                             │
│            ▼                 ▼                 ▼                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         S3 Storage (Parquet)                            │ │
│  │   /sources/         - Data from Airbyte                                 │ │
│  │   /results/{job_id}/stage_1/  - Stage 1 outputs                        │ │
│  │   /results/{job_id}/stage_2/  - Stage 2 outputs                        │ │
│  │   /results/{job_id}/stage_3/  - Stage 3 outputs                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Workflow DAG Example

```
Three-Way Bank Reconciliation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
    │   Ledger      │     │   Gateway     │     │    Bank       │
    │   (Airbyte)   │     │   (Airbyte)   │     │   (Airbyte)   │
    └───────┬───────┘     └───────┬───────┘     └───────┬───────┘
            │                     │                     │
            │    ┌────────────────┴────────┐           │
            │    │                         │           │
            ▼    ▼                         ▼           ▼
    ┌─────────────────┐            ┌─────────────────┐
    │    Stage 1      │            │    Stage 2      │
    │ Ledger vs       │            │ Gateway vs      │
    │ Gateway         │            │ Bank            │
    │ (K8s Job)       │            │ (K8s Job)       │
    └────────┬────────┘            └────────┬────────┘
             │                              │
             │         ┌────────────────────┘
             │         │
             ▼         ▼
         ┌─────────────────┐
         │    Stage 3      │
         │  Consolidation  │
         │  (K8s Job)      │
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌───────┐   ┌─────────┐   ┌──────────┐
│Matched│   │ Partial │   │Unmatched │
└───────┘   └─────────┘   └──────────┘
```

## 4. Stage Input Types

### 4.1 Airbyte Data Source

Data synced by Airbyte to S3 Parquet:

```yaml
datasourceLeft:
  type: airbyte
  sourceId: internal_ledger
  # Reads from: s3://bucket/sources/internal_ledger/date=YYYY-MM-DD/*.parquet
```

### 4.2 Stage Output

Use output from a previous stage:

```yaml
datasourceLeft:
  type: stage_output
  stageId: stage_1
  outputType: matched  # or unmatched_left, unmatched_right, match_failed
```

### 4.3 Result Query

Use a filtered query on stage results:

```yaml
datasourceLeft:
  type: stage_output
  stageId: stage_1
  outputType: result_query
  queryId: high_value_transactions
```

## 5. Stage Configuration

### 5.1 Stage Definition

```yaml
stages:
  - id: stage_1
    name: "Ledger vs Gateway"
    order: 1
    mode: one_to_one

    datasourceLeft:
      type: airbyte
      sourceId: internal_ledger

    datasourceRight:
      type: airbyte
      sourceId: payment_gateway

    joinConditions:
      - leftField: transaction_id
        rightField: txn_ref

    matchingRule:
      type: boolean
      operator: AND
      children:
        - type: comparison
          left: { type: field, source: left, name: currency }
          operator: "="
          right: { type: field, source: right, name: currency }
        - type: comparison
          left:
            type: function
            name: abs
            args:
              - type: arithmetic
                operator: "-"
                left: { type: field, source: left, name: amount }
                right: { type: field, source: right, name: amount }
          operator: "<="
          right: { type: literal, value: 0.01 }

    resultQueries:
      - id: high_value
        name: "High Value Matches"
        filter:
          type: comparison
          left: { type: field, source: left, name: amount }
          operator: ">"
          right: { type: literal, value: 10000 }

    outputs:
      matched: true
      unmatchedLeft: true
      unmatchedRight: true
      matchFailed: true
```

### 5.2 Stage Dependencies

Dependencies are automatically inferred from input configurations:

```
Stage 3 depends on Stage 1 and Stage 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────┐
│ Stage 1 │──────┐
└─────────┘      │
                 ▼
            ┌─────────┐
            │ Stage 3 │
            └─────────┘
┌─────────┐      ▲
│ Stage 2 │──────┘
└─────────┘
```

If Stage 3 uses outputs from Stage 1 and Stage 2, it waits for both to complete.

## 6. K8s Job Execution

### 6.1 Job Creation Flow

```
Spring Boot Orchestration
━━━━━━━━━━━━━━━━━━━━━━━━━

1. Parse Workflow DAG
   ┌────────────────────────────────────────────────────┐
   │ workflow_config.yaml → Stage dependencies graph    │
   └────────────────────────────────────────────────────┘

2. Schedule Ready Stages
   ┌────────────────────────────────────────────────────┐
   │ Stages with no pending dependencies → K8s Jobs     │
   │ Spring Boot → K8s API → Create Job                 │
   └────────────────────────────────────────────────────┘

3. Monitor Job Completion
   ┌────────────────────────────────────────────────────┐
   │ Watch K8s Job status                               │
   │ On completion → Update PostgreSQL → Schedule next  │
   └────────────────────────────────────────────────────┘

4. Handle Failures
   ┌────────────────────────────────────────────────────┐
   │ Retry policy → Skip and continue → Stop workflow  │
   └────────────────────────────────────────────────────┘
```

### 6.2 K8s Job Spec Template

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: recon-{workflow_id}-{stage_id}
  labels:
    app: reconciliation
    workflow: "{workflow_id}"
    stage: "{stage_id}"
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: polars-engine
          image: reconciliation/polars-engine:latest
          resources:
            requests:
              memory: "2Gi"
              cpu: "1000m"
            limits:
              memory: "8Gi"
              cpu: "4000m"
          env:
            - name: WORKFLOW_ID
              value: "{workflow_id}"
            - name: STAGE_ID
              value: "{stage_id}"
            - name: CONFIG_URL
              value: "s3://bucket/configs/{workflow_id}/{stage_id}.yaml"
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: access_key
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: secret_key
            - name: AWS_REGION
              value: "us-east-1"
```

### 6.3 Polars Stage Execution

```python
import polars as pl
import os
import yaml

def execute_stage():
    """Execute a single reconciliation stage."""

    # Load configuration
    config = load_config_from_s3(os.environ["CONFIG_URL"])
    workflow_id = os.environ["WORKFLOW_ID"]
    stage_id = os.environ["STAGE_ID"]

    # Load data sources
    left_df = load_source(config["datasourceLeft"], workflow_id)
    right_df = load_source(config["datasourceRight"], workflow_id)

    # Perform join
    join_keys = config["joinConditions"]
    joined = left_df.join(
        right_df,
        left_on=[k["leftField"] for k in join_keys],
        right_on=[k["rightField"] for k in join_keys],
        how="full",
        suffix="_right"
    )

    # Compile and apply matching rules
    rule_expr = compile_block(config["matchingRule"])
    result = joined.with_columns(rule_expr.alias("is_matched"))

    # Categorize results
    results = categorize_results(result)

    # Write outputs to S3
    base_path = f"s3://bucket/results/{workflow_id}/{stage_id}"
    for category, df in results.items():
        df.write_parquet(f"{base_path}/{category}.parquet", compression="zstd")

    # Write metrics
    write_metrics(workflow_id, stage_id, results)


def load_source(config: dict, workflow_id: str) -> pl.LazyFrame:
    """Load data from Airbyte source or previous stage output."""

    if config["type"] == "airbyte":
        source_id = config["sourceId"]
        return pl.scan_parquet(f"s3://bucket/sources/{source_id}/*.parquet")

    elif config["type"] == "stage_output":
        stage_id = config["stageId"]
        output_type = config["outputType"]
        return pl.scan_parquet(
            f"s3://bucket/results/{workflow_id}/{stage_id}/{output_type}.parquet"
        )


def categorize_results(df: pl.DataFrame) -> dict:
    """Split results into categories."""
    return {
        "matched": df.filter(
            pl.col("is_matched") &
            pl.col("left_id").is_not_null() &
            pl.col("right_id").is_not_null()
        ),
        "unmatched_left": df.filter(pl.col("right_id").is_null()),
        "unmatched_right": df.filter(pl.col("left_id").is_null()),
        "match_failed": df.filter(
            pl.col("left_id").is_not_null() &
            pl.col("right_id").is_not_null() &
            ~pl.col("is_matched")
        )
    }
```

## 7. Execution Flow

### 7.1 DAG Execution Sequence

```
Parallel Stage Execution
━━━━━━━━━━━━━━━━━━━━━━━━

Time ──────────────────────────────────────────────────────────────▶

Spring Boot    ─┬── Create Job: Stage 1 ─────────────────────┬─ Monitor
               │                                              │
               └── Create Job: Stage 2 ─────────────────────┬─┘
                                                            │
Stage 1 Job    ████████████████████████ Complete ───────────┤
               ↳ Read S3 → Join → Rules → Write S3          │
                                                            │
Stage 2 Job    ██████████████████████████████ Complete ─────┤
               ↳ Read S3 → Join → Rules → Write S3          │
                                                            │
Spring Boot    ─────────────────────────────────────────────┼── Create Job: Stage 3
                                                            │
Stage 3 Job                                                 └───████████████ Complete
                                                                ↳ Read Stage 1 + 2 outputs
                                                                  Join → Write final
```

### 7.2 Execution Rules

1. **Parallel Execution**: Stages with no dependencies run as concurrent K8s Jobs
2. **Dependency Wait**: Spring Boot creates next job only after all dependencies complete
3. **Failure Handling**:
   - `retry`: K8s Job backoffLimit (default: 3)
   - `continue`: Skip failed stage, mark downstream as skipped
   - `stop`: Halt entire workflow on failure
4. **Partial Results**: Downstream stages can use partial results if configured

## 8. Result Aggregation

### 8.1 Stage Outputs (S3 Parquet)

Each stage produces Parquet files in S3:

```
s3://bucket/results/{workflow_id}/{stage_id}/
├── matched.parquet
├── unmatched_left.parquet
├── unmatched_right.parquet
├── match_failed.parquet
└── _metrics.json
```

### 8.2 Output Schema

```python
output_schema = {
    "match_id": pl.Utf8,              # Unique match identifier
    "left_*": "All columns from Source A",
    "right_*": "All columns from Source B (with _right suffix)",
    "is_matched": pl.Boolean,         # Final match result
    "rules_passed": pl.List(pl.Utf8), # List of passed rule names
    "rules_failed": pl.List(pl.Utf8), # List of failed rule names
    "match_explanation": pl.Utf8,     # Human-readable explanation
    "matched_at": pl.Datetime         # Timestamp
}
```

### 8.3 Final Aggregation

The workflow produces aggregated results:

```yaml
finalResults:
  # All records matched across all stages
  fullyMatched:
    stages: [stage_1, stage_2, stage_3]
    condition: all_matched

  # Records matched in some but not all stages
  partiallyMatched:
    stages: [stage_1, stage_2, stage_3]
    condition: some_matched

  # Records unmatched in any stage
  unmatched:
    stages: [stage_1, stage_2]
    condition: any_unmatched
```

## 9. Result Queries

### 9.1 Definition

Result queries filter stage outputs for downstream stages or reports:

```yaml
resultQueries:
  - id: high_value
    name: "High Value Transactions"
    description: "Transactions over $10,000"
    filter:
      type: comparison
      left: { type: field, source: left, name: amount }
      operator: ">"
      right: { type: literal, value: 10000 }

  - id: currency_mismatch
    name: "Currency Warnings"
    description: "Matches with currency conversion"
    filter:
      type: boolean
      operator: AND
      children:
        - type: comparison
          left: { type: field, source: result, name: is_matched }
          operator: "="
          right: { type: literal, value: true }
        - type: comparison
          left: { type: field, source: left, name: currency }
          operator: "!="
          right: { type: field, source: right, name: currency }
```

### 9.2 Query Execution

Result queries are executed as Polars filter expressions:

```python
def execute_result_query(stage_output_path: str, query: dict) -> pl.LazyFrame:
    """Execute a result query on stage output."""

    df = pl.scan_parquet(stage_output_path)
    filter_expr = compile_block(query["filter"])
    return df.filter(filter_expr)
```

### 9.3 Using Result Queries

In a downstream stage:

```yaml
stages:
  - id: stage_2
    datasourceLeft:
      type: stage_output
      stageId: stage_1
      outputType: result_query
      queryId: high_value  # Only high-value matches
```

## 10. Use Cases

### 10.1 Three-Way Reconciliation

Reconcile internal ledger, payment gateway, and bank statement:

```
┌───────────┐
│  Ledger   │────┐
└───────────┘    │     ┌──────────────┐
                 ├────▶│   Stage 1:   │
┌───────────┐    │     │ Ledger vs    │
│  Gateway  │────┤     │ Gateway      │
└───────────┘    │     └──────┬───────┘
                 │            │
                 │            │ matched
                 │            ▼
                 │     ┌──────────────┐
                 └────▶│   Stage 3:   │
                       │ Consolidation│◀──── matched
┌───────────┐          └──────┬───────┘         │
│   Bank    │────┐            │          ┌──────┴───────┐
└───────────┘    │            ▼          │   Stage 2:   │
                 └───────────────────────│ Gateway vs   │
                                         │ Bank         │
                                         └──────────────┘
```

### 10.2 Cascading Reconciliation

Try exact match first, then fuzzy match on failures:

```
┌─────────┐     ┌──────────────┐
│ Source  │────▶│   Stage 1:   │
└─────────┘     │ Exact Match  │
                └───────┬──────┘
┌─────────┐             │
│ Target  │────┐        │
└─────────┘    │        │
               │   ┌────┴────┐
               │   │         │
               │   ▼         ▼
               │  matched   unmatched_left
               │   │         │
               │   │         ▼
               │   │  ┌──────────────┐
               └───┼─▶│   Stage 2:   │
                   │  │ Fuzzy Match  │
                   │  └──────┬───────┘
                   │         │
                   ▼         ▼
              ┌─────────────────┐
              │  Final Results  │
              │  (merged)       │
              └─────────────────┘
```

## 11. Configuration Schema

### 11.1 Full Workflow Configuration

```yaml
workflow:
  id: workflow_three_way_recon
  name: "Three-Way Bank Reconciliation"
  description: "Reconcile ledger, gateway, and bank"

dataSources:
  - id: internal_ledger
    name: "Internal Ledger"
    type: airbyte
    airbyte:
      connectionId: conn_ledger_123
      # Synced to: s3://bucket/sources/internal_ledger/

  - id: payment_gateway
    name: "Payment Gateway"
    type: airbyte
    airbyte:
      connectionId: conn_gateway_456

  - id: bank_statement
    name: "Bank Statement"
    type: airbyte
    airbyte:
      connectionId: conn_bank_789

stages:
  - id: stage_ledger_gateway
    name: "Ledger vs Gateway"
    order: 1
    mode: one_to_one
    datasourceLeft:
      type: airbyte
      sourceId: internal_ledger
    datasourceRight:
      type: airbyte
      sourceId: payment_gateway
    joinConditions:
      - leftField: transaction_id
        rightField: txn_ref
    matchingRule:
      # ... rule config
    outputs:
      matched: true
      unmatchedLeft: true
      unmatchedRight: true

  - id: stage_gateway_bank
    name: "Gateway vs Bank"
    order: 2
    mode: one_to_one
    datasourceLeft:
      type: airbyte
      sourceId: payment_gateway
    datasourceRight:
      type: airbyte
      sourceId: bank_statement
    joinConditions:
      - leftField: txn_ref
        rightField: bank_ref
    matchingRule:
      # ... rule config
    outputs:
      matched: true
      unmatchedLeft: true
      unmatchedRight: true

  - id: stage_consolidation
    name: "Three-Way Consolidation"
    order: 3
    mode: one_to_one
    datasourceLeft:
      type: stage_output
      stageId: stage_ledger_gateway
      outputType: matched
    datasourceRight:
      type: stage_output
      stageId: stage_gateway_bank
      outputType: matched
    joinConditions:
      - leftField: txn_ref
        rightField: txn_ref_right
    matchingRule:
      type: literal
      value: true  # Simple join, no additional rules
    outputs:
      matched: true
      unmatchedLeft: true
      unmatchedRight: true

execution:
  failurePolicy: stop  # or: continue, retry
  maxParallelStages: 5
  jobTimeoutSeconds: 3600

schedule:
  cron: "0 6 * * *"  # Daily at 6 AM
  timezone: UTC
```

## 12. Monitoring & Debugging

### 12.1 Stage Metrics

Each stage writes metrics to S3 and PostgreSQL:

```json
{
  "workflow_id": "wf_123",
  "stage_id": "stage_1",
  "status": "completed",
  "started_at": "2024-03-15T10:00:00Z",
  "completed_at": "2024-03-15T10:01:30Z",
  "duration_ms": 90000,
  "metrics": {
    "records_left": 50000,
    "records_right": 48000,
    "matched_count": 45000,
    "unmatched_left_count": 2000,
    "unmatched_right_count": 1500,
    "match_failed_count": 3000,
    "memory_peak_mb": 1250
  }
}
```

### 12.2 Spring Boot Monitoring API

```
GET /api/workflows/{workflow_id}/status

{
  "workflow_id": "wf_123",
  "status": "running",
  "stages": [
    { "id": "stage_1", "status": "completed", "progress": 100 },
    { "id": "stage_2", "status": "running", "progress": 65 },
    { "id": "stage_3", "status": "pending", "progress": 0 }
  ],
  "started_at": "2024-03-15T10:00:00Z",
  "estimated_completion": "2024-03-15T10:05:00Z"
}
```

### 12.3 K8s Job Status

```bash
# List jobs for a workflow
kubectl get jobs -l workflow=wf_123

# View job logs
kubectl logs job/recon-wf_123-stage_1

# Describe job status
kubectl describe job recon-wf_123-stage_2
```
