# Multi-Source Reconciliation — Simplified Spec

## Overview
For scenarios where multiple datasources need to be reconciled (one-to-many or many-to-many), the approach is:

1. **Data Extraction**  
   Pull records from all involved datasources.

2. **Data Assimilation**  
   Merge or normalize the records into a **single unified dataset**.
    - Use join keys to combine related records.
    - Include metadata like `source_id` to track origin.

3. **Matching Strategy**  
   After assimilation, perform reconciliation using standard modes:
    - `one_to_one` → row ↔ row
    - `one_to_many` → row ↔ aggregated group

No new engine logic is required; the system treats the assimilated dataset as a single source.

## Execution Flow
1. Extract records from all datasources.
2. Merge into a single dataset, preserving join keys.
3. Aggregate as needed (group by join keys).
4. Apply existing rules and matching logic (one-to-one / one-to-many).

## Notes
- Aggregation functions (`sum`, `count`, `min`, `max`, `avg`) remain applicable.
- Source tracking ensures auditability and traceability.
- Performance depends on the largest datasource in the merged dataset.  

## Column Mapping
1. **Define Standard Columns**  
   Choose canonical column names for reconciliation, e.g., `transaction_id`, `amount`, `timestamp`.

2. **Map Source Columns to Standard Columns**  
   Each datasource maps its columns to the standard schema. Example:

| Standard Column | Datasource A | Datasource B | Datasource C |
|-----------------|--------------|--------------|--------------|
| transaction_id  | txn_id       | id           | trans_id     |
| amount          | amt          | total        | value        |
| timestamp       | created_at   | time         | ts           |

3. **Mapping in UI**
    - Allow users to visually map columns from each datasource to the standard schema.
    - Only mapped columns are used for **joining, aggregation, and rule evaluation**.

## Assimilation and Matching
- After mapping, merge all datasources into a **single normalized dataset**.
- Use the standard columns for:
    - Join keys
    - Aggregations (`sum`, `count`, `min`, `max`, `avg`)
    - Rule evaluation
- Apply existing one-to-one, one-to-many, or many-to-many matching logic as usual.

## Notes
- Mapping ensures **semantic consistency** across sources.
- Unmapped fields are ignored for reconciliation but may be retained for reporting.
- Changes in source schema only require updates to the mapping, not the matching engine.