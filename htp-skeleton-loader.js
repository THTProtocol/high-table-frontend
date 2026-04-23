/**
 * HTP Skeleton Loader
 * Simple skeleton loader functions for modal/game loading states
 */

window.HTPSkeleton = (function() {
    'use strict';
    
    /**
     * Show skeleton loading state
     * @param {string} id - Element ID or class
     */
    function skeletonShow(id) {
        const element = document.getElementById(id) || document.querySelector(`[data-skeleton="${id}"]`);
        if (!element) {
            console.warn(`[HTP Skeleton] Element not found: ${id}`);
            return;
        }
        
        // Store original content
        if (!element.dataset.originalContent) {
            element.dataset.originalContent = element.innerHTML;
        }
        
        // Create skeleton structure based on element type
        let skeletonHTML = '';
        
        if (element.classList.contains('game-modal') || element.classList.contains('lobby-section')) {
            // Full modal/section skeleton
            skeletonHTML = `
                <div class="skeleton-pulse" style="height: 24px; width: 60%; margin-bottom: 16px; border-radius: 8px;"></div>
                <div class="skeleton-pulse" style="height: 16px; width: 80%; margin-bottom: 12px; border-radius: 6px;"></div>
                <div class="skeleton-pulse" style="height: 16px; width: 70%; margin-bottom: 20px; border-radius: 6px;"></div>
                <div class="skeleton-pulse" style="height: 120px; width: 100%; margin-bottom: 16px; border-radius: 12px;"></div>
                <div class="skeleton-pulse" style="height: 44px; width: 40%; border-radius: 8px; margin: 0 auto;"></div>
            `;
        } else if (element.classList.contains('game-board')) {
            // Game board skeleton
            skeletonHTML = `
                <div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; width: 100%; max-width: 480px; margin: 0 auto;">
                    ${Array(64).fill().map(() => 
                        '<div class="skeleton-pulse" style="aspect-ratio: 1; border-radius: 4px;"></div>'
                    ).join('')}
                </div>
            `;
        } else if (element.classList.contains('stats-panel')) {
            // Stats panel skeleton
            skeletonHTML = `
                <div class="skeleton-pulse" style="height: 16px; width: 50%; margin-bottom: 8px; border-radius: 6px;"></div>
                <div class="skeleton-pulse" style="height: 24px; width: 30%; margin-bottom: 16px; border-radius: 8px;"></div>
                <div class="skeleton-pulse" style="height: 14px; width: 70%; margin-bottom: 6px; border-radius: 4px;"></div>
                <div class="skeleton-pulse" style="height: 14px; width: 60%; border-radius: 4px;"></div>
            `;
        } else {
            // Default skeleton
            skeletonHTML = '<div class="skeleton-pulse" style="height: 20px; width: 100%; border-radius: 8px;"></div>';
        }
        
        // Add loading class and skeleton content
        element.classList.add('skeleton-loading');
        element.innerHTML = skeletonHTML;
        
        console.log(`[HTP Skeleton] Showing skeleton for: ${id}`);
    }
    
    /**
     * Hide skeleton loading state and restore content
     * @param {string} id - Element ID or class
     * @param {string} newContent - Optional new content to show instead of restoring original
     */
    function skeletonHide(id, newContent = null) {
        const element = document.getElementById(id) || document.querySelector(`[data-skeleton="${id}"]`);
        if (!element) {
            console.warn(`[HTP Skeleton] Element not found: ${id}`);
            return;
        }
        
        element.classList.remove('skeleton-loading');
        
        if (newContent !== null) {
            element.innerHTML = newContent;
        } else if (element.dataset.originalContent) {
            element.innerHTML = element.dataset.originalContent;
            delete element.dataset.originalContent;
        } else {
            element.innerHTML = '';
        }
        
        console.log(`[HTP Skeleton] Hiding skeleton for: ${id}`);
    }
    
    /**
     * Wrap async function with skeleton loading
     * @param {Function} asyncFn - Async function to wrap
     * @param {string} elementId - Element to show skeleton in
     * @param {Object} options - Options
     * @returns {Promise} Result of async function
     */
    async function withSkeletonLoader(asyncFn, elementId, options = {}) {
        try {
            skeletonShow(elementId);
            const result = await asyncFn();
            return result;
        } finally {
            skeletonHide(elementId, options.newContent);
        }
    }
    
    /**
     * Preload skeleton styles if not already present
     */
    function preloadStyles() {
        if (document.getElementById('htp-skeleton-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'htp-skeleton-styles';
        style.textContent = `
            .skeleton-loading {
                pointer-events: none !important;
                user-select: none !important;
            }
            
            .skeleton-loading * {
                visibility: hidden !important;
            }
            
            .skeleton-loading > .skeleton-pulse {
                visibility: visible !important;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', preloadStyles);
    
    // Public API
    return {
        skeletonShow: skeletonShow,
        skeletonHide: skeletonHide,
        withLoader: withSkeletonLoader,
        preloadStyles: preloadStyles
    };
})();

// Alias for global access
window.skeletonShow = window.HTPSkeleton.skeletonShow;
window.skeletonHide = window.HTPSkeleton.skeletonHide;

console.log('[HTP Skeleton Loader] Initialized');