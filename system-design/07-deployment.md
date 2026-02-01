# Deployment Architecture

## 1. Overview

The reconciliation engine is designed for cloud-native deployment on Kubernetes with:
- **Spring Boot API** for configuration and orchestration
- **Polars K8s Jobs** for reconciliation execution
- **Airbyte OSS** for data ingestion
- **S3** for Parquet storage (source data and results)
- **PostgreSQL** for configuration and audit logs

## 2. Kubernetes Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Kubernetes Cluster                                │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         Ingress Controller                             │ │
│  │                            (nginx)                                     │ │
│  └───────────────────────────────┬───────────────────────────────────────┘ │
│                                  │                                          │
│          ┌───────────────────────┼───────────────────────┐                 │
│          │                       │                       │                 │
│          ▼                       ▼                       ▼                 │
│  ┌───────────────┐      ┌───────────────┐      ┌───────────────┐          │
│  │   Dashboard   │      │  Spring Boot  │      │    Airbyte    │          │
│  │   (React)     │      │     API       │      │   (Web + API) │          │
│  │   Replicas: 2 │      │   Replicas: 3 │      │   Replicas: 1 │          │
│  └───────────────┘      └───────┬───────┘      └───────┬───────┘          │
│                                 │                       │                  │
│                    ┌────────────┼───────────────────────┘                  │
│                    │            │                                          │
│                    ▼            ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                        K8s API Server                               │   │
│  │                    (Job Management)                                 │   │
│  └────────────────────────────┬───────────────────────────────────────┘   │
│                               │                                            │
│                               ▼                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                     Polars K8s Jobs                                 │   │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐   │   │
│  │   │  Job: S1   │  │  Job: S2   │  │  Job: S3   │  │  Job: S4   │   │   │
│  │   │ (Polars)   │  │ (Polars)   │  │ (Polars)   │  │ (Polars)   │   │   │
│  │   └────────────┘  └────────────┘  └────────────┘  └────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                               │                                            │
│                               ▼                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                         Data Layer                                  │   │
│  │   ┌─────────────────┐            ┌─────────────────────────────┐   │   │
│  │   │   PostgreSQL    │            │        S3 / MinIO           │   │   │
│  │   │  (Config/Audit) │            │  /sources/  (from Airbyte)  │   │   │
│  │   │   StatefulSet   │            │  /results/  (from Polars)   │   │   │
│  │   └─────────────────┘            └─────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Component Specifications

### 3.1 Spring Boot API Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recon-api
  labels:
    app: recon-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: recon-api
  template:
    metadata:
      labels:
        app: recon-api
    spec:
      serviceAccountName: recon-api-sa
      containers:
        - name: api
          image: reconciliation/spring-boot-api:latest
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_DATASOURCE_URL
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: database-url
            - name: SPRING_DATASOURCE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: database-username
            - name: SPRING_DATASOURCE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: database-password
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: access-key
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: secret-key
            - name: AWS_REGION
              value: "us-east-1"
            - name: S3_BUCKET
              value: "recon-data"
            - name: AIRBYTE_API_URL
              value: "http://airbyte-server:8001"
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
---
# ServiceAccount for K8s API access
apiVersion: v1
kind: ServiceAccount
metadata:
  name: recon-api-sa
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: recon-job-manager
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: recon-api-job-manager
subjects:
  - kind: ServiceAccount
    name: recon-api-sa
roleRef:
  kind: Role
  name: recon-job-manager
  apiGroup: rbac.authorization.k8s.io
```

### 3.2 Polars Job Template

Jobs are created dynamically by Spring Boot for each reconciliation stage.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: recon-{workflow_id}-{stage_id}
  labels:
    app: recon-engine
    component: polars-job
    workflow: "{workflow_id}"
    stage: "{stage_id}"
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: recon-engine
        component: polars-job
    spec:
      restartPolicy: Never
      containers:
        - name: polars-engine
          image: reconciliation/polars-engine:latest
          env:
            - name: WORKFLOW_ID
              value: "{workflow_id}"
            - name: STAGE_ID
              value: "{stage_id}"
            - name: CONFIG_URL
              value: "s3://recon-data/configs/{workflow_id}/{stage_id}.yaml"
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: access-key
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: secret-key
            - name: AWS_REGION
              value: "us-east-1"
            - name: RESULT_CALLBACK_URL
              value: "http://recon-api:8080/api/internal/jobs/{workflow_id}/{stage_id}/complete"
          resources:
            requests:
              memory: "2Gi"
              cpu: "1000m"
            limits:
              memory: "8Gi"
              cpu: "4000m"
          volumeMounts:
            - name: scratch
              mountPath: /tmp/polars
      volumes:
        - name: scratch
          emptyDir:
            sizeLimit: 20Gi
```

### 3.3 Polars Engine Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir \
    polars==0.20.0 \
    pyarrow==14.0.0 \
    boto3==1.34.0 \
    pyyaml==6.0.1 \
    numba==0.59.0

# Copy application code
COPY src/ /app/src/
COPY main.py /app/

# Set environment
ENV PYTHONUNBUFFERED=1
ENV POLARS_MAX_THREADS=4

ENTRYPOINT ["python", "main.py"]
```

### 3.4 Web Dashboard

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recon-dashboard
  labels:
    app: recon-dashboard
spec:
  replicas: 2
  selector:
    matchLabels:
      app: recon-dashboard
  template:
    metadata:
      labels:
        app: recon-dashboard
    spec:
      containers:
        - name: dashboard
          image: reconciliation/dashboard:latest
          ports:
            - containerPort: 80
          env:
            - name: API_URL
              value: "/api"
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
```

### 3.5 Airbyte Deployment

Use the official Airbyte Helm chart or Docker Compose in K8s:

```yaml
# Reference: https://docs.airbyte.com/deploying-airbyte/on-kubernetes
apiVersion: apps/v1
kind: Deployment
metadata:
  name: airbyte-server
  labels:
    app: airbyte
spec:
  replicas: 1
  selector:
    matchLabels:
      app: airbyte-server
  template:
    metadata:
      labels:
        app: airbyte-server
    spec:
      containers:
        - name: airbyte-server
          image: airbyte/server:latest
          ports:
            - containerPort: 8001
          env:
            - name: DATABASE_URL
              value: "jdbc:postgresql://postgres:5432/airbyte"
            - name: CONFIGS_DATABASE_URL
              value: "jdbc:postgresql://postgres:5432/airbyte"
---
apiVersion: v1
kind: Service
metadata:
  name: airbyte-server
spec:
  selector:
    app: airbyte-server
  ports:
    - port: 8001
      targetPort: 8001
```

## 4. Services

### 4.1 API Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: recon-api
spec:
  selector:
    app: recon-api
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP
```

### 4.2 Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: recon-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - recon.example.com
      secretName: recon-tls
  rules:
    - host: recon.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: recon-api
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: recon-dashboard
                port:
                  number: 80
```

## 5. Data Services

### 5.1 PostgreSQL

Option 1: Managed Service (Recommended for production)
- AWS RDS PostgreSQL
- Google Cloud SQL
- Azure Database for PostgreSQL

Option 2: Self-Managed StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: recon
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: password
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ssd
        resources:
          requests:
            storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
```

### 5.2 S3 Storage (MinIO for self-hosted)

Option 1: AWS S3 (Recommended for production)

Option 2: MinIO (S3-Compatible)

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: minio
spec:
  serviceName: minio
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      containers:
        - name: minio
          image: minio/minio:latest
          args: ["server", "/data", "--console-address", ":9001"]
          ports:
            - containerPort: 9000
            - containerPort: 9001
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: access-key
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: s3-credentials
                  key: secret-key
          volumeMounts:
            - name: data
              mountPath: /data
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ssd
        resources:
          requests:
            storage: 500Gi
---
apiVersion: v1
kind: Service
metadata:
  name: minio
spec:
  selector:
    app: minio
  ports:
    - name: api
      port: 9000
      targetPort: 9000
    - name: console
      port: 9001
      targetPort: 9001
```

## 6. S3 Bucket Structure

```
s3://recon-data/
├── sources/                        # Airbyte output (Parquet)
│   ├── {source_id}/
│   │   └── date=YYYY-MM-DD/
│   │       ├── part-0001.parquet
│   │       ├── part-0002.parquet
│   │       └── ...
│   └── ...
├── results/                        # Polars output (Parquet)
│   ├── {workflow_id}/
│   │   ├── {stage_id}/
│   │   │   ├── matched.parquet
│   │   │   ├── unmatched_left.parquet
│   │   │   ├── unmatched_right.parquet
│   │   │   ├── match_failed.parquet
│   │   │   └── _metrics.json
│   │   └── ...
│   └── ...
└── configs/                        # Job configurations
    └── {workflow_id}/
        └── {stage_id}.yaml
```

## 7. Configuration Management

### 7.1 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: recon-config
data:
  # Spring Boot
  SPRING_PROFILES_ACTIVE: "production"
  SERVER_PORT: "8080"

  # Polars Jobs
  POLARS_MAX_THREADS: "4"
  POLARS_STREAMING_CHUNK_SIZE: "100000"

  # Job defaults
  JOB_TIMEOUT_SECONDS: "3600"
  JOB_BACKOFF_LIMIT: "3"
  JOB_TTL_AFTER_FINISHED: "86400"

  # Retention
  RESULT_RETENTION_DAYS: "90"
```

### 7.2 Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: recon-secrets
type: Opaque
stringData:
  database-url: "jdbc:postgresql://postgres:5432/recon"
  database-username: "recon"
  database-password: "secretpassword"
---
apiVersion: v1
kind: Secret
metadata:
  name: s3-credentials
type: Opaque
stringData:
  access-key: "minioadmin"
  secret-key: "minioadmin"
```

## 8. Monitoring Stack

### 8.1 Prometheus ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: recon-api-monitor
spec:
  selector:
    matchLabels:
      app: recon-api
  endpoints:
    - port: http
      path: /actuator/prometheus
      interval: 15s
```

### 8.2 Key Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| `recon_jobs_active` | Spring Boot | Currently running K8s jobs |
| `recon_jobs_completed_total` | Spring Boot | Completed jobs counter |
| `recon_jobs_failed_total` | Spring Boot | Failed jobs counter |
| `recon_stage_duration_seconds` | Polars Job | Stage execution time |
| `recon_records_processed_total` | Polars Job | Records processed |
| `recon_match_rate` | Polars Job | Match percentage |
| `airbyte_sync_duration_seconds` | Airbyte | Data sync duration |
| `s3_bytes_written` | Polars Job | Data written to S3 |

### 8.3 Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: recon-alerts
spec:
  groups:
    - name: recon-engine
      rules:
        - alert: ReconJobFailed
          expr: increase(recon_jobs_failed_total[5m]) > 0
          for: 1m
          labels:
            severity: warning
          annotations:
            summary: "Reconciliation job failed"

        - alert: ReconAPIDown
          expr: up{job="recon-api"} == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Reconciliation API is down"

        - alert: AirbyteSyncFailed
          expr: airbyte_sync_status == 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Airbyte sync failed"

        - alert: S3StorageHigh
          expr: s3_bucket_size_bytes > 500e9
          for: 1h
          labels:
            severity: warning
          annotations:
            summary: "S3 storage exceeding 500GB"
```

## 9. Helm Chart Structure

```
helm/recon-engine/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── api-serviceaccount.yaml
│   ├── api-rbac.yaml
│   ├── polars-job-template.yaml      # ConfigMap with job template
│   ├── dashboard-deployment.yaml
│   ├── dashboard-service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   ├── servicemonitor.yaml
│   └── prometheusrule.yaml
└── charts/
    ├── postgresql/
    ├── minio/
    └── airbyte/
```

### 9.1 values.yaml

```yaml
global:
  imageRegistry: ""
  imagePullSecrets: []

api:
  replicaCount: 3
  image:
    repository: reconciliation/spring-boot-api
    tag: latest
    pullPolicy: IfNotPresent
  resources:
    requests:
      memory: "512Mi"
      cpu: "500m"
    limits:
      memory: "1Gi"
      cpu: "1000m"

polarsJob:
  image:
    repository: reconciliation/polars-engine
    tag: latest
  resources:
    requests:
      memory: "2Gi"
      cpu: "1000m"
    limits:
      memory: "8Gi"
      cpu: "4000m"
  backoffLimit: 3
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 86400

dashboard:
  replicaCount: 2
  image:
    repository: reconciliation/dashboard
    tag: latest

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: recon.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: recon-tls
      hosts:
        - recon.example.com

postgresql:
  enabled: true
  auth:
    database: recon
    username: recon
    existingSecret: postgres-secrets

minio:
  enabled: true
  defaultBuckets: "recon-data"

airbyte:
  enabled: true
  # See Airbyte Helm chart for full configuration
```

## 10. CI/CD Pipeline

```yaml
# .github/workflows/deploy.yaml
name: Deploy

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ secrets.REGISTRY }}
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Build and push Spring Boot API
        uses: docker/build-push-action@v5
        with:
          context: ./api
          push: true
          tags: |
            ${{ secrets.REGISTRY }}/reconciliation/spring-boot-api:${{ github.sha }}
            ${{ secrets.REGISTRY }}/reconciliation/spring-boot-api:latest

      - name: Build and push Polars Engine
        uses: docker/build-push-action@v5
        with:
          context: ./polars-engine
          push: true
          tags: |
            ${{ secrets.REGISTRY }}/reconciliation/polars-engine:${{ github.sha }}
            ${{ secrets.REGISTRY }}/reconciliation/polars-engine:latest

      - name: Build and push Dashboard
        uses: docker/build-push-action@v5
        with:
          context: ./dashboard
          push: true
          tags: |
            ${{ secrets.REGISTRY }}/reconciliation/dashboard:${{ github.sha }}
            ${{ secrets.REGISTRY }}/reconciliation/dashboard:latest

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Helm
        uses: azure/setup-helm@v3

      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBECONFIG }}

      - name: Deploy to Kubernetes
        run: |
          helm upgrade --install recon-engine ./helm/recon-engine \
            --namespace recon \
            --create-namespace \
            --set api.image.tag=${{ github.sha }} \
            --set polarsJob.image.tag=${{ github.sha }} \
            --set dashboard.image.tag=${{ github.sha }} \
            --wait
```

## 11. Resource Sizing Guide

### 11.1 Small Deployment (< 1M records)

| Component | Replicas | Memory | CPU |
|-----------|----------|--------|-----|
| Spring Boot API | 2 | 512Mi | 500m |
| Dashboard | 2 | 64Mi | 50m |
| Polars Job | 1 | 2Gi | 1000m |
| PostgreSQL | 1 | 1Gi | 500m |
| MinIO | 1 | 512Mi | 250m |

### 11.2 Medium Deployment (1M - 10M records)

| Component | Replicas | Memory | CPU |
|-----------|----------|--------|-----|
| Spring Boot API | 3 | 1Gi | 1000m |
| Dashboard | 2 | 128Mi | 100m |
| Polars Job | 1 | 8Gi | 4000m |
| PostgreSQL | 1 | 4Gi | 2000m |
| MinIO | 1 | 2Gi | 1000m |

### 11.3 Large Deployment (> 10M records)

| Component | Replicas | Memory | CPU |
|-----------|----------|--------|-----|
| Spring Boot API | 5 | 2Gi | 2000m |
| Dashboard | 3 | 256Mi | 200m |
| Polars Job | 1 | 16Gi | 8000m |
| PostgreSQL | HA cluster | 8Gi | 4000m |
| MinIO | Distributed | 4Gi | 2000m |
