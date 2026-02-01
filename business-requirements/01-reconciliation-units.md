# Reconciliation Units

## 1. Overview

A **Reconciliation Unit** defines the time-based scope for a reconciliation run. It consists of:
- **dateTimeRange**: Start and end datetime (start inclusive, end exclusive) passed at runtime
- **interval**: Preconfigured subdivision pattern that determines template variables
- **timezone**: Time zone for interpreting the datetime range

The interval determines what template variables (year, month, day, hour, minute, second) are available for:
- Constructing file patterns for SFTP data sources
- Building query parameters for API endpoints
- Generating WHERE clauses for database queries

## 2. Core Concepts

### 2.1 dateTimeRange (Runtime Argument)

The time window to reconcile, specified when running a job:
- **start**: Start datetime (inclusive)
- **end**: End datetime (exclusive)
- **timezone**: Time zone for interpretation

**Important: Exclusive End Semantics**

The end datetime uses exclusive semantics, following the half-open interval convention `[start, end)`:
- **start** is included in the range
- **end** is NOT included in the range
- To include all of March 2024: `start=2024-03-01T00:00:00Z, end=2024-04-01T00:00:00Z`
- To include all transactions on March 15th: `start=2024-03-15T00:00:00Z, end=2024-03-16T00:00:00Z`

This convention:
- Prevents overlap between consecutive periods
- Eliminates ambiguity about 23:59:59 vs 23:59:59.999...
- Aligns with standard database and programming practices
- Ensures that `end time of period N == start time of period N+1`

**Example**: Reconcile March 2024
```
start: 2024-03-01T00:00:00Z
end: 2024-04-01T00:00:00Z  # Exclusive - first moment of April (not included)
timezone: UTC
```

### 2.2 interval (Preconfigured)

How to subdivide the dateTimeRange, configured in the reconciliation definition. The interval determines:
- How the system iterates through the dateTimeRange
- What template variables are generated for each iteration

**Common intervals**: `day`, `hour`, `minute`

**Example Configuration**:
```yaml
reconciliation:
  name: daily_payment_recon
  reconciliation_unit:
    interval: day
    timezone: UTC
```

### 2.3 Template Variables

Based on the configured interval, the system generates template variables for each subdivision:

| Variable | Description | Example (for 2024-03-15 14:30:45) |
|----------|-------------|-----------------------------------|
| `{year}` | 4-digit year | 2024 |
| `{month}` | 2-digit month | 03 |
| `{day}` | 2-digit day | 15 |
| `{hour}` | 2-digit hour (00-23) | 14 |
| `{minute}` | 2-digit minute (00-59) | 30 |
| `{second}` | 2-digit second (00-59) | 45 |
| `{start_datetime}` | Full range start | 2024-03-01T00:00:00Z |
| `{end_datetime}` | Full range end (exclusive) | 2024-04-01T00:00:00Z |
| `{start_date}` | Range start date only | 2024-03-01 |
| `{end_date}` | Range end date only (exclusive) | 2024-04-01 |

## 3. How It Works

### 3.1 Configuration Time

The reconciliation is configured with an interval:

```yaml
reconciliation:
  name: daily_payment_reconciliation
  reconciliation_unit:
    interval: day  # Process by day
    timezone: UTC

  source_a:
    datasource: internal_ledger
    # Uses templates based on interval
  source_b:
    datasource: payment_gateway
```

### 3.2 Runtime Execution

User runs the job with a dateTimeRange:

```bash
reconciliation-cli run \
  --config daily_payment_reconciliation \
  --start 2024-03-01T00:00:00Z \
  --end 2024-04-01T00:00:00Z  # Exclusive end
```

### 3.3 Internal Processing

The system:
1. Takes the dateTimeRange (March 1-31, 2024)
2. Uses the preconfigured interval (day)
3. Subdivides the range into daily intervals: Mar 1, Mar 2, ..., Mar 31
4. For each day, generates template variables:
   - Day 1: `{year}=2024, {month}=03, {day}=01`
   - Day 2: `{year}=2024, {month}=03, {day}=02`
   - ...
   - Day 31: `{year}=2024, {month}=03, {day}=31`
5. Executes reconciliation for each interval

## 4. Template Substitution

### 4.1 File Patterns (SFTP)

**Configuration**:
```yaml
datasource:
  type: sftp
  fetch:
    file_pattern: "/data/payments/{year}/{month}/transactions_{year}{month}{day}.csv"
```

**Execution for March 15, 2024**:
```
/data/payments/2024/03/transactions_20240315.csv
```

### 4.2 API URLs and Query Parameters

**Configuration**:
```yaml
datasource:
  type: api
  connection:
    endpoint: /settlements
    query_params:
      date: "{year}-{month}-{day}"
```

**Execution for March 15, 2024**:
```
https://api.paymentgateway.com/settlements?date=2024-03-15
```

### 4.3 Database Queries

**Configuration**:
```yaml
datasource:
  type: database
  query_template: |
    SELECT * FROM transactions
    WHERE transaction_date >= '{year}-{month}-{day} 00:00:00'
      AND transaction_date < DATE_ADD('{year}-{month}-{day}', INTERVAL 1 DAY)
```

**Execution for March 15, 2024**:
```sql
SELECT * FROM transactions
WHERE transaction_date >= '2024-03-15 00:00:00'
  AND transaction_date < '2024-03-16 00:00:00'  -- Exclusive end
```

### 4.4 Using Full Range Variables

**Configuration**:
```yaml
datasource:
  type: api
  connection:
    query_params:
      start_date: "{start_date}"
      end_date: "{end_date}"
```

**Execution for entire March 2024**:
```
https://api.gateway.com/settlements?start_date=2024-03-01&end_date=2024-04-01
```
Note: `end_date` is exclusive

## 5. Interval Examples

### 5.1 Daily Interval

**Configuration**:
```yaml
reconciliation_unit:
  interval: day
  timezone: UTC
```

**Runtime**:
```bash
--start 2024-03-01T00:00:00Z --end 2024-04-01T00:00:00Z  # Exclusive end
```

**Processing**: Runs 31 times (once per day, from Mar 1 to Mar 31 inclusive)

**Template Variables per Run**:
- Run 1: `{year}=2024, {month}=03, {day}=01`
- Run 2: `{year}=2024, {month}=03, {day}=02`
- ...
- Run 31: `{year}=2024, {month}=03, {day}=31`

### 5.2 Hourly Interval

**Configuration**:
```yaml
reconciliation_unit:
  interval: hour
  timezone: UTC
```

**Runtime**:
```bash
--start 2024-03-15T00:00:00Z --end 2024-03-16T00:00:00Z  # Exclusive end (full day)
```

**Processing**: Runs 24 times (once per hour, from 00:00 to 23:00 inclusive)

**Template Variables per Run**:
- Run 1: `{year}=2024, {month}=03, {day}=15, {hour}=00`
- Run 2: `{year}=2024, {month}=03, {day}=15, {hour}=01`
- ...
- Run 24: `{year}=2024, {month}=03, {day}=15, {hour}=23`

### 5.3 Minute Interval (Fine-grained)

**Configuration**:
```yaml
reconciliation_unit:
  interval: minute
  timezone: UTC
```

**Runtime**:
```bash
--start 2024-03-15T14:00:00Z --end 2024-03-15T15:00:00Z  # Exclusive end (1 hour)
```

**Processing**: Runs 60 times (once per minute, from 14:00 to 14:59 inclusive)

**Template Variables per Run**:
- Run 1: `{year}=2024, {month}=03, {day}=15, {hour}=14, {minute}=00`
- Run 2: `{year}=2024, {month}=03, {day}=15, {hour}=14, {minute}=01`
- ...

## 6. Time Zones

### 6.1 Timezone Configuration

**Requirement**: All reconciliation units must use UTC timezone.

```yaml
reconciliation_unit:
  interval: day
  timezone: UTC
```

### 6.2 Timezone Handling

- All reconciliation units must use UTC timezone
- Data sources may have their own local timezones
- System performs automatic conversion to UTC when fetching data from sources
- All timestamp comparisons during reconciliation happen in UTC

**Example**:
- Source A (Payment Gateway): UTC
- Source B (Bank Statement): America/New_York (converted to UTC during fetch)
- Reconciliation Unit: UTC

All timestamps normalized to UTC before matching.

## 7. Validation Rules

The system must validate reconciliation unit inputs:

1. **Valid datetime format**: ISO 8601 format required
2. **Valid date components**: February 30th must be rejected
3. **Leap year handling**: February 29, 2024 is valid; February 29, 2023 is not
4. **Range validity**: End datetime must be >= start datetime
5. **Timezone validity**: Timezone must be valid IANA timezone

## 8. Use Cases & Examples

### 8.1 Daily Payment Reconciliation

**Business Need**: Reconcile daily payment transactions between internal ledger and payment gateway.

**Configuration**:
```yaml
reconciliation:
  name: daily_payment_recon
  reconciliation_unit:
    interval: day
    timezone: UTC
```

**Runtime Execution**:
```bash
reconciliation-cli run \
  --config daily_payment_recon \
  --start 2024-03-15T00:00:00Z \
  --end 2024-03-16T00:00:00Z  # Exclusive end
```

**Data Source Usage**:
- **SFTP**: Fetches `/payments/2024/03/gateway_settlement_20240315.csv`
- **DB Query**: `WHERE DATE(created_at) = '2024-03-15'`

### 8.2 Monthly Settlement Reconciliation

**Business Need**: Reconcile all merchant settlements for March 2024.

**Configuration**:
```yaml
reconciliation:
  name: monthly_settlement_recon
  reconciliation_unit:
    interval: day  # Process each day in the month
    timezone: UTC
```

**Runtime Execution**:
```bash
reconciliation-cli run \
  --config monthly_settlement_recon \
  --start 2024-03-01T00:00:00Z \
  --end 2024-04-01T00:00:00Z  # Exclusive end
```

**Processing**: Runs 31 times (once per day in March)

**Data Source Usage**:
- **API**: For each day: `GET /settlements?date=2024-03-01`, `date=2024-03-02`, etc.
- **DB Query**: For each day: `WHERE settlement_date = '2024-03-01'`, etc.

### 8.3 Hourly Near-Real-Time Reconciliation

**Business Need**: Reconcile card transactions every hour.

**Configuration**:
```yaml
reconciliation:
  name: hourly_card_recon
  reconciliation_unit:
    interval: hour
    timezone: UTC
```

**Runtime Execution**:
```bash
reconciliation-cli run \
  --config hourly_card_recon \
  --start 2024-03-15T14:00:00Z \
  --end 2024-03-15T15:00:00Z  # Exclusive end
```

**Data Source Usage**:
- **API**: `GET /transactions?from=2024-03-15T14:00:00Z&to=2024-03-15T15:00:00Z` (Note: `to` is exclusive)

### 8.4 Custom Business Period (Quarterly)

**Business Need**: Reconcile transactions for fiscal quarter (Q1 2024: Jan 1 - Mar 31).

**Configuration**:
```yaml
reconciliation:
  name: quarterly_recon
  reconciliation_unit:
    interval: day
    timezone: UTC
```

**Runtime Execution**:
```bash
reconciliation-cli run \
  --config quarterly_recon \
  --start 2024-01-01T00:00:00Z \
  --end 2024-04-01T00:00:00Z  # Exclusive end
```

**Processing**: Runs 90 times (once per day for 90 days)

## 9. Edge Cases & Error Handling

### 9.1 Missing Data for Period

**Scenario**: User requests reconciliation for 2024-03-15, but source A has no data for that date.

**Behavior**:
- System fetches from source (returns 0 records)
- Reconciliation proceeds with 0 records from source A
- Result shows all source B records as "unmatched right"
- Warning logged: "Source A returned 0 records for reconciliation unit 2024-03-15"

### 9.2 Partial Data Availability

**Scenario**: SFTP file for 2024-03-15 only uploaded at 10:00 AM, but contains full day's data.

**Requirement**: Data source configuration should support:
- **Expected availability time**: File available after 10:00 AM
- **Data coverage**: File contains data for entire day (00:00-23:59)

This prevents premature reconciliation runs that would show false negatives.

### 9.3 Invalid Date Ranges

**Scenario**: User specifies `start: 2024-03-15, end: 2024-03-10` (end before start).

**Behavior**:
- Pre-validation error before execution
- Clear error message: "End datetime must be >= start datetime"
- Job execution rejected

## 10. System Behavior

### 10.1 Reconciliation Run Metadata

Every reconciliation run must record:

```yaml
run_id: RUN-2024-03-15-001
reconciliation_config: daily_payment_recon:v1
reconciliation_unit:
  start: 2024-03-15T00:00:00Z
  end: 2024-03-16T00:00:00Z  # Exclusive
  interval: day
  timezone: UTC
executed_at: 2024-03-15T23:30:00Z
intervals_processed: 1  # One day
data_fetch_timestamps:
  source_a: 2024-03-15T23:30:05Z
  source_b: 2024-03-15T23:30:12Z
record_counts:
  source_a: 125430
  source_b: 125398
```

This ensures complete auditability of what period was reconciled and when data was fetched.

## 11. Convenience Shortcuts

For common cases, the system supports shorthand notations:

### 11.1 Date-Only Format

Instead of full datetime:
```bash
--start 2024-03-15 --end 2024-03-15
```

System interprets as:
```
--start 2024-03-15T00:00:00Z --end 2024-03-16T00:00:00Z  # Exclusive end (full day)
```

### 11.2 Single Date

For single-day reconciliation:
```bash
--date 2024-03-15
```

System interprets as:
```
--start 2024-03-15T00:00:00Z --end 2024-03-16T00:00:00Z  # Exclusive end (full day)
```
