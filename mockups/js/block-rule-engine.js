/**
 * Block Rule Engine
 * Manages the block programming state, rendering, and serialization
 * for the reconciliation rule builder
 */

class BlockRuleEngine {
  constructor(options = {}) {
    this.containerId = options.containerId;
    this.toolboxId = options.toolboxId;
    this.trashId = options.trashId;
    this.previewId = options.previewId;
    this.onStateChange = options.onStateChange || (() => {});

    // Available fields from schemas
    this.availableFields = options.availableFields || { left: [], right: [] };

    // Block registry (id -> block data)
    this.blocks = new Map();

    // Root expression
    this.rootExpression = null;

    // Undo/Redo stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistorySize = 50;

    // Clipboard
    this.clipboard = null;

    // Block type definitions
    this.blockTypes = {
      comparison: {
        operators: ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN'],
        slots: ['left', 'right'],
        category: 'comparison'
      },
      boolean: {
        operators: ['AND', 'OR', 'NOT'],
        category: 'boolean'
      },
      field_reference: {
        category: 'field'
      },
      literal: {
        valueTypes: ['string', 'number', 'boolean', 'null'],
        category: 'literal'
      },
      function: {
        functions: {
          'ABS': { args: 1, description: 'Absolute value' },
          'MIN': { args: -1, description: 'Minimum value (variable args)' },
          'MAX': { args: -1, description: 'Maximum value (variable args)' },
          'COALESCE': { args: -1, description: 'First non-null value' },
          'TRIM': { args: 1, description: 'Remove whitespace' },
          'UPPER': { args: 1, description: 'Convert to uppercase' },
          'LOWER': { args: 1, description: 'Convert to lowercase' },
          'LENGTH': { args: 1, description: 'String length' },
          'ROUND': { args: 2, description: 'Round to decimals' }
        },
        category: 'function'
      },
      arithmetic: {
        operators: ['+', '-', '*', '/'],
        slots: ['left', 'right'],
        category: 'arithmetic'
      }
    };
  }

  /**
   * Initialize the engine with existing expression or create default
   */
  initialize(expressionData = null) {
    this.blocks.clear();
    this.undoStack = [];
    this.redoStack = [];

    if (expressionData) {
      this.rootExpression = this.deserializeExpression(expressionData);
    } else {
      // Create default AND block with empty slots
      this.rootExpression = this.createBlock('boolean', { operator: 'AND' });
      this.rootExpression.children = [null, null];
    }

    this.render();
    this.renderToolbox();
    this.updatePreview();
  }

  /**
   * Update available fields from schemas
   */
  setAvailableFields(fields) {
    this.availableFields = fields;
    this.render();
    this.renderToolbox();
  }

  /**
   * Generate unique block ID
   */
  generateBlockId() {
    return 'block_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Create a new block instance
   */
  createBlock(type, options = {}) {
    const id = this.generateBlockId();

    const blockDefaults = {
      comparison: {
        type: 'comparison',
        operator: options.operator || '=',
        left: null,
        right: null
      },
      boolean: {
        type: 'boolean',
        operator: options.operator || 'AND',
        children: options.operator === 'NOT' ? [null] : [null, null]
      },
      field_reference: {
        type: 'field_reference',
        source: options.source || 'source_left',
        fieldName: options.fieldName || (this.availableFields.left[0]?.name || 'field')
      },
      literal: {
        type: 'literal',
        valueType: options.valueType || 'string',
        value: options.value !== undefined ? options.value : ''
      },
      function: {
        type: 'function',
        functionName: options.functionName || 'ABS',
        arguments: this.createFunctionArgs(options.functionName || 'ABS')
      },
      arithmetic: {
        type: 'arithmetic',
        operator: options.operator || '+',
        left: null,
        right: null
      }
    };

    const block = {
      id,
      ...blockDefaults[type],
      ...options,
      parentId: null,
      slotKey: null
    };

    // Ensure ID is always the generated one
    block.id = id;

    this.blocks.set(id, block);
    return block;
  }

  /**
   * Create initial arguments array for a function
   */
  createFunctionArgs(functionName) {
    const funcDef = this.blockTypes.function.functions[functionName];
    if (!funcDef) return [null];

    const argCount = funcDef.args === -1 ? 2 : funcDef.args;
    return Array(argCount).fill(null);
  }

  /**
   * Get block by ID
   */
  getBlock(id) {
    return this.blocks.get(id);
  }

  /**
   * Save current state to history for undo
   */
  saveToHistory() {
    this.undoStack.push(this.serialize());
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Update block property
   */
  updateBlock(id, property, value) {
    this.saveToHistory();

    const block = this.blocks.get(id);
    if (block) {
      block[property] = value;

      // Handle special cases
      if (block.type === 'boolean' && property === 'operator') {
        if (value === 'NOT') {
          block.children = [block.children[0] || null];
        } else if (block.children.length < 2) {
          block.children.push(null);
        }
      }

      if (block.type === 'function' && property === 'functionName') {
        block.arguments = this.createFunctionArgs(value);
      }

      this.render();
      this.updatePreview();
      this.onStateChange(this.serialize());
    }
  }

  /**
   * Insert block into a slot
   */
  insertBlockIntoSlot(blockId, parentId, slotKey) {
    this.saveToHistory();

    const block = this.blocks.get(blockId);
    const parent = parentId ? this.blocks.get(parentId) : null;

    if (!block) return;

    // Remove from previous parent if exists
    if (block.parentId) {
      this.removeBlockFromParent(block);
    }

    // Insert into new parent
    if (parent) {
      if (parent.type === 'comparison' || parent.type === 'arithmetic') {
        if (slotKey === 'left') {
          parent.left = block;
        } else if (slotKey === 'right') {
          parent.right = block;
        }
      } else if (parent.type === 'boolean') {
        const index = parseInt(slotKey.replace('operand_', ''));
        if (!isNaN(index)) {
          parent.children[index] = block;
        }
      } else if (parent.type === 'function') {
        const index = parseInt(slotKey.replace('arg_', ''));
        if (!isNaN(index)) {
          parent.arguments[index] = block;
        }
      }

      block.parentId = parentId;
      block.slotKey = slotKey;
    } else {
      // Inserting as root
      this.rootExpression = block;
      block.parentId = null;
      block.slotKey = null;
    }

    this.render();
    this.updatePreview();
    this.onStateChange(this.serialize());
  }

  /**
   * Remove block from its parent
   */
  removeBlockFromParent(block) {
    if (!block.parentId) return;

    const parent = this.blocks.get(block.parentId);
    if (!parent) return;

    if (parent.type === 'comparison' || parent.type === 'arithmetic') {
      if (parent.left?.id === block.id) parent.left = null;
      if (parent.right?.id === block.id) parent.right = null;
    } else if (parent.type === 'boolean') {
      const idx = parent.children.findIndex(c => c?.id === block.id);
      if (idx !== -1) parent.children[idx] = null;
    } else if (parent.type === 'function') {
      const idx = parent.arguments.findIndex(a => a?.id === block.id);
      if (idx !== -1) parent.arguments[idx] = null;
    }

    block.parentId = null;
    block.slotKey = null;
  }

  /**
   * Delete block and all its children
   */
  deleteBlock(blockId) {
    this.saveToHistory();

    const block = this.blocks.get(blockId);
    if (!block) return;

    // Remove from parent
    this.removeBlockFromParent(block);

    // If this is the root, create a new default root
    if (this.rootExpression?.id === blockId) {
      this.rootExpression = this.createBlock('boolean', { operator: 'AND' });
      this.rootExpression.children = [null, null];
    }

    // Recursively delete children
    this.deleteBlockRecursive(block);

    this.render();
    this.updatePreview();
    this.onStateChange(this.serialize());
  }

  /**
   * Recursively delete block and children from registry
   */
  deleteBlockRecursive(block) {
    if (block.left) this.deleteBlockRecursive(block.left);
    if (block.right) this.deleteBlockRecursive(block.right);
    if (block.children) block.children.forEach(c => c && this.deleteBlockRecursive(c));
    if (block.arguments) block.arguments.forEach(a => a && this.deleteBlockRecursive(a));

    this.blocks.delete(block.id);
  }

  /**
   * Add operand slot to boolean block
   */
  addBooleanOperand(blockId) {
    this.saveToHistory();

    const block = this.blocks.get(blockId);
    if (block?.type === 'boolean' && block.operator !== 'NOT') {
      block.children.push(null);
      this.render();
      this.onStateChange(this.serialize());
    }
  }

  /**
   * Remove empty operand slot from boolean block
   */
  removeBooleanOperand(blockId, index) {
    this.saveToHistory();

    const block = this.blocks.get(blockId);
    if (block?.type === 'boolean' && block.operator !== 'NOT' && block.children.length > 2) {
      if (block.children[index] === null) {
        block.children.splice(index, 1);
        this.render();
        this.onStateChange(this.serialize());
      }
    }
  }

  /**
   * Add argument slot to variable-arg function
   */
  addFunctionArgument(blockId) {
    this.saveToHistory();

    const block = this.blocks.get(blockId);
    const variableArgFunctions = ['COALESCE', 'MIN', 'MAX'];

    if (block?.type === 'function' && variableArgFunctions.includes(block.functionName)) {
      block.arguments.push(null);
      this.render();
      this.onStateChange(this.serialize());
    }
  }

  /**
   * Copy block to clipboard
   */
  copyBlock(blockId) {
    const block = this.blocks.get(blockId);
    if (block) {
      this.clipboard = this.serializeBlock(block);
    }
  }

  /**
   * Paste block from clipboard
   */
  pasteBlock(parentId, slotKey) {
    if (!this.clipboard) return;

    this.saveToHistory();

    const newBlock = this.deserializeExpression(this.clipboard);
    this.insertBlockIntoSlot(newBlock.id, parentId, slotKey);
  }

  /**
   * Undo last action
   */
  undo() {
    if (this.undoStack.length === 0) return;

    this.redoStack.push(this.serialize());
    const state = this.undoStack.pop();
    this.deserialize(state);
    this.render();
    this.updatePreview();
    this.onStateChange(this.serialize());
  }

  /**
   * Redo last undone action
   */
  redo() {
    if (this.redoStack.length === 0) return;

    this.undoStack.push(this.serialize());
    const state = this.redoStack.pop();
    this.deserialize(state);
    this.render();
    this.updatePreview();
    this.onStateChange(this.serialize());
  }

  /**
   * Check if undo is available
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Serialize state to JSON (for storage)
   */
  serialize() {
    return {
      rootExpression: this.serializeBlock(this.rootExpression)
    };
  }

  /**
   * Serialize a single block and its children
   */
  serializeBlock(block) {
    if (!block) return null;

    const serialized = {
      type: block.type
    };

    switch (block.type) {
      case 'comparison':
        serialized.operator = block.operator;
        serialized.left = this.serializeBlock(block.left);
        serialized.right = this.serializeBlock(block.right);
        break;
      case 'boolean':
        serialized.operator = block.operator;
        serialized.children = block.children.map(c => this.serializeBlock(c));
        break;
      case 'field_reference':
        serialized.source = block.source;
        serialized.fieldName = block.fieldName;
        break;
      case 'literal':
        serialized.valueType = block.valueType;
        serialized.value = block.value;
        break;
      case 'function':
        serialized.functionName = block.functionName;
        serialized.arguments = block.arguments.map(a => this.serializeBlock(a));
        break;
      case 'arithmetic':
        serialized.operator = block.operator;
        serialized.left = this.serializeBlock(block.left);
        serialized.right = this.serializeBlock(block.right);
        break;
    }

    return serialized;
  }

  /**
   * Deserialize state from JSON
   */
  deserialize(state) {
    this.blocks.clear();
    this.rootExpression = this.deserializeExpression(state.rootExpression);
  }

  /**
   * Deserialize expression tree from JSON
   */
  deserializeExpression(data, parentId = null, slotKey = null) {
    if (!data) return null;

    const block = this.createBlock(data.type, data);
    block.parentId = parentId;
    block.slotKey = slotKey;

    switch (data.type) {
      case 'comparison':
      case 'arithmetic':
        block.left = this.deserializeExpression(data.left, block.id, 'left');
        block.right = this.deserializeExpression(data.right, block.id, 'right');
        break;
      case 'boolean':
        block.children = (data.children || []).map((c, i) =>
          this.deserializeExpression(c, block.id, `operand_${i}`)
        );
        if (block.children.length < 2 && block.operator !== 'NOT') {
          while (block.children.length < 2) block.children.push(null);
        }
        break;
      case 'function':
        block.arguments = (data.arguments || []).map((a, i) =>
          this.deserializeExpression(a, block.id, `arg_${i}`)
        );
        break;
    }

    return block;
  }

  /**
   * Render the expression tree to DOM
   */
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = '';

    if (!this.rootExpression) {
      container.innerHTML = `
        <div class="block-canvas-empty">
          <div class="block-canvas-empty-icon">🧩</div>
          <div class="block-canvas-empty-text">
            Drag blocks from the toolbox to build your matching rule
          </div>
        </div>
      `;
      return;
    }

    const rootWrapper = document.createElement('div');
    rootWrapper.className = 'block-root-expression';
    rootWrapper.appendChild(this.renderBlock(this.rootExpression));
    container.appendChild(rootWrapper);
  }

  /**
   * Render a single block to DOM element
   */
  renderBlock(block) {
    if (!block) return this.createEmptySlotPlaceholder();

    const renderer = this[`render_${block.type}`];
    if (renderer) {
      return renderer.call(this, block);
    }

    const span = document.createElement('span');
    span.textContent = '[Unknown block]';
    return span;
  }

  /**
   * Create placeholder for empty slot
   */
  createEmptySlotPlaceholder() {
    const span = document.createElement('span');
    span.className = 'block-slot-placeholder';
    return span;
  }

  /**
   * Render comparison block
   */
  render_comparison(block) {
    const div = document.createElement('div');
    div.className = 'block block--comparison';
    div.dataset.blockId = block.id;
    div.dataset.blockType = 'comparison';
    div.draggable = true;

    // Left slot
    const leftSlot = this.createSlot('left', 'value', block.left);
    leftSlot.dataset.parentId = block.id;

    // Operator select
    const opSelect = document.createElement('select');
    opSelect.className = 'block-operator-select';
    this.blockTypes.comparison.operators.forEach(op => {
      const option = document.createElement('option');
      option.value = op;
      option.textContent = op;
      option.selected = block.operator === op;
      opSelect.appendChild(option);
    });
    opSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'operator', e.target.value);
    });
    opSelect.addEventListener('mousedown', e => e.stopPropagation());

    // Right slot
    const rightSlot = this.createSlot('right', 'value', block.right);
    rightSlot.dataset.parentId = block.id;

    div.appendChild(leftSlot);
    div.appendChild(opSelect);
    div.appendChild(rightSlot);

    this.attachBlockEvents(div, block);
    return div;
  }

  /**
   * Render boolean block
   */
  render_boolean(block) {
    const isVertical = block.operator !== 'NOT';

    const div = document.createElement('div');
    div.className = `block block--boolean ${isVertical ? 'block--vertical' : 'block--not'}`;
    div.dataset.blockId = block.id;
    div.dataset.blockType = 'boolean';
    div.dataset.operator = block.operator;
    div.draggable = true;

    // Operator label / select
    const labelContainer = document.createElement('div');
    labelContainer.className = 'block-operator-label';

    const opSelect = document.createElement('select');
    opSelect.style.cssText = 'background: transparent; border: none; color: white; font-weight: 700; text-transform: uppercase; cursor: pointer;';
    ['AND', 'OR', 'NOT'].forEach(op => {
      const option = document.createElement('option');
      option.value = op;
      option.textContent = op;
      option.selected = block.operator === op;
      opSelect.appendChild(option);
    });
    opSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'operator', e.target.value);
    });
    opSelect.addEventListener('mousedown', e => e.stopPropagation());

    labelContainer.appendChild(opSelect);
    div.appendChild(labelContainer);

    if (block.operator === 'NOT') {
      // Single operand for NOT
      const slot = this.createSlot('operand_0', 'condition', block.children[0]);
      slot.dataset.parentId = block.id;
      div.appendChild(slot);
    } else {
      // Multiple operands for AND/OR
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'block-children';

      block.children.forEach((child, i) => {
        const slot = this.createSlot(`operand_${i}`, 'condition', child);
        slot.dataset.parentId = block.id;
        childrenContainer.appendChild(slot);
      });

      div.appendChild(childrenContainer);

      // Add button
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-add-operand';
      addBtn.textContent = '+ Add condition';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addBooleanOperand(block.id);
      });
      addBtn.addEventListener('mousedown', e => e.stopPropagation());
      div.appendChild(addBtn);
    }

    this.attachBlockEvents(div, block);
    return div;
  }

  /**
   * Render field reference block
   */
  render_field_reference(block) {
    const div = document.createElement('div');
    div.className = 'block block--field';
    div.dataset.blockId = block.id;
    div.dataset.blockType = 'field_reference';
    div.draggable = true;

    // Source select
    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'block-source-select';
    ['source_left', 'source_right'].forEach(src => {
      const option = document.createElement('option');
      option.value = src;
      option.textContent = src === 'source_left' ? 'Left' : 'Right';
      option.selected = block.source === src;
      sourceSelect.appendChild(option);
    });
    sourceSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'source', e.target.value);
      // Reset field to first available
      const fields = e.target.value === 'source_left'
        ? this.availableFields.left
        : this.availableFields.right;
      if (fields.length > 0) {
        this.updateBlock(block.id, 'fieldName', fields[0].name);
      }
    });
    sourceSelect.addEventListener('mousedown', e => e.stopPropagation());

    // Dot
    const dot = document.createElement('span');
    dot.className = 'block-dot';
    dot.textContent = '.';

    // Field select
    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'block-field-select';
    const fields = block.source === 'source_left'
      ? this.availableFields.left
      : this.availableFields.right;

    if (fields.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '(no fields)';
      fieldSelect.appendChild(option);
    } else {
      fields.forEach(field => {
        const option = document.createElement('option');
        option.value = field.name;
        option.textContent = field.name;
        option.selected = block.fieldName === field.name;
        fieldSelect.appendChild(option);
      });
    }
    fieldSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'fieldName', e.target.value);
    });
    fieldSelect.addEventListener('mousedown', e => e.stopPropagation());

    div.appendChild(sourceSelect);
    div.appendChild(dot);
    div.appendChild(fieldSelect);

    this.attachBlockEvents(div, block);
    return div;
  }

  /**
   * Render literal block
   */
  render_literal(block) {
    const div = document.createElement('div');
    div.className = 'block block--literal';
    div.dataset.blockId = block.id;
    div.dataset.blockType = 'literal';
    div.draggable = true;

    // Type select
    const typeSelect = document.createElement('select');
    typeSelect.className = 'block-literal-type';
    this.blockTypes.literal.valueTypes.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type === 'string' ? 'txt' : type.substr(0, 3);
      option.selected = block.valueType === type;
      typeSelect.appendChild(option);
    });
    typeSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'valueType', e.target.value);
    });
    typeSelect.addEventListener('mousedown', e => e.stopPropagation());

    div.appendChild(typeSelect);

    // Value input (except for null and boolean)
    if (block.valueType === 'null') {
      const nullLabel = document.createElement('span');
      nullLabel.className = 'block-literal-value';
      nullLabel.textContent = 'NULL';
      div.appendChild(nullLabel);
    } else if (block.valueType === 'boolean') {
      const boolSelect = document.createElement('select');
      boolSelect.className = 'block-literal-value';
      ['true', 'false'].forEach(v => {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = v;
        option.selected = String(block.value) === v;
        boolSelect.appendChild(option);
      });
      boolSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        this.updateBlock(block.id, 'value', e.target.value === 'true');
      });
      boolSelect.addEventListener('mousedown', e => e.stopPropagation());
      div.appendChild(boolSelect);
    } else {
      const input = document.createElement('input');
      input.type = block.valueType === 'number' ? 'number' : 'text';
      input.className = 'block-literal-value';
      input.value = block.value !== undefined ? block.value : '';
      input.placeholder = block.valueType === 'number' ? '0' : 'value';
      input.addEventListener('change', (e) => {
        e.stopPropagation();
        let value = e.target.value;
        if (block.valueType === 'number') {
          value = parseFloat(value) || 0;
        }
        this.updateBlock(block.id, 'value', value);
      });
      input.addEventListener('mousedown', e => e.stopPropagation());
      input.addEventListener('click', e => e.stopPropagation());
      div.appendChild(input);
    }

    this.attachBlockEvents(div, block);
    return div;
  }

  /**
   * Render function block
   */
  render_function(block) {
    const div = document.createElement('div');
    div.className = 'block block--function';
    div.dataset.blockId = block.id;
    div.dataset.blockType = 'function';
    div.dataset.function = block.functionName;
    div.draggable = true;

    // Function name select
    const nameSelect = document.createElement('select');
    nameSelect.className = 'block-function-name';
    nameSelect.style.cssText = 'background: transparent; border: none; color: white; font-weight: 700; cursor: pointer; padding-right: 16px;';

    Object.keys(this.blockTypes.function.functions).forEach(fn => {
      const option = document.createElement('option');
      option.value = fn;
      option.textContent = fn;
      option.selected = block.functionName === fn;
      nameSelect.appendChild(option);
    });
    nameSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'functionName', e.target.value);
    });
    nameSelect.addEventListener('mousedown', e => e.stopPropagation());

    div.appendChild(nameSelect);

    // Arguments
    const argsContainer = document.createElement('div');
    argsContainer.className = 'block-args';

    block.arguments.forEach((arg, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'arg-separator';
        sep.textContent = ',';
        argsContainer.appendChild(sep);
      }

      const slot = this.createSlot(`arg_${i}`, 'value', arg);
      slot.dataset.parentId = block.id;
      argsContainer.appendChild(slot);
    });

    div.appendChild(argsContainer);

    // Add argument button for variable-arg functions
    const variableArgFunctions = ['COALESCE', 'MIN', 'MAX'];
    if (variableArgFunctions.includes(block.functionName)) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-add-arg';
      addBtn.textContent = '+';
      addBtn.title = 'Add argument';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addFunctionArgument(block.id);
      });
      addBtn.addEventListener('mousedown', e => e.stopPropagation());
      div.appendChild(addBtn);
    }

    this.attachBlockEvents(div, block);
    return div;
  }

  /**
   * Render arithmetic block
   */
  render_arithmetic(block) {
    const div = document.createElement('div');
    div.className = 'block block--arithmetic';
    div.dataset.blockId = block.id;
    div.dataset.blockType = 'arithmetic';
    div.draggable = true;

    // Left slot
    const leftSlot = this.createSlot('left', 'value', block.left);
    leftSlot.dataset.parentId = block.id;

    // Operator select
    const opSelect = document.createElement('select');
    opSelect.className = 'block-operator-select';
    this.blockTypes.arithmetic.operators.forEach(op => {
      const option = document.createElement('option');
      option.value = op;
      option.textContent = op;
      option.selected = block.operator === op;
      opSelect.appendChild(option);
    });
    opSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.updateBlock(block.id, 'operator', e.target.value);
    });
    opSelect.addEventListener('mousedown', e => e.stopPropagation());

    // Right slot
    const rightSlot = this.createSlot('right', 'value', block.right);
    rightSlot.dataset.parentId = block.id;

    div.appendChild(leftSlot);
    div.appendChild(opSelect);
    div.appendChild(rightSlot);

    this.attachBlockEvents(div, block);
    return div;
  }

  /**
   * Create a slot element
   */
  createSlot(slotKey, placeholder, childBlock) {
    const slot = document.createElement('div');
    slot.className = 'block-slot';
    slot.dataset.slot = slotKey;
    slot.dataset.placeholder = placeholder;

    if (childBlock) {
      slot.appendChild(this.renderBlock(childBlock));
    }

    return slot;
  }

  /**
   * Attach drag and context menu events to block
   */
  attachBlockEvents(element, block) {
    // Right-click context menu
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e.clientX, e.clientY, block);
    });
  }

  /**
   * Show context menu for block
   */
  showContextMenu(x, y, block) {
    // Remove existing menu
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'block-context-menu';
    menu.id = 'block-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const items = [
      { icon: '📋', label: 'Copy', action: () => this.copyBlock(block.id) },
      { icon: '✂️', label: 'Cut', action: () => { this.copyBlock(block.id); this.deleteBlock(block.id); } },
      { separator: true },
      { icon: '🗑️', label: 'Delete', action: () => this.deleteBlock(block.id), danger: true }
    ];

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'block-context-menu-separator';
        menu.appendChild(sep);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = 'block-context-menu-item' + (item.danger ? ' danger' : '');
        menuItem.innerHTML = `
          <span class="block-context-menu-item-icon">${item.icon}</span>
          <span>${item.label}</span>
        `;
        menuItem.addEventListener('click', () => {
          item.action();
          this.hideContextMenu();
        });
        menu.appendChild(menuItem);
      }
    });

    document.body.appendChild(menu);

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
    }, 0);
  }

  /**
   * Hide context menu
   */
  hideContextMenu() {
    const menu = document.getElementById('block-context-menu');
    if (menu) menu.remove();
  }

  /**
   * Render toolbox palette
   */
  renderToolbox() {
    const toolbox = document.getElementById(this.toolboxId);
    if (!toolbox) return;

    toolbox.innerHTML = '';

    // Boolean section
    const boolSection = this.createToolboxSection('Logic', [
      { type: 'boolean', options: { operator: 'AND' }, label: 'AND' },
      { type: 'boolean', options: { operator: 'OR' }, label: 'OR' },
      { type: 'boolean', options: { operator: 'NOT' }, label: 'NOT' }
    ]);
    toolbox.appendChild(boolSection);

    // Comparison section
    const compSection = this.createToolboxSection('Compare', [
      { type: 'comparison', options: { operator: '=' }, label: '= equals' },
      { type: 'comparison', options: { operator: '!=' }, label: '!= not equals' },
      { type: 'comparison', options: { operator: '>' }, label: '> greater' },
      { type: 'comparison', options: { operator: '<' }, label: '< less' }
    ]);
    toolbox.appendChild(compSection);

    // Function section
    const funcSection = this.createToolboxSection('Functions', [
      { type: 'function', options: { functionName: 'ABS' }, label: 'ABS()' },
      { type: 'function', options: { functionName: 'MIN' }, label: 'MIN()' },
      { type: 'function', options: { functionName: 'MAX' }, label: 'MAX()' },
      { type: 'function', options: { functionName: 'COALESCE' }, label: 'COALESCE()' },
      { type: 'function', options: { functionName: 'TRIM' }, label: 'TRIM()' },
      { type: 'function', options: { functionName: 'UPPER' }, label: 'UPPER()' },
      { type: 'function', options: { functionName: 'LOWER' }, label: 'LOWER()' }
    ]);
    toolbox.appendChild(funcSection);

    // Fields section
    const fieldSection = this.createToolboxSection('Fields', [
      { type: 'field_reference', options: { source: 'source_left' }, label: 'Left.field' },
      { type: 'field_reference', options: { source: 'source_right' }, label: 'Right.field' }
    ]);
    toolbox.appendChild(fieldSection);

    // Arithmetic section
    const arithSection = this.createToolboxSection('Math', [
      { type: 'arithmetic', options: { operator: '+' }, label: '+ add' },
      { type: 'arithmetic', options: { operator: '-' }, label: '- subtract' },
      { type: 'arithmetic', options: { operator: '*' }, label: '* multiply' },
      { type: 'arithmetic', options: { operator: '/' }, label: '/ divide' }
    ]);
    toolbox.appendChild(arithSection);

    // Literals section
    const litSection = this.createToolboxSection('Values', [
      { type: 'literal', options: { valueType: 'string', value: '' }, label: '"text"' },
      { type: 'literal', options: { valueType: 'number', value: 0 }, label: '123' },
      { type: 'literal', options: { valueType: 'boolean', value: true }, label: 'true/false' },
      { type: 'literal', options: { valueType: 'null' }, label: 'NULL' }
    ]);
    toolbox.appendChild(litSection);
  }

  /**
   * Create a toolbox section
   */
  createToolboxSection(title, items) {
    const section = document.createElement('div');
    section.className = 'block-toolbox-section';

    const titleEl = document.createElement('div');
    titleEl.className = 'block-toolbox-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'block-toolbox-items';

    items.forEach(item => {
      const wrapper = document.createElement('div');
      wrapper.className = 'block-toolbox-item';
      wrapper.dataset.blockType = item.type;
      wrapper.dataset.blockOptions = JSON.stringify(item.options);

      // Create preview block
      const previewBlock = this.createToolboxPreview(item);
      wrapper.appendChild(previewBlock);

      itemsContainer.appendChild(wrapper);
    });

    section.appendChild(itemsContainer);
    return section;
  }

  /**
   * Create a preview block for toolbox
   */
  createToolboxPreview(item) {
    const div = document.createElement('div');
    div.className = `block block--${this.getBlockCategory(item.type)}`;
    div.style.pointerEvents = 'none';

    const label = document.createElement('span');
    label.textContent = item.label;
    div.appendChild(label);

    return div;
  }

  /**
   * Get block category for styling
   */
  getBlockCategory(type) {
    const categories = {
      comparison: 'comparison',
      boolean: 'boolean',
      function: 'function',
      field_reference: 'field',
      literal: 'literal',
      arithmetic: 'arithmetic'
    };
    return categories[type] || type;
  }

  /**
   * Update expression preview
   */
  updatePreview() {
    const preview = document.getElementById(this.previewId);
    if (!preview) return;

    const expression = this.toExpressionString(this.rootExpression);
    preview.textContent = expression || '(empty expression)';
  }

  /**
   * Convert expression tree to human-readable string
   */
  toExpressionString(block) {
    if (!block) return '?';

    switch (block.type) {
      case 'comparison':
        return `${this.toExpressionString(block.left)} ${block.operator} ${this.toExpressionString(block.right)}`;

      case 'boolean':
        if (block.operator === 'NOT') {
          return `NOT(${this.toExpressionString(block.children[0])})`;
        }
        const parts = block.children
          .filter(c => c !== null)
          .map(c => this.toExpressionString(c));
        if (parts.length === 0) return `(${block.operator} ...)`;
        if (parts.length === 1) return parts[0];
        return `(${parts.join(` ${block.operator} `)})`;

      case 'field_reference':
        const sourcePrefix = block.source === 'source_left' ? 'L' : 'R';
        return `${sourcePrefix}.${block.fieldName}`;

      case 'literal':
        if (block.valueType === 'string') return `"${block.value}"`;
        if (block.valueType === 'null') return 'NULL';
        return String(block.value);

      case 'function':
        const args = block.arguments
          .filter(a => a !== null)
          .map(a => this.toExpressionString(a))
          .join(', ');
        return `${block.functionName}(${args || '?'})`;

      case 'arithmetic':
        return `(${this.toExpressionString(block.left)} ${block.operator} ${this.toExpressionString(block.right)})`;

      default:
        return '?';
    }
  }

  /**
   * Validate the expression (check all required slots are filled)
   */
  validate() {
    const errors = [];
    this.validateBlock(this.rootExpression, errors, 'root');
    return errors;
  }

  /**
   * Validate a single block recursively
   */
  validateBlock(block, errors, path) {
    if (!block) {
      errors.push({ path, message: 'Empty expression' });
      return;
    }

    switch (block.type) {
      case 'comparison':
      case 'arithmetic':
        if (!block.left) errors.push({ path: `${path}.left`, message: 'Left operand is required' });
        else this.validateBlock(block.left, errors, `${path}.left`);
        if (!block.right) errors.push({ path: `${path}.right`, message: 'Right operand is required' });
        else this.validateBlock(block.right, errors, `${path}.right`);
        break;

      case 'boolean':
        const filledChildren = block.children.filter(c => c !== null);
        if (filledChildren.length === 0) {
          errors.push({ path, message: 'At least one condition is required' });
        }
        block.children.forEach((child, i) => {
          if (child) this.validateBlock(child, errors, `${path}.operand_${i}`);
        });
        break;

      case 'function':
        const filledArgs = block.arguments.filter(a => a !== null);
        if (filledArgs.length === 0) {
          errors.push({ path, message: 'Function requires at least one argument' });
        }
        block.arguments.forEach((arg, i) => {
          if (arg) this.validateBlock(arg, errors, `${path}.arg_${i}`);
        });
        break;

      case 'field_reference':
        if (!block.fieldName) {
          errors.push({ path, message: 'Field name is required' });
        }
        break;

      case 'literal':
        if (block.valueType !== 'null' && block.valueType !== 'boolean' &&
            (block.value === '' || block.value === undefined)) {
          errors.push({ path, message: 'Value is required' });
        }
        break;
    }
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockRuleEngine;
}
