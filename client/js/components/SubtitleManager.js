// BeeMoo - Subtitle Manager Component
// Manages subtitle upload, sharing, and synchronization

import { SubtitleParser } from '../utils/subtitleParser.js';
import { SubtitleRenderer } from './SubtitleRenderer.js';

export class SubtitleManager {
  constructor(videoPlayer, socketClient, isHost = false) {
    this.videoPlayer = videoPlayer;
    this.socketClient = socketClient;
    this.isHost = isHost;
    this.parser = new SubtitleParser();
    this.renderer = null;
    this.isEnabled = true;
    this.shareMode = 'all'; // 'all' or 'individual'
    this.hasHostSubtitles = false;
    
    console.log(`🎬 SubtitleManager created (isHost: ${isHost}, hasSocket: ${!!socketClient})`);
    
    this.init();
  }

  /**
   * Initialize subtitle manager
   */
  init() {
    this.createRenderer();
    this.setupSocketListeners();
    this.bindToVideoPlayer();
    this.createUI();
  }

  /**
   * Create subtitle renderer
   */
  createRenderer() {
    if (this.videoPlayer && this.videoPlayer.container) {
      this.renderer = new SubtitleRenderer(this.videoPlayer.container);
    }
  }

  /**
   * Setup socket event listeners for subtitle sync
   */
  setupSocketListeners() {
    if (!this.socketClient) {
      console.warn('⚠️ SubtitleManager: No socket client provided');
      return;
    }

    console.log(`🔌 Setting up subtitle socket listeners (isHost: ${this.isHost})`);

    // Host shares subtitles with participants
    this.socketClient.on('subtitle-shared', (data) => {
      console.log('📥 Received subtitle-shared event:', data);
      if (!this.isHost && data.mode === 'all') {
        console.log('📥 Processing shared subtitles from host');
        this.receiveSharedSubtitles(data);
      } else {
        console.log('📥 Ignoring subtitle-shared event (isHost or not for all)');
      }
    });

    // Listen for server confirmations
    this.socketClient.on('subtitle-share-confirmed', (data) => {
      console.log('📥 Received subtitle-share-confirmed:', data);
    });

    this.socketClient.on('subtitle-permission-confirmed', (data) => {
      console.log('📥 Received subtitle-permission-confirmed:', data);
    });

    // Listen for errors
    this.socketClient.on('error', (error) => {
      if (error.message && error.message.includes('subtitle')) {
        console.error('❌ Subtitle-related error:', error);
      }
    });

    // Participant requests individual subtitle permission
    this.socketClient.on('subtitle-individual-allowed', (data) => {
      console.log('📥 Received subtitle-individual-allowed event:', data);
      this.showIndividualUploadOption();
    });

    // Host updates subtitle settings
    this.socketClient.on('subtitle-settings-updated', (settings) => {
      console.log('📥 Received subtitle-settings-updated event:', settings);
      if (!this.isHost && this.renderer) {
        this.renderer.updateSettings(settings);
      }
    });

    console.log('✅ Subtitle socket listeners registered');
  }

  /**
   * Bind subtitle display to video player time updates
   */
  bindToVideoPlayer() {
    if (!this.videoPlayer) {
      console.warn('⚠️ No video player to bind subtitles to');
      return;
    }

    console.log('🔗 Binding subtitle display to video player');

    // Listen for video time updates
    const updateSubtitle = () => {
      if (!this.isEnabled || !this.renderer) return;
      
      const currentTime = this.videoPlayer.currentTime || 0;
      const result = this.parser.getSubtitleAtTime(currentTime);
      
      if (result && result.changed) {
        console.log(`📝 Subtitle change at ${currentTime}s:`, result.subtitle?.text || 'clear');
        this.renderer.displaySubtitle(result.subtitle);
      }
    };

    // Bind to video player events - try multiple approaches
    if (this.videoPlayer.videoElement) {
      this.videoPlayer.videoElement.addEventListener('timeupdate', updateSubtitle);
      this.videoPlayer.videoElement.addEventListener('seeked', updateSubtitle);
      console.log('✅ Bound to video element events');
    }

    // Also bind to VideoPlayer's internal timer for participants
    const originalTimer = this.videoPlayer.updatePlayerState;
    if (originalTimer) {
      this.videoPlayer.updatePlayerState = () => {
        originalTimer.call(this.videoPlayer);
        updateSubtitle();
      };
      console.log('✅ Bound to VideoPlayer updatePlayerState');
    }

    // Store cleanup function
    this.videoCleanup = () => {
      if (this.videoPlayer.videoElement) {
        this.videoPlayer.videoElement.removeEventListener('timeupdate', updateSubtitle);
        this.videoPlayer.videoElement.removeEventListener('seeked', updateSubtitle);
      }
    };

    console.log('✅ Subtitle binding to video player complete');
  }

  /**
   * Create subtitle UI controls
   */
  createUI() {
    this.createSubtitleButton();
    this.createSubtitleModal();
  }

  /**
   * Create subtitle button in video controls
   */
  createSubtitleButton() {
    if (!this.videoPlayer.container) return;

    const controlsRight = this.videoPlayer.container.querySelector('.controls-right');
    if (!controlsRight) return;

    const subtitleBtn = document.createElement('button');
    subtitleBtn.className = 'control-btn subtitle-btn';
    subtitleBtn.id = 'subtitle-btn';
    subtitleBtn.title = 'Subtitles';
    subtitleBtn.innerHTML = `
      <svg class="subtitle-icon" viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M20,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6A2,2 0 0,0 20,4M20,18H4V6H20V18M6,10H8V12H6V10M6,14H8V16H6V14M10,14H18V16H10V14M10,10H18V12H10V10Z"/>
      </svg>
    `;

    // Insert before fullscreen button
    const fullscreenBtn = controlsRight.querySelector('.fullscreen-btn');
    if (fullscreenBtn) {
      controlsRight.insertBefore(subtitleBtn, fullscreenBtn);
    } else {
      controlsRight.appendChild(subtitleBtn);
    }

    // Add click handler
    subtitleBtn.addEventListener('click', () => this.showSubtitleModal());
  }

  /**
   * Create subtitle modal
   */
  createSubtitleModal() {
    const modal = document.createElement('div');
    modal.className = 'subtitle-modal';
    modal.id = 'subtitle-modal';
    modal.innerHTML = this.getModalHTML();
    
    document.body.appendChild(modal);
    this.setupModalEvents(modal);
  }

  /**
   * Get subtitle modal HTML
   */
  getModalHTML() {
    return `
      <div class="modal-overlay">
        <div class="modal-content subtitle-modal-content">
          <div class="modal-header">
            <h3>Subtitle Settings</h3>
            <button class="modal-close" id="subtitle-modal-close">×</button>
          </div>
          
          <div class="modal-body">
            <div class="subtitle-section">
              <div class="subtitle-toggle">
                <label class="toggle-label">
                  <input type="checkbox" id="subtitle-enabled" ${this.isEnabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                  Enable Subtitles
                </label>
              </div>
            </div>

            ${this.isHost ? this.getHostControls() : this.getParticipantControls()}
            
            <div class="subtitle-section">
              <h4>Appearance</h4>
              ${SubtitleRenderer.createSettingsHTML()}
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-secondary" id="subtitle-cancel">Cancel</button>
            <button class="btn btn-primary" id="subtitle-apply">Apply</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get host-specific controls HTML
   */
  getHostControls() {
    return `
      <div class="subtitle-section">
        <h4>Upload Subtitle File</h4>
        <div class="subtitle-upload">
          <input type="file" id="subtitle-file" accept=".srt,.vtt,.ass" style="display: none;">
          <button class="btn btn-outline" id="subtitle-upload-btn">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
            </svg>
            Choose Subtitle File (.srt, .vtt, .ass)
          </button>
          <span class="file-info" id="subtitle-file-info"></span>
        </div>
      </div>

      <div class="subtitle-section" id="subtitle-share-section" style="display: none;">
        <h4>Sharing Options</h4>
        <div class="subtitle-share-options">
          <label class="radio-option">
            <input type="radio" name="subtitle-share" value="all" checked>
            <span class="radio-text">Apply to All Participants</span>
            <small>Everyone will see the same subtitles</small>
          </label>
          <label class="radio-option">
            <input type="radio" name="subtitle-share" value="individual">
            <span class="radio-text">Host Only</span>
            <small>Others can add their own subtitles</small>
          </label>
        </div>
      </div>
    `;
  }

  /**
   * Get participant-specific controls HTML
   */
  getParticipantControls() {
    if (this.hasHostSubtitles && this.shareMode === 'all') {
      return `
        <div class="subtitle-section">
          <div class="subtitle-info">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>
            </svg>
            <span>Host has shared subtitles for everyone</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="subtitle-section">
        <h4>Upload Your Subtitle File</h4>
        <div class="subtitle-upload">
          <input type="file" id="subtitle-file" accept=".srt,.vtt,.ass" style="display: none;">
          <button class="btn btn-outline" id="subtitle-upload-btn">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
            </svg>
            Choose Subtitle File (.srt, .vtt, .ass)
          </button>
          <span class="file-info" id="subtitle-file-info"></span>
        </div>
        <small class="subtitle-note">This subtitle will only be visible to you</small>
      </div>
    `;
  }

  /**
   * Setup modal event handlers
   */
  setupModalEvents(modal) {
    // Close modal
    const closeBtn = modal.querySelector('#subtitle-modal-close');
    const cancelBtn = modal.querySelector('#subtitle-cancel');
    const overlay = modal.querySelector('.modal-overlay');
    
    [closeBtn, cancelBtn].forEach(btn => {
      btn?.addEventListener('click', () => this.hideSubtitleModal());
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hideSubtitleModal();
    });

    // File upload
    const fileInput = modal.querySelector('#subtitle-file');
    const uploadBtn = modal.querySelector('#subtitle-upload-btn');
    
    uploadBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => this.handleFileUpload(e));

    // Enable/disable toggle
    const enabledToggle = modal.querySelector('#subtitle-enabled');
    enabledToggle?.addEventListener('change', (e) => {
      this.setEnabled(e.target.checked);
    });

    // Apply button
    const applyBtn = modal.querySelector('#subtitle-apply');
    applyBtn?.addEventListener('click', () => this.applySettings());

    // Settings inputs
    modal.querySelectorAll('.subtitle-setting').forEach(input => {
      input.addEventListener('change', () => this.updateRendererSettings());
    });
  }

  /**
   * Handle subtitle file upload
   */
  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      // Validate file
      SubtitleParser.validateFile(file);

      // Read file content
      const content = await this.readFile(file);
      
      // Parse subtitles
      const subtitles = this.parser.parse(content);
      
      // Update UI
      const fileInfo = document.querySelector('#subtitle-file-info');
      if (fileInfo) {
        fileInfo.textContent = `${file.name} (${subtitles.length} subtitles)`;
        fileInfo.className = 'file-info success';
      }

      // Show share options for host
      if (this.isHost) {
        const shareSection = document.querySelector('#subtitle-share-section');
        if (shareSection) shareSection.style.display = 'block';
      }

      console.log(`✅ Subtitle file loaded: ${subtitles.length} subtitles`);
      
    } catch (error) {
      console.error('❌ Subtitle upload failed:', error);
      
      const fileInfo = document.querySelector('#subtitle-file-info');
      if (fileInfo) {
        fileInfo.textContent = `Error: ${error.message}`;
        fileInfo.className = 'file-info error';
      }
    }
  }

  /**
   * Read file content as text
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * Apply subtitle settings
   */
  applySettings() {
    const modal = document.querySelector('#subtitle-modal');
    if (!modal) return;

    // Get share mode for host
    if (this.isHost) {
      const shareMode = modal.querySelector('input[name="subtitle-share"]:checked')?.value || 'all';
      this.shareMode = shareMode;
      
      if (this.parser.subtitles.length > 0) {
        this.shareSubtitles(shareMode);
      }
    }

    this.hideSubtitleModal();
  }

  /**
   * Share subtitles with participants
   */
  shareSubtitles(mode) {
    if (!this.isHost || !this.socketClient) {
      console.warn('⚠️ Cannot share subtitles: not host or no socket client');
      return;
    }

    console.log(`📤 Sharing subtitles with mode: ${mode}`);

    const subtitleData = {
      mode,
      subtitles: this.parser.export(),
      settings: this.renderer?.getSettings(),
      timestamp: Date.now()
    };

    console.log('📤 Subtitle data to share:', {
      mode: subtitleData.mode,
      subtitleCount: subtitleData.subtitles.count,
      hasSettings: !!subtitleData.settings
    });

    if (mode === 'all') {
      // Send subtitles to all participants
      console.log('📤 Emitting share-subtitles event to server');
      this.socketClient.emit('share-subtitles', subtitleData);
      console.log('📤 Shared subtitles with all participants');
    } else {
      // Allow individual subtitle uploads
      console.log('📤 Emitting allow-individual-subtitles event to server');
      this.socketClient.emit('allow-individual-subtitles', { allowed: true });
      console.log('📤 Allowed individual subtitle uploads');
    }
  }

  /**
   * Receive shared subtitles from host
   */
  receiveSharedSubtitles(data) {
    console.log('📥 Processing received subtitles:', data);
    
    if (data.subtitles) {
      console.log('📥 Importing subtitle data:', {
        subtitleCount: data.subtitles.count,
        isEnabled: data.subtitles.isEnabled
      });
      
      const importSuccess = this.parser.import(data.subtitles);
      console.log(`📥 Subtitle import ${importSuccess ? 'successful' : 'failed'}`);
      
      this.hasHostSubtitles = true;
      this.shareMode = 'all';
      
      if (data.settings && this.renderer) {
        console.log('📥 Applying shared subtitle settings');
        this.renderer.updateSettings(data.settings);
      }
      
      // Force enable subtitles for shared content
      this.setEnabled(true);
      
      console.log('✅ Received and applied shared subtitles from host');
    } else {
      console.warn('⚠️ Received subtitle-shared event but no subtitles data');
    }
  }

  /**
   * Show individual upload option
   */
  showIndividualUploadOption() {
    this.shareMode = 'individual';
    console.log('✅ Individual subtitle upload allowed');
  }

  /**
   * Update renderer settings from UI
   */
  updateRendererSettings() {
    if (!this.renderer) return;

    const modal = document.querySelector('#subtitle-modal');
    if (!modal) return;

    const settings = {
      fontSize: modal.querySelector('#subtitle-font-size')?.value || 'medium',
      position: modal.querySelector('#subtitle-position')?.value || 'bottom',
      backgroundColor: this.getBackgroundColor(modal),
      textColor: modal.querySelector('#subtitle-text-color')?.value || '#ffffff',
      outline: modal.querySelector('#subtitle-outline')?.checked || true,
      shadow: modal.querySelector('#subtitle-shadow')?.checked || true
    };

    this.renderer.updateSettings(settings);
  }

  /**
   * Get background color with opacity
   */
  getBackgroundColor(modal) {
    const color = modal.querySelector('#subtitle-background')?.value || '#000000';
    const opacity = modal.querySelector('#subtitle-opacity')?.value || 80;
    
    // Convert hex to rgba
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
  }

  /**
   * Show subtitle modal
   */
  showSubtitleModal() {
    const modal = document.querySelector('#subtitle-modal');
    if (modal) {
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }
  }

  /**
   * Hide subtitle modal
   */
  hideSubtitleModal() {
    const modal = document.querySelector('#subtitle-modal');
    if (modal) {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }
  }

  /**
   * Enable/disable subtitles
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.parser.setEnabled(enabled);
    
    if (this.renderer) {
      this.renderer.setVisible(enabled);
    }
    
    if (!enabled) {
      this.renderer?.clear();
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      hasSubtitles: this.parser.subtitles.length > 0,
      subtitleCount: this.parser.subtitles.length,
      shareMode: this.shareMode,
      hasHostSubtitles: this.hasHostSubtitles
    };
  }

  /**
   * Destroy subtitle manager
   */
  destroy() {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    
    if (this.videoCleanup) {
      this.videoCleanup();
    }
    
    // Remove UI elements
    const modal = document.querySelector('#subtitle-modal');
    modal?.remove();
    
    const button = document.querySelector('#subtitle-btn');
    button?.remove();
    
    console.log('🧹 Subtitle manager destroyed');
  }
}
