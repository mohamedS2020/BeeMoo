// BeeMoo - Subtitle Renderer Component
// Handles displaying subtitles with responsive design

export class SubtitleRenderer {
  constructor(videoContainer) {
    this.videoContainer = videoContainer;
    this.subtitleElement = null;
    this.isVisible = true;
    this.currentText = '';
    this.settings = {
      fontSize: 'medium',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textColor: '#ffffff',
      position: 'bottom',
      outline: true,
      shadow: true
    };
    
    this.init();
  }

  /**
   * Initialize subtitle display element
   */
  init() {
    this.setupResponsiveHandling();
    // Don't create element until needed
  }

  /**
   * Create subtitle display element
   */
  createSubtitleElement() {
    // Remove existing subtitle element
    if (this.subtitleElement) {
      this.subtitleElement.remove();
    }

    this.subtitleElement = document.createElement('div');
    this.subtitleElement.className = 'subtitle-overlay';
    this.subtitleElement.setAttribute('role', 'region');
    this.subtitleElement.setAttribute('aria-label', 'Video subtitles');
    this.subtitleElement.setAttribute('aria-live', 'polite');
    
    this.applyStyles();
    this.videoContainer.appendChild(this.subtitleElement);
  }

  /**
   * Get responsive bottom position for subtitles
   */
  getBottomPosition() {
    if (this.settings.position !== 'bottom') return 'auto';
    
    // Check if video player is in fullscreen mode
    const isFullscreen = document.fullscreenElement && 
                         document.fullscreenElement.classList.contains('video-player');
    
    if (isFullscreen) {
      return '90px'; // Fullscreen: largest controls
    }
    
    // Check screen size for responsive positioning
    const width = window.innerWidth;
    
    if (width <= 480) {
      return '40px'; // Mobile: smaller controls
    } else if (width <= 768) {
      return '50px'; // Tablet: medium controls  
    } else {
      return '80px'; // Desktop: larger controls
    }
  }

  /**
   * Apply responsive styles to subtitle element
   */
  applyStyles() {
    if (!this.subtitleElement) return;

    const styles = {
      position: 'absolute',
      left: '50%',
      bottom: this.getBottomPosition(),
      top: this.settings.position === 'top' ? '20px' : 'auto',
      transform: 'translateX(-50%)',
      width: '90%',
      maxWidth: '800px',
      textAlign: 'center',
      fontSize: this.getFontSize(),
      fontFamily: this.settings.fontFamily,
      color: this.settings.textColor,
      backgroundColor: this.settings.backgroundColor,
      padding: '8px 16px',
      borderRadius: '4px',
      lineHeight: '1.4',
      wordWrap: 'break-word',
      whiteSpace: 'pre-wrap',
      zIndex: '1000',
      pointerEvents: 'none',
      visibility: this.isVisible ? 'visible' : 'hidden',
      opacity: this.isVisible ? '1' : '0',
      transition: 'opacity 0.2s ease',
      
      // Text outline/shadow for better readability
      ...(this.settings.outline && {
        textShadow: this.settings.shadow ? 
          '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' :
          '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
      })
    };

    Object.assign(this.subtitleElement.style, styles);
  }

  /**
   * Get responsive font size
   */
  getFontSize() {
    const containerWidth = this.videoContainer.clientWidth;
    const baseSize = this.settings.fontSize;
    
    // Responsive font sizing
    const sizeMap = {
      small: {
        mobile: '14px',
        tablet: '16px',
        desktop: '18px'
      },
      medium: {
        mobile: '16px',
        tablet: '18px',
        desktop: '20px'
      },
      large: {
        mobile: '18px',
        tablet: '22px',
        desktop: '24px'
      },
      xlarge: {
        mobile: '20px',
        tablet: '26px',
        desktop: '28px'
      }
    };

    if (containerWidth <= 480) {
      return sizeMap[baseSize]?.mobile || '16px';
    } else if (containerWidth <= 768) {
      return sizeMap[baseSize]?.tablet || '18px';
    } else {
      return sizeMap[baseSize]?.desktop || '20px';
    }
  }

  /**
   * Display subtitle text
   */
  displaySubtitle(subtitle) {
    const text = subtitle?.text || '';
    
    // Create element only when we have text to show
    if (text && !this.subtitleElement) {
      this.createSubtitleElement();
    }
    
    if (!this.subtitleElement) return;

    // Only update if text changed
    if (this.currentText === text) return;
    
    this.currentText = text;
    this.subtitleElement.textContent = text;
    
    // Handle visibility
    if (text && this.isVisible) {
      this.subtitleElement.style.visibility = 'visible';
      this.subtitleElement.style.opacity = '1';
    } else {
      this.subtitleElement.style.visibility = 'hidden';
      this.subtitleElement.style.opacity = '0';
    }

    // Accessibility announcement
    if (text) {
      this.announceSubtitle(text);
    }
  }

  /**
   * Announce subtitle for screen readers
   */
  announceSubtitle(text) {
    // Create temporary element for screen reader announcement
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = `Subtitle: ${text}`;
    
    document.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
  }

  /**
   * Clear current subtitle
   */
  clear() {
    this.displaySubtitle(null);
  }

  /**
   * Show/hide subtitles
   */
  setVisible(visible) {
    this.isVisible = visible;
    if (this.subtitleElement) {
      this.subtitleElement.style.visibility = visible ? 'visible' : 'hidden';
      this.subtitleElement.style.opacity = visible ? '1' : '0';
    }
  }

  /**
   * Update subtitle settings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.applyStyles();
  }

  /**
   * Setup responsive handling
   */
  setupResponsiveHandling() {
    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.applyStyles();
      }, 100);
    };

    const handleFullscreenChange = () => {
      // Update subtitle position when entering/exiting fullscreen
      this.applyStyles();
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    // Cleanup function
    this.cleanup = () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }

  /**
   * Get current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Destroy subtitle renderer
   */
  destroy() {
    if (this.subtitleElement) {
      this.subtitleElement.remove();
      this.subtitleElement = null;
    }
    
    if (this.cleanup) {
      this.cleanup();
    }
  }

  /**
   * Create subtitle settings panel HTML
   */
  static createSettingsHTML() {
    return `
      <div class="subtitle-settings">
        <h4>Subtitle Settings</h4>
        
        <div class="setting-group">
          <label for="subtitle-font-size">Font Size:</label>
          <select id="subtitle-font-size" class="subtitle-setting">
            <option value="small">Small</option>
            <option value="medium" selected>Medium</option>
            <option value="large">Large</option>
            <option value="xlarge">Extra Large</option>
          </select>
        </div>

        <div class="setting-group">
          <label for="subtitle-position">Position:</label>
          <select id="subtitle-position" class="subtitle-setting">
            <option value="bottom" selected>Bottom</option>
            <option value="top">Top</option>
          </select>
        </div>

        <div class="setting-group">
          <label for="subtitle-background">Background:</label>
          <input type="color" id="subtitle-background" class="subtitle-setting" value="#000000">
          <input type="range" id="subtitle-opacity" class="subtitle-setting" min="0" max="100" value="80">
        </div>

        <div class="setting-group">
          <label for="subtitle-text-color">Text Color:</label>
          <input type="color" id="subtitle-text-color" class="subtitle-setting" value="#ffffff">
        </div>

        <div class="setting-group">
          <label>
            <input type="checkbox" id="subtitle-outline" class="subtitle-setting" checked>
            Text Outline
          </label>
        </div>

        <div class="setting-group">
          <label>
            <input type="checkbox" id="subtitle-shadow" class="subtitle-setting" checked>
            Text Shadow
          </label>
        </div>
      </div>
    `;
  }
}
