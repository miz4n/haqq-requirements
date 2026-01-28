# Matching Engine

## 1. Overview

The matching engine is the core component responsible for comparing records from two data sources and determining matches based on configured rules.

## 2. Engine Architecture

```mermaid
flowchart LR
    subgraph Input
        Config["Job Config<br/>(YAML)"]
        SourceA["Data Source A"]
        SourceB["Data Source B"]
    end

    subgraph Compiler["Rule Compiler"]
        Parser["Block JSON<br/>Parser"]
        Validator["Schema<br/>Validator"]
        LuaGen["Lua Code<br/>Generator"]
    end

    subgraph Matcher["Matching Engine"]
        Loader["Data Loader<br/>(JDBC, HTTP, SFTP)"]
        HashJoin["Hash Join<br/>Algorithm"]
        RuleEval["Rule Evaluator<br/>(Lua Runtime)"]
    end

    subgraph Output
        Matched["Matched<br/>Records"]
        UnmatchedL["Unmatched<br/>Left"]
        UnmatchedR["Unmatched<br/>Right"]
        Explanations["Match<br/>Explanations"]
    end

    Config --> Parser
    Parser --> Validator
    Validator --> LuaGen
    LuaGen --> RuleEval

    SourceA --> Loader
    SourceB --> Loader
    Loader --> HashJoin
    HashJoin --> RuleEval

    RuleEval --> Matched
    RuleEval --> UnmatchedL
    RuleEval --> UnmatchedR
    RuleEval --> Explanations
```

## 3. Hash Join Algorithm (1:1 Matching)

The Hash Join algorithm provides O(n + m) time complexity for matching, making it ideal for large datasets.

```mermaid
flowchart TD
    subgraph Phase1["Phase 1: Build Index"]
        A1["Read Source A"] --> A2["Extract Join Keys"]
        A2 --> A3["Build HashMap<br/>key → row"]
    end

    subgraph Phase2["Phase 2: Probe & Match"]
        B1["Read Source B"] --> B2["Extract Join Keys"]
        B2 --> B3{"Key exists<br/>in HashMap?"}
        B3 -->|Yes| B4["Get Candidate Row"]
        B4 --> B5["Evaluate Rules"]
        B5 -->|Pass| B6["Emit MATCHED"]
        B5 -->|Fail| B7["Emit MATCH_FAILED<br/>(with explanation)"]
        B3 -->|No| B8["Emit UNMATCHED_RIGHT"]
    end

    subgraph Phase3["Phase 3: Remainder"]
        C1["Scan Unused<br/>HashMap Entries"]
        C1 --> C2["Emit UNMATCHED_LEFT"]
    end

    Phase1 --> Phase2
    Phase2 --> Phase3
```

### 3.1 Phase Details

#### Phase 1: Build Index
1. Stream records from Source A (typically the smaller dataset)
2. Extract join key fields (e.g., `transaction_id`, `reference_number`)
3. Build in-memory hash map: `key → record`
4. Mark all entries as "unused"

#### Phase 2: Probe & Match
1. Stream records from Source B
2. Extract join key fields
3. Probe the hash map:
   - **Key Found**: Get candidate record, evaluate matching rules
     - Rules pass → Emit MATCHED, mark entry as "used"
     - Rules fail → Emit MATCH_FAILED with explanation
   - **Key Not Found**: Emit UNMATCHED_RIGHT

#### Phase 3: Remainder
1. Scan hash map for entries still marked "unused"
2. Emit UNMATCHED_LEFT for each

### 3.2 Complexity Analysis

| Operation | Time Complexity | Space Complexity |
|-----------|-----------------|------------------|
| Build Index | O(n) | O(n) |
| Probe & Match | O(m) | O(1) per record |
| Remainder | O(n) | O(1) |
| **Total** | **O(n + m)** | **O(n)** |

Where n = Source A records, m = Source B records.

## 4. Matching Modes

```mermaid
flowchart LR
    subgraph OneToOne["1:1 Matching"]
        A1["Record A"] --- B1["Record B"]
    end

    subgraph OneToMany["1:N Matching"]
        A2["Parent Record"]
        A2 --- B2a["Child 1"]
        A2 --- B2b["Child 2"]
        A2 --- B2c["Child N"]
    end

    subgraph ManyToMany["N:M Matching"]
        A3a["Record A1"] --- B3a["Record B1"]
        A3a --- B3b["Record B2"]
        A3b["Record A2"] --- B3a
        A3b --- B3b
    end
```

### 4.1 One-to-One (1:1)
- **MVP Implementation**
- Each record from Source A matches at most one record from Source B
- First match wins (deterministic)
- Use case: Transaction matching where IDs are unique

### 4.2 One-to-Many (1:N)
- **Future Implementation**
- One parent record matches multiple child records
- Aggregation rules: sum of children must equal parent amount
- Use case: Invoice vs line items, batch transactions

### 4.3 Many-to-Many (N:M)
- **Future Implementation**
- Multiple records from both sources can match
- Complex reconciliation scenarios
- Use case: Split transactions, partial settlements

## 5. Join Key Strategy

### 5.1 Simple Key
Single field as join key:
```yaml
joinConditions:
  - leftField: transaction_id
    rightField: txn_id
```

### 5.2 Composite Key
Multiple fields combined:
```yaml
joinConditions:
  - leftField: account_number
    rightField: acct_num
  - leftField: transaction_date
    rightField: txn_date
```

### 5.3 Fuzzy Key (Future)
Approximate matching with tolerance:
```yaml
joinConditions:
  - leftField: amount
    rightField: amount
    tolerance: 0.01
    toleranceType: absolute  # or percentage
```

## 6. Data Loading

### 6.1 Supported Data Sources

| Type | Protocol | Configuration |
|------|----------|---------------|
| **PostgreSQL** | JDBC | Connection string, query |
| **REST API** | HTTP/HTTPS | URL, headers, pagination |
| **SFTP** | SSH | Host, credentials, path |
| **CSV** | File | Path, delimiter, encoding |
| **S3** | HTTP/HTTPS | Bucket, key, credentials |

### 6.2 Streaming vs Batch

```mermaid
flowchart LR
    subgraph Streaming["Streaming Mode"]
        S1["Read chunk"] --> S2["Process chunk"]
        S2 --> S3["Write results"]
        S3 --> S1
    end

    subgraph Batch["Batch Mode"]
        B1["Load all data"] --> B2["Process all"]
        B2 --> B3["Write all results"]
    end
```

- **Streaming**: For large datasets, memory-efficient
- **Batch**: For smaller datasets, simpler implementation

## 7. Performance Optimizations

### 7.1 Parallelization
- Partition Source B by key hash
- Process partitions in parallel
- Merge results

### 7.2 Memory Management
- Spill to disk for large hash maps
- LRU cache for frequently accessed records
- Configurable memory limits

### 7.3 Compiled Rules
- Pre-compile Lua rules to bytecode
- Cache compiled rules by hash
- Reuse across executions

## 8. Output Formats

### 8.1 Match Results

| Category | Description |
|----------|-------------|
| **matched** | Records that passed all matching rules |
| **unmatched_left** | Records from Source A with no match |
| **unmatched_right** | Records from Source B with no match |
| **match_failed** | Records found by key but failed rules |

### 8.2 Output Schema

```json
{
  "result": "matched",
  "leftRecord": { "id": "TXN-001", "amount": 100.50 },
  "rightRecord": { "id": "TXN-001", "amount": 100.48 },
  "explanation": {
    "summary": "Matched with 1 warning",
    "rules": [...]
  }
}
```
