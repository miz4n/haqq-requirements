/**
 * Main Application Logic
 * Common utilities and helpers for all pages
 */

const App = {
  /**
   * Initialize the app on page load
   */
  init() {
    this.updateProgressStepper();
    this.attachEventListeners();
  },

  /**
   * Update progress stepper based on current page and completed steps
   * Note: New 5-step flow (Recon Unit, Data Sources, Schema, Stages & Rules, Review)
   */
  updateProgressStepper() {
    const currentPage = window.location.pathname.split('/').pop();

    // Step mapping for both old (6-step) and new (5-step) flows
    const stepMapping = {
      'index.html': 0,
      '1-recon-unit.html': 1,
      '2-datasources.html': 2,
      '3-schema.html': 3,
      '4-stages.html': 4,      // New unified page
      '4-rules.html': 4,       // Legacy support
      '5-reconciliation.html': 4, // Legacy - redirects to 4-stages
      '5-review.html': 5,      // New review page (was 6-review)
      '6-review.html': 5       // Legacy support
    };

    const currentStep = stepMapping[currentPage] || 0;
    const config = Storage.get();

    // Update step states
    const steps = document.querySelectorAll('.step');
    steps.forEach((step, index) => {
      step.classList.remove('active', 'completed');

      if (index + 1 < currentStep) {
        step.classList.add('completed');
      } else if (index + 1 === currentStep) {
        step.classList.add('active');
      }

      // Mark completed based on config (5-step flow)
      if (index === 0 && config.reconUnit) step.classList.add('completed');
      if (index === 1 && config.sourceA && config.sourceB) step.classList.add('completed');
      if (index === 2 && config.schemaA && config.schemaA.fields) step.classList.add('completed');
      // Step 4: Check for new stages format OR legacy matchingRules + reconciliation
      if (index === 3 && ((config.stages && config.stages.length > 0) ||
                          (config.matchingRules && config.reconciliation))) {
        step.classList.add('completed');
      }
    });
  },

  /**
   * Navigate to a specific step
   */
  navigateTo(page) {
    window.location.href = page;
  },

  /**
   * Go to next step (5-step flow)
   */
  nextStep() {
    const currentPage = window.location.pathname.split('/').pop();
    const nextPages = {
      'index.html': '1-recon-unit.html',
      '1-recon-unit.html': '2-datasources.html',
      '2-datasources.html': '3-schema.html',
      '3-schema.html': '4-stages.html',       // New unified page
      '4-stages.html': '5-review.html',       // New review page
      // Legacy support
      '4-rules.html': '4-stages.html',        // Redirect to new page
      '5-reconciliation.html': '5-review.html',
      '6-review.html': null                   // End of flow
    };

    const nextPage = nextPages[currentPage];
    if (nextPage) {
      this.navigateTo(nextPage);
    }
  },

  /**
   * Go to previous step (5-step flow)
   */
  prevStep() {
    const currentPage = window.location.pathname.split('/').pop();
    const prevPages = {
      '1-recon-unit.html': 'index.html',
      '2-datasources.html': '1-recon-unit.html',
      '3-schema.html': '2-datasources.html',
      '4-stages.html': '3-schema.html',       // New unified page
      '5-review.html': '4-stages.html',       // New review page
      // Legacy support
      '4-rules.html': '3-schema.html',
      '5-reconciliation.html': '4-stages.html',
      '6-review.html': '4-stages.html'
    };

    const prevPage = prevPages[currentPage];
    if (prevPage) {
      this.navigateTo(prevPage);
    } else {
      this.navigateTo('index.html');
    }
  },

  /**
   * Attach common event listeners
   */
  attachEventListeners() {
    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.prevStep());
    }

    // Next button
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.validateCurrentStep()) {
          this.nextStep();
        }
      });
    }

    // Save draft button
    const saveDraftBtn = document.getElementById('saveDraftBtn');
    if (saveDraftBtn) {
      saveDraftBtn.addEventListener('click', () => {
        this.showNotification('Draft saved successfully!', 'success');
      });
    }
  },

  /**
   * Validate current step (to be overridden by page-specific logic)
   */
  validateCurrentStep() {
    return true;
  },

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type}`;
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.zIndex = '9999';
    notification.style.minWidth = '300px';

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  },

  /**
   * Show modal
   */
  showModal(title, content, actions = []) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
      <h3 class="modal-title">${title}</h3>
      <button class="modal-close">&times;</button>
    `;

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else {
      body.appendChild(content);
    }

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = `btn ${action.class || 'btn-secondary'}`;
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        if (action.onClick) action.onClick();
        overlay.remove();
      });
      footer.appendChild(btn);
    });

    modal.appendChild(header);
    modal.appendChild(body);
    if (actions.length > 0) {
      modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on X button
    header.querySelector('.modal-close').addEventListener('click', () => {
      overlay.remove();
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    return overlay;
  },

  /**
   * Format date for display
   */
  formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString();
  },

  /**
   * Download text as file
   */
  downloadFile(content, filename, contentType = 'text/plain') {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Copy text to clipboard
   */
  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showNotification('Copied to clipboard!', 'success');
      }).catch(err => {
        console.error('Failed to copy:', err);
        this.fallbackCopyToClipboard(text);
      });
    } else {
      this.fallbackCopyToClipboard(text);
    }
  },

  /**
   * Fallback copy to clipboard for older browsers
   */
  fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        this.showNotification('Copied to clipboard!', 'success');
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      this.showNotification('Failed to copy to clipboard', 'error');
    }

    document.body.removeChild(textArea);
  },

  /**
   * Generate unique ID
   */
  generateId() {
    return 'id_' + Math.random().toString(36).substr(2, 9);
  },

  /**
   * Debounce function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
};

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}
