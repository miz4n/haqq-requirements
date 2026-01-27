# Reconciliation Engine - Requirements Overview

## 1. Executive Summary

The Reconciliation Engine is a mission-critical SaaS platform designed for large fintech systems to perform automated, configurable reconciliation of financial transactions across multiple data sources. The system enables financial institutions to match, verify, and audit transactions with complete traceability and explainability.

**NOTE: In this document, LUA is used to express dynamic configuration templates without recompiling the engine again. It doesn't mean we will/must use LUA**

### Key Capabilities
- **Multi-source reconciliation**: Compare data from SFTP files, APIs, and databases
- **Flexible matching rules**: Support for join-based, tolerance-based, and conditional matching
- **Complete auditability**: Track every match decision with full explainability
- **High performance**: Handle 1M x 1M transaction reconciliations per second
- **Multi-tenant SaaS**: Isolated tenant data with configurable retention policies
- **Configuration-driven**: YAML-based DSL with web UI for non-technical users


## 2. System Scope

### In Scope
- **Data Ingestion**: Fetch structured data (CSV/JSON) from SFTP, REST APIs, and databases
- **Schema Normalization**: Type mapping, field transformations, derived fields, enum mapping
- **Matching Engine**: Configurable rules for one-to-one and one-to-many reconciliation
- **Multi-stage Reconciliation**: Chain reconciliations to handle complex workflows
- **Results Management**: Queryable, exportable, immutable reconciliation results
- **Patch Management**: Apply corrections to source data without external system changes
- **Security**: OAuth2 authentication, role-based permissions, encrypted credentials
- **Performance**: Support for parallel reconciliation jobs with resource limits
- **Web Application**: Full UI for configuration, execution, and analysis
- **Retention Policies**: Configurable data cleanup with automated jobs

### Out of Scope (Phase 1)
- Full dispute management workflow (basic exception tracking only)
- Real-time streaming reconciliation (batch/on-demand only)
- Multi-currency and FX rate handling
- Machine learning-based matching suggestions
- External system integrations beyond data fetch (no write-back capabilities)

## 3. Core Concepts

### Reconciliation Unit
A dateTimeRange parameter (start and end datetime) with a preconfigured interval that defines the scope of a reconciliation run. The interval determines how the range is subdivided and what template variables (year, month, day, hour, minute, second) are generated for data source queries.

### Data Source
A configured connection to external systems (SFTP server, REST API, or database) with authentication, connection parameters, and query/file patterns.

### Schema
A normalized representation of data structure with type definitions, field mappings, and transformation rules. Both sources in a reconciliation must be mapped to a common schema.

### Matching Rules
Ordered, versioned rules that define how records from two sources are matched. Rules can be composable expressions including joins, comparisons, tolerances, and conditional logic.

### Reconciliation Job
A versioned configuration that combines two data sources, schema mappings, and matching rules to perform reconciliation for a given reconciliation unit.

### Results
Immutable output consisting of:
- **Matched records**: Inner join results with rule match details
- **Unmatched left**: Records from source A with no match in source B
- **Unmatched right**: Records from source B with no match in source A
- **Explainability data**: Which rules matched/failed for each record

### Stages
Multi-step reconciliation where the output of one reconciliation becomes the input to the next stage.

## 4. Architecture Principles

### Configuration-Driven
The system is driven by a YAML-based DSL that describes:
- Data source connections
- Schema definitions and mappings
- Matching rule logic
- Reconciliation job configurations

The web UI translates user interactions into this DSL, allowing both programmatic and visual configuration.

### Plugin Architecture
Data sources follow a common interface pattern, enabling new source types to be added without modifying the reconciliation engine core logic.

### Versioning
All configurations (data sources, schemas, rules, reconciliation jobs) are versioned to ensure:
- Reproducibility of historical reconciliations
- Audit trail of configuration changes
- Ability to rollback or compare versions

### Immutability
Reconciliation results are immutable once generated. Changes require:
- New reconciliation run with updated configuration, OR
- Patch files applied to source data with re-run

## 5. User Personas

### Financial Controller
Runs scheduled reconciliations, reviews match/mismatch reports, investigates exceptions, exports results for auditors.

### Reconciliation Analyst
Configures reconciliation rules, adjusts tolerances, creates derived fields, troubleshoots matching logic.

### System Administrator
Manages data source connections, configures retention policies, monitors system performance, manages user permissions.

### Integration Engineer
Writes YAML configurations directly, creates custom Lua scripts for complex transformations, integrates with external systems via API.

## 6. Key Use Cases

### Payment Gateway Reconciliation
Match payment transactions from internal ledger against payment gateway settlement reports to identify discrepancies in amounts, fees, or missing transactions.

### Bank Statement Reconciliation
Compare internal cash position against bank statements to ensure all deposits, withdrawals, and fees are accounted for.

### Merchant Settlement Reconciliation
Verify that merchant payouts match aggregated transaction data, accounting for fees, chargebacks, and refunds.

### Trade Settlement Reconciliation
Match executed trades from trading system against clearinghouse confirmations to ensure quantity, price, and settlement date alignment.

### Card Network Reconciliation
Reconcile card transactions from issuer processor against card network (Visa/Mastercard) files to identify interchange discrepancies.

## 7. Success Criteria

### Functional
- Support for all three data source types (SFTP, API, DB)
- Rule engine can express 95% of common fintech reconciliation patterns
- Multi-stage reconciliation for complex workflows
- Complete explainability for every match decision

### Performance
- 1M x 1M transaction reconciliation completes in < 1 second (with up to 5 rules)
- Support for multiple parallel reconciliation jobs
- Per-job memory limit of 2GB

### Usability
- Non-technical users can configure basic reconciliations via web UI
- Technical users can write YAML configurations efficiently
- Clear, actionable error messages for configuration and runtime errors

### Reliability
- Immutable audit trail for all reconciliations
- Automated retention policy enforcement
- Encrypted storage of all credentials

## 8. Document Structure

This requirements suite is organized as follows:

- **01-reconciliation-units.md**: Time-based parameter definitions
- **02-data-sources.md**: SFTP, API, and database source configurations
- **03-data-formats.md**: CSV and JSON parsing requirements
- **04-schema-normalization.md**: Type system, mappings, derived fields
- **05-matching-rules.md**: Rule system and fintech examples
- **06-reconciliation-modes.md**: One-to-one and one-to-many patterns
- **07-results-and-queryability.md**: Result structure, queries, exports
- **08-stages-and-workflows.md**: Multi-stage reconciliation and patches
- **09-security-and-tenancy.md**: Authentication, authorization, multi-tenancy
- **10-performance-requirements.md**: SLAs, resource limits, retention
- **11-missing-use-cases.md**: Gap analysis and recommendations
- **dsl/**: YAML DSL specifications and examples

## 9. Glossary

- **Reconciliation**: The process of comparing two datasets to identify matches and discrepancies
- **Tolerance**: An acceptable variance in numeric comparisons (e.g., amounts within $0.01)
- **Derived Field**: A calculated field created from existing fields using transformations
- **Enum Mapping**: Translation of categorical values between different systems (e.g., "SUCCESS" → "COMPLETED")
- **Join Key**: Field(s) used to match records across sources
- **Rule Match Group**: Set of rules that matched for a given record pair
- **Break**: An unmatched or discrepant record requiring investigation
- **Patch**: A correction applied to source data for re-reconciliation
- **Recon Unit**: Time period parameters defining the scope of a reconciliation
