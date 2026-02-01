# Rule Expression System

## 1. Overview

The rule expression system enables non-technical users to define complex matching logic through a visual block-based interface. Rules are compiled from Block JSON to **Polars expressions** for high-performance execution.

## 2. Compilation Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Compilation Pipeline                             │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                   Visual Builder (Frontend)                     │    │
│  │   Drag & Drop Rule Blocks → React Component Tree                │    │
│  └──────────────────────────────┬─────────────────────────────────┘    │
│                                 │                                       │
│                                 ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                   Block JSON (Intermediate)                     │    │
│  │   Structured AST (JSON Schema Validated)                        │    │
│  └──────────────────────────────┬─────────────────────────────────┘    │
│                                 │                                       │
│                                 ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                   Compiler (Python)                             │    │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │    │
│  │   │  Parse   │→ │ Validate │→ │ Optimize │→ │  Generate    │   │    │
│  │   │  JSON    │  │  Schema  │  │   AST    │  │  Polars Expr │   │    │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │    │
│  └──────────────────────────────┬─────────────────────────────────┘    │
│                                 │                                       │
│                                 ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                   Execution (Polars)                            │    │
│  │   pl.col() expressions → Columnar evaluation → Boolean result   │    │
│  └────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. Block Types

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Available Block Types                            │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │   Comparison     │  │    Boolean       │  │    Function      │      │
│  │   field = field  │  │    AND / OR      │  │    abs() round() │      │
│  │   field != value │  │    NOT           │  │    upper() lower()│     │
│  │   field > value  │  │                  │  │                  │      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐                            │
│  │   Arithmetic     │  │   DateTime       │                            │
│  │   + / - / * / /  │  │   days_between() │                            │
│  │                  │  │   timestamp_diff()│                           │
│  └──────────────────┘  └──────────────────┘                            │
│                                                                         │
│                    ▼   ▼   ▼   ▼   ▼                                   │
│              ┌─────────────────────────┐                               │
│              │    Complete Rule        │                               │
│              │  (Polars Expression)    │                               │
│              └─────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Comparison Block

Compares two values using an operator.

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equal | `amount = amount` |
| `!=` | Not equal | `status != 'cancelled'` |
| `>` | Greater than | `date > '2024-01-01'` |
| `>=` | Greater or equal | `balance >= 0` |
| `<` | Less than | `amount < 1000` |
| `<=` | Less or equal | `diff <= 0.01` |
| `contains` | String contains | `name contains 'Corp'` |
| `starts_with` | String prefix | `id starts_with 'TXN'` |
| `ends_with` | String suffix | `ref ends_with '-A'` |
| `matches` | Regex match | `code matches '^[A-Z]{3}$'` |

### 3.2 Boolean Block

Combines multiple conditions.

| Operator | Description | Example |
|----------|-------------|---------|
| `AND` | All must be true | `currency = currency AND amount = amount` |
| `OR` | Any must be true | `status = 'settled' OR status = 'cleared'` |
| `NOT` | Negation | `NOT (status = 'cancelled')` |

### 3.3 Function Block

Transforms values before comparison.

| Function | Description | Polars Mapping |
|----------|-------------|----------------|
| `abs(x)` | Absolute value | `.abs()` |
| `round(x, n)` | Round to n decimals | `.round(n)` |
| `floor(x)` | Round down | `.floor()` |
| `ceil(x)` | Round up | `.ceil()` |
| `upper(s)` | Uppercase | `.str.to_uppercase()` |
| `lower(s)` | Lowercase | `.str.to_lowercase()` |
| `trim(s)` | Remove whitespace | `.str.strip_chars()` |
| `len(s)` | String length | `.str.len_chars()` |
| `coalesce(a, b)` | First non-null | `pl.coalesce()` |

### 3.4 Arithmetic Block

Mathematical operations.

| Operator | Description | Example |
|----------|-------------|---------|
| `+` | Addition | `base + tax` |
| `-` | Subtraction | `gross - fees` |
| `*` | Multiplication | `quantity * price` |
| `/` | Division | `total / count` |
| `%` | Modulo | `id % 100` |

### 3.5 DateTime Block

Date and time operations.

| Function | Description | Polars Mapping |
|----------|-------------|----------------|
| `days_between(a, b)` | Days difference | `(b - a).dt.total_days()` |
| `hours_between(a, b)` | Hours difference | `(b - a).dt.total_hours()` |
| `date_part(d, 'year')` | Extract part | `.dt.year()` / `.dt.month()` |
| `date_add(d, n, 'days')` | Add interval | `+ pl.duration(days=n)` |
| `date_trunc(d, 'day')` | Truncate | `.dt.truncate()` |

## 4. Block JSON Schema

### 4.1 Base Node Types

```typescript
type BlockNode =
  | BooleanBlock
  | ComparisonBlock
  | FunctionBlock
  | ArithmeticBlock
  | FieldReference
  | LiteralValue;

interface BooleanBlock {
  type: 'boolean';
  operator: 'AND' | 'OR' | 'NOT';
  children: BlockNode[];
}

interface ComparisonBlock {
  type: 'comparison';
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'starts_with' | 'ends_with' | 'matches';
  left: BlockNode;
  right: BlockNode;
}

interface FunctionBlock {
  type: 'function';
  name: string;
  args: BlockNode[];
}

interface ArithmeticBlock {
  type: 'arithmetic';
  operator: '+' | '-' | '*' | '/' | '%';
  left: BlockNode;
  right: BlockNode;
}

interface FieldReference {
  type: 'field';
  source: 'left' | 'right';
  name: string;
}

interface LiteralValue {
  type: 'literal';
  value: string | number | boolean | null;
}
```

### 4.2 Complete Example

**Visual Rule**: "Currency must match AND amount difference must be within $0.01"

**Block JSON**:
```json
{
  "type": "boolean",
  "operator": "AND",
  "children": [
    {
      "type": "comparison",
      "left": { "type": "field", "source": "left", "name": "currency" },
      "operator": "=",
      "right": { "type": "field", "source": "right", "name": "currency" }
    },
    {
      "type": "comparison",
      "left": {
        "type": "function",
        "name": "abs",
        "args": [{
          "type": "arithmetic",
          "operator": "-",
          "left": { "type": "field", "source": "left", "name": "amount" },
          "right": { "type": "field", "source": "right", "name": "amount" }
        }]
      },
      "operator": "<=",
      "right": { "type": "literal", "value": 0.01 }
    }
  ]
}
```

**Compiled Polars Expression**:
```python
import polars as pl

# Generated expression
rule_expr = (
    (pl.col("currency") == pl.col("currency_right")) &
    ((pl.col("amount") - pl.col("amount_right")).abs() <= 0.01)
).alias("rule_passed")
```

## 5. JSON Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://haqq.io/schemas/block-expression.json",
  "title": "Block Expression",
  "description": "A block-based rule expression for reconciliation matching",

  "definitions": {
    "fieldReference": {
      "type": "object",
      "required": ["type", "source", "name"],
      "properties": {
        "type": { "const": "field" },
        "source": { "enum": ["left", "right"] },
        "name": { "type": "string", "minLength": 1 }
      },
      "additionalProperties": false
    },

    "literalValue": {
      "type": "object",
      "required": ["type", "value"],
      "properties": {
        "type": { "const": "literal" },
        "value": {
          "oneOf": [
            { "type": "string" },
            { "type": "number" },
            { "type": "boolean" },
            { "type": "null" }
          ]
        }
      },
      "additionalProperties": false
    },

    "booleanBlock": {
      "type": "object",
      "required": ["type", "operator", "children"],
      "properties": {
        "type": { "const": "boolean" },
        "operator": { "enum": ["AND", "OR", "NOT"] },
        "children": {
          "type": "array",
          "items": { "$ref": "#/definitions/blockNode" },
          "minItems": 1
        }
      },
      "additionalProperties": false
    },

    "comparisonBlock": {
      "type": "object",
      "required": ["type", "operator", "left", "right"],
      "properties": {
        "type": { "const": "comparison" },
        "operator": {
          "enum": ["=", "!=", ">", ">=", "<", "<=", "contains", "starts_with", "ends_with", "matches"]
        },
        "left": { "$ref": "#/definitions/blockNode" },
        "right": { "$ref": "#/definitions/blockNode" }
      },
      "additionalProperties": false
    },

    "functionBlock": {
      "type": "object",
      "required": ["type", "name", "args"],
      "properties": {
        "type": { "const": "function" },
        "name": {
          "enum": ["abs", "round", "floor", "ceil", "upper", "lower", "trim", "len", "coalesce",
                   "days_between", "hours_between", "date_part", "date_add", "date_trunc"]
        },
        "args": {
          "type": "array",
          "items": { "$ref": "#/definitions/blockNode" }
        }
      },
      "additionalProperties": false
    },

    "arithmeticBlock": {
      "type": "object",
      "required": ["type", "operator", "left", "right"],
      "properties": {
        "type": { "const": "arithmetic" },
        "operator": { "enum": ["+", "-", "*", "/", "%"] },
        "left": { "$ref": "#/definitions/blockNode" },
        "right": { "$ref": "#/definitions/blockNode" }
      },
      "additionalProperties": false
    },

    "blockNode": {
      "oneOf": [
        { "$ref": "#/definitions/booleanBlock" },
        { "$ref": "#/definitions/comparisonBlock" },
        { "$ref": "#/definitions/functionBlock" },
        { "$ref": "#/definitions/arithmeticBlock" },
        { "$ref": "#/definitions/fieldReference" },
        { "$ref": "#/definitions/literalValue" }
      ]
    }
  },

  "$ref": "#/definitions/blockNode"
}
```

## 6. Polars Expression Generation

### 6.1 Generation Rules

| Block Type | Polars Output |
|------------|---------------|
| `field` (left) | `pl.col("fieldName")` |
| `field` (right) | `pl.col("fieldName_right")` |
| `literal` (string) | `pl.lit("value")` |
| `literal` (number) | `pl.lit(value)` |
| `literal` (boolean) | `pl.lit(True)` / `pl.lit(False)` |
| `literal` (null) | `pl.lit(None)` |
| `comparison` (=) | `left == right` |
| `comparison` (!=) | `left != right` |
| `comparison` (>) | `left > right` |
| `comparison` (contains) | `left.str.contains(right)` |
| `comparison` (starts_with) | `left.str.starts_with(right)` |
| `comparison` (ends_with) | `left.str.ends_with(right)` |
| `comparison` (matches) | `left.str.contains(right)` (regex) |
| `boolean` (AND) | `(a) & (b)` |
| `boolean` (OR) | `(a) \| (b)` |
| `boolean` (NOT) | `~(a)` |
| `arithmetic` | `(left op right)` |
| `function` | Mapped to Polars method |

### 6.2 Expression Compiler

```python
import polars as pl
from typing import Union

def compile_block(node: dict, right_suffix: str = "_right") -> pl.Expr:
    """Compile Block JSON to Polars expression."""

    node_type = node["type"]

    if node_type == "field":
        col_name = node["name"]
        if node["source"] == "right":
            col_name = f"{col_name}{right_suffix}"
        return pl.col(col_name)

    elif node_type == "literal":
        return pl.lit(node["value"])

    elif node_type == "comparison":
        left = compile_block(node["left"], right_suffix)
        right = compile_block(node["right"], right_suffix)
        op = node["operator"]

        if op == "=":
            return left == right
        elif op == "!=":
            return left != right
        elif op == ">":
            return left > right
        elif op == ">=":
            return left >= right
        elif op == "<":
            return left < right
        elif op == "<=":
            return left <= right
        elif op == "contains":
            return left.str.contains(right)
        elif op == "starts_with":
            return left.str.starts_with(right)
        elif op == "ends_with":
            return left.str.ends_with(right)
        elif op == "matches":
            return left.str.contains(right)

    elif node_type == "boolean":
        children = [compile_block(c, right_suffix) for c in node["children"]]
        op = node["operator"]

        if op == "AND":
            result = children[0]
            for child in children[1:]:
                result = result & child
            return result
        elif op == "OR":
            result = children[0]
            for child in children[1:]:
                result = result | child
            return result
        elif op == "NOT":
            return ~children[0]

    elif node_type == "arithmetic":
        left = compile_block(node["left"], right_suffix)
        right = compile_block(node["right"], right_suffix)
        op = node["operator"]

        if op == "+":
            return left + right
        elif op == "-":
            return left - right
        elif op == "*":
            return left * right
        elif op == "/":
            return left / right
        elif op == "%":
            return left % right

    elif node_type == "function":
        args = [compile_block(a, right_suffix) for a in node["args"]]
        name = node["name"]

        if name == "abs":
            return args[0].abs()
        elif name == "round":
            decimals = args[1] if len(args) > 1 else pl.lit(0)
            return args[0].round(decimals)
        elif name == "floor":
            return args[0].floor()
        elif name == "ceil":
            return args[0].ceil()
        elif name == "upper":
            return args[0].str.to_uppercase()
        elif name == "lower":
            return args[0].str.to_lowercase()
        elif name == "trim":
            return args[0].str.strip_chars()
        elif name == "len":
            return args[0].str.len_chars()
        elif name == "coalesce":
            return pl.coalesce(args)
        elif name == "days_between":
            return (args[1] - args[0]).dt.total_days()
        elif name == "hours_between":
            return (args[1] - args[0]).dt.total_hours()
        elif name == "date_part":
            part = node["args"][1]["value"]
            if part == "year":
                return args[0].dt.year()
            elif part == "month":
                return args[0].dt.month()
            elif part == "day":
                return args[0].dt.day()
        elif name == "date_trunc":
            unit = node["args"][1]["value"]
            return args[0].dt.truncate(unit)

    raise ValueError(f"Unknown node type: {node_type}")
```

### 6.3 Usage Example

```python
import polars as pl

# Block JSON from visual builder
block_json = {
    "type": "boolean",
    "operator": "AND",
    "children": [
        {
            "type": "comparison",
            "left": {"type": "field", "source": "left", "name": "currency"},
            "operator": "=",
            "right": {"type": "field", "source": "right", "name": "currency"}
        },
        {
            "type": "comparison",
            "left": {
                "type": "function",
                "name": "abs",
                "args": [{
                    "type": "arithmetic",
                    "operator": "-",
                    "left": {"type": "field", "source": "left", "name": "amount"},
                    "right": {"type": "field", "source": "right", "name": "amount"}
                }]
            },
            "operator": "<=",
            "right": {"type": "literal", "value": 0.01}
        }
    ]
}

# Compile to Polars expression
rule_expr = compile_block(block_json).alias("amount_match_passed")

# Apply to joined DataFrame
joined = left_df.join(right_df, on="id", suffix="_right")
result = joined.with_columns(rule_expr)
```

## 7. Validation

### 7.1 Schema Validation
- JSON Schema validation against block expression schema
- Type checking for field references
- Operator compatibility checks

### 7.2 Semantic Validation
- Field existence in source schemas
- Type compatibility (comparing string to number)
- Circular reference detection

### 7.3 Validation Implementation

```python
def validate_block(node: dict, left_schema: dict, right_schema: dict) -> list[dict]:
    """Validate Block JSON against source schemas."""
    errors = []

    if node["type"] == "field":
        source = node["source"]
        field_name = node["name"]
        schema = left_schema if source == "left" else right_schema

        if field_name not in schema["fields"]:
            # Find similar field names
            similar = find_similar(field_name, schema["fields"].keys())
            suggestion = f" Did you mean '{similar}'?" if similar else ""
            errors.append({
                "path": f"$.{source}.{field_name}",
                "message": f"Field '{field_name}' not found in {source} schema.{suggestion}",
                "code": "FIELD_NOT_FOUND"
            })

    elif node["type"] in ("comparison", "arithmetic"):
        errors.extend(validate_block(node["left"], left_schema, right_schema))
        errors.extend(validate_block(node["right"], left_schema, right_schema))

    elif node["type"] == "boolean":
        for child in node["children"]:
            errors.extend(validate_block(child, left_schema, right_schema))

    elif node["type"] == "function":
        for arg in node["args"]:
            errors.extend(validate_block(arg, left_schema, right_schema))

    return errors
```

### 7.4 Error Response

```json
{
  "valid": false,
  "errors": [
    {
      "path": "$.children[1].left.name",
      "message": "Field 'ammount' not found in left schema. Did you mean 'amount'?",
      "code": "FIELD_NOT_FOUND"
    }
  ]
}
```

## 8. Optimization

### 8.1 Constant Folding

```python
# Before: abs(-5)
{ "type": "function", "name": "abs", "args": [{ "type": "literal", "value": -5 }] }

# After: 5
{ "type": "literal", "value": 5 }
```

### 8.2 Polars Query Optimization
Polars automatically optimizes expression trees:
- Predicate pushdown
- Column pruning
- Common subexpression elimination
- Parallel execution

### 8.3 Lazy Evaluation

```python
# Expressions are built lazily
rule_exprs = [compile_block(rule) for rule in rules]

# Add all rule columns at once
result = joined.with_columns(rule_exprs)

# Execute only when collecting
final = result.collect()  # All optimizations applied
```

## 9. Complex Rules with Numba

For rules that cannot be expressed as Polars expressions, use Numba JIT:

```python
import numba

@numba.jit(nopython=True)
def validate_tiered_fee(amount: float, fee: float) -> bool:
    """Custom tiered fee validation logic."""
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
      .map_elements(
          lambda x: validate_tiered_fee(x["amount"], x["fee_amount"]),
          return_dtype=pl.Boolean
      )
      .alias("fee_validation_passed")
)
```

## 10. Expression Caching

Compiled expressions are cached for performance:

```python
import hashlib
import json

class ExpressionCache:
    def __init__(self):
        self._cache = {}

    def get_or_compile(self, block_json: dict) -> pl.Expr:
        """Get cached expression or compile new one."""
        cache_key = hashlib.sha256(
            json.dumps(block_json, sort_keys=True).encode()
        ).hexdigest()

        if cache_key not in self._cache:
            self._cache[cache_key] = compile_block(block_json)

        return self._cache[cache_key]

    def invalidate(self):
        """Clear cache (e.g., on schema changes)."""
        self._cache.clear()
```
