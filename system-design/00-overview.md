# Reconciliation Engine - System Design Overview

## 1. Introduction

A cloud-native reconciliation engine for financial transaction matching with:
- Visual rule builder for non-technical users
- High-performance matching using Polars (1M+ records/second)
- Full explainability and audit trail
- Multi-stage workflow support
- Single-tenant deployment per organization

## 2. Requirements Summary

| Category | Requirement |
|----------|-------------|
| **Matching Modes** | 1:1 (MVP), 1:N, N:M (future) |
| **Rule Types** | Comparison, Boolean (AND/OR/NOT), Tolerance, Date functions |
| **Explainability** | Human-readable audit trail for every match decision |
| **Multi-Stage** | DAG-based workflow with stage dependencies |
| **Performance** | 1M x 1M records in < 1 second |
| **Data Sources** | Airbyte connectors (300+ sources) → Parquet → S3 |
| **Deployment** | Kubernetes (single-tenant) |
| **Users** | Non-technical (visual builder required) |

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Kubernetes Cluster                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Presentation Layer                              │   │
│  │   ┌──────────────────────┐    ┌──────────────────────────┐          │   │
│  │   │    Web Dashboard     │    │   Visual Rule Builder    │          │   │
│  │   │  (React + TypeScript)│    │   (Block Programming)    │          │   │
│  │   └──────────────────────┘    └──────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Spring Boot API Service                          │   │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐   │   │
│  │   │ Config API │  │  Run API   │  │Reports API │  │ Airbyte API │   │   │
│  │   │  (CRUD)    │  │  (Jobs)    │  │ (Results)  │  │ (Data Sync) │   │   │
│  │   └────────────┘  └────────────┘  └────────────┘  └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                  │                              │               │
│           │                  │ K8s API                      │               │
│           ▼                  ▼                              ▼               │
│  ┌──────────────┐   ┌──────────────────────┐      ┌──────────────────┐     │
│  │  PostgreSQL  │   │   Polars K8s Jobs    │      │   Airbyte OSS    │     │
│  │  (Config &   │   │   (Reconciliation)   │      │  (Data Ingestion)│     │
│  │   Audit)     │   │                      │      │                  │     │
│  └──────────────┘   │  - Read Parquet/S3   │      │  - API-driven    │     │
│                     │  - Run matching      │      │  - 300+ sources  │     │
│                     │  - Apply rules       │      │  - Parquet output│     │
│                     │  - Write results/S3  │      └────────┬─────────┘     │
│                     └──────────┬───────────┘               │               │
│                                │                           │               │
│                                ▼                           ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          S3 Storage                                  │   │
│  │   /sources/{source_id}/    - Parquet files from Airbyte             │   │
│  │   /results/{job_id}/       - Parquet results from Polars            │   │
│  │   /configs/                - Job configuration files                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4. Data Flow

```
1. CONFIGURATION
   User → Web Dashboard → Spring Boot API → PostgreSQL

2. DATA INGESTION
   Spring Boot → Airbyte API (trigger sync)
   Airbyte → External Data Source → Parquet → S3

3. RECONCILIATION
   Spring Boot → K8s API (create Job)
   Polars Job:
     → Read config from PostgreSQL
     → Read Parquet from S3
     → Execute JOIN + matching rules
     → Write results (Parquet) to S3
     → Update job status

4. RESULTS
   User → Web Dashboard → Spring Boot → Read Parquet from S3
```

## 5. Component Overview

### 5.1 Presentation Layer
- **Web Dashboard**: React + TypeScript application for job management, monitoring, and reports
- **Visual Rule Builder**: Block-based programming interface for non-technical users to define matching rules

### 5.2 API Layer (Spring Boot)
- **Config API**: CRUD operations for reconciliation configurations
- **Run API**: Job execution triggers via K8s API, status monitoring
- **Reports API**: Results retrieval from S3 Parquet files
- **Airbyte API**: Data source configuration and sync triggers

### 5.3 Reconciliation Engine (Polars)
- **Polars K8s Job**: Kubernetes Job that runs reconciliation
- **Matching Engine**: Polars join operations for high-performance record matching
- **Rule Evaluator**: Composable expressions translated to Polars expressions
- **Explainability**: Generates human-readable explanations for every match decision

### 5.4 Data Ingestion (Airbyte)
- **Airbyte OSS**: Self-hosted data integration platform
- **API-Driven**: All operations via Airbyte API (no UI dependency)
- **Parquet Output**: Data dumped to Parquet format in S3

### 5.5 Storage Layer
- **PostgreSQL**: Job configurations, audit logs, user data
- **S3**: Source data (Parquet from Airbyte), results (Parquet from Polars)

## 6. Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Reconciliation Engine** | Python 3.11+ with Polars | High-performance columnar processing, Rust-powered |
| **API Service** | Spring Boot 3.x (Java 17+) | Enterprise-grade, K8s integration, Airbyte SDK |
| **Data Ingestion** | Airbyte OSS | 300+ connectors, API-driven, Parquet support |
| **Web Dashboard** | React + TypeScript | Component-based, typed |
| **Visual Builder** | React + Custom | Block programming UI |
| **Database** | PostgreSQL 15+ | JSONB, ACID, mature |
| **Object Storage** | S3 (AWS/MinIO) | Parquet storage, direct Polars access |
| **Orchestration** | Kubernetes | K8s Jobs for reconciliation, native scaling |
| **Monitoring** | Prometheus + Grafana | K8s-native observability |
| **Logging** | Loki + Promtail | Log aggregation |

## 7. Key Design Decisions

### 7.1 Polars over Custom Go Engine
- **Performance**: Polars uses Rust backend with SIMD optimizations
- **Parquet Native**: Direct S3 Parquet reading without intermediate steps
- **Expression API**: Composable expressions map naturally to Polars
- **Lazy Evaluation**: Memory-efficient processing of large datasets

### 7.2 Spring Boot as Orchestrator
- **K8s Integration**: Fabric8 client for K8s Job management
- **Airbyte SDK**: Java SDK for Airbyte API integration
- **Enterprise Features**: Security, observability, configuration management

### 7.3 Airbyte for Data Ingestion
- **Connector Coverage**: 300+ pre-built connectors
- **API-First**: Programmatic control without UI dependency
- **Parquet Output**: Direct output to S3 in Parquet format
- **Incremental Sync**: Efficient data updates

### 7.4 K8s Jobs for Reconciliation
- **Isolation**: Each reconciliation runs in isolated container
- **Scaling**: Horizontal scaling via multiple concurrent jobs
- **Resource Management**: CPU/memory limits per job
- **Observability**: Native K8s logging and monitoring

## 8. Document Index

| Document | Description |
|----------|-------------|
| [01-matching-engine.md](./01-matching-engine.md) | Polars matching engine and algorithms |
| [02-rule-expression-system.md](./02-rule-expression-system.md) | Block types, JSON schema, Polars compilation |
| [03-explainability.md](./03-explainability.md) | Match explanation system |
| [04-multi-stage-workflows.md](./04-multi-stage-workflows.md) | K8s Job-based multi-stage reconciliation |
| [05-api-contracts.md](./05-api-contracts.md) | Spring Boot REST API endpoints |
| [06-database-schema.md](./06-database-schema.md) | PostgreSQL schema and indexes |
| [07-deployment.md](./07-deployment.md) | Kubernetes deployment architecture |
| [08-security.md](./08-security.md) | Security (single-tenant) |
| [11-datasource-connector.md](./11-datasource-connector.md) | Airbyte integration |
