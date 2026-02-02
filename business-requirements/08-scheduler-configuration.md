# Scheduler Configuration

## 1. Overview

When multiple reconciliations are configured, the system must manage concurrent job execution to ensure data consistency, resource efficiency, and fair resource allocation across configurations.

## 2. Rate Limiting

### 2.1 System-Wide Limit

The system enforces a maximum number of parallel jobs that can run simultaneously across all configurations.

| Setting | Description |
|---------|-------------|
| `max_parallel_jobs` | Maximum jobs running at any time (e.g., 10) |

### 2.2 Per-Configuration Limit

Each reconciliation configuration has a configurable limit on how many concurrent jobs it can run. This prevents a single configuration from consuming all system resources.

| Setting | Default | Description |
|---------|---------|-------------|
| `max_jobs_per_config` | 1 | Maximum concurrent jobs for a single configuration |

**Example Scenarios:**

| System Limit | Config Limit | Config A Running | Config A Request | Behavior |
|--------------|--------------|------------------|------------------|----------|
| 10 | 1 | 1 job | New request | Queued (config limit reached) |
| 10 | 3 | 2 jobs | New request | Runs (within config limit) |
| 10 | 3 | 3 jobs | New request | Queued (config limit reached) |
| 10 | 5 | 3 jobs | New request | Queued if system has 10 running (system limit) |

### 2.3 Fair Resource Allocation

Rate limiting per configuration ensures:
- No single configuration can monopolize system resources
- All configurations get fair access to execution slots
- Malicious or misconfigured clients cannot starve other configurations

### 2.4 Cross-Configuration Parallelism

Different reconciliation configurations CAN run in parallel, subject to:
1. System-wide concurrency limit
2. Per-configuration concurrency limit

## 3. Queue Behavior

### 3.1 Queue Order

Jobs are processed in FIFO (first-in, first-out) order within each configuration's queue.

### 3.2 Queue Visibility

Users must be able to:
- See pending jobs in queue
- See queue position
- Cancel pending jobs

## 4. Job Lifecycle

| Status | Description |
|--------|-------------|
| `pending` | Queued, waiting for current job to complete |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Encountered an error |
| `cancelled` | Cancelled by user |

## 5. Timeout and Retry

### 5.1 Job Timeout

Jobs have a maximum runtime. Jobs exceeding the timeout are terminated.

### 5.2 Retry on Failure

Failed jobs may be automatically retried based on configuration (transient errors only).

## 6. Configuration Options

### 6.1 System-Level Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `max_parallel_jobs` | 10 | System-wide limit on parallel jobs |
| `default_max_jobs_per_config` | 1 | Default per-config limit for new configurations |
| `job_timeout` | 60 min | Maximum runtime per job |
| `retry_attempts` | 3 | Number of retries for failed jobs |
| `retry_delay` | 5 min | Wait time between retries |

### 6.2 Per-Configuration Settings

Each reconciliation configuration can override defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `max_concurrent_jobs` | 1 | Max parallel jobs for this configuration |
| `priority` | normal | Job priority (low, normal, high) |
| `timeout_override` | - | Custom timeout for this configuration |

### 6.3 Configuration Example

```yaml
# System defaults
scheduler:
  max_parallel_jobs: 10
  default_max_jobs_per_config: 1

# Per-configuration override
reconciliation:
  name: high_volume_daily_recon
  scheduler:
    max_concurrent_jobs: 3    # Allow 3 parallel jobs for this config
    priority: high
```
