# Remarks: Airbyte Integration as Data Source Connector

## Executive Summary

Integrating Airbyte as a data source connector for the Haqq Reconciliation Engine is a **strategically sound decision** that can significantly accelerate time-to-market and expand data source coverage. However, there are architectural considerations that need careful evaluation.

---

## How Airbyte Fits with Current Requirements

### Alignment with Plugin Architecture (02-data-sources.md §2.1)

Your requirements already define a plugin interface:
```
connect() → fetch(reconciliation_unit) → validate() → disconnect()
```

**Good fit**: Airbyte connectors can be wrapped to implement this interface. Airbyte's connector protocol (Airbyte Protocol) provides similar abstractions:
- `spec` → Maps to `validate()`
- `check` → Maps to `connect()` validation
- `discover` → Can inform schema discovery
- `read` → Maps to `fetch()`

### Current Data Source Coverage vs Airbyte

| Current Support | Airbyte Provides |
|-----------------|------------------|
| SFTP | ✅ SFTP connector + 300+ more |
| REST APIs | ✅ Generic HTTP + specific API connectors (Stripe, Plaid, etc.) |
| PostgreSQL | ✅ PostgreSQL + MySQL, MongoDB, Snowflake, BigQuery, etc. |
| S3/Azure/GCS (Open Question §8) | ✅ All cloud storage providers |

**Key Advantage**: Airbyte immediately answers the open question in §8 about cloud storage support.

---

## Integration Architecture Options

### Option A: Airbyte as Middleware (Recommended for Phase 1)

```
[External Sources] → [Airbyte] → [Staging DB/Files] → [Haqq Reconciliation Engine]
```

**Pros**:
- Minimal changes to existing architecture
- Airbyte handles auth, pagination, rate limiting, retries
- Mature scheduling and monitoring
- Clear separation of concerns

**Cons**:
- Additional infrastructure (Airbyte server + database)
- Data lands in intermediate storage before reconciliation
- Latency added (not real-time)

**Fit with Requirements**:
- ✅ Matches "batch/on-demand only" (§2 Out of Scope)
- ✅ Works with existing SFTP/API/DB fetch patterns
- ⚠️ Adds infrastructure complexity

### Option B: Native Airbyte Connector Protocol Integration

```
[Airbyte Connector Images] → [Haqq Connector Wrapper] → [Reconciliation Engine]
```

**Pros**:
- Direct access to 300+ connectors
- No intermediate storage needed
- Single system to manage

**Cons**:
- Requires Docker runtime for connector execution
- Need to implement Airbyte Protocol parsing
- Connector versioning/updates become your responsibility
- More complex implementation

**Fit with Requirements**:
- ✅ Maintains plugin architecture pattern
- ⚠️ Performance implications (container spin-up time vs 1M x 1M/sec target in §7)
- ⚠️ Memory overhead per connector container

### Option C: Hybrid Approach (Recommended Long-term)

Use Airbyte middleware for complex/external sources, native connectors for high-performance scenarios:

```yaml
# High-performance: Native connector
data_source:
  type: database
  database_type: postgresql
  # ... native config

# Complex external: Via Airbyte
data_source:
  type: airbyte
  connector: source-stripe
  # ... airbyte config
```

---

## Compatibility Analysis with Requirements

### ✅ Fully Compatible

| Requirement | Airbyte Support |
|-------------|-----------------|
| Configuration Versioning (§2.2) | Airbyte has version-controlled connector configs |
| Credential Security (§2.3) | Supports secret management (Vault, env vars) |
| OAuth2 Authentication (§4.2) | Native OAuth support for many connectors |
| Pagination (§4.5) | Handled automatically by connectors |
| Rate Limiting (§4.4) | Built-in rate limit handling |
| Compression/Encoding (§2.5) | Handled by connectors |

### ⚠️ Requires Adaptation

| Requirement | Gap | Mitigation |
|-------------|-----|------------|
| Reconciliation Unit Templates (§3.3, §4.3) | Airbyte uses incremental sync, not templated queries | Build wrapper to translate recon unit to Airbyte's incremental state |
| Query Templates (§5.3) | Airbyte DB connectors don't support arbitrary SQL | Use database source with custom SQL mode OR native DB connector for complex queries |
| File Pattern Matching (§3.3) | Airbyte file connectors have different pattern syntax | Pattern translation layer needed |
| 1M x 1M Performance (§7) | Container spin-up adds latency | Use native connectors for high-volume sources |

### ❌ Not Directly Supported

| Requirement | Issue | Recommendation |
|-------------|-------|----------------|
| Custom Lua Transforms at Source | Airbyte does schema mapping, not Lua | Keep transform layer in reconciliation engine (already planned) |
| Multi-file Concatenation (§3.4) | Airbyte streams per-file | Post-processing aggregation in engine |

---

## Recommended Airbyte Connectors for Fintech

Based on your use cases (§6 Key Use Cases):

| Use Case | Relevant Airbyte Connectors |
|----------|----------------------------|
| Payment Gateway Reconciliation | `source-stripe`, `source-paypal`, `source-square`, `source-adyen` |
| Bank Statement Reconciliation | `source-plaid`, `source-yodlee` (via custom) |
| Card Network Reconciliation | `source-sftp` (for Visa/MC files), custom connectors |
| Merchant Settlement | `source-shopify`, `source-woocommerce` |
| General APIs | `source-http-request` (generic HTTP) |
| Databases | `source-postgres`, `source-mysql`, `source-mongodb`, `source-snowflake` |
| Cloud Storage | `source-s3`, `source-gcs`, `source-azure-blob-storage` |

---

## Implementation Recommendations

### Phase 1: Airbyte as External Middleware
1. Deploy Airbyte OSS alongside Haqq
2. Configure Airbyte to sync data to PostgreSQL staging tables
3. Create `database` data source in Haqq pointing to staging tables
4. Airbyte handles the "fetch from external", Haqq handles reconciliation

### Phase 2: Native Airbyte Connector Type
1. Add new data source type: `type: airbyte`
2. Implement Airbyte Protocol wrapper:
   ```yaml
   data_source:
     type: airbyte
     connector_image: airbyte/source-stripe:latest
     config:
       account_id: ${SECRET:stripe_account}
       api_key: ${SECRET:stripe_key}
     stream: balance_transactions
     sync_mode: incremental
   ```
3. Run connector as subprocess/container, parse Airbyte messages

### Phase 3: Connector Catalog
1. Build UI for browsing available Airbyte connectors
2. Auto-generate configuration forms from connector specs
3. Handle connector updates and versioning

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance degradation | Medium | High | Use native connectors for high-volume; Airbyte for long-tail |
| Airbyte connector bugs | Low | Medium | Pin versions, test before upgrades |
| Infrastructure complexity | High | Medium | Start with managed Airbyte Cloud OR simple OSS setup |
| Schema drift in connectors | Medium | Medium | Version lock + monitoring |

---

## Cost-Benefit Summary

### Benefits
- **300+ connectors** out of the box
- **Faster time-to-market** for new data source integrations
- **Community-maintained** connectors (updates, bug fixes)
- **Answers open questions** about cloud storage support
- **OAuth complexity** handled by mature implementations

### Costs
- Additional infrastructure (Airbyte server, database, containers)
- Learning curve for team
- Some performance overhead
- Dependency on external project

---

## Final Recommendation

**Integrate Airbyte using the Hybrid Approach**:

1. **Immediate (Phase 1)**: Deploy Airbyte as middleware for external/complex sources
2. **Short-term (Phase 2)**: Add native `airbyte` data source type for direct integration
3. **Long-term**: Maintain both Airbyte and native connectors based on performance needs

This approach:
- Leverages your existing plugin architecture
- Respects performance requirements for high-volume reconciliations
- Expands data source coverage without rewriting connectors
- Keeps the door open for cloud storage (S3/GCS/Azure) immediately

---

## Selected Approach: Middleware on Kubernetes

Based on your input:
- **Architecture**: Airbyte as Middleware
- **Infrastructure**: Kubernetes

### Kubernetes Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                          │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │   Airbyte OSS    │    │  Staging DB      │                  │
│  │   (Helm Chart)   │───▶│  (PostgreSQL)    │                  │
│  │                  │    │                  │                  │
│  │ - Server         │    │ - airbyte_raw    │                  │
│  │ - Scheduler      │    │ - airbyte_norm   │                  │
│  │ - Worker pods    │    └────────┬─────────┘                  │
│  │ - Temporal       │             │                            │
│  └──────────────────┘             │                            │
│                                   ▼                            │
│                      ┌──────────────────┐                      │
│                      │  Haqq Recon      │                      │
│                      │  Engine          │                      │
│                      │                  │                      │
│                      │ data_source:     │                      │
│                      │   type: database │                      │
│                      │   host: staging  │                      │
│                      └──────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### Helm Deployment

```bash
# Add Airbyte Helm repo
helm repo add airbyte https://airbytehq.github.io/helm-charts

# Install with custom values
helm install airbyte airbyte/airbyte \
  --namespace airbyte \
  --create-namespace \
  -f airbyte-values.yaml
```

**Recommended `airbyte-values.yaml`**:
```yaml
global:
  database:
    # Use external PostgreSQL for reliability
    type: external
    host: your-postgres.namespace.svc.cluster.local
    port: 5432
    database: airbyte
    user: airbyte
    password: ${AIRBYTE_DB_PASSWORD}

webapp:
  service:
    type: ClusterIP  # Access via Ingress

worker:
  resources:
    requests:
      memory: "2Gi"
      cpu: "1"
    limits:
      memory: "4Gi"
      cpu: "2"
  replicaCount: 2  # Scale based on connector load

# For fintech: Enable encryption at rest
minio:
  enabled: true
  persistence:
    enabled: true
    size: 50Gi
```

### Integration Pattern with Haqq

**Step 1**: Airbyte syncs external data to staging schema:
```yaml
# Airbyte Connection Config
source: source-stripe
destination: destination-postgres
sync_mode: incremental_append
destination_namespace: airbyte_staging
```

**Step 2**: Haqq references staging as data source:
```yaml
# Haqq Data Source Config (02-data-sources.md compliant)
type: database
name: stripe_transactions_via_airbyte
version: 1

connection:
  database_type: postgresql
  host: staging-db.namespace.svc.cluster.local
  port: 5432
  database: haqq_staging
  schema: airbyte_staging
  username: haqq_reader
  password: ${SECRET:staging_db_password}
  ssl_enabled: true

query_template: |
  SELECT
    id as transaction_id,
    amount,
    currency,
    status,
    created as created_at
  FROM balance_transactions
  WHERE DATE(created AT TIME ZONE 'UTC') = '{year}-{month}-{day}'
  ORDER BY id

metadata:
  description: Stripe transactions synced via Airbyte
  data_availability: "Incremental sync every 15 minutes"
  upstream_connector: airbyte/source-stripe
```

### Operational Considerations

| Aspect | Recommendation |
|--------|----------------|
| **Sync Frequency** | 15-minute incremental for near-real-time, daily for batch reconciliation |
| **Data Retention** | Configure Airbyte to match Haqq retention policies (§10) |
| **Monitoring** | Expose Airbyte metrics to Prometheus, alert on sync failures |
| **Secrets** | Use Kubernetes Secrets or external-secrets-operator for credentials |
| **Network** | Keep Airbyte and staging DB in same namespace for performance |

### Resource Estimates

| Component | CPU | Memory | Storage |
|-----------|-----|--------|---------|
| Airbyte Server | 1 core | 2Gi | - |
| Airbyte Scheduler | 0.5 core | 1Gi | - |
| Airbyte Worker (per pod) | 1-2 cores | 2-4Gi | - |
| Temporal | 0.5 core | 1Gi | - |
| Staging PostgreSQL | 2 cores | 4Gi | 100Gi+ |
| MinIO (logs/state) | 0.5 core | 1Gi | 50Gi |

**Total baseline**: ~6 cores, 12Gi memory + storage

---

## Next Steps

1. **Deploy Airbyte** on your K8s cluster using Helm
2. **Configure first connector** (recommend starting with `source-stripe` or `source-postgres`)
3. **Set up staging database** schema for Airbyte output
4. **Create Haqq data source** pointing to staging tables
5. **Test end-to-end** with a sample reconciliation job

Would you like me to create detailed Kubernetes manifests or a specific connector configuration?
