# Security

## 1. Overview

The reconciliation engine is a **single-tenant application** deployed per organization. Security requirements include:

- **Authentication**: Verify user identity via OAuth2/SSO
- **Authorization**: Role-based access control (RBAC)
- **Credential Security**: Encrypted storage of sensitive credentials
- **Audit Logging**: Track all user actions and system events
- **Data Protection**: Encryption at rest and in transit

## 2. Authentication

### 2.1 OAuth 2.0 / SSO

**Requirement**: User authentication via OAuth 2.0 or organizational SSO.

**Supported Flows**:
- **Authorization Code Flow**: For web application login
- **Client Credentials Flow**: For API/service-to-service auth

**Configuration**:
```yaml
authentication:
  provider: oauth2
  authorization_endpoint: https://auth.company.com/oauth/authorize
  token_endpoint: https://auth.company.com/oauth/token
  userinfo_endpoint: https://auth.company.com/oauth/userinfo
  client_id: ${SECRET:oauth_client_id}
  client_secret: ${SECRET:oauth_client_secret}
  scopes:
    - reconciliation:read
    - reconciliation:write
    - reconciliation:admin
```

### 2.2 Token Management

**Requirement**: Support JWT tokens with expiration and refresh.

**Token Contents**:
```json
{
  "sub": "user@company.com",
  "roles": ["reconciliation_analyst", "data_viewer"],
  "iat": 1710499800,
  "exp": 1710503400,
  "scope": "reconciliation:read reconciliation:write"
}
```

### 2.3 Session Management

**Requirement**: Web sessions with configurable timeout.

```yaml
session:
  timeout: 3600  # 1 hour
  refresh_before_expiry: 300  # Refresh 5 minutes before expiration
  max_concurrent_sessions: 3
```

## 3. Authorization (RBAC)

### 3.1 Roles

**Requirement**: Support predefined and custom roles.

**Predefined Roles**:

| Role | Permissions |
|------|-------------|
| `viewer` | View reconciliation results, export data |
| `analyst` | Run reconciliations, create queries, view all results |
| `admin` | Configure sources, rules, schemas, manage users |

### 3.2 Permissions

**Granular Permissions**:

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
| `user:read` | View users |
| `user:write` | Manage users and roles |
| `audit:read` | View audit logs |

### 3.3 Role Assignment

```yaml
user:
  email: jane.smith@company.com
  roles:
    - analyst
  custom_permissions:
    - datasource:read  # Additional permission beyond role
```

### 3.4 Resource-Level Permissions

**Requirement**: Control access at individual resource level.

```yaml
reconciliation:
  name: payment_gateway_recon
  owner: john.doe@company.com
  permissions:
    - user: jane.smith@company.com
      level: read
    - role: analyst
      level: execute
    - team: finance_team
      level: write
```

## 4. Credential Security

### 4.1 Encryption at Rest

**Requirement**: All sensitive credentials encrypted at rest.

**Encrypted Fields**:
- Database passwords
- SFTP private keys and passwords
- API keys and tokens
- OAuth client secrets

**Encryption Method**:
```yaml
encryption:
  algorithm: AES-256-GCM
  key_management: file  # or: aws_kms, hashicorp_vault, azure_keyvault
  key_rotation: manual
```

### 4.2 Secret Storage

**Requirement**: Support external secret management or local encrypted storage.

**Supported Providers**:
- Local encrypted file (default)
- HashiCorp Vault
- AWS Secrets Manager
- Azure Key Vault
- GCP Secret Manager

**Configuration**:
```yaml
secret_manager:
  provider: local  # or: hashicorp_vault, aws_secrets_manager
  local:
    path: /etc/reconciliation/secrets.enc
    key_file: /etc/reconciliation/master.key
```

**Secret Reference**:
```yaml
datasource:
  password: ${SECRET:payment_gateway_password}
  api_key: ${SECRET:api_keys/payment_gateway}
```

### 4.3 Credential Rotation

**Requirement**: Support credential rotation with notifications.

```yaml
credential_rotation:
  notification:
    before_expiry: 7 days
    notify:
      - admin@company.com
```

## 5. Data Security

### 5.1 Encryption in Transit

**Requirement**: All data transmission encrypted via TLS 1.2+.

```yaml
network_security:
  tls_version: "1.2"
  cipher_suites:
    - TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
    - TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
```

### 5.2 Data Masking

**Requirement**: Mask sensitive fields in logs and UI.

**Masked Fields**:
- Card numbers (show last 4 digits)
- Account numbers
- SSN/Tax IDs
- Passwords, API keys

**Configuration**:
```yaml
data_masking:
  enabled: true
  rules:
    - field: card_number
      mask_type: last4
      example: "************1234"
    - field: account_number
      mask_type: partial
      visible_chars: 4
    - field: password
      mask_type: full
      replacement: "********"
```

### 5.3 PII Handling

**Requirement**: Identify and protect personally identifiable information (PII).

```yaml
pii_fields:
  - name
  - email
  - phone_number
  - address
  - ssn

pii_protection:
  encryption: required
  access_logging: enabled
```

### 5.4 Data Retention

**Requirement**: Configurable retention policies.

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

## 6. Audit Logging

### 6.1 Audit Events

**Requirement**: Log all security-relevant events.

**Logged Events**:
- User login/logout
- Failed authentication attempts
- Permission changes
- Data source access
- Reconciliation execution
- Query execution
- Data exports
- Configuration changes
- Secret access

### 6.2 Audit Log Structure

```yaml
audit_log:
  event_id: AUDIT-2024-03-15-0001
  timestamp: 2024-03-15T12:00:00Z
  user_id: john.doe@company.com
  event_type: reconciliation_executed
  action: execute
  resource_type: reconciliation
  resource_id: payment_gateway_recon
  source_ip: 192.168.1.100
  user_agent: "Mozilla/5.0..."
  result: success
  details:
    reconciliation_unit:
      date: 2024-03-15
    records_processed: 10000
    duration: 45s
```

### 6.3 Audit Log Retention

**Requirement**: Retain audit logs for compliance.

```yaml
audit_retention:
  duration: 2555 days  # 7 years
  immutable: true
  storage: append_only
```

### 6.4 Security Alerts

**Requirement**: Alert on suspicious activities.

**Alert Conditions**:
- Multiple failed login attempts (5+ in 10 minutes)
- Access from new IP address
- Unusual data export volume
- Permission escalation

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
```

## 7. Network Security

### 7.1 IP Whitelisting (Optional)

**Requirement**: Support IP-based access restrictions.

```yaml
network_access:
  ip_whitelist:
    - 203.0.113.0/24
    - 198.51.100.50
  ip_blacklist:
    - 192.0.2.0/24
```

### 7.2 Private Network Access

**Requirement**: Support private network connectivity for data sources.

```yaml
datasource:
  type: database
  connection:
    host: internal-db.company.local
    network: private
```

## 8. Deployment Security

### 8.1 Single-Tenant Deployment

The application is deployed as a single-tenant instance per organization:

```yaml
deployment:
  type: single_tenant
  organization: "Acme Financial Services"
  environment: production

  isolation:
    database: dedicated
    storage: dedicated
    compute: dedicated
```

### 8.2 Environment Configuration

```yaml
environments:
  production:
    authentication:
      provider: oauth2
      endpoint: https://sso.company.com
    database:
      host: prod-db.company.local
      ssl: required
    logging:
      level: info
      audit: enabled

  staging:
    authentication:
      provider: oauth2
      endpoint: https://sso-staging.company.com
    database:
      host: staging-db.company.local
      ssl: required
    logging:
      level: debug
      audit: enabled
```

## 9. Compliance

### 9.1 SOC 2 Compliance

**Requirements**:
- Audit logging of all data access
- Encryption at rest and in transit
- Access controls and RBAC
- Data retention policies
- Incident response procedures

### 9.2 GDPR Compliance

**Requirements**:
- Data subject access requests (export user's data)
- Right to deletion (delete user's data)
- Data breach notification

```yaml
gdpr:
  enabled: true
  data_subject_access:
    max_response_time: 30 days
  right_to_deletion:
    supported: true
    retention_override: false  # Cannot delete audit logs
```

### 9.3 PCI DSS Compliance

**Requirements** (if handling card data):
- Cardholder data masking
- Restricted access to card data
- Encrypted transmission and storage

## 10. Incident Response

### 10.1 Security Breach Protocol

```yaml
incident_response:
  detection:
    - automated_alerts
    - manual_reporting
  containment:
    - revoke_compromised_credentials
    - block_suspicious_ips
  notification:
    - admin@company.com
    - security_team@company.com
  remediation:
    - patch_vulnerability
    - reset_credentials
    - audit_all_access
  post_incident:
    - incident_report
    - lessons_learned
    - update_procedures
```

## 11. Open Questions

1. **SSO Integration**: Support for SAML/LDAP in addition to OAuth2?

2. **API Rate Limiting**: Per-user rate limits to prevent abuse?

3. **Backup Encryption**: Require encryption for database backups?

4. **Two-Factor Authentication**: Require 2FA for admin users?
