# Security

## 1. Overview

The reconciliation engine is a **single-tenant application** deployed per organization. Security is simplified compared to multi-tenant architectures while maintaining enterprise-grade protection.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Security Architecture                                │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Authentication Layer                              ││
│  │   OAuth 2.0 / SSO → JWT Tokens → Spring Security                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Authorization Layer                               ││
│  │   RBAC (Roles) → Permissions → Resource-Level Access                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Data Protection                                   ││
│  │   Encryption at Rest (AES-256) → Encryption in Transit (TLS 1.2+)       ││
│  │   Credential Storage → Data Masking → PII Handling                      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Audit & Compliance                                ││
│  │   Audit Logging → Security Alerts → Compliance (SOC 2, GDPR)            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Single-Tenant Deployment

The application is deployed as a dedicated instance per organization:

```yaml
deployment:
  type: single_tenant
  organization: "Acme Financial Services"
  environment: production

  isolation:
    database: dedicated       # Dedicated PostgreSQL instance
    storage: dedicated        # Dedicated S3 bucket
    compute: dedicated        # Dedicated K8s namespace
    network: isolated         # Network policies
```

### 2.1 Benefits

| Aspect | Single-Tenant Advantage |
|--------|------------------------|
| **Security** | Complete data isolation, no cross-tenant risks |
| **Compliance** | Simplified audit scope, dedicated resources |
| **Performance** | No noisy neighbor issues |
| **Customization** | Per-organization configuration |

## 3. Authentication

### 3.1 OAuth 2.0 / SSO Integration

Spring Security configuration for OAuth 2.0:

```yaml
# application.yml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.company.com
          jwk-set-uri: https://auth.company.com/.well-known/jwks.json

# OAuth2 client configuration
authentication:
  provider: oauth2
  authorization_endpoint: https://auth.company.com/oauth/authorize
  token_endpoint: https://auth.company.com/oauth/token
  userinfo_endpoint: https://auth.company.com/oauth/userinfo
  scopes:
    - reconciliation:read
    - reconciliation:write
    - reconciliation:admin
```

### 3.2 JWT Token Structure

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user@company.com",
    "iss": "https://auth.company.com",
    "aud": "reconciliation-api",
    "exp": 1710547200,
    "iat": 1710460800,
    "roles": ["analyst", "data_viewer"],
    "scope": "reconciliation:read reconciliation:write"
  }
}
```

### 3.3 Spring Security Configuration

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers("/api/**").authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthConverter()))
            )
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            );

        return http.build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthConverter() {
        JwtGrantedAuthoritiesConverter converter = new JwtGrantedAuthoritiesConverter();
        converter.setAuthoritiesClaimName("roles");
        converter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(converter);
        return jwtConverter;
    }
}
```

### 3.4 Session Management

```yaml
session:
  timeout: 3600              # 1 hour
  refresh_before_expiry: 300  # Refresh 5 minutes before expiration
  max_concurrent_sessions: 3
```

## 4. Authorization (RBAC)

### 4.1 Predefined Roles

| Role | Permissions |
|------|-------------|
| `viewer` | View reconciliation results, export data |
| `analyst` | Run reconciliations, create queries, view all results |
| `admin` | Configure sources, rules, schemas, manage users |

### 4.2 Granular Permissions

| Permission | Description |
|------------|-------------|
| `reconciliation:read` | View reconciliation configurations and results |
| `reconciliation:write` | Create and modify reconciliation configurations |
| `reconciliation:execute` | Run reconciliations |
| `reconciliation:delete` | Delete reconciliations and results |
| `datasource:read` | View data source configurations |
| `datasource:write` | Create and modify data sources |
| `datasource:test` | Test data source connections |
| `schema:read` | View schemas |
| `schema:write` | Create and modify schemas |
| `rules:read` | View matching rules |
| `rules:write` | Create and modify matching rules |
| `audit:read` | View audit logs |

### 4.3 Permission Enforcement

```java
@RestController
@RequestMapping("/api/reconciliations")
public class ReconciliationController {

    @GetMapping
    @PreAuthorize("hExpression CompilerasAuthority('reconciliation:read')")
    public List<Reconciliation> list() {
        return reconciliationService.findAll();
    }

    @PostMapping
    @PreAuthorize("hasAuthority('reconciliation:write')")
    public Reconciliation create(@RequestBody ReconciliationRequest request) {
        return reconciliationService.create(request);
    }

    @PostMapping("/{id}/run")
    @PreAuthorize("hasAuthority('reconciliation:execute')")
    public RunStatus run(@PathVariable String id) {
        return reconciliationService.run(id);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('reconciliation:delete')")
    public void delete(@PathVariable String id) {
        reconciliationService.delete(id);
    }
}
```

## 5. Expression Security

### 5.1 Polars Expression Safety

Unlike arbitrary code execution, Polars expressions are declarative and safe:

```python
# Block JSON is compiled to Polars expressions
# No file I/O, no network access, no system calls

# Safe operations only:
rule_expr = (
    (pl.col("currency") == pl.col("currency_right")) &
    ((pl.col("amount") - pl.col("amount_right")).abs() <= 0.01)
)
```

### 5.2 Numba JIT Security

For complex rules using Numba JIT, functions are pre-approved:

```python
# Only pre-defined Numba functions are allowed
# No arbitrary Python code execution

ALLOWED_NUMBA_FUNCTIONS = {
    "validate_tiered_fee",
    "validate_fx_rate",
    "validate_checksum",
}

def execute_custom_rule(func_name: str, *args):
    if func_name not in ALLOWED_NUMBA_FUNCTIONS:
        raise SecurityError(f"Function '{func_name}' not allowed")
    return NUMBA_REGISTRY[func_name](*args)
```

### 5.3 AST Validation Pipeline

User-provided Polars expressions are validated before execution using Python AST analysis:

```python
import ast
import polars as pl

ALLOWED_POLARS_METHODS = {
    # Math
    'abs', 'ceil', 'floor', 'round', 'sqrt', 'log', 'exp',
    # String
    'str.to_uppercase', 'str.to_lowercase', 'str.slice', 'str.strip_chars',
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

### 5.4 Expression Sandboxing

| Safeguard | Implementation |
|-----------|----------------|
| **Container Isolation** | Each job runs in ephemeral Kubernetes pod with no network egress |
| **Resource Limits** | Hard limits on CPU (4 cores), memory (2GB), execution time (10 min) |
| **Restricted Builtins** | Python `exec()`/`eval()` wrapped with restricted globals (no `__import__`, `open`, `os`, `subprocess`) |
| **Allowlist-Only Functions** | Only approved Polars expression functions permitted |
| **AST Validation** | Pre-parse expressions and reject any non-Polars constructs |
| **Read-Only Data** | Job containers mount source data as read-only volumes |
| **No Secrets in Environment** | Database credentials passed only to loader, not to expression evaluator |

### 5.5 Resource Limits

K8s Jobs have strict resource limits:

```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "1000m"
  limits:
    memory: "8Gi"
    cpu: "4000m"

# Job timeout
activeDeadlineSeconds: 3600

# Execution context
execution:
  max_cpu_cores: 4
  max_memory_gb: 2
  max_execution_minutes: 10
  network_egress: disabled
```

## 6. Data Protection

### 6.1 Encryption at Rest

| Data | Storage | Encryption |
|------|---------|------------|
| Configurations | PostgreSQL | TDE (Transparent Data Encryption) |
| Credentials | K8s Secrets | Encrypted etcd, external secret manager |
| Source Data | S3 (Parquet) | SSE-S3 or SSE-KMS |
| Results | S3 (Parquet) | SSE-S3 or SSE-KMS |
| Audit Logs | PostgreSQL | AES-256 |

### 6.2 Encryption in Transit

```yaml
network_security:
  tls_version: "1.2"
  cipher_suites:
    - TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
    - TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256

# All internal communication uses TLS
# - Spring Boot ↔ PostgreSQL
# - Polars Jobs ↔ S3
# - Spring Boot ↔ Airbyte
```

### 6.3 Credential Storage

```yaml
# Kubernetes External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: recon-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: recon-secrets
  data:
    - secretKey: database-password
      remoteRef:
        key: recon/database
        property: password
    - secretKey: s3-secret-key
      remoteRef:
        key: recon/s3
        property: secret_key
```

### 6.4 Data Masking

Sensitive fields are masked in logs and UI:

```java
@Component
public class DataMaskingService {

    private static final Map<String, MaskType> MASK_RULES = Map.of(
        "card_number", MaskType.LAST4,
        "account_number", MaskType.PARTIAL,
        "ssn", MaskType.FULL,
        "password", MaskType.FULL,
        "api_key", MaskType.FULL
    );

    public String mask(String fieldName, String value) {
        MaskType type = MASK_RULES.get(fieldName);
        if (type == null) return value;

        return switch (type) {
            case LAST4 -> "************" + value.substring(value.length() - 4);
            case PARTIAL -> value.substring(0, 4) + "****";
            case FULL -> "********";
        };
    }
}
```

### 6.5 Data Retention

```yaml
retention_policy:
  reconciliation_results:
    duration: 730 days  # 2 years
    after_expiry: delete

  audit_logs:
    duration: 2555 days  # 7 years
    after_expiry: archive

  source_data:
    duration: 90 days
    after_expiry: delete

  cleanup_schedule: "0 2 * * *"  # Daily at 2 AM
```

## 7. Audit Logging

### 7.1 Logged Events

| Event Category | Events |
|----------------|--------|
| **Authentication** | login, logout, failed_login, token_refresh |
| **Authorization** | permission_denied, role_change |
| **Reconciliation** | created, updated, deleted, executed, completed, failed |
| **Data Source** | created, updated, deleted, sync_triggered, sync_completed |
| **Configuration** | rule_created, rule_updated, schema_changed |
| **Data Access** | result_viewed, result_exported, query_executed |

### 7.2 Audit Log Structure

```json
{
  "event_id": "AUDIT-2024-03-15-0001",
  "timestamp": "2024-03-15T12:00:00Z",
  "user_id": "john.doe@company.com",
  "event_type": "reconciliation_executed",
  "action": "execute",
  "resource_type": "reconciliation",
  "resource_id": "recon_payment_gateway",
  "source_ip": "192.168.1.100",
  "user_agent": "Mozilla/5.0...",
  "result": "success",
  "details": {
    "workflow_id": "wf_123",
    "stages_count": 3,
    "records_processed": 50000,
    "duration_ms": 45000
  }
}
```

### 7.3 Audit Service Implementation

```java
@Service
public class AuditService {

    private final AuditLogRepository repository;
    private final ObjectMapper objectMapper;

    public void log(AuditEvent event) {
        AuditLog entry = AuditLog.builder()
            .eventId(generateEventId())
            .timestamp(Instant.now())
            .userId(event.getUserId())
            .eventType(event.getType())
            .action(event.getAction())
            .resourceType(event.getResourceType())
            .resourceId(event.getResourceId())
            .sourceIp(event.getSourceIp())
            .userAgent(event.getUserAgent())
            .result(event.getResult())
            .details(objectMapper.writeValueAsString(event.getDetails()))
            .build();

        repository.save(entry);
    }
}
```

### 7.4 Audit Log Retention

```yaml
audit_retention:
  duration: 2555 days  # 7 years for compliance
  immutable: true
  storage: append_only
```

## 8. Security Alerts

### 8.1 Alert Conditions

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Failed login attempts | 5 in 10 minutes | Lock account, notify admin |
| Access from new IP | First access | Email notification |
| Unusual export volume | > 100,000 records | Require approval |
| Permission escalation | Any | Notify admin |
| Job failure spike | > 5 failures in 1 hour | Alert ops team |

### 8.2 Alert Configuration

```yaml
security_alerts:
  - condition: failed_login_threshold
    threshold: 5
    window: 600 seconds
    action:
      - lock_account
      - notify: admin@company.com

  - condition: unusual_export
    threshold: 100000 records
    action:
      - require_approval
      - notify: admin@company.com

  - condition: job_failure_spike
    threshold: 5
    window: 3600 seconds
    action:
      - notify: ops@company.com
```

## 9. Network Security

### 9.1 Kubernetes Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: recon-api-policy
  namespace: recon
spec:
  podSelector:
    matchLabels:
      app: recon-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              app: airbyte
      ports:
        - port: 8001
```

### 9.2 Pod Security Standards

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: recon-api
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
  containers:
    - name: api
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
```

## 10. Security Headers

Spring Boot security headers configuration:

```java
@Configuration
public class SecurityHeadersConfig implements WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request,
                                    HttpServletResponse response,
                                    Object handler) {
                response.setHeader("X-Content-Type-Options", "nosniff");
                response.setHeader("X-Frame-Options", "DENY");
                response.setHeader("X-XSS-Protection", "1; mode=block");
                response.setHeader("Content-Security-Policy", "default-src 'self'");
                response.setHeader("Strict-Transport-Security",
                    "max-age=31536000; includeSubDomains");
                response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
                return true;
            }
        });
    }
}
```

## 11. Compliance

### 11.1 SOC 2 Compliance

| Control | Implementation |
|---------|---------------|
| Access Control | RBAC, OAuth 2.0, MFA |
| Audit Logging | All data access logged, 7-year retention |
| Encryption | At rest (AES-256), in transit (TLS 1.2+) |
| Data Retention | Configurable policies, automated cleanup |
| Incident Response | Documented procedures, security alerts |

### 11.2 GDPR Compliance

```yaml
gdpr:
  enabled: true
  data_subject_access:
    max_response_time: 30 days
    export_format: json
  right_to_deletion:
    supported: true
    retention_override: false  # Cannot delete audit logs
  data_breach_notification:
    max_notification_time: 72 hours
    notify: dpo@company.com
```

## 12. Security Checklist

### Development

- [ ] Dependencies scanned for vulnerabilities (Snyk, Dependabot)
- [ ] Static code analysis (SonarQube, SpotBugs)
- [ ] Secrets never committed to repository
- [ ] Input validation on all endpoints
- [ ] Output encoding for XSS prevention
- [ ] SQL injection prevention (parameterized queries)

### Deployment

- [ ] TLS 1.2+ for all connections
- [ ] Network policies restricting pod communication
- [ ] Resource limits on all containers
- [ ] Read-only root filesystem where possible
- [ ] Non-root container users
- [ ] Secrets managed via external secret manager

### Operations

- [ ] Audit logging enabled and monitored
- [ ] Log aggregation configured (Loki, ELK)
- [ ] Alerts for security events
- [ ] Regular security scans (Trivy, Falco)
- [ ] Incident response plan documented
- [ ] Regular backup verification
