/**
 * Block Drag Drop Manager
 * Handles all drag-and-drop interactions for the block programming UI
 */

class BlockDragDropManager {
  constructor(options = {}) {
    this.engine = options.engine;
    this.canvasSelector = options.canvasSelector || '.block-canvas';
    this.toolboxSelector = options.toolboxSelector || '.block-toolbox';
    this.trashSelector = options.trashSelector || '.block-trash';

    this.dragState = {
      isDragging: false,
      sourceType: null,      // 'toolbox' | 'canvas'
      blockType: null,
      blockOptions: null,
      blockId: null,
      clone: null,
      originalElement: null,
      offsetX: 0,
      offsetY: 0
    };

    this.init();
  }

  /**
   * Initialize event listeners
   */
  init() {
    // Bind handlers
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);

    // Add listeners
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    document.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    document.addEventListener('touchend', this.handleTouchEnd);

    // Prevent default drag behavior
    document.addEventListener('dragstart', (e) => {
      if (e.target.closest('.block') || e.target.closest('.block-toolbox-item')) {
        e.preventDefault();
      }
    });
  }

  /**
   * Handle mouse down event
   */
  handleMouseDown(e) {
    // Check for toolbox item - must be within THIS toolbox
    const toolboxItem = e.target.closest('.block-toolbox-item');
    const toolbox = document.querySelector(this.toolboxSelector);
    if (toolboxItem && toolbox && toolbox.contains(toolboxItem)) {
      e.preventDefault();
      this.startToolboxDrag(toolboxItem, e.clientX, e.clientY);
      return;
    }

    // Check for canvas block - must be within THIS canvas
    const block = e.target.closest('.block');
    const canvas = document.querySelector(this.canvasSelector);
    if (block && canvas && canvas.contains(block)) {
      // Don't drag if clicking on form controls
      if (e.target.matches('input, select, button')) return;

      e.preventDefault();
      this.startCanvasDrag(block, e.clientX, e.clientY);
    }
  }

  /**
   * Handle touch start event
   */
  handleTouchStart(e) {
    const touch = e.touches[0];

    // Check for toolbox item - must be within THIS toolbox
    const toolboxItem = e.target.closest('.block-toolbox-item');
    const toolbox = document.querySelector(this.toolboxSelector);
    if (toolboxItem && toolbox && toolbox.contains(toolboxItem)) {
      e.preventDefault();
      this.startToolboxDrag(toolboxItem, touch.clientX, touch.clientY);
      return;
    }

    // Check for canvas block - must be within THIS canvas
    const block = e.target.closest('.block');
    const canvas = document.querySelector(this.canvasSelector);
    if (block && canvas && canvas.contains(block)) {
      if (e.target.matches('input, select, button')) return;

      e.preventDefault();
      this.startCanvasDrag(block, touch.clientX, touch.clientY);
    }
  }

  /**
   * Start dragging from toolbox
   */
  startToolboxDrag(toolboxItem, clientX, clientY) {
    const blockType = toolboxItem.dataset.blockType;
    const blockOptions = JSON.parse(toolboxItem.dataset.blockOptions || '{}');

    // Create a visual clone for dragging
    const clone = this.createDragClone(blockType, blockOptions);
    const rect = toolboxItem.getBoundingClientRect();

    this.dragState = {
      isDragging: true,
      sourceType: 'toolbox',
      blockType,
      blockOptions,
      blockId: null,
      clone,
      originalElement: null,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top
    };

    // Position clone
    clone.style.position = 'fixed';
    clone.style.zIndex = '10000';
    clone.style.pointerEvents = 'none';
    clone.style.left = `${clientX - this.dragState.offsetX}px`;
    clone.style.top = `${clientY - this.dragState.offsetY}px`;
    clone.classList.add('dragging');

    document.body.appendChild(clone);

    // Show trash
    this.showTrash();
  }

  /**
   * Start dragging from canvas
   */
  startCanvasDrag(block, clientX, clientY) {
    const blockId = block.dataset.blockId;
    if (!blockId) return;

    const rect = block.getBoundingClientRect();

    this.dragState = {
      isDragging: true,
      sourceType: 'canvas',
      blockType: block.dataset.blockType,
      blockOptions: null,
      blockId,
      clone: block,
      originalElement: block,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top
    };

    // Add dragging class
    block.classList.add('dragging');

    // Show trash
    this.showTrash();
  }

  /**
   * Create a clone element for dragging
   */
  createDragClone(blockType, options) {
    const clone = document.createElement('div');
    clone.className = `block block--${this.getBlockCategory(blockType)}`;

    // Simple label based on type
    let label = blockType;
    if (options.operator) label = options.operator;
    if (options.functionName) label = options.functionName + '()';
    if (options.valueType) label = options.valueType === 'string' ? '"text"' : options.valueType;

    clone.innerHTML = `<span>${label}</span>`;
    return clone;
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
   * Handle mouse move event
   */
  handleMouseMove(e) {
    if (!this.dragState.isDragging) return;
    this.updateDragPosition(e.clientX, e.clientY);
  }

  /**
   * Handle touch move event
   */
  handleTouchMove(e) {
    if (!this.dragState.isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    this.updateDragPosition(touch.clientX, touch.clientY);
  }

  /**
   * Update drag position and highlight targets
   */
  updateDragPosition(clientX, clientY) {
    const { clone, offsetX, offsetY, sourceType } = this.dragState;

    if (sourceType === 'toolbox') {
      clone.style.left = `${clientX - offsetX}px`;
      clone.style.top = `${clientY - offsetY}px`;
    }

    // Check drop targets
    this.highlightDropTargets(clientX, clientY);
  }

  /**
   * Highlight valid drop targets
   */
  highlightDropTargets(clientX, clientY) {
    // Get the canvas for this drag-drop manager
    const canvas = document.querySelector(this.canvasSelector);
    if (!canvas) return;

    // Clear previous highlights only within this canvas
    canvas.querySelectorAll('.block-slot.drag-over, .block-slot.invalid-drop').forEach(el => {
      el.classList.remove('drag-over', 'invalid-drop');
    });

    const trash = document.querySelector(this.trashSelector);
    if (trash) {
      trash.classList.remove('drag-over');
    }

    // Check trash
    if (trash && this.dragState.sourceType === 'canvas') {
      const trashRect = trash.getBoundingClientRect();
      if (this.isPointInRect(clientX, clientY, trashRect)) {
        trash.classList.add('drag-over');
        return;
      }
    }

    // Find all empty slots only within this canvas
    const slots = canvas.querySelectorAll('.block-slot');
    for (const slot of slots) {
      // Skip slots that already have a block (unless it's the dragged block)
      const hasBlock = slot.querySelector('.block');
      if (hasBlock && hasBlock !== this.dragState.originalElement) continue;

      const rect = slot.getBoundingClientRect();
      if (this.isPointInRect(clientX, clientY, rect)) {
        const isValid = this.isValidDrop(slot);
        slot.classList.add(isValid ? 'drag-over' : 'invalid-drop');
        break;
      }
    }
  }

  /**
   * Check if drop is valid for slot
   */
  isValidDrop(slot) {
    const { blockType, blockId, sourceType } = this.dragState;

    // Can't drop a block into its own descendants
    if (sourceType === 'canvas' && blockId) {
      const parentBlock = slot.closest('.block');
      if (parentBlock) {
        // Check if slot's parent is a descendant of the dragged block
        const draggedElement = document.querySelector(`[data-block-id="${blockId}"]`);
        if (draggedElement && draggedElement.contains(parentBlock)) {
          return false;
        }
      }
    }

    // Type compatibility rules
    const slotParent = slot.closest('.block');
    if (!slotParent) return true;

    const parentType = slotParent.dataset.blockType;
    const slotKey = slot.dataset.slot;

    // Boolean blocks expect comparison or boolean children
    if (parentType === 'boolean') {
      return ['comparison', 'boolean'].includes(blockType);
    }

    // Comparison/arithmetic/function slots expect value types
    if (parentType === 'comparison' || parentType === 'arithmetic' || parentType === 'function') {
      return ['field_reference', 'literal', 'function', 'arithmetic'].includes(blockType);
    }

    return true;
  }

  /**
   * Handle mouse up event
   */
  handleMouseUp(e) {
    if (!this.dragState.isDragging) return;
    this.endDrag(e.clientX, e.clientY);
  }

  /**
   * Handle touch end event
   */
  handleTouchEnd(e) {
    if (!this.dragState.isDragging) return;
    const touch = e.changedTouches[0];
    this.endDrag(touch.clientX, touch.clientY);
  }

  /**
   * End drag operation
   */
  endDrag(clientX, clientY) {
    const { clone, sourceType, blockType, blockOptions, blockId, originalElement } = this.dragState;

    // Get the canvas for this drag-drop manager
    const canvas = document.querySelector(this.canvasSelector);

    // Check if dropped on trash
    const trash = document.querySelector(this.trashSelector);
    if (trash && sourceType === 'canvas') {
      const trashRect = trash.getBoundingClientRect();
      if (this.isPointInRect(clientX, clientY, trashRect)) {
        // Delete the block
        this.engine.deleteBlock(blockId);
        this.cleanup();
        return;
      }
    }

    // Check if dropped on valid slot - only within this canvas
    let targetSlot = null;
    if (canvas) {
      const slots = canvas.querySelectorAll('.block-slot');

      for (const slot of slots) {
        const hasBlock = slot.querySelector('.block');
        if (hasBlock && hasBlock !== originalElement) continue;

        const rect = slot.getBoundingClientRect();
        if (this.isPointInRect(clientX, clientY, rect) && this.isValidDrop(slot)) {
          targetSlot = slot;
          break;
        }
      }
    }

    if (targetSlot) {
      const parentBlockEl = targetSlot.closest('.block');
      const parentId = parentBlockEl ? parentBlockEl.dataset.blockId : null;
      const slotKey = targetSlot.dataset.slot;

      if (sourceType === 'toolbox') {
        // Create new block and insert
        const newBlock = this.engine.createBlock(blockType, blockOptions);
        this.engine.insertBlockIntoSlot(newBlock.id, parentId, slotKey);
      } else {
        // Move existing block
        this.engine.insertBlockIntoSlot(blockId, parentId, slotKey);
      }
    } else if (sourceType === 'toolbox') {
      // Check if dropped on canvas root (not in a slot)
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        if (this.isPointInRect(clientX, clientY, canvasRect)) {
          // Create new block as root (replace existing)
          if (['boolean', 'comparison'].includes(blockType)) {
            const newBlock = this.engine.createBlock(blockType, blockOptions);
            this.engine.rootExpression = newBlock;
            this.engine.render();
            this.engine.updatePreview();
            this.engine.onStateChange(this.engine.serialize());
          }
        }
      }
    }

    this.cleanup();
  }

  /**
   * Clean up after drag
   */
  cleanup() {
    const { clone, sourceType, originalElement } = this.dragState;

    // Remove clone if from toolbox
    if (sourceType === 'toolbox' && clone && clone.parentElement) {
      clone.remove();
    }

    // Remove dragging class
    if (originalElement) {
      originalElement.classList.remove('dragging');
    }

    // Clear highlights only within this canvas
    const canvas = document.querySelector(this.canvasSelector);
    if (canvas) {
      canvas.querySelectorAll('.block-slot.drag-over, .block-slot.invalid-drop').forEach(el => {
        el.classList.remove('drag-over', 'invalid-drop');
      });
    }

    // Hide trash
    this.hideTrash();

    // Reset state
    this.dragState = {
      isDragging: false,
      sourceType: null,
      blockType: null,
      blockOptions: null,
      blockId: null,
      clone: null,
      originalElement: null,
      offsetX: 0,
      offsetY: 0
    };
  }

  /**
   * Show trash zone
   */
  showTrash() {
    const trash = document.querySelector(this.trashSelector);
    if (trash) {
      trash.classList.add('visible');
    }
  }

  /**
   * Hide trash zone
   */
  hideTrash() {
    const trash = document.querySelector(this.trashSelector);
    if (trash) {
      trash.classList.remove('visible', 'drag-over');
    }
  }

  /**
   * Check if point is inside rectangle
   */
  isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /**
   * Destroy the drag drop manager
   */
  destroy() {
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('touchstart', this.handleTouchStart);
    document.removeEventListener('touchmove', this.handleTouchMove);
    document.removeEventListener('touchend', this.handleTouchEnd);
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockDragDropManager;
}
