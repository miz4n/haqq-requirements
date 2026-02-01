# Matching Engine

## 1. Overview

The matching engine is the core component responsible for comparing records from two data sources and determining matches based on configured rules. Built on **Polars** (Python with Rust backend), it provides high-performance columnar processing with native Parquet and S3 support.

## 2. Engine Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Polars K8s Job                                   │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Job Config  │    │   Source A   │    │   Source B   │              │
│  │   (YAML)     │    │  (Parquet)   │    │  (Parquet)   │              │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
│         │                   │                   │                       │
│         ▼                   ▼                   ▼                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Expression Compiler                           │   │
│  │   Block JSON → Polars Expressions + Python Functions            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Polars Matching Engine                       │   │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │   │
│  │   │ Data Loader │  │  Hash Join  │  │   Rule Evaluator    │     │   │
│  │   │ (S3/Parquet)│  │ (pl.join)   │  │ (Polars Expressions)│     │   │
│  │   └─────────────┘  └─────────────┘  └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         Outputs (S3)                             │   │
│  │   matched.parquet  │  unmatched_left.parquet  │  explanations   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Language** | Python 3.11+ | Rich ecosystem, Numba JIT support |
| **Core Engine** | Polars 0.20+ | Rust-powered, columnar, Parquet-native |
| **JIT Compilation** | Numba | Fast custom functions |
| **Storage** | S3 + Parquet | Columnar format, direct Polars access |
| **Container** | Python slim image | K8s Job execution |

## 4. Hash Join Algorithm (1:1 Matching)

Polars provides highly optimized hash join operations implemented in Rust.

### 4.1 Join Implementation

```python
import polars as pl

# Read source data from S3
source_left = pl.scan_parquet("s3://bucket/sources/left/*.parquet")
source_right = pl.scan_parquet("s3://bucket/sources/right/*.parquet")

# Execute hash join on configured keys
joined = source_left.join(
    source_right,
    left_on=["transaction_id"],
    right_on=["txn_id"],
    how="full",  # Returns matched + unmatched from both sides
    suffix="_right"
)

# Lazy evaluation - only executes when needed
result = joined.collect()
```

### 4.2 Join Phases

```
Phase 1: Data Loading (Lazy)
┌─────────────────────────────────────────────────────────────┐
│  pl.scan_parquet("s3://...")  →  LazyFrame (no data loaded) │
└─────────────────────────────────────────────────────────────┘

Phase 2: Join Planning (Lazy)
┌─────────────────────────────────────────────────────────────┐
│  left.join(right, on=keys)  →  LazyFrame (query plan built) │
└─────────────────────────────────────────────────────────────┘

Phase 3: Rule Evaluation (Lazy)
┌─────────────────────────────────────────────────────────────┐
│  joined.with_columns(rules)  →  LazyFrame (rules added)     │
└─────────────────────────────────────────────────────────────┘

Phase 4: Execution (Eager)
┌─────────────────────────────────────────────────────────────┐
│  result.collect()  →  DataFrame (all operations execute)    │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Complexity Analysis

| Operation | Time Complexity | Space Complexity |
|-----------|-----------------|------------------|
| Data Loading | O(n + m) | Streaming (memory-efficient) |
| Hash Join | O(n + m) | O(min(n, m)) |
| Rule Evaluation | O(n * r) | O(1) per rule |
| **Total** | **O(n + m)** | **O(min(n, m))** |

Where n = Source A records, m = Source B records, r = number of rules.

## 5. Matching Modes

### 5.1 One-to-One (1:1)
- **MVP Implementation**
- Each record from Source A matches at most one record from Source B
- Polars `how="inner"` for matched, `how="full"` for complete picture

```python
# 1:1 matching with deduplication
matched = source_left.join(
    source_right,
    left_on=join_keys,
    right_on=join_keys,
    how="inner"
)
```

### 5.2 One-to-Many (1:N)
- **Future Implementation**
- One parent record matches multiple child records
- Use `group_by` + aggregation for sum validation

```python
# 1:N with aggregation
children_sum = source_right.group_by("parent_id").agg(
    pl.col("amount").sum().alias("total_amount")
)
matched = source_left.join(children_sum, left_on="id", right_on="parent_id")
```

### 5.3 Many-to-Many (N:M)
- **Future Implementation**
- Complex reconciliation scenarios
- Requires allocation algorithms

## 6. Join Key Strategy

### 6.1 Simple Key
```python
joined = source_left.join(
    source_right,
    left_on=["transaction_id"],
    right_on=["txn_id"],
    how="full"
)
```

### 6.2 Composite Key
```python
joined = source_left.join(
    source_right,
    left_on=["account_number", "transaction_date"],
    right_on=["acct_num", "txn_date"],
    how="full"
)
```

### 6.3 Transformed Key
```python
# Apply transformations before join
source_left = source_left.with_columns(
    pl.col("reference").str.to_uppercase().str.strip_chars().alias("join_key")
)
source_right = source_right.with_columns(
    pl.col("ref_number").str.to_uppercase().str.strip_chars().alias("join_key")
)
joined = source_left.join(source_right, on="join_key", how="full")
```

## 7. Rule Evaluation with Polars Expressions

### 7.1 Composable Expression Translation

Block JSON expressions are translated to Polars expressions:

```python
# Block JSON:
# { type: "comparison", operator: "<=",
#   left: { type: "function", name: "ABS", arguments: [
#     { type: "arithmetic", operator: "-",
#       left: { field: "source_left.amount" },
#       right: { field: "source_right.amount" }
#     }
#   ]},
#   right: { type: "literal", value: 0.01 }
# }

# Translated to Polars:
rule_expr = (
    (pl.col("amount") - pl.col("amount_right")).abs() <= 0.01
).alias("amount_tolerance_passed")
```

### 7.2 Rule Evaluation Pipeline

```python
def evaluate_rules(joined: pl.LazyFrame, rules: list) -> pl.LazyFrame:
    """Evaluate all rules and add result columns."""

    rule_expressions = []
    for rule in rules:
        expr = compile_rule_to_polars(rule)
        rule_expressions.append(expr.alias(f"{rule['name']}_passed"))

    # Add rule evaluation columns
    result = joined.with_columns(rule_expressions)

    # Determine overall match status
    error_rules = [r['name'] for r in rules if r['severity'] == 'error']
    result = result.with_columns(
        pl.all_horizontal([pl.col(f"{r}_passed") for r in error_rules])
          .alias("is_matched")
    )

    return result
```

### 7.3 Complex Rules with Numba

For rules that cannot be expressed as Polars expressions:

```python
import numba

@numba.jit(nopython=True)
def validate_tiered_fee(amount: float, fee: float) -> bool:
    if amount <= 100:
        expected = 2.50
    elif amount <= 1000:
        expected = 5.00
    else:
        expected = amount * 0.005
    return abs(expected - fee) <= 0.10

# Apply via map_elements
result = joined.with_columns(
    pl.struct(["amount", "fee_amount"])
      .map_elements(lambda x: validate_tiered_fee(x["amount"], x["fee_amount"]))
      .alias("fee_validation_passed")
)
```

## 8. Data Loading from S3

### 8.1 Direct S3 Access

```python
import polars as pl

# Configure S3 credentials via environment
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

# Lazy scan - no data loaded until collect()
source_left = pl.scan_parquet(
    "s3://bucket/sources/source_a/date=2024-03-15/*.parquet",
    storage_options={
        "aws_access_key_id": os.environ["AWS_ACCESS_KEY_ID"],
        "aws_secret_access_key": os.environ["AWS_SECRET_ACCESS_KEY"],
        "aws_region": os.environ["AWS_REGION"]
    }
)
```

### 8.2 Partitioned Data

Airbyte outputs data in partitioned format:

```
s3://bucket/sources/
  └── payment_gateway/
      └── date=2024-03-15/
          ├── part-0001.parquet
          ├── part-0002.parquet
          └── part-0003.parquet
```

```python
# Read all partitions with predicate pushdown
source = pl.scan_parquet(
    "s3://bucket/sources/payment_gateway/date=2024-03-15/*.parquet"
).filter(
    pl.col("status") == "COMPLETED"  # Pushed down to Parquet reader
)
```

## 9. Output Generation

### 9.1 Result Categories

```python
def categorize_results(evaluated: pl.DataFrame) -> dict:
    """Split results into categories."""

    # Records that matched (joined and passed rules)
    matched = evaluated.filter(
        pl.col("is_matched") &
        pl.col("left_id").is_not_null() &
        pl.col("right_id").is_not_null()
    )

    # Left records with no join match
    unmatched_left = evaluated.filter(
        pl.col("right_id").is_null()
    )

    # Right records with no join match
    unmatched_right = evaluated.filter(
        pl.col("left_id").is_null()
    )

    # Joined but rules failed
    match_failed = evaluated.filter(
        pl.col("left_id").is_not_null() &
        pl.col("right_id").is_not_null() &
        ~pl.col("is_matched")
    )

    return {
        "matched": matched,
        "unmatched_left": unmatched_left,
        "unmatched_right": unmatched_right,
        "match_failed": match_failed
    }
```

### 9.2 Write Results to S3

```python
def write_results(results: dict, job_id: str):
    """Write all result categories to S3 as Parquet."""

    base_path = f"s3://bucket/results/{job_id}"

    for category, df in results.items():
        df.write_parquet(
            f"{base_path}/{category}.parquet",
            compression="zstd"
        )
```

### 9.3 Output Schema

```python
output_schema = {
    "match_id": pl.Utf8,
    "left_*": "All columns from Source A",
    "right_*": "All columns from Source B (with _right suffix)",
    "is_matched": pl.Boolean,
    "rules_passed": pl.List(pl.Utf8),
    "rules_failed": pl.List(pl.Utf8),
    "match_explanation": pl.Utf8,
    "matched_at": pl.Datetime
}
```

## 10. Performance Optimizations

### 10.1 Lazy Evaluation
- Query plan optimization before execution
- Predicate pushdown to Parquet reader
- Column pruning (only read needed columns)

### 10.2 Parallel Execution
- Polars automatically parallelizes operations
- Configurable thread pool size
- Partition-parallel S3 reads

### 10.3 Memory Management
- Streaming execution for large datasets
- Configurable row group size
- Spill to disk when needed

```python
# Configure Polars for large datasets
pl.Config.set_streaming_chunk_size(100_000)

# Use streaming for very large joins
result = joined.collect(streaming=True)
```

### 10.4 Resource Limits (K8s Job)

```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "1000m"
  limits:
    memory: "8Gi"
    cpu: "4000m"
```

## 11. Deduplication Handling

When JOIN produces multiple matches, use ordering to select the best match:

```python
def deduplicate_matches(joined: pl.LazyFrame, config: dict) -> pl.LazyFrame:
    """Select best match when multiple candidates exist."""

    # Order by configured fields
    order_cols = config.get("deduplication_order", {})

    if order_cols.get("left"):
        # Rank matches for each left record
        joined = joined.with_columns(
            pl.col("updated_at").rank(descending=True).over("left_id").alias("rank")
        ).filter(pl.col("rank") == 1)

    return joined
```
