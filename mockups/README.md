# Reconciliation Engine - Mock UI/UX

Interactive multi-page HTML/CSS/JS prototype for configuring reconciliations.

## Overview

This mockup demonstrates the complete user journey for creating a reconciliation configuration through a 6-step wizard. It generates production-ready YAML configurations that match the DSL specification.

## Directory Structure

```
/mockups/
├── index.html                    # Landing page / Dashboard
├── 1-recon-unit.html            # Step 1: Reconciliation unit selection
├── 2-datasources.html           # Step 2: Data source configuration
├── 3-schema.html                # Step 3: Schema auto-detection & editing
├── 4-rules.html                 # Step 4: Matching rules builder
├── 5-reconciliation.html        # Step 5: Multi-stage reconciliation
├── 6-review.html                # Step 6: Review & export YAML
├── css/
│   ├── main.css                 # Core styles (typography, layout, utilities)
│   ├── components.css           # Reusable components (buttons, cards, forms)
│   └── steps.css                # Step-specific styles
├── js/
│   ├── app.js                   # Main app logic, navigation, utilities
│   ├── yaml-generator.js        # YAML generation from config
│   ├── schema-detector.js       # Mock schema auto-detection
│   └── storage.js               # LocalStorage state management
└── README.md                    # This file
```

## Tech Stack

- **Pure HTML5**: Semantic markup, accessibility
- **Custom CSS3**: No frameworks, full control
- **Vanilla JavaScript**: No dependencies, works in any browser
- **LocalStorage**: Client-side state persistence

## Features

### ✅ Implemented

1. **Landing Page (index.html)**
   - Welcome screen with quick start
   - Template selection
   - Continue saved draft
   - Feature highlights

2. **CSS Framework**
   - Complete design system with CSS variables
   - Responsive grid system
   - Component library (buttons, cards, forms, tables, modals, alerts)
   - Professional fintech aesthetic

3. **JavaScript Utilities**
   - State management with LocalStorage
   - YAML generation for all configuration types
   - Schema auto-detection from sample data
   - Common utilities (navigation, validation, notifications)

### 🚧 To Be Implemented

The remaining HTML pages follow the same structure pattern:

**Common Structure:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Meta tags, title, CSS links -->
</head>
<body>
  <!-- Header with logo & navigation -->
  <header class="site-header">...</header>

  <!-- Main Content -->
  <main class="main-content">
    <!-- Progress Stepper -->
    <div class="progress-stepper">...</div>

    <!-- Step Content -->
    <div class="step-content">
      <!-- Main Form Area -->
      <div class="step-main">...</div>

      <!-- YAML Preview Sidebar -->
      <div class="step-sidebar">...</div>
    </div>
  </main>

  <!-- Action Bar (Back/Next buttons) -->
  <div class="action-bar">...</div>

  <!-- Scripts -->
  <script src="js/storage.js"></script>
  <script src="js/yaml-generator.js"></script>
  <script src="js/schema-detector.js"></script>
  <script src="js/app.js"></script>
  <script>
    // Page-specific logic
  </script>
</body>
</html>
```

## User Journey - 6 Steps

### Step 1: Reconciliation Unit Selection (1-recon-unit.html)

**Purpose:** Select how to subdivide the reconciliation timeframe

**UI Elements:**
- Radio buttons for interval: Day / Hour / Minute
- Timezone display (UTC only, read-only)
- Info box explaining reconciliation units
- Preview: "Data will be processed in [daily/hourly/minute] intervals"

**Form Fields:**
```javascript
{
  interval: 'day',  // 'day' | 'hour' | 'minute'
  timezone: 'UTC'   // Read-only, always UTC
}
```

**Validation:**
- Interval must be selected

**YAML Preview:**
```yaml
reconciliation_unit:
  interval: day
  timezone: UTC
```

---

### Step 2: Data Source Definition (2-datasources.html)

**Purpose:** Configure Source A and Source B data sources

**UI Elements:**
- Two tabs: "Source A" and "Source B"
- Data source type cards: SFTP / API / PostgreSQL
- Dynamic form based on selected type
- Test Connection button (mock)
- Sample query preview for PostgreSQL

**Form Fields (SFTP):**
```javascript
{
  name: 'source_a',
  type: 'sftp',
  host: 'sftp.example.com',
  port: 22,
  username: 'user',
  authType: 'password',  // 'password' | 'private_key'
  directory: '/data',
  filePattern: 'transactions_{year}{month}{day}.csv',
  encoding: 'UTF-8',
  compression: 'none',  // 'none' | 'gzip' | 'zip'
  formatType: 'csv',
  delimiter: ',',
  headerRow: true
}
```

**Form Fields (API):**
```javascript
{
  name: 'source_a',
  type: 'api',
  baseUrl: 'https://api.example.com',
  endpoint: '/transactions',
  method: 'GET',
  authType: 'bearer',  // 'bearer' | 'api_key' | 'basic' | 'oauth2'
  queryParams: {
    date: '{year}-{month}-{day}'
  },
  timeout: 60,
  formatType: 'json',
  arrayPath: 'data.transactions'
}
```

**Form Fields (PostgreSQL):**
```javascript
{
  name: 'source_a',
  type: 'postgresql',
  host: 'db.example.com',
  port: 5432,
  database: 'transactions',
  schema: 'public',
  username: 'readonly',
  sslEnabled: true,
  query: 'SELECT * FROM transactions WHERE...',
  formatType: 'tabular'
}
```

---

### Step 3: Schema Configuration (3-schema.html)

**Purpose:** Auto-detect schema and allow modifications

**UI Elements:**
- Two tabs: "Source A Schema" and "Source B Schema"
- "Fetch Sample Data" button → triggers SchemaDetector
- Sample data table (5 rows)
- Editable schema table with columns:
  - Source Field (from sample data)
  - Target Field Name (editable)
  - Type (dropdown: string/decimal/integer/date/timestamp/boolean)
  - Required (checkbox)
  - Transform (Lua code editor)
  - Sample Value (preview)
  - Actions (edit/delete)
- "Add Derived Field" button
- Live YAML preview

**Schema Table Row:**
```javascript
{
  source: 'transaction_id',  // Original field name
  name: 'transaction_id',    // Normalized name
  type: 'string',
  required: true,
  precision: null,  // For decimal
  scale: null,      // For decimal
  transform: null   // Lua code
}
```

**Features:**
- Inline editing of field names
- Type dropdown with validation
- Syntax-highlighted Lua code editor
- Add/remove fields
- Suggested transforms dropdown

---

### Step 4: Matching Rules Builder (4-rules.html)

**Purpose:** Define JOIN and WHERE rules

**UI Elements:**
- **JOIN Section:**
  - Add join conditions (equality only)
  - Field selector for source_a and source_b
  - Visual equality indicator (=)

- **RULES Section:**
  - Drag-to-reorder rule cards
  - Each rule card contains:
    - Rule name (editable)
    - Severity badge (error/warning)
    - Rule type selector: Comparison / Lua Script / Boolean Logic
    - Dynamic fields based on type
  - "Add Rule" button

**Join Configuration:**
```javascript
{
  join: [
    { left: 'source_a.transaction_id', right: 'source_b.transaction_id' },
    { left: 'source_a.date', right: 'source_b.date' }
  ]
}
```

**Rule Types:**

1. **Comparison Rule:**
```javascript
{
  name: 'currency_match',
  severity: 'error',
  type: 'comparison',
  left: 'source_a.currency',
  operator: '=',  // '=' | '!=' | '>' | '<' | '>=' | '<='
  right: 'source_b.currency',
  description: 'Currency must match exactly'
}
```

2. **Lua Script Rule:**
```javascript
{
  name: 'amount_tolerance',
  severity: 'error',
  type: 'script',
  script: 'return math.abs(source_a.amount - source_b.amount) <= 0.05',
  description: 'Amount within $0.05 tolerance'
}
```

3. **Boolean Logic Rule:**
```javascript
{
  name: 'compound_check',
  severity: 'error',
  type: 'boolean',
  operator: 'AND',  // 'AND' | 'OR' | 'NOT'
  operands: [
    { left: 'source_a.status', operator: '=', right: 'source_b.status' },
    { script: 'return source_a.amount > 0' }
  ]
}
```

---

### Step 5: Multi-Stage Reconciliation (5-reconciliation.html)

**Purpose:** Configure outputs and named queries

**UI Elements:**
- Job name and description
- Schedule configuration (optional)
  - Enable/disable
  - Cron expression
  - Auto-generate range selector
- **Output Configuration:**
  - Matched output settings
  - Unmatched left settings
  - Unmatched right settings
  - Export paths with template variables
- **Named Queries Section:**
  - Add queries for match groups
  - Query name (editable)
  - Rules passed (multi-select)
  - Rules failed (multi-select)
  - Optional Lua filter script
- **Multi-Stage Workflow (Optional):**
  - Add stages
  - Configure stage inputs/outputs
  - Chain stages together

**Output Configuration:**
```javascript
{
  matched: {
    store: true,
    path: '/results/{run_id}/matched.csv',
    queries: [
      {
        name: 'perfect_matches',
        description: 'All rules passed',
        rulesPassed: ['currency_match', 'amount_tolerance'],
        rulesFailed: []
      },
      {
        name: 'warnings',
        description: 'Minor discrepancies',
        rulesPassed: ['currency_match'],
        rulesFailed: ['timestamp_window'],
        script: 'return source_a.amount > 100'
      }
    ]
  },
  unmatchedLeft: {
    store: true,
    path: '/results/{run_id}/unmatched_left.csv'
  },
  unmatchedRight: {
    store: true,
    path: '/results/{run_id}/unmatched_right.csv'
  }
}
```

---

### Step 6: Review & Export (6-review.html)

**Purpose:** Review complete configuration and export YAML

**UI Elements:**
- **Summary Cards:**
  - Reconciliation unit summary
  - Source A summary
  - Source B summary
  - Schema summary (field count, transformations)
  - Rules summary (join conditions, rule count)
  - Output configuration summary

- **Full YAML Preview:**
  - Syntax-highlighted complete YAML
  - Line numbers
  - Expandable sections

- **Actions:**
  - Download YAML button
  - Copy to Clipboard button
  - Edit buttons (navigate back to specific step)
  - Save Draft button
  - Start Over button

**YAML Download:**
- Filename: `reconciliation-{jobName}-{timestamp}.yaml`
- Content: Complete YAML from YAMLGenerator.generateComplete()

---

## State Management

All configuration is stored in LocalStorage under key `reconciliation_config`:

```javascript
{
  reconUnit: {
    interval: 'day',
    timezone: 'UTC'
  },
  sourceA: { /* data source config */ },
  sourceB: { /* data source config */ },
  schemaA: { /* schema config */ },
  schemaB: { /* schema config */ },
  matchingRules: { /* rules config */ },
  reconciliation: { /* job config */ },
  created: '2024-03-15T10:30:00Z',
  lastModified: '2024-03-15T10:45:00Z'
}
```

## YAML Generation

The `YAMLGenerator` class generates production-ready YAML that matches the DSL specification (Version 2.0):

- Data sources (SFTP/API/PostgreSQL)
- Schemas with Lua transformations
- Matching rules (JOIN + WHERE pattern)
- Reconciliation job with outputs and named queries

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ JavaScript features
- LocalStorage API
- No polyfills required for modern environments

## Usage

1. Open `index.html` in a web browser
2. Click "Start New Configuration"
3. Complete each step of the wizard
4. Review and download YAML configuration
5. Use the generated YAML with the reconciliation engine backend

## Development

### Adding a New Step

1. Create HTML file: `N-step-name.html`
2. Follow the common structure pattern
3. Add navigation logic in `js/app.js`
4. Update progress stepper mapping
5. Implement validation logic
6. Update YAML generation in `js/yaml-generator.js`

### Styling

- Use CSS variables from `main.css`
- Follow existing component patterns in `components.css`
- Add step-specific styles to `steps.css`

### JavaScript

- Use Storage API for state management
- Follow existing coding patterns
- Add utility functions to `app.js`
- Keep page-specific logic in inline `<script>` tags

## Future Enhancements

- [ ] Real backend integration
- [ ] Actual data source connection testing
- [ ] Live schema detection from real data sources
- [ ] Rule validation and testing
- [ ] YAML import (reverse of export)
- [ ] Multi-user collaboration
- [ ] Version control for configurations
- [ ] Template library with sharing

## License

Internal use only for BS23 Reconciliation Engine project.
