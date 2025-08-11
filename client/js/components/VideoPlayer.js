// BeeMoo - Advanced Video Player Component
// Integrates with StreamingManager for progressive video playback

import { StreamingManager } from '../utils/streaming.js';

export class VideoPlayer {
  constructor(socketClient, onStateChange) {
    this.socketClient = socketClient;
    this.onStateChange = onStateChange; // Callback for state changes
    this.streamingManager = new StreamingManager();
    this.container = null;
    this.videoElement = null;
    this.controlsContainer = null;
    this.isInitialized = false;
    this.isHost = false;
    this.currentFile = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 1.0;
    this.currentTime = 0;
    this.duration = 0;
    this.bufferedPercent = 0;
    this.isFullscreen = false;
    this.controlsVisible = true;
    this.controlsTimer = null;
    
    // UI state
    this.isDragging = false;
    this.wasPlayingBeforeDrag = false;
    
    // Bind methods
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleKeyPress = this.handleKeyPress.bind(this);
    this.hideControlsDelayed = this.hideControlsDelayed.bind(this);
    
    this.setupStreamingEvents();
  }
  
  /**
   * Setup streaming manager events
   */
  setupStreamingEvents() {
    this.streamingManager.on('ready', () => {
      console.log('🎬 Video ready for playback');
      this.updatePlayerState();
      this.emit('ready');
    });
    
    this.streamingManager.on('timeupdate', (data) => {
      this.currentTime = data.currentTime;
      this.duration = data.duration;
      this.bufferedPercent = data.buffered;
      this.updateTimeDisplay();
      this.updateProgressBar();
    });
    
    this.streamingManager.on('buffering', (isBuffering) => {
      this.showBufferingIndicator(isBuffering);
    });
    
    this.streamingManager.on('buffer-health', (health) => {
      this.updateBufferIndicator(health);
    });
    
    this.streamingManager.on('chunk-loaded', (progress) => {
      this.updateLoadingProgress(progress);
    });
    
    this.streamingManager.on('error', (error) => {
      console.error('❌ Streaming error:', error);
      
      let errorMessage = 'Streaming error: ' + error.message;
      
      // Provide more specific error messages for common issues
      if (error.message && error.message.includes('MediaSource')) {
        errorMessage = 'Video file format error: This video file may not be compatible with browser streaming. Try a different MP4 file or convert to a web-optimized format.';
      } else if (error.message && error.message.includes('SourceBuffer')) {
        errorMessage = 'Video streaming failed: There was a problem loading the video data. Please try again or use a smaller file.';
      } else if (error.message && error.message.includes('Format error')) {
        errorMessage = 'Video format error: This video format is not supported. Please use an MP4 file with H.264 video and AAC audio.';
      }
      
      this.showError(errorMessage);
    });
  }
  
  /**
   * Initialize video player with file
   */
  async initializeWithFile(file, container, isHost = false) {
    this.currentFile = file;
    this.container = container;
    this.isHost = isHost;
    
    if (!container) {
      throw new Error('Container element is required');
    }
    
    // Create player UI
    this.createPlayerElements();
    this.setupEventListeners();
    
    try {
      // Initialize streaming with enhanced logging and error handling
      console.log('🎬 Initializing video player with file:', {
        name: file.name,
        size: this.formatBytes(file.size),
        type: file.type
      });
      
      // Show loading with more specific status
      this.updateLoadingStatus('Analyzing video file...');
      
      const streamingResult = await this.streamingManager.initializeStreaming(file, this.videoElement, {
        chunkSize: this.calculateOptimalChunkSize(file.size),
        bufferTimeAhead: 30
      });
      
      console.log('🎬 Streaming initialization completed:', streamingResult);
      
      // Update loading status
      this.updateLoadingStatus('Loading video metadata...');
      
      // Wait a moment for metadata to load
      await this.waitForMetadata(5000); // 5 second timeout
      
      this.isInitialized = true;
      this.updatePlayerState();
      
      console.log('✅ Video player initialized successfully:', {
        duration: this.duration,
        width: this.videoElement.videoWidth,
        height: this.videoElement.videoHeight,
        readyState: this.videoElement.readyState
      });
      
      // Hide loading overlay if metadata is loaded
      if (this.duration && !isNaN(this.duration)) {
        this.hideLoadingOverlay();
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize video player:', error);
      this.showError('Failed to load video: ' + error.message);
      throw error;
    }
  }
  
  /**
   * Calculate optimal chunk size based on file size
   */
  calculateOptimalChunkSize(fileSize) {
    // Adaptive chunk sizing based on file size
    if (fileSize < 50 * 1024 * 1024) { // < 50MB
      return 512 * 1024; // 512KB chunks
    } else if (fileSize < 200 * 1024 * 1024) { // < 200MB
      return 1024 * 1024; // 1MB chunks
    } else if (fileSize < 1024 * 1024 * 1024) { // < 1GB
      return 2 * 1024 * 1024; // 2MB chunks
    } else {
      return 4 * 1024 * 1024; // 4MB chunks for very large files
    }
  }
  
  /**
   * Create video player HTML elements
   */
  createPlayerElements() {
    this.container.innerHTML = this.renderPlayer();
    
    // Get references to elements
    this.videoElement = this.container.querySelector('#video-element');
    this.controlsContainer = this.container.querySelector('#video-controls');
    
    // Setup video element attributes for optimal MSE streaming
    this.videoElement.playsInline = true;
    this.videoElement.preload = 'metadata'; // Changed from 'none' to help with metadata loading
    this.videoElement.controls = false; // We'll use custom controls
    this.videoElement.muted = false; // Ensure not muted by default
    this.videoElement.autoplay = false; // Explicit control over playback
  }
  
  /**
   * Render video player HTML
   */
  renderPlayer() {
    return `
      <div class="video-player" id="video-player">
        <div class="video-container">
          <video id="video-element" class="video-element">
            Your browser does not support the video tag.
          </video>
          
          <!-- Loading overlay -->
          <div class="video-overlay loading-overlay" id="loading-overlay">
            <div class="loading-content">
              <div class="loading-spinner"></div>
              <div class="loading-text">Loading video...</div>
              <div class="loading-progress">
                <div class="progress-bar">
                  <div class="progress-fill" id="loading-progress-fill"></div>
                </div>
                <div class="progress-text" id="loading-progress-text">0%</div>
              </div>
            </div>
          </div>
          
          <!-- Buffering overlay -->
          <div class="video-overlay buffering-overlay" id="buffering-overlay" style="display: none;">
            <div class="buffering-spinner"></div>
          </div>
          
          <!-- Error overlay -->
          <div class="video-overlay error-overlay" id="error-overlay" style="display: none;">
            <div class="error-content">
              <div class="error-icon">⚠️</div>
              <div class="error-message" id="error-message"></div>
              <button class="btn btn-primary" id="retry-btn">Retry</button>
            </div>
          </div>
          
          <!-- Video controls -->
          <div class="video-controls" id="video-controls">
            <div class="controls-background"></div>
            
            <!-- Progress bar -->
            <div class="progress-container" id="progress-container">
              <div class="progress-track">
                <div class="progress-buffered" id="progress-buffered"></div>
                <div class="progress-played" id="progress-played"></div>
                <div class="progress-thumb" id="progress-thumb"></div>
              </div>
            </div>
            
            <!-- Control buttons -->
            <div class="controls-row">
              <div class="controls-left">
                <button class="control-btn play-pause-btn" id="play-pause-btn" title="Play/Pause">
                  <svg class="play-icon" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
                  </svg>
                  <svg class="pause-icon" viewBox="0 0 24 24" width="20" height="20" style="display: none;">
                    <path fill="currentColor" d="M14,19H18V5H14M6,19H10V5H6V19Z" />
                  </svg>
                </button>
                
                <div class="volume-container">
                  <button class="control-btn volume-btn" id="volume-btn" title="Mute/Unmute">
                    <svg class="volume-icon" viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor" d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18.01,19.86 21,16.28 21,12C21,7.72 18.01,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" />
                    </svg>
                    <svg class="mute-icon" viewBox="0 0 24 24" width="20" height="20" style="display: none;">
                      <path fill="currentColor" d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.52C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" />
                    </svg>
                  </button>
                  <div class="volume-slider" id="volume-slider">
                    <div class="volume-track">
                      <div class="volume-fill" id="volume-fill"></div>
                      <div class="volume-thumb" id="volume-thumb"></div>
                    </div>
                  </div>
                </div>
                
                <div class="time-display" id="time-display">
                  <span class="current-time">0:00</span>
                  <span class="time-separator">/</span>
                  <span class="duration-time">0:00</span>
                </div>
              </div>
              
              <div class="controls-right">
                <div class="buffer-health" id="buffer-health" title="Buffer Health">
                  <div class="buffer-indicator"></div>
                </div>
                
                ${this.isHost ? `
                  <button class="control-btn sync-btn" id="sync-btn" title="Sync with participants">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor" d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" />
                    </svg>
                  </button>
                ` : ''}
                
                <button class="control-btn fullscreen-btn" id="fullscreen-btn" title="Fullscreen">
                  <svg class="fullscreen-icon" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z" />
                  </svg>
                  <svg class="fullscreen-exit-icon" viewBox="0 0 24 24" width="20" height="20" style="display: none;">
                    <path fill="currentColor" d="M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  /**
   * Setup event listeners for controls and video
   */
  setupEventListeners() {
    // Video element events with improved metadata handling
    this.videoElement.addEventListener('loadedmetadata', () => {
      console.log('🎬 Video metadata loaded:', {
        duration: this.videoElement.duration,
        width: this.videoElement.videoWidth,
        height: this.videoElement.videoHeight,
        readyState: this.videoElement.readyState
      });
      
      this.duration = this.videoElement.duration;
      this.updateTimeDisplay();
      this.hideLoadingOverlay();
      this.emit('metadata-loaded', {
        duration: this.duration,
        width: this.videoElement.videoWidth,
        height: this.videoElement.videoHeight
      });
    });
    
    // Additional metadata loading events for better reliability
    this.videoElement.addEventListener('loadeddata', () => {
      console.log('🎬 Video data loaded, readyState:', this.videoElement.readyState);
      if (this.videoElement.duration && !isNaN(this.videoElement.duration)) {
        this.duration = this.videoElement.duration;
        this.updateTimeDisplay();
        this.hideLoadingOverlay();
      }
    });
    
    this.videoElement.addEventListener('durationchange', () => {
      console.log('🎬 Video duration changed:', this.videoElement.duration);
      if (this.videoElement.duration && !isNaN(this.videoElement.duration)) {
        this.duration = this.videoElement.duration;
        this.updateTimeDisplay();
        this.hideLoadingOverlay();
      }
    });
    
    this.videoElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayPauseButton();
      this.notifyStateChange();
    });
    
    this.videoElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseButton();
      this.notifyStateChange();
    });
    
    this.videoElement.addEventListener('volumechange', () => {
      this.volume = this.videoElement.volume;
      this.isMuted = this.videoElement.muted;
      this.updateVolumeControls();
    });
    
    // Control button events
    const playPauseBtn = this.container.querySelector('#play-pause-btn');
    playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
    
    const volumeBtn = this.container.querySelector('#volume-btn');
    volumeBtn?.addEventListener('click', () => this.toggleMute());
    
    const fullscreenBtn = this.container.querySelector('#fullscreen-btn');
    fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    
    const syncBtn = this.container.querySelector('#sync-btn');
    syncBtn?.addEventListener('click', () => this.syncWithParticipants());
    
    const retryBtn = this.container.querySelector('#retry-btn');
    retryBtn?.addEventListener('click', () => this.retry());
    
    // Progress bar events
    this.setupProgressBarEvents();
    
    // Volume slider events
    this.setupVolumeSliderEvents();
    
    // Mouse and keyboard events
    this.container.addEventListener('mousemove', this.handleMouseMove);
    this.container.addEventListener('mouseleave', () => this.hideControls());
    document.addEventListener('keydown', this.handleKeyPress);
    
    // Fullscreen events
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
      this.updateFullscreenButton();
    });
  }
  
  /**
   * Setup progress bar drag and click events
   */
  setupProgressBarEvents() {
    const progressContainer = this.container.querySelector('#progress-container');
    const progressThumb = this.container.querySelector('#progress-thumb');
    
    let isDragging = false;
    
    // Progress bar click
    progressContainer.addEventListener('click', (e) => {
      if (isDragging) return;
      const rect = progressContainer.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const newTime = percent * this.duration;
      this.seek(newTime);
    });
    
    // Thumb drag
    progressThumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      this.wasPlayingBeforeDrag = this.isPlaying;
      if (this.isPlaying) this.pause();
      
      const handleMouseMove = (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const newTime = percent * this.duration;
        this.videoElement.currentTime = newTime;
        this.updateProgressBar();
      };
      
      const handleMouseUp = () => {
        isDragging = false;
        if (this.wasPlayingBeforeDrag) this.play();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });
  }
  
  /**
   * Setup volume slider events
   */
  setupVolumeSliderEvents() {
    const volumeSlider = this.container.querySelector('#volume-slider');
    const volumeThumb = this.container.querySelector('#volume-thumb');
    
    let isDragging = false;
    
    volumeSlider.addEventListener('click', (e) => {
      if (isDragging) return;
      const rect = volumeSlider.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      this.setVolume(percent);
    });
    
    volumeThumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      
      const handleMouseMove = (e) => {
        const rect = volumeSlider.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.setVolume(percent);
      };
      
      const handleMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });
  }
  
  /**
   * Handle mouse movement for showing/hiding controls
   */
  handleMouseMove() {
    this.showControls();
    this.hideControlsDelayed();
  }
  
  /**
   * Handle keyboard shortcuts
   */
  handleKeyPress(e) {
    if (!this.isInitialized) return;
    
    // Only handle if video player is focused or no input is focused
    const activeElement = document.activeElement;
    if (activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName)) {
      return;
    }
    
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.seek(this.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.seek(this.currentTime + 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.setVolume(Math.min(1, this.volume + 0.1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.setVolume(Math.max(0, this.volume - 0.1));
        break;
      case 'KeyM':
        e.preventDefault();
        this.toggleMute();
        break;
      case 'KeyF':
        e.preventDefault();
        this.toggleFullscreen();
        break;
    }
  }
  
  /**
   * Show/hide controls with auto-hide timer
   */
  showControls() {
    this.controlsVisible = true;
    this.controlsContainer.style.opacity = '1';
    this.container.style.cursor = 'default';
  }
  
  hideControls() {
    if (this.isPlaying) {
      this.controlsVisible = false;
      this.controlsContainer.style.opacity = '0';
      this.container.style.cursor = 'none';
    }
  }
  
  hideControlsDelayed() {
    if (this.controlsTimer) {
      clearTimeout(this.controlsTimer);
    }
    
    this.controlsTimer = setTimeout(() => {
      this.hideControls();
    }, 3000);
  }
  
  /**
   * Playback control methods
   */
  async play() {
    try {
      await this.streamingManager.play();
      
      if (this.isHost) {
        this.notifyPlaybackChange('play', this.currentTime);
      }
    } catch (error) {
      console.error('❌ Play failed:', error);
    }
  }
  
  pause() {
    this.streamingManager.pause();
    
    if (this.isHost) {
      this.notifyPlaybackChange('pause', this.currentTime);
    }
  }
  
  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }
  
  seek(time) {
    const clampedTime = Math.max(0, Math.min(this.duration, time));
    this.streamingManager.seek(clampedTime);
    
    if (this.isHost) {
      this.notifyPlaybackChange('seek', clampedTime);
    }
  }
  
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.streamingManager.setVolume(this.volume);
    this.videoElement.muted = false;
    this.updateVolumeControls();
  }
  
  toggleMute() {
    this.isMuted = !this.isMuted;
    this.videoElement.muted = this.isMuted;
    this.updateVolumeControls();
  }
  
  async toggleFullscreen() {
    if (!this.isFullscreen) {
      try {
        await this.container.requestFullscreen();
      } catch (error) {
        console.warn('⚠️ Fullscreen not supported:', error);
      }
    } else {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.warn('⚠️ Exit fullscreen failed:', error);
      }
    }
  }
  
  /**
   * Sync playback with other participants (host only)
   */
  syncWithParticipants() {
    if (!this.isHost) return;
    
    console.log('🔄 Syncing with participants');
    this.notifyPlaybackChange('sync', this.currentTime, {
      isPlaying: this.isPlaying,
      volume: this.volume,
      duration: this.duration
    });
  }
  
  /**
   * Update UI elements
   */
  updatePlayPauseButton() {
    const playIcon = this.container.querySelector('.play-icon');
    const pauseIcon = this.container.querySelector('.pause-icon');
    
    if (this.isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
    }
  }
  
  updateVolumeControls() {
    const volumeIcon = this.container.querySelector('.volume-icon');
    const muteIcon = this.container.querySelector('.mute-icon');
    const volumeFill = this.container.querySelector('#volume-fill');
    const volumeThumb = this.container.querySelector('#volume-thumb');
    
    if (this.isMuted || this.volume === 0) {
      volumeIcon.style.display = 'none';
      muteIcon.style.display = 'block';
    } else {
      volumeIcon.style.display = 'block';
      muteIcon.style.display = 'none';
    }
    
    const volumePercent = this.isMuted ? 0 : this.volume * 100;
    volumeFill.style.width = `${volumePercent}%`;
    volumeThumb.style.left = `${volumePercent}%`;
  }
  
  updateFullscreenButton() {
    const fullscreenIcon = this.container.querySelector('.fullscreen-icon');
    const fullscreenExitIcon = this.container.querySelector('.fullscreen-exit-icon');
    
    if (this.isFullscreen) {
      fullscreenIcon.style.display = 'none';
      fullscreenExitIcon.style.display = 'block';
    } else {
      fullscreenIcon.style.display = 'block';
      fullscreenExitIcon.style.display = 'none';
    }
  }
  
  updateTimeDisplay() {
    const currentTimeElement = this.container.querySelector('.current-time');
    const durationTimeElement = this.container.querySelector('.duration-time');
    
    if (currentTimeElement) {
      currentTimeElement.textContent = this.formatTime(this.currentTime);
    }
    
    if (durationTimeElement) {
      durationTimeElement.textContent = this.formatTime(this.duration);
    }
  }
  
  updateProgressBar() {
    const progressPlayed = this.container.querySelector('#progress-played');
    const progressBuffered = this.container.querySelector('#progress-buffered');
    const progressThumb = this.container.querySelector('#progress-thumb');
    
    if (this.duration > 0) {
      const playedPercent = (this.currentTime / this.duration) * 100;
      progressPlayed.style.width = `${playedPercent}%`;
      progressThumb.style.left = `${playedPercent}%`;
    }
    
    progressBuffered.style.width = `${this.bufferedPercent}%`;
  }
  
  updateBufferIndicator(health) {
    const bufferIndicator = this.container.querySelector('.buffer-indicator');
    
    if (bufferIndicator) {
      bufferIndicator.style.width = `${health.health}%`;
      
      // Color coding for buffer health
      if (health.health > 80) {
        bufferIndicator.style.backgroundColor = '#10b981'; // Green
      } else if (health.health > 40) {
        bufferIndicator.style.backgroundColor = '#f59e0b'; // Yellow
      } else {
        bufferIndicator.style.backgroundColor = '#ef4444'; // Red
      }
    }
  }
  
  updateLoadingProgress(progress) {
    const progressFill = this.container.querySelector('#loading-progress-fill');
    const progressText = this.container.querySelector('#loading-progress-text');
    
    if (progressFill) {
      progressFill.style.width = `${progress.progress * 100}%`;
    }
    
    if (progressText) {
      progressText.textContent = `${Math.round(progress.progress * 100)}%`;
    }
  }
  
  /**
   * Show/hide overlays
   */
  showLoadingOverlay() {
    const overlay = this.container.querySelector('#loading-overlay');
    if (overlay) overlay.style.display = 'flex';
  }
  
  hideLoadingOverlay() {
    const overlay = this.container.querySelector('#loading-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  
  showBufferingIndicator(show) {
    const overlay = this.container.querySelector('#buffering-overlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
  }
  
  showError(message) {
    const overlay = this.container.querySelector('#error-overlay');
    const messageElement = this.container.querySelector('#error-message');
    
    if (overlay && messageElement) {
      messageElement.textContent = message;
      overlay.style.display = 'flex';
    }
  }
  
  hideError() {
    const overlay = this.container.querySelector('#error-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  
  /**
   * Retry loading video
   */
  async retry() {
    this.hideError();
    this.showLoadingOverlay();
    
    try {
      if (this.currentFile && this.container) {
        await this.initializeWithFile(this.currentFile, this.container, this.isHost);
      }
    } catch (error) {
      this.showError('Retry failed: ' + error.message);
    }
  }
  
  /**
   * Notify state changes to parent component
   */
  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange({
        isPlaying: this.isPlaying,
        currentTime: this.currentTime,
        duration: this.duration,
        volume: this.volume,
        isMuted: this.isMuted,
        bufferedPercent: this.bufferedPercent
      });
    }
  }
  
  /**
   * Notify playback changes to server (host only)
   */
  notifyPlaybackChange(action, time, extraData = {}) {
    if (!this.isHost || !this.socketClient) return;
    
    this.socketClient.emit('movie-control', {
      action: action,
      movieState: {
        currentTime: time,
        isPlaying: this.isPlaying,
        ...extraData
      }
    });
  }
  
  /**
   * Update player state from external source
   */
  updatePlayerState() {
    this.updatePlayPauseButton();
    this.updateVolumeControls();
    this.updateFullscreenButton();
    this.updateTimeDisplay();
    this.updateProgressBar();
  }
  
  /**
   * Get player statistics
   */
  getStats() {
    return {
      ...this.streamingManager.getStats(),
      isInitialized: this.isInitialized,
      isHost: this.isHost,
      fileName: this.currentFile?.name || null,
      fileSize: this.currentFile?.size || 0
    };
  }
  
  /**
   * Wait for video metadata to load
   */
  async waitForMetadata(timeout = 5000) {
    return new Promise((resolve) => {
      // If metadata is already loaded, resolve immediately
      if (this.videoElement.duration && !isNaN(this.videoElement.duration)) {
        console.log('🎬 Metadata already loaded');
        resolve();
        return;
      }
      
      const timeoutId = setTimeout(() => {
        console.log('⏰ Metadata loading timeout, continuing anyway...');
        resolve();
      }, timeout);
      
      const onMetadataLoaded = () => {
        console.log('🎬 Metadata loaded during wait');
        clearTimeout(timeoutId);
        resolve();
      };
      
      this.videoElement.addEventListener('loadedmetadata', onMetadataLoaded, { once: true });
      this.videoElement.addEventListener('durationchange', onMetadataLoaded, { once: true });
      this.videoElement.addEventListener('loadeddata', onMetadataLoaded, { once: true });
    });
  }
  
  /**
   * Update loading overlay status text
   */
  updateLoadingStatus(status) {
    const loadingText = this.container.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = status;
    }
  }
  
  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Format time in MM:SS or HH:MM:SS
   */
  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }
  
  /**
   * Event emitter functionality
   */
  emit(event, data) {
    // Dispatch custom event for external listeners
    const customEvent = new CustomEvent(`videoplayer:${event}`, { detail: data });
    this.container.dispatchEvent(customEvent);
  }
  
  /**
   * Cleanup and destroy player
   */
  destroy() {
    // Stop streaming
    this.streamingManager.stop();
    
    // Remove event listeners
    document.removeEventListener('keydown', this.handleKeyPress);
    
    // Clear timers
    if (this.controlsTimer) {
      clearTimeout(this.controlsTimer);
    }
    
    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }
    
    console.log('🎬 Video player destroyed');
  }
}
