# Deployment Architecture

## 1. Overview

The reconciliation engine is designed for cloud-native deployment on Kubernetes with:
- Horizontal scaling for workers
- High availability for API services
- Managed data services

## 2. Kubernetes Architecture

```mermaid
flowchart TB
    subgraph K8s["Kubernetes Cluster"]
        subgraph Ingress
            IG["Ingress Controller<br/>(nginx)"]
        end

        subgraph Frontend
            Web["Dashboard Pods<br/>Replicas: 2"]
        end

        subgraph Backend
            API["API Pods<br/>Replicas: 3"]
        end

        subgraph Workers
            W1["Worker Pod 1<br/>Go + Lua"]
            W2["Worker Pod 2<br/>Go + Lua"]
            W3["Worker Pod 3<br/>Go + Lua"]
            WN["... Pod N<br/>(HPA: 3-10)"]
        end

        subgraph Data
            PG[(PostgreSQL<br/>StatefulSet)]
            RD[(Redis<br/>Cluster)]
            S3[(MinIO<br/>S3-Compatible)]
        end
    end

    Internet --> IG
    IG --> Web
    IG --> API
    API --> Workers
    Workers --> Data
```

## 3. Component Specifications

### 3.1 API Service

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
      containers:
        - name: api
          image: recon-engine/api:latest
          ports:
            - containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: redis-url
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
```

### 3.2 Worker Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recon-worker
  labels:
    app: recon-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: recon-worker
  template:
    metadata:
      labels:
        app: recon-worker
    spec:
      containers:
        - name: worker
          image: recon-engine/worker:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: recon-secrets
                  key: redis-url
            - name: S3_ENDPOINT
              value: "minio:9000"
            - name: S3_BUCKET
              value: "recon-results"
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"
          volumeMounts:
            - name: scratch
              mountPath: /tmp/recon
      volumes:
        - name: scratch
          emptyDir:
            sizeLimit: 10Gi
```

### 3.3 Web Dashboard

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
          image: recon-engine/dashboard:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
```

## 4. Horizontal Pod Autoscaler

```mermaid
flowchart LR
    subgraph Metrics
        QueueDepth["Job Queue<br/>Depth"]
        CPUUsage["CPU<br/>Usage"]
        RequestRate["Request<br/>Rate"]
    end

    subgraph HPA["Horizontal Pod Autoscaler"]
        WorkerHPA["Worker HPA<br/>Min: 3, Max: 10"]
        APIHPA["API HPA<br/>Min: 2, Max: 5"]
    end

    subgraph Pods
        WorkerPods["Worker Pods"]
        APIPods["API Pods"]
    end

    QueueDepth -->|"Scale workers"| WorkerHPA
    CPUUsage --> WorkerHPA
    RequestRate --> APIHPA
    WorkerHPA --> WorkerPods
    APIHPA --> APIPods
```

### 4.1 Worker HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: recon-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: recon-worker
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: External
      external:
        metric:
          name: redis_queue_depth
          selector:
            matchLabels:
              queue: recon-jobs
        target:
          type: AverageValue
          averageValue: "5"
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

### 4.2 API HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: recon-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: recon-api
  minReplicas: 2
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## 5. Services

### 5.1 API Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: recon-api
spec:
  selector:
    app: recon-api
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

### 5.2 Ingress

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
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: recon-dashboard
                port:
                  number: 80
```

## 6. Data Services

### 6.1 PostgreSQL

Option 1: Managed Service (Recommended)
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
```

### 6.2 Redis

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
spec:
  serviceName: redis
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "1Gi"
              cpu: "500m"
```

### 6.3 MinIO (S3-Compatible Storage)

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
                  name: minio-secrets
                  key: access-key
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: minio-secrets
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
```

## 7. Configuration Management

### 7.1 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: recon-config
data:
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"
  WORKER_CONCURRENCY: "4"
  MAX_MEMORY_MB: "3072"
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
  database-url: "postgres://user:pass@postgres:5432/recon?sslmode=disable"
  redis-url: "redis://redis:6379"
  s3-access-key: "minioadmin"
  s3-secret-key: "minioadmin"
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
      path: /metrics
      interval: 15s
```

### 8.2 Grafana Dashboard

Key metrics to display:
- Request rate and latency
- Job queue depth
- Active workers
- Match rates
- Error rates
- Memory/CPU usage

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
        - alert: HighJobQueueDepth
          expr: redis_queue_depth{queue="recon-jobs"} > 100
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Job queue backing up"

        - alert: WorkerDown
          expr: up{job="recon-worker"} == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Recon worker is down"

        - alert: HighErrorRate
          expr: rate(recon_job_errors_total[5m]) > 0.1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High job error rate"
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
│   ├── api-hpa.yaml
│   ├── worker-deployment.yaml
│   ├── worker-hpa.yaml
│   ├── dashboard-deployment.yaml
│   ├── dashboard-service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   ├── servicemonitor.yaml
│   └── prometheusrule.yaml
└── charts/
    ├── postgresql/
    ├── redis/
    └── minio/
```

### 9.1 values.yaml

```yaml
global:
  imageRegistry: ""
  imagePullSecrets: []

api:
  replicaCount: 3
  image:
    repository: recon-engine/api
    tag: latest
    pullPolicy: IfNotPresent
  resources:
    requests:
      memory: "256Mi"
      cpu: "250m"
    limits:
      memory: "512Mi"
      cpu: "500m"
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 5
    targetCPUUtilization: 70

worker:
  replicaCount: 3
  image:
    repository: recon-engine/worker
    tag: latest
  resources:
    requests:
      memory: "1Gi"
      cpu: "500m"
    limits:
      memory: "4Gi"
      cpu: "2000m"
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10

dashboard:
  replicaCount: 2
  image:
    repository: recon-engine/dashboard
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

redis:
  enabled: true
  architecture: standalone

minio:
  enabled: true
  defaultBuckets: "recon-results"
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
      - uses: actions/checkout@v3

      - name: Build and push images
        run: |
          docker build -t recon-engine/api:${{ github.sha }} ./api
          docker build -t recon-engine/worker:${{ github.sha }} ./worker
          docker build -t recon-engine/dashboard:${{ github.sha }} ./dashboard
          docker push recon-engine/api:${{ github.sha }}
          docker push recon-engine/worker:${{ github.sha }}
          docker push recon-engine/dashboard:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to Kubernetes
        run: |
          helm upgrade --install recon-engine ./helm/recon-engine \
            --set api.image.tag=${{ github.sha }} \
            --set worker.image.tag=${{ github.sha }} \
            --set dashboard.image.tag=${{ github.sha }}
```
