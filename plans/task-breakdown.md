# HAQQ Reconciliation Engine - Consolidated Task Breakdown

**Story Point Definition**: 1 SP = 8 hours

---

## 0. Planning & Proof of Concept (Completed)

| ID | Task | SP |
|----|------|-----|
| 0.1 | Requirements analysis & system design | 6 |
| 0.2 | Architecture planning & tech stack decisions | 4 |
| 0.3 | Dummy MVC implementation (end-to-end skeleton) | 4 |
| **Subtotal** | | **14** |

---

## 1. Project Setup & Infrastructure

| ID | Task | SP |
|----|------|-----|
| 1.1 | Python project setup (Poetry, Polars, Temporal SDK, pytest) | 0.5 |
| 1.2 | Spring Boot project setup (Gradle, PostgreSQL, Flyway, OpenAPI) | 0.5 |
| 1.3 | React project setup (Vite, TypeScript, TailwindCSS, React Query) | 0.5 |
| 1.4 | Docker Compose for local dev (PostgreSQL, Temporal, services) | 1 |
| 1.5 | CI/CD pipeline (GitHub Actions: lint, test, build) | 1 |
| **Subtotal** | | **3.5** |

---

## 2. Database & Data Layer

| ID | Task | SP |
|----|------|-----|
| 2.1 | Database schema design & ERD | 0.5 |
| 2.2 | Flyway migrations (all tables: tenants, data_sources, reconciliations, stages, rules, runs, audit_logs) | 1.5 |
| 2.3 | JPA entities with audit fields & repositories | 1 |
| 2.4 | Database indexing strategy | 0.5 |
| **Subtotal** | | **3.5** |

---

## 3. Data Ingestion Module

| ID | Task | SP |
|----|------|-----|
| 3.1 | Storage adapter interface (abstracts S3/local filesystem) | 1 |
| 3.2 | Local filesystem storage implementation | 0.5 |
| 3.3 | S3-compatible storage implementation (optional, for production) | 0.5 |
| 3.4 | File readers (Parquet, CSV, JSON with compression support) | 1.5 |
| 3.5 | SFTP connector | 1 |
| 3.6 | REST API connector (paginated) | 1 |
| 3.7 | Database connector (PostgreSQL, MySQL) | 1 |
| 3.8 | Incremental data loading | 1.5 |
| 3.9 | Connection testing & data preview | 0.5 |
| **Subtotal** | | **8.5** |

---

## 4. Schema Normalization

| ID | Task | SP |
|----|------|-----|
| 4.1 | Type mapping engine (string→date, string→decimal, etc.) | 1 |
| 4.2 | Field transformations (rename, derive, enum mapping) | 1 |
| 4.3 | String/date/currency normalization | 1 |
| 4.4 | Null handling strategies | 0.5 |
| **Subtotal** | | **3.5** |

---

## 5. Matching Engine Core

| ID | Task | SP |
|----|------|-----|
| 5.1 | Hash-join with composite key builder | 2 |
| 5.2 | Matching modes (1:1, 1:N, N:M) | 4 |
| 5.3 | Result categorization & match ID generation | 1 |
| 5.4 | Duplicate detection | 1 |
| 5.5 | Performance optimization & memory management | 3 |
| **Subtotal** | | **11** |

---

## 6. Rule Expression System

| ID | Task | SP |
|----|------|-----|
| 6.1 | Expression schema & field reference resolution | 1 |
| 6.2 | Operators (comparison, boolean, arithmetic) | 1 |
| 6.3 | Built-in functions (math, string, date, null handling) | 1.5 |
| 6.4 | Tolerance matching (absolute, percentage) | 1 |
| 6.5 | Expression compiler (JSON → Polars) | 2 |
| 6.6 | Rule validation & severity handling | 1 |
| 6.7 | Custom Python function support (optional) | 2 |
| **Subtotal** | | **9.5** |

---

## 7. Multi-Stage Workflows

| ID | Task | SP |
|----|------|-----|
| 7.1 | DAG builder with topological sort | 1.5 |
| 7.2 | Parallel stage execution | 1.5 |
| 7.3 | Result queries & inter-stage data passing | 1.5 |
| 7.4 | Conditional execution & retry logic | 1.5 |
| **Subtotal** | | **6** |

---

## 8. Match Explainability

| ID | Task | SP |
|----|------|-----|
| 8.1 | Rule evaluation capture (pass/fail, values, tolerances) | 1.5 |
| 8.2 | Human-readable explanation generator | 1.5 |
| 8.3 | Match confidence scoring | 1 |
| **Subtotal** | | **4** |

---

## 9. Temporal Orchestration

| ID | Task | SP |
|----|------|-----|
| 9.1 | Temporal server setup | 0.5 |
| 9.2 | ReconciliationWorkflow with stage activities | 2 |
| 9.3 | Heartbeat, retry policies, checkpointing | 1.5 |
| 9.4 | Workflow queries & signals (status, cancel, pause, resume) | 1.5 |
| 9.5 | Worker pool & task queue management | 1 |
| 9.6 | Spring Boot Temporal SDK integration | 1 |
| **Subtotal** | | **7.5** |

---

## 10. Spring Boot REST API

| ID | Task | SP |
|----|------|-----|
| 10.1 | Base setup (exception handling, DTOs, validation, pagination) | 1.5 |
| 10.2 | Data Source endpoints (CRUD, test, preview) | 1.5 |
| 10.3 | Reconciliation Config endpoints (CRUD, validate, dry-run) | 2 |
| 10.4 | Job endpoints (submit, status, cancel) | 1 |
| 10.5 | Run & Results endpoints (list, detail, matched/unmatched, explanations) | 2 |
| 10.6 | Export endpoints (CSV, Parquet) | 1 |
| 10.7 | OpenAPI documentation | 0.5 |
| **Subtotal** | | **9.5** |

---

## 11. React Frontend

| ID | Task | SP |
|----|------|-----|
| 11.1 | Project structure, routing, API client | 1.5 |
| 11.2 | Auth context & layout components | 1.5 |
| 11.3 | Dashboard page | 1.5 |
| 11.4 | Data Sources pages (list, create/edit, test, preview) | 3 |
| 11.5 | Reconciliation pages (list, create/edit, stage config) | 4 |
| 11.6 | Visual rule builder & JSON editor | 4 |
| 11.7 | Runs & Results pages (list, detail, data tables, explanations) | 4 |
| 11.8 | Common (export, dialogs, notifications, loading states) | 2 |
| 11.9 | Real-time status updates & responsive design | 2 |
| **Subtotal** | | **23.5** |

---

## 12. Security & Multi-Tenancy

| ID | Task | SP |
|----|------|-----|
| 12.1 | JWT authentication (Spring Security) | 1.5 |
| 12.2 | Role-based access control | 1.5 |
| 12.3 | Tenant isolation (DB queries, storage paths) | 1.5 |
| 12.4 | API rate limiting & audit logging | 2 |
| 12.5 | Security headers (CORS, CSP, HSTS) | 0.5 |
| 12.6 | Environment-based secrets management | 0.5 |
| **Subtotal** | | **7.5** |

---

## 13. Monitoring & Observability

| ID | Task | SP |
|----|------|-----|
| 13.1 | Prometheus metrics (Spring Actuator, Python worker) | 1 |
| 13.2 | Custom business metrics | 1 |
| 13.3 | Grafana dashboards | 2 |
| 13.4 | Structured logging & health checks | 1 |
| **Subtotal** | | **5** |

---

## 14. Testing

| ID | Task | SP |
|----|------|-----|
| 14.1 | Unit tests (matching engine, rules, data loaders, services) | 5 |
| 14.2 | Integration tests (Temporal, API, database) | 4 |
| 14.3 | E2E tests (full reconciliation flow) | 2 |
| 14.4 | Performance tests (100K-1M records, concurrent jobs) | 3 |
| 14.5 | Test data generation | 1 |
| 14.6 | React tests (components, E2E) | 3 |
| **Subtotal** | | **18** |

---

## 15. Documentation

| ID | Task | SP |
|----|------|-----|
| 15.1 | README & quick start | 0.5 |
| 15.2 | Architecture & API docs | 1.5 |
| 15.3 | Rule expression guide | 1 |
| 15.4 | Deployment & operations | 1.5 |
| 15.5 | User manual | 1.5 |
| **Subtotal** | | **6** |

---

## Summary

| Module | SP |
|--------|-----|
| 0. Planning & PoC (Completed) | 14 |
| 1. Project Setup | 3.5 |
| 2. Database | 3.5 |
| 3. Data Ingestion | 8.5 |
| 4. Schema Normalization | 3.5 |
| 5. Matching Engine | 11 |
| 6. Rule Expression | 9.5 |
| 7. Multi-Stage Workflows | 6 |
| 8. Match Explainability | 4 |
| 9. Temporal Orchestration | 7.5 |
| 10. REST API | 9.5 |
| 11. React Frontend | 23.5 |
| 12. Security | 7.5 |
| 13. Monitoring | 5 |
| 14. Testing | 18 |
| 15. Documentation | 6 |
| **TOTAL** | **140.5 SP (1,124 hours)** |
| **Remaining** | **126.5 SP (1,012 hours)** |

---

## Local-First Architecture (No External Dependencies)

The system is designed to run entirely locally without Airbyte, MinIO, or Kubernetes:

### Storage Abstraction
```
StorageAdapter (interface)
├── LocalFileSystemStorage (default) - uses local disk
└── S3Storage (optional) - for production with S3/MinIO
```

### Deployment Options

**Local Development (Docker Compose only)**
- PostgreSQL container
- Temporal server container
- Spring Boot service
- Python worker service
- React dev server

**Production (VM/bare metal)**
- Same services deployed via Docker Compose or systemd
- PostgreSQL (managed or self-hosted)
- Temporal (self-hosted cluster)
- Nginx reverse proxy

### Configuration
```yaml
# application.yml
storage:
  type: local  # or 's3'
  local:
    base-path: /data/reconciliation
  s3:  # optional, only if type=s3
    bucket: reconciliation-data
    endpoint: https://s3.amazonaws.com
```

### Data Flow (Local Mode)
1. Input files read from local filesystem
2. Intermediate results stored in temp directories
3. Checkpoints saved to PostgreSQL or local files
4. Output files written to configurable local path

---

## Priority Phasing

### Phase 1: MVP (55 SP)
- Project Setup (3.5)
- Database (3.5)
- Data Ingestion (8.5)
- Schema Normalization (3.5)
- Matching Engine (11)
- Rule Expression - core (5)
- Multi-Stage Workflows (6)
- Temporal Orchestration (7.5)
- REST API - core (6)

### Phase 2: Full Backend (26.5 SP)
- Rule Expression - advanced (4.5)
- Match Explainability (4)
- REST API - complete (3.5)
- Security (7.5)
- Monitoring (5)
- Documentation - core (2)

### Phase 3: Frontend (23.5 SP)
- React Frontend - complete (23.5)

### Phase 4: Quality (21.5 SP)
- Testing (18)
- Documentation - complete (3.5)
