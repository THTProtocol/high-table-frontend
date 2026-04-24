/**
 * HTP Error Messages
 * Centralized human-readable error handling for High Table Protocol
 */

window.HTPError = {
  messages: {
    // Wallet errors
    WALLET_UNLOCK_ERROR: 'Failed to unlock wallet. Please check your password and try again.',
    WALLET_NOT_FOUND: 'No wallet found. Please create or import a wallet first.',
    WALLET_INVALID_PASSWORD: 'Invalid password. Please enter the correct password.',
    WALLET_INSUFFICIENT_BALANCE: 'Insufficient balance for this transaction.',
    WALLET_INVALID_ADDRESS: 'Invalid Kaspa address format.',
    WALLET_ALREADY_CONNECTED: 'Wallet is already connected.',
    
    // Game errors
    GAME_NOT_FOUND: 'Game not found or no longer available.',
    GAME_FULL: 'This game is already full. Please join a different game.',
    GAME_ALREADY_STARTED: 'Game has already started. Please wait for the next round.',
    GAME_INVALID_MOVE: 'Invalid move. Please check the game rules.',
    GAME_TIMEOUT: 'Game has timed out due to inactivity.',
    GAME_INVALID_STAKE: 'Invalid stake amount. Please check the minimum and maximum limits.',
    
    // Contract errors
    CONTRACT_NOT_FOUND: 'Contract not found on the blockchain.',
    CONTRACT_EXECUTION_ERROR: 'Contract execution failed. Please try again.',
    CONTRACT_INVALID_PARAMS: 'Invalid contract parameters.',
    
    // Network errors
    NETWORK_ERROR: 'Network connection error. Please check your internet connection.',
    NETWORK_TIMEOUT: 'Request timed out. Please try again.',
    RPC_ERROR: 'Blockchain connection error. Please try again later.',
    
    // Settlement errors
    SETTLEMENT_FAILED: 'Settlement process failed. Please contact support.',
    SETTLEMENT_PENDING: 'Settlement is still pending. Please wait a bit longer.',
    ORACLE_ERROR: 'Oracle data unavailable. Please try again later.',
    
    // Firebase errors
    FIREBASE_AUTH_ERROR: 'Authentication failed. Please sign in again.',
    FIREBASE_PERMISSION_DENIED: 'Permission denied. You may not have access to this resource.',
    FIREBASE_OFFLINE: 'Database connection lost. Please check your connection.',
    
    // Misc errors
    USER_CANCELLED: 'Transaction cancelled by user.',
    UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
    FEATURE_NOT_AVAILABLE: 'This feature is not available yet.',
    MAINTENANCE_MODE: 'System is currently under maintenance. Please try again later.'
  },

  /**
   * Get human-readable message for an error
   * @param {string|Error|Object} error - Error object, message, or code
   * @returns {string} Human-readable error message
   */
  getMessage: function(error) {
    if (!error) return this.messages.UNKNOWN_ERROR;
    
    let errorKey = error;
    
    // Handle Error objects
    if (error instanceof Error) {
      errorKey = error.message;
    }
    
    // Handle objects with code property
    if (typeof error === 'object' && error.code) {
      errorKey = error.code;
    }
    
    // Handle strings
    if (typeof errorKey === 'string') {
      // Check if we have a direct match
      if (this.messages[errorKey]) {
        return this.messages[errorKey];
      }
      
      // Try to extract code from error string
      const codeMatch = errorKey.match(/\[([A-Z_]+)\]|^([A-Z_]+):/);
      if (codeMatch) {
        const code = codeMatch[1] || codeMatch[2];
        if (this.messages[code]) {
          return this.messages[code];
        }
      }
      
      // Check for common patterns
      if (errorKey.includes('insufficient balance')) {
        return this.messages.WALLET_INSUFFICIENT_BALANCE;
      }
      if (errorKey.includes('timeout')) {
        return this.messages.NETWORK_TIMEOUT;
      }
      if (errorKey.includes('wallet')) {
        return this.messages.WALLET_UNLOCK_ERROR;
      }
    }
    
    return this.messages.UNKNOWN_ERROR;
  },

  /**
   * Show user-friendly error notification
   * @param {string|Error} error - Error to display
   * @param {Object} options - Display options
   */
  show: function(error, options = {}) {
    const message = this.getMessage(error);
    const { duration = 5000, type = 'error', title = 'Error' } = options;
    
    // Use error card styling if no notification system exists
    if (!window.notify && !window.toast) {
      this.showErrorCard(message, title);
      return;
    }
    
    // Use the HTP toast system if available (from htp-ui-polish.js)
    if (window.htpShowToast && typeof window.htpShowToast === 'function') {
      window.htpShowToast(message, type, Math.floor(duration / 1000));
      return;
    }
    
    // Use the existing notification system if available
    if (window.notify && typeof window.notify === 'function') {
      window.notify(message, type);
    } else if (window.toast && typeof window.toast === 'function') {
      window.toast(message, type);
    } else if (window.alert) {
      // Fallback to alert if no notification system exists
      window.alert(`${title}: ${message}`);
    }
    
    console.error(`[HTP Error] ${title}:`, message, error);
  },

  /**
   * Show styled error card
   * @param {string} message - Error message
   * @param {string} title - Error title
   * @param {Object} options - Display options
   */
  showErrorCard: function(message, title = 'Error', options = {}) {
    const { container = document.body, autoClose = true, duration = 5000 } = options;
    
    // Create error card
    const card = document.createElement('div');
    card.className = 'htp-error-card';
    card.innerHTML = `
      <button class="htp-error-card-close" onclick="this.parentElement.remove()">&times;</button>
      <div class="htp-error-card-title">
        <span>⚠️</span>
        <span>${title}</span>
      </div>
      <div class="htp-error-card-body">${message}</div>
    `;
    
    // Insert at top of container
    container.insertBefore(card, container.firstChild);
    
    // Auto-close after duration
    if (autoClose) {
      setTimeout(() => {
        if (card.parentElement) {
          card.remove();
        }
      }, duration);
    }
    
    console.error(`[HTP Error Card] ${title}:`, message);
  },

  /**
   * Show success message
   * @param {string} message - Success message
   * @param {Object} options - Display options
   */
  showSuccess: function(message, options = {}) {
    const { duration = 3000 } = options;
    
    if (window.notify && typeof window.notify === 'function') {
      window.notify(message, 'success');
    } else if (window.toast && typeof window.toast === 'function') {
      window.toast(message, 'success');
    }
    
    console.log(`[HTP Success] ${message}`);
  },

    /*
   * Wrap a function with error handling
   * @param {Function} fn - Function to wrap
   * @param {Object} options - Error handling options
   * @returns {Function} Wrapped function
   */
  wrap: function(fn, options = {}) {
    const self = this;
    return async function(...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        if (options.showError !== false) {
          self.show(error, options);
        }
        if (options.throw !== false) {
          throw error;
        }
        return options.defaultValue;
      }
    };
  },

  /**
   * Show skeleton loading state for an element
   * @param {Element|string} element - Element or selector
   * @param {Object} options - Skeleton options
   */
  showSkeleton: function(element, options = {}) {
    const target = typeof element === 'string' ? document.querySelector(element) : element;
    if (!target) return;
    
    const { text = false, lines = 1, height = '20px', width = '100%' } = options;
    
    // Create skeleton container
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-pulse';
    skeleton.style.width = width;
    skeleton.style.height = height;
    skeleton.style.margin = '4px 0';
    skeleton.style.borderRadius = '4px';
    
    if (text) {
      // Create multiple lines for text content
      const container = document.createElement('div');
      for (let i = 0; i < lines; i++) {
        const line = skeleton.cloneNode();
        line.style.width = i === lines - 1 ? '60%' : '100%';
        line.style.height = height;
        container.appendChild(line);
      }
      skeleton = container;
    }
    
    // Store original content
    target.dataset.originalContent = target.innerHTML;
    target.innerHTML = '';
    target.appendChild(skeleton);
    target.classList.add('skeleton-loading');
    
    return skeleton;
  },

  /**
   * Hide skeleton loading state and restore original content
   * @param {Element|string} element - Element or selector
   * @param {string} newContent - Optional new content to show
   */
  hideSkeleton: function(element, newContent = null) {
    const target = typeof element === 'string' ? document.querySelector(element) : element;
    if (!target) return;
    
    // Remove skeleton elements
    const skeletons = target.querySelectorAll('.skeleton-pulse');
    skeletons.forEach(s => s.remove());
    
    target.classList.remove('skeleton-loading');
    
    // Restore or set content
    if (newContent !== null) {
      target.innerHTML = newContent;
    } else if (target.dataset.originalContent) {
      target.innerHTML = target.dataset.originalContent;
      delete target.dataset.originalContent;
    }
  },

  /**
   * Wrap async function with skeleton loading state
   * @param {Function} fn - Async function to wrap
   * @param {Element|string} element - Element to show skeleton in
   * @param {Object} options - Options for skeleton and function
   */
  withSkeleton: async function(fn, element, options = {}) {
    try {
      this.showSkeleton(element, options);
      const result = await fn();
      return result;
    } finally {
      this.hideSkeleton(element, options.newContent);
    }
  }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('[HTP Error Messages] Error handling system initialized');
});

// Global error handler
window.addEventListener('error', function(e) {
  console.error('[HTP Global Error Handler]', e.error || e.message);
  // Only show user-friendly message if it's a known error pattern
  const message = e.message || e.error?.message || '';
  if (message.includes('Wallet') || message.includes('Insufficient') || message.includes('Network')) {
    HTPError.show(message);
  }
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', function(e) {
  console.error('[HTP Unhandled Promise Rejection]', e.reason);
  if (e.reason && e.reason.message) {
    const message = e.reason.message;
    if (message.includes('Wallet') || message.includes('Insufficient') || message.includes('Network')) {
      HTPError.show(message);
    }
  }
});