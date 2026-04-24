/**
 * High Table Protocol UI/UX Polish Module
 * Provides toast notifications, button spinners, wallet pulse animation
 */

(function() {
    'use strict';

    // Toast notification system
    window.htpShowToast = function(message, type = 'info', durationSec = 3) {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'htp-toast htp-toast-' + type;
        toast.textContent = message;
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'htp-toast-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = function() {
            removeToast(toast);
        };
        toast.appendChild(closeBtn);
        
        // Add to body
        document.body.appendChild(toast);
        
        // Position toast
        setTimeout(() => {
            toast.classList.add('htp-toast-show');
        }, 10);
        
        // Auto remove
        setTimeout(() => {
            removeToast(toast);
        }, durationSec * 1000);
        
        function removeToast(toastEl) {
            if (toastEl.classList.contains('htp-toast-hiding')) return;
            toastEl.classList.add('htp-toast-hiding');
            setTimeout(() => {
                if (toastEl.parentNode) {
                    toastEl.parentNode.removeChild(toastEl);
                }
            }, 300);
        }
    };

    // Button spinner helpers
    window.htpShowButtonSpinner = function(btnId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        
        // Store original text and disable
        btn.setAttribute('data-original-text', btn.textContent);
        btn.disabled = true;
        btn.innerHTML = '<span class="htp-spinner"></span>';
    };

    window.htpHideButtonSpinner = function(btnId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        
        // Restore original text and enable
        const originalText = btn.getAttribute('data-original-text');
        if (originalText) {
            btn.textContent = originalText;
        }
        btn.disabled = false;
    };

})();