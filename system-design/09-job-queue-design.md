# Job Queue Design

## 1. Overview

The job queue manages reconciliation job execution with rate limiting at two levels:
- **System-wide limit**: Maximum total parallel jobs across all configurations
- **Per-configuration limit**: Maximum parallel jobs for a single configuration (prevents resource hogging)

The design uses PostgreSQL for queue persistence and K8s events for crash recovery.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Job Execution Flow                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   POST /api/v1/jobs                                                         │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Rate Limit Check                                                    │   │
│   │  1. System limit: running_total < max_parallel_jobs?                │   │
│   │  2. Config limit: running_for_config < config.max_concurrent_jobs?  │   │
│   └────────────────────────────────┬────────────────────────────────────┘   │
│                                    │                                         │
│                       ┌────────────┴────────────┐                           │
│                       │                         │                           │
│                  LIMIT REACHED            WITHIN LIMITS                     │
│                       │                         │                           │
│                       ▼                         ▼                           │
│                 ┌───────────┐            ┌───────────┐                      │
│                 │  Queue    │            │  Launch   │                      │
│                 │ (pending) │            │  K8s Job  │                      │
│                 └───────────┘            └─────┬─────┘                      │
│                                                │                            │
│                                                ▼                            │
│                              ┌─────────────────────────────┐               │
│                              │  K8s Job (Python/Polars)    │               │
│                              │                             │               │
│                              │  On Success: POST /callback─┼──┐            │
│                              │  On Crash: K8s Event ───────┼──┼──┐         │
│                              └─────────────────────────────┘  │  │         │
│                                                               │  │         │
│   ┌───────────────────────────────────────────────────────────┼──┼─────┐   │
│   │  Event Handlers                                           ▼  ▼     │   │
│   │   ┌────────────────────────┐    ┌────────────────────────────┐    │   │
│   │   │  Callback Handler      │    │  K8s Watch Handler         │    │   │
│   │   │  1. Mark completed     │    │  1. Check retry count      │    │   │
│   │   │  2. Check pending jobs │    │  2. Retry OR mark failed   │    │   │
│   │   │  3. Launch if within   │    │  3. Launch pending if      │    │   │
│   │   │     rate limits        │    │     within rate limits     │    │   │
│   │   └────────────────────────┘    └────────────────────────────┘    │   │
│   └───────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2.1 Rate Limiting Rules

| Check | Condition | Action |
|-------|-----------|--------|
| System limit | `total_running >= max_parallel_jobs` | Queue job |
| Config limit | `config_running >= config.max_concurrent_jobs` | Queue job |
| Both within limits | Both checks pass | Launch immediately |

## 3. Database Schema

### 3.1 Job Queue Table

```sql
CREATE TABLE job_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id       UUID NOT NULL REFERENCES reconciliations(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    k8s_job_name    VARCHAR(255),
    k8s_pod_name    VARCHAR(255),

    -- Retry tracking
    attempt         INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,

    -- Job parameters
    date_range_start TIMESTAMP,
    date_range_end   TIMESTAMP,
    parameters       JSONB,

    -- Timestamps
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,

    -- Results
    result_status   VARCHAR(20),  -- success, failed, timeout
    result_path     VARCHAR(500), -- S3 path to results
    error_message   TEXT,

    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

-- Indexes
CREATE INDEX idx_job_queue_config_status ON job_queue(config_id, status);
CREATE INDEX idx_job_queue_pending ON job_queue(created_at) WHERE status = 'pending';
CREATE INDEX idx_job_queue_running ON job_queue(config_id) WHERE status = 'running';
CREATE INDEX idx_job_queue_k8s_job ON job_queue(k8s_job_name) WHERE k8s_job_name IS NOT NULL;
```

### 3.2 Reconciliation Config Table (Rate Limit Settings)

```sql
-- Add rate limit column to reconciliations table
ALTER TABLE reconciliations ADD COLUMN max_concurrent_jobs INT NOT NULL DEFAULT 1;
```

### 3.3 System Settings Table

```sql
CREATE TABLE system_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           VARCHAR(500) NOT NULL,
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Default system-wide limit
INSERT INTO system_settings (key, value) VALUES ('max_parallel_jobs', '10');
INSERT INTO system_settings (key, value) VALUES ('default_max_concurrent_jobs', '1');
```

### 3.4 Rate Limit Check Queries

```sql
-- Count total running jobs (system-wide)
SELECT COUNT(*) FROM job_queue WHERE status = 'running';

-- Count running jobs for a specific config
SELECT COUNT(*) FROM job_queue WHERE config_id = ? AND status = 'running';

-- Get config's max concurrent jobs
SELECT max_concurrent_jobs FROM reconciliations WHERE id = ?;
```

## 4. Job Status Lifecycle

```
                         ┌────────────────┐
                         │    pending     │
                         └───────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
             ┌──────────┐  ┌──────────┐  ┌──────────┐
             │ running  │  │cancelled │  │ (timeout)│
             └────┬─────┘  └──────────┘  └──────────┘
                  │
             ┌────┴────┐
             │         │
             ▼         ▼
      ┌──────────┐ ┌──────────┐
      │completed │ │  failed  │
      └──────────┘ └─────┬────┘
                         │
                         ▼ (if retries remaining)
                   ┌──────────┐
                   │ pending  │ (re-queued)
                   └──────────┘
```

| Status | Description |
|--------|-------------|
| `pending` | Queued, waiting for execution |
| `running` | K8s Job launched and executing |
| `completed` | Job finished successfully |
| `failed` | Job failed after max retries |
| `cancelled` | Cancelled by user |

## 5. Core Operations

### 5.1 Submit Job

```java
@Service
public class JobQueueService {

    @Value("${job-queue.max-parallel-jobs:10}")
    private int maxParallelJobs;

    @Transactional
    public JobQueueEntry submitJob(UUID configId, JobRequest request) {
        // Get config's rate limit
        Reconciliation config = reconciliationRepository.findById(configId)
            .orElseThrow(() -> new NotFoundException("Config not found"));
        int configMaxJobs = config.getMaxConcurrentJobs();

        // Check rate limits
        int totalRunning = jobQueueRepository.countByStatus("running");
        int configRunning = jobQueueRepository.countByConfigIdAndStatus(configId, "running");

        boolean withinSystemLimit = totalRunning < maxParallelJobs;
        boolean withinConfigLimit = configRunning < configMaxJobs;
        boolean canLaunch = withinSystemLimit && withinConfigLimit;

        // Create queue entry
        JobQueueEntry entry = new JobQueueEntry();
        entry.setConfigId(configId);
        entry.setStatus(canLaunch ? "running" : "pending");
        entry.setDateRangeStart(request.getDateRange().getStart());
        entry.setDateRangeEnd(request.getDateRange().getEnd());
        entry.setParameters(request.getParameters());

        entry = jobQueueRepository.save(entry);

        // Launch immediately if within limits
        if (canLaunch) {
            launchK8sJob(entry);
        }

        return entry;
    }

    /**
     * Check if we can launch more jobs (called when a job completes)
     */
    public boolean canLaunchMore(UUID configId) {
        Reconciliation config = reconciliationRepository.findById(configId).orElse(null);
        if (config == null) return false;

        int totalRunning = jobQueueRepository.countByStatus("running");
        int configRunning = jobQueueRepository.countByConfigIdAndStatus(configId, "running");

        return totalRunning < maxParallelJobs && configRunning < config.getMaxConcurrentJobs();
    }
}
```

### 5.2 Launch K8s Job

```java
private void launchK8sJob(JobQueueEntry entry) {
    String jobName = String.format("recon-%s-%s",
        entry.getConfigId().toString().substring(0, 8),
        entry.getId().toString().substring(0, 8)
    );

    V1Job k8sJob = new V1JobBuilder()
        .withNewMetadata()
            .withName(jobName)
            .withNamespace("recon-jobs")
            .addToLabels("config-id", entry.getConfigId().toString())
            .addToLabels("job-id", entry.getId().toString())
        .endMetadata()
        .withNewSpec()
            .withBackoffLimit(0)  // We handle retries ourselves
            .withActiveDeadlineSeconds(3600L)
            .withNewTemplate()
                .withNewSpec()
                    .withRestartPolicy("Never")
                    .addNewContainer()
                        .withName("recon")
                        .withImage("recon-python:latest")
                        .addNewEnv().withName("JOB_ID").withValue(entry.getId().toString()).endEnv()
                        .addNewEnv().withName("CONFIG_ID").withValue(entry.getConfigId().toString()).endEnv()
                        .addNewEnv().withName("CALLBACK_URL").withValue(callbackUrl).endEnv()
                    .endContainer()
                .endSpec()
            .endTemplate()
        .endSpec()
        .build();

    batchV1Api.createNamespacedJob("recon-jobs", k8sJob, null, null, null, null);

    // Update queue entry
    entry.setK8sJobName(jobName);
    entry.setStartedAt(Instant.now());
    jobQueueRepository.save(entry);
}
```

### 5.3 Handle Job Callback

```java
@RestController
@RequestMapping("/api/v1/jobs")
public class JobCallbackController {

    @PostMapping("/{jobId}/callback")
    @Transactional
    public ResponseEntity<?> handleCallback(
            @PathVariable UUID jobId,
            @RequestBody JobCallbackRequest request) {

        JobQueueEntry entry = jobQueueRepository.findById(jobId)
            .orElseThrow(() -> new NotFoundException("Job not found"));

        // Update job status
        entry.setStatus("completed");
        entry.setCompletedAt(Instant.now());
        entry.setResultStatus(request.getStatus());
        entry.setResultPath(request.getResultPath());
        jobQueueRepository.save(entry);

        // Process next job in queue for this config
        processNextInQueue(entry.getConfigId());

        return ResponseEntity.ok().build();
    }

    /**
     * Process pending jobs across all configs, respecting rate limits
     */
    private void processNextInQueue(UUID completedConfigId) {
        // First, try to launch more jobs for the same config (if within limits)
        if (canLaunchMore(completedConfigId)) {
            Optional<JobQueueEntry> nextForConfig = jobQueueRepository
                .findFirstByConfigIdAndStatusOrderByCreatedAt(completedConfigId, "pending");

            if (nextForConfig.isPresent()) {
                launchPendingJob(nextForConfig.get());
                return;
            }
        }

        // Then, try other configs with pending jobs (FIFO across all)
        List<JobQueueEntry> pendingJobs = jobQueueRepository
            .findByStatusOrderByCreatedAt("pending");

        for (JobQueueEntry pending : pendingJobs) {
            if (canLaunchMore(pending.getConfigId())) {
                launchPendingJob(pending);
                // Check if system limit reached after each launch
                if (jobQueueRepository.countByStatus("running") >= maxParallelJobs) {
                    break;
                }
            }
        }
    }

    private void launchPendingJob(JobQueueEntry job) {
        job.setStatus("running");
        job.setAttempt(job.getAttempt() + 1);
        jobQueueRepository.save(job);
        launchK8sJob(job);
    }
}
```

### 5.4 Handle K8s Pod Failure

```java
@Component
public class K8sJobWatcher {

    @PostConstruct
    public void startWatching() {
        executorService.submit(() -> {
            try {
                watchJobs();
            } catch (Exception e) {
                log.error("K8s watch failed, restarting...", e);
                startWatching();  // Reconnect
            }
        });
    }

    private void watchJobs() throws Exception {
        BatchV1Api api = new BatchV1Api(k8sClient);

        Watch<V1Job> watch = Watch.createWatch(
            k8sClient,
            api.listNamespacedJobCall(
                "recon-jobs", null, null, null, null,
                "app=reconciliation", null, null, null, null, true, null
            ),
            new TypeToken<Watch.Response<V1Job>>(){}.getType()
        );

        for (Watch.Response<V1Job> event : watch) {
            if (event.type.equals("MODIFIED")) {
                handleJobUpdate(event.object);
            }
        }
    }

    @Transactional
    private void handleJobUpdate(V1Job k8sJob) {
        String jobName = k8sJob.getMetadata().getName();
        V1JobStatus status = k8sJob.getStatus();

        // Check if job failed
        if (status.getFailed() != null && status.getFailed() > 0) {
            JobQueueEntry entry = jobQueueRepository.findByK8sJobName(jobName)
                .orElse(null);

            if (entry != null && entry.getStatus().equals("running")) {
                handleJobFailure(entry);
            }
        }
    }

    private void handleJobFailure(JobQueueEntry entry) {
        if (entry.getAttempt() < entry.getMaxAttempts()) {
            // Retry: re-queue the job
            log.info("Job {} failed, retrying (attempt {}/{})",
                entry.getId(), entry.getAttempt() + 1, entry.getMaxAttempts());

            entry.setStatus("pending");
            entry.setK8sJobName(null);
            entry.setStartedAt(null);
            jobQueueRepository.save(entry);

            // Process queue (will pick up this job again)
            processNextInQueue(entry.getConfigId());
        } else {
            // Max retries exceeded
            log.error("Job {} failed after {} attempts",
                entry.getId(), entry.getMaxAttempts());

            entry.setStatus("failed");
            entry.setCompletedAt(Instant.now());
            entry.setErrorMessage("Max retry attempts exceeded");
            jobQueueRepository.save(entry);

            // Process next pending job for this config
            processNextInQueue(entry.getConfigId());
        }
    }
}
```

### 5.5 Application Startup Recovery

```java
@Component
public class JobQueueRecovery {

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void recoverOnStartup() {
        log.info("Starting job queue recovery...");

        // 1. Find jobs stuck in "running" state
        List<JobQueueEntry> staleJobs = jobQueueRepository.findByStatus("running");

        for (JobQueueEntry job : staleJobs) {
            boolean k8sJobExists = checkK8sJobExists(job.getK8sJobName());

            if (!k8sJobExists) {
                // K8s job gone - treat as failed, maybe retry
                log.warn("Found stale job {} with no K8s job, recovering...", job.getId());
                handleJobFailure(job);
            } else {
                // K8s job still running - keep watching
                log.info("Job {} still running in K8s, continuing to watch", job.getId());
            }
        }

        // 2. Process any pending jobs (respecting rate limits)
        processPendingQueue();

        log.info("Job queue recovery complete");
    }

    /**
     * Process all pending jobs across configs, respecting rate limits
     */
    private void processPendingQueue() {
        List<JobQueueEntry> pendingJobs = jobQueueRepository
            .findByStatusOrderByCreatedAt("pending");

        for (JobQueueEntry pending : pendingJobs) {
            // Check system limit
            int totalRunning = jobQueueRepository.countByStatus("running");
            if (totalRunning >= maxParallelJobs) {
                log.info("System limit reached ({}/{}), stopping queue processing",
                    totalRunning, maxParallelJobs);
                break;
            }

            // Check config limit
            if (canLaunchMore(pending.getConfigId())) {
                log.info("Launching pending job {} for config {}",
                    pending.getId(), pending.getConfigId());
                launchPendingJob(pending);
            }
        }
    }
}
```

## 6. Python Job Callback

The Python reconciliation job calls back on completion:

```python
import requests
import os
import sys

def main():
    job_id = os.environ["JOB_ID"]
    config_id = os.environ["CONFIG_ID"]
    callback_url = os.environ["CALLBACK_URL"]

    try:
        # Run reconciliation
        result_path = run_reconciliation(config_id)

        # Success callback
        requests.post(
            f"{callback_url}/api/v1/jobs/{job_id}/callback",
            json={
                "status": "success",
                "result_path": result_path
            },
            timeout=30
        )
    except Exception as e:
        # Failure callback (optional - K8s event will also catch this)
        try:
            requests.post(
                f"{callback_url}/api/v1/jobs/{job_id}/callback",
                json={
                    "status": "failed",
                    "error": str(e)
                },
                timeout=30
            )
        except:
            pass  # K8s watcher will handle it

        sys.exit(1)  # Exit with error code

if __name__ == "__main__":
    main()
```

## 7. Queue Visibility API

### 7.1 Get Queue Status

```
GET /api/v1/jobs/queue?config_id={configId}
```

Response:
```json
{
  "config_id": "uuid-...",
  "rate_limits": {
    "config_max": 3,
    "config_running": 2,
    "config_available": 1,
    "system_max": 10,
    "system_running": 7,
    "system_available": 3
  },
  "running": [
    {
      "job_id": "uuid-...",
      "started_at": "2024-03-15T10:00:00Z",
      "attempt": 1
    },
    {
      "job_id": "uuid-...",
      "started_at": "2024-03-15T10:02:00Z",
      "attempt": 1
    }
  ],
  "pending": [
    {
      "job_id": "uuid-...",
      "position": 1,
      "created_at": "2024-03-15T10:05:00Z"
    }
  ],
  "running_count": 2,
  "pending_count": 1
}
```

### 7.2 Get System Queue Status

```
GET /api/v1/jobs/queue
```

Response:
```json
{
  "system_limits": {
    "max_parallel_jobs": 10,
    "running": 7,
    "pending": 15,
    "available_slots": 3
  },
  "by_config": [
    {
      "config_id": "uuid-a",
      "config_name": "daily_payment_recon",
      "max_concurrent_jobs": 3,
      "running": 2,
      "pending": 5
    },
    {
      "config_id": "uuid-b",
      "config_name": "hourly_ledger_recon",
      "max_concurrent_jobs": 1,
      "running": 1,
      "pending": 3
    }
  ]
}
```

### 7.3 Cancel Pending Job

```
DELETE /api/v1/jobs/{jobId}
```

- If `pending`: Remove from queue
- If `running`: Terminate K8s job, mark as cancelled

## 8. Configuration

### 8.1 System Settings

```yaml
job-queue:
  # Rate limiting
  max-parallel-jobs: 10              # System-wide limit
  default-max-jobs-per-config: 1     # Default per-config limit

  # Retry settings
  max-attempts: 3                    # Retry attempts for failed jobs
  job-timeout-seconds: 3600          # K8s job timeout (1 hour)
  callback-timeout-seconds: 30       # Callback request timeout

  k8s:
    namespace: recon-jobs
    image: recon-python:latest
    resources:
      requests:
        memory: "2Gi"
        cpu: "1000m"
      limits:
        memory: "8Gi"
        cpu: "4000m"
```

### 8.2 Per-Configuration Override

```json
// When creating/updating a reconciliation config
POST /api/v1/reconciliations
{
  "name": "high_volume_daily_recon",
  "max_concurrent_jobs": 3,    // Override: allow 3 parallel jobs
  ...
}
```

### 8.3 Rate Limit Examples

| System Limit | Config A Limit | Config B Limit | Scenario |
|--------------|----------------|----------------|----------|
| 10 | 1 | 1 | Each config can run 1 job, up to 10 configs simultaneously |
| 10 | 3 | 2 | Config A can run up to 3, Config B up to 2, total max 10 |
| 10 | 5 | 5 | Each config can run up to 5, but combined max is still 10 |

## 9. Monitoring

### 9.1 Metrics

| Metric | Description |
|--------|-------------|
| `recon_jobs_pending` | Number of pending jobs (total) |
| `recon_jobs_running` | Number of running jobs (total) |
| `recon_jobs_pending_by_config` | Pending jobs by config_id label |
| `recon_jobs_running_by_config` | Running jobs by config_id label |
| `recon_job_queue_time_seconds` | Time spent in pending state |
| `recon_job_duration_seconds` | Job execution duration |
| `recon_job_failures_total` | Total failed jobs |
| `recon_job_retries_total` | Total retry attempts |
| `recon_rate_limit_rejections` | Jobs queued due to rate limit |

### 9.2 Alerts

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Queue backlog | > 50 pending | Alert ops |
| Job stuck running | > 2 hours | Alert ops |
| High failure rate | > 20% in 1 hour | Alert ops |
| System limit sustained | At max for > 30 min | Alert ops (may need to increase limit) |
| Config queue growing | > 10 pending for single config | Alert (possible misconfiguration) |
