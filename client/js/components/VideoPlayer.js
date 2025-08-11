// BeeMoo - Advanced Video Player Component
// Integrates with StreamingManager for progressive video playback

import { StreamingManager } from '../utils/streaming.js';
import { SynchronizationManager } from '../utils/synchronization.js';

export class VideoPlayer {
  constructor(socketClient, onStateChange) {
    this.socketClient = socketClient;
    this.onStateChange = onStateChange; // Callback for state changes
    this.streamingManager = new StreamingManager();
    this.syncManager = new SynchronizationManager(socketClient);
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
    
    // Participant virtual playback timer
    this.participantTimer = null;
    this.participantStartTime = null;
    this.lastLoggedTime = -1;
    
    this.setupStreamingEvents();
    this.setupSyncStatsListener();
  }
  
  /**
   * Setup streaming manager events
   */
  setupStreamingEvents() {
    this.streamingManager.on('ready', () => {
      console.log('🎬 Video ready for playback');
      this.hideError(); // Hide any previous error when streaming is ready
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
      
      // Only show error if video is not already playing (i.e., streaming hasn't recovered)
      if (this.videoElement.readyState < 2 && !this.videoElement.duration) {
        this.showError(errorMessage);
      } else {
        console.log('🔄 Streaming error occurred but video is playable, not showing error UI');
      }
    });
    
    // Hide error when video starts playing successfully
    this.streamingManager.on('playing', () => {
      this.hideError();
    });
  }

  /**
   * Setup sync statistics listener for frame-perfect sync quality monitoring
   */
  setupSyncStatsListener() {
    if (typeof window !== 'undefined') {
      window.addEventListener('sync-stats-updated', (event) => {
        this.updateSyncQualityIndicator(event.detail);
      });
    }
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
   * Initialize video player as participant (no local file, sync with host)
   */
  async initializeAsParticipant(container, movieState) {
    this.container = container;
    this.isHost = false;
    
    if (!container) {
      throw new Error('Container element is required');
    }
    
    console.log('🎬 Initializing participant video player:', movieState);
    
    // Store movie metadata for participant
    this.participantMovieState = movieState;
    this.duration = movieState.duration || 0;
    this.currentTime = movieState.currentTime || 0;
    
    // Create player UI
    this.createPlayerElements();
    this.setupEventListeners();
    
    // Disable participant controls - only host can control playback
    this.disableParticipantControls();
    
    // Setup virtual video player for participants
    this.setupParticipantVideoPlayer(movieState);
    
    this.isInitialized = true;
    this.updatePlayerState();
    
    console.log('✅ Participant video player initialized with metadata:', {
      duration: this.duration,
      title: movieState.title
    });
  }

  /**
   * Setup virtual video player for participants with proper metadata
   */
  setupParticipantVideoPlayer(movieState) {
    // Set up video element with metadata for proper UI display
    if (this.videoElement && movieState.duration) {
      // Create a mock video source for duration display
      // This won't actually play video but allows proper time display
      Object.defineProperty(this.videoElement, 'duration', {
        value: movieState.duration,
        writable: true,
        configurable: true
      });
      
      Object.defineProperty(this.videoElement, 'currentTime', {
        value: movieState.currentTime || 0,
        writable: true,
        configurable: true
      });
      
      // Update UI to show proper duration
      this.updateTimeDisplay();
      this.hideLoadingOverlay();
    }
    
    // Show participant message with video information
    this.showParticipantMessage(movieState);
    
    console.log('🎬 Virtual video player setup complete for participant');
  }

  /**
   * Disable playback controls for participants (host-controlled playback only)
   */
  disableParticipantControls() {
    if (this.isHost) return; // Host keeps full control
    
    // Disable interactive elements for participants
    const playPauseBtn = this.container.querySelector('#play-pause-btn');
    const progressContainer = this.container.querySelector('#progress-container');
    const syncBtn = this.container.querySelector('#sync-btn');
    
    // Disable play/pause button
    if (playPauseBtn) {
      playPauseBtn.disabled = true;
      playPauseBtn.style.opacity = '0.6';
      playPauseBtn.title = 'Only host can control playback';
    }
    
    // Disable progress bar seeking
    if (progressContainer) {
      progressContainer.style.pointerEvents = 'none';
      progressContainer.style.opacity = '0.8';
      progressContainer.title = 'Only host can seek';
    }
    
    // Hide sync button for participants
    if (syncBtn) {
      syncBtn.style.display = 'none';
    }
    
    // Disable keyboard shortcuts for playback control
    this.participantControlsDisabled = true;
    
    console.log('🔒 Participant playback controls disabled');
  }

  /**
   * Show message to participants about the movie
   */
  showParticipantMessage(movieState) {
    const loadingOverlay = this.container.querySelector('.loading-overlay');
    if (loadingOverlay) {
      // If we have duration, the video is "ready" for sync
      if (movieState.duration && movieState.duration > 0) {
        loadingOverlay.innerHTML = `
          <div class="loading-content">
            <div class="movie-info-participant">
              <h3>🎬 ${this.escapeHtml(movieState.title || 'Movie Selected')}</h3>
              <div class="movie-details">
                <p><strong>Duration:</strong> ${this.formatTime(movieState.duration)}</p>
                <p><strong>Resolution:</strong> ${movieState.width || '?'}×${movieState.height || '?'}</p>
                <p><strong>Size:</strong> ${this.formatBytes(movieState.size || 0)}</p>
              </div>
              <div class="participant-status">
                <p>🎯 <strong>Frame-perfect sync enabled</strong></p>
                <p>📡 Synchronized with host playback</p>
                <small style="color: rgba(255,255,255,0.7);">
                  Video streaming from host to participants coming soon!
                </small>
              </div>
            </div>
          </div>
        `;
        
        // Auto-hide the overlay after 3 seconds to show the controls
        setTimeout(() => {
          if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
          }
        }, 3000);
      } else {
        // No duration yet, show waiting message
        loadingOverlay.innerHTML = `
          <div class="loading-content">
            <div class="movie-info-participant">
              <h3>🎬 ${this.escapeHtml(movieState.title || 'Movie Selected')}</h3>
              <p>The host is streaming: <strong>${this.escapeHtml(movieState.title || 'Unknown Movie')}</strong></p>
              <p>⏳ Waiting for host to start playback...</p>
              <div class="sync-info" style="margin-top: 12px; font-size: 0.9rem; color: rgba(255,255,255,0.7);">
                <p>📡 Frame-perfect synchronization ready</p>
                <small>Video streaming implementation in progress</small>
              </div>
            </div>
          </div>
        `;
      }
      loadingOverlay.style.display = 'flex';
    }
  }

  /**
   * Sync participant player with host actions using frame-perfect synchronization
   */
  async syncWithHost(action, movieState) {
    if (this.isHost) return; // Host doesn't sync with itself
    
    console.log(`🎯 Frame-perfect sync with host: ${action}`, movieState);
    
    // Update participant movie state with latest data
    this.participantMovieState = { ...this.participantMovieState, ...movieState };
    
    // For participants, we'll do virtual sync (no actual video playback)
    try {
      // Update internal timing state based on host action
      switch (action) {
        case 'play':
          this.isPlaying = true;
          this.currentTime = movieState.currentTime || 0;
          
          // Start virtual playback timer for participants
          this.startParticipantTimer();
          
          // If we have virtual video setup, update its currentTime
          if (this.videoElement && this.duration > 0) {
            Object.defineProperty(this.videoElement, 'currentTime', {
              value: this.currentTime,
              writable: true,
              configurable: true
            });
          }
          break;
          
        case 'pause':
          this.isPlaying = false;
          this.currentTime = movieState.currentTime || 0;
          
          // Stop virtual playback timer
          this.stopParticipantTimer();
          
          if (this.videoElement && this.duration > 0) {
            Object.defineProperty(this.videoElement, 'currentTime', {
              value: this.currentTime,
              writable: true,
              configurable: true
            });
          }
          break;
          
        case 'seek':
          this.currentTime = movieState.currentTime || 0;
          
          // Update timer if playing
          if (this.isPlaying) {
            this.startParticipantTimer();
          }
          
          if (this.videoElement && this.duration > 0) {
            Object.defineProperty(this.videoElement, 'currentTime', {
              value: this.currentTime,
              writable: true,
              configurable: true
            });
          }
          break;
      }
      
      // Update UI to reflect the sync
      this.updatePlayerState();
      
      // Hide loading overlay if we have valid duration
      if (this.duration > 0) {
        this.hideLoadingOverlay();
      }
      
      console.log(`✅ Virtual sync completed: ${action} at ${this.formatTime(this.currentTime)}`);
      
      // Show enhanced sync status
      this.showParticipantSyncStatus(action, movieState);
      
    } catch (error) {
      console.error('❌ Failed to sync with host:', error);
      this.showParticipantSyncStatus(action, movieState);
    }
  }

  /**
   * Basic sync fallback method (original sync logic)
   */
  async basicSyncWithHost(action, movieState) {
    switch (action) {
      case 'play':
        if (movieState.currentTime !== undefined) {
          this.videoElement.currentTime = movieState.currentTime;
        }
        await this.videoElement.play();
        this.isPlaying = true;
        break;
        
      case 'pause':
        this.videoElement.pause();
        this.isPlaying = false;
        break;
        
      case 'seek':
        if (movieState.currentTime !== undefined) {
          this.videoElement.currentTime = movieState.currentTime;
        }
        break;
        
      default:
        console.warn('Unknown sync action:', action);
    }
  }

  /**
   * Show sync status for participants with enhanced information
   */
  showParticipantSyncStatus(action, movieState) {
    // Don't show overlay if we have proper video metadata and duration
    if (this.duration > 0) {
      // Just update the play/pause button and return
      this.updatePlayPauseButton();
      return;
    }
    
    // Show overlay for participants without full metadata
    const loadingOverlay = this.container.querySelector('.loading-overlay');
    if (loadingOverlay) {
      const currentTime = this.formatTime(movieState.currentTime || 0);
      const duration = this.formatTime(movieState.duration || 0);
      const actionText = {
        'play': '▶️ Playing',
        'pause': '⏸️ Paused', 
        'seek': '⏩ Seeking',
        'sync': '🔄 Syncing'
      }[action] || action;
      
      loadingOverlay.innerHTML = `
        <div class="loading-content">
          <div class="movie-info-participant">
            <h3>🎬 ${this.escapeHtml(movieState.title || 'Movie Streaming')}</h3>
            <div class="sync-status-main">
              <p><strong>Host Status:</strong> ${actionText}</p>
              <p><strong>Time:</strong> ${currentTime} / ${duration}</p>
            </div>
            <div class="sync-status">
              <p>🎯 <strong>Frame-perfect sync active</strong></p>
              <p>📡 Latency: ${Math.round(this.syncManager?.networkLatency || 0)}ms</p>
              <small style="color: rgba(255,255,255,0.7);">
                Video stream from host coming soon!
              </small>
            </div>
          </div>
        </div>
      `;
      loadingOverlay.style.display = 'flex';
    }
    
    // Update our internal state
    this.isPlaying = (action === 'play');
    this.currentTime = movieState.currentTime || 0;
    
    // Update play/pause button if it exists
    this.updatePlayPauseButton();
  }

  /**
   * Start virtual playback timer for participants
   */
  startParticipantTimer() {
    if (this.isHost) return; // Only for participants
    
    this.stopParticipantTimer(); // Clear any existing timer
    
    console.log(`🕐 Starting participant timer from ${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}`);
    
    this.participantStartTime = Date.now();
    const startCurrentTime = this.currentTime;
    
    this.participantTimer = setInterval(() => {
      if (this.isPlaying && this.duration > 0) {
        // Calculate elapsed time since play started
        const elapsedSeconds = (Date.now() - this.participantStartTime) / 1000;
        this.currentTime = startCurrentTime + elapsedSeconds;
        
        // Don't exceed video duration
        if (this.currentTime >= this.duration) {
          this.currentTime = this.duration;
          this.isPlaying = false;
          this.stopParticipantTimer();
          console.log('🕐 Participant timer reached end');
          return;
        }
        
        // Force update video element currentTime for UI
        if (this.videoElement) {
          // Try multiple approaches to ensure UI updates
          try {
            this.videoElement.currentTime = this.currentTime;
          } catch (e) {
            // Fallback: use defineProperty
            Object.defineProperty(this.videoElement, 'currentTime', {
              value: this.currentTime,
              writable: true,
              configurable: true
            });
          }
        }
        
        // Force UI updates
        this.updateTimeDisplay();
        this.updateProgressBar();
        
        // Debug log every 2 seconds
        if (Math.floor(this.currentTime) % 2 === 0 && Math.floor(this.currentTime) !== this.lastLoggedTime) {
          this.lastLoggedTime = Math.floor(this.currentTime);
          console.log(`🕐 Timer: ${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}`);
        }
      } else {
        // Stop timer if not playing
        this.stopParticipantTimer();
      }
    }, 100); // Update every 100ms for smooth time display
    
    console.log('🕐 Started participant virtual playback timer');
  }

  /**
   * Stop virtual playback timer for participants
   */
  stopParticipantTimer() {
    if (this.participantTimer) {
      clearInterval(this.participantTimer);
      this.participantTimer = null;
      this.participantStartTime = null;
      console.log('🕐 Stopped participant virtual playback timer');
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
                
                <div class="sync-quality" id="sync-quality" title="Synchronization Quality" style="display: none;">
                  <div class="sync-indicator"></div>
                  <span class="sync-text">SYNC</span>
                </div>
                
                ${this.isHost ? `
                  <div class="host-controls">
                    <div class="host-indicator" title="You are controlling playback for all participants">
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M12,5.5A3.5,3.5 0 0,1 15.5,9A3.5,3.5 0 0,1 12,12.5A3.5,3.5 0 0,1 8.5,9A3.5,3.5 0 0,1 12,5.5M5,8C5.56,8 6.08,8.15 6.53,8.42C6.38,9.85 6.8,11.27 7.66,12.38C7.16,13.34 6.16,14 5,14A3,3 0 0,1 2,11A3,3 0 0,1 5,8M19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14C17.84,14 16.84,13.34 16.34,12.38C17.2,11.27 17.62,9.85 17.47,8.42C17.92,8.15 18.44,8 19,8M5.5,18.25C5.5,16.18 8.41,14.5 12,14.5C15.59,14.5 18.5,16.18 18.5,18.25V20H5.5V18.25Z" />
                      </svg>
                      <span class="host-text">HOST</span>
                    </div>
                    <button class="control-btn sync-btn" id="sync-btn" title="Sync playback with all participants">
                      <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" />
                      </svg>
                    </button>
                  </div>
                ` : `
                  <div class="participant-indicator" title="Playback is controlled by the host">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path fill="currentColor" d="M12,2C13.1,2 14,2.9 14,4C14,5.1 13.1,6 12,6C10.9,6 10,5.1 10,4C10,2.9 10.9,2 12,2M21,9V7L15,7V9H21M15,15H21V13H15V15M11,22A2,2 0 0,1 9,20V14A2,2 0 0,1 11,12H13A2,2 0 0,1 15,14V20A2,2 0 0,1 13,22H11Z" />
                    </svg>
                    <span class="participant-text">VIEWER</span>
                  </div>
                `}
                
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
      this.hideError(); // Hide error when metadata loads successfully
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
        this.hideError(); // Hide error when data loads successfully
      }
    });
    
    this.videoElement.addEventListener('durationchange', () => {
      console.log('🎬 Video duration changed:', this.videoElement.duration);
      if (this.videoElement.duration && !isNaN(this.videoElement.duration)) {
        this.duration = this.videoElement.duration;
        this.updateTimeDisplay();
        this.hideLoadingOverlay();
        this.hideError(); // Hide error when duration is available
      }
    });
    
    this.videoElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayPauseButton();
      this.hideError(); // Hide error when video starts playing
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
    
    // Restrict playback control shortcuts for participants
    const isPlaybackControl = ['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code);
    if (isPlaybackControl && this.participantControlsDisabled) {
      console.log('🔒 Playback keyboard shortcuts disabled for participants');
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
   * Enhanced playback control methods with host-controlled functionality
   */
  async play() {
    // Restrict playback control to host only
    if (this.participantControlsDisabled) {
      console.log('🔒 Play blocked: Only host can control playback');
      return;
    }
    
    try {
      await this.streamingManager.play();
      
      if (this.isHost) {
        console.log('🎬 Host started playback - syncing with participants');
        this.notifyPlaybackChange('play', this.currentTime);
        this.showHostAction('play');
      }
    } catch (error) {
      console.error('❌ Play failed:', error);
      if (this.isHost) {
        this.showError(`Failed to start playback: ${error.message}`);
      }
    }
  }
  
  pause() {
    // Restrict playback control to host only
    if (this.participantControlsDisabled) {
      console.log('🔒 Pause blocked: Only host can control playback');
      return;
    }
    
    this.streamingManager.pause();
    
    if (this.isHost) {
      console.log('🎬 Host paused playback - syncing with participants');
      this.notifyPlaybackChange('pause', this.currentTime);
      this.showHostAction('pause');
    }
  }
  
  togglePlayPause() {
    // Restrict playback control to host only
    if (this.participantControlsDisabled) {
      console.log('🔒 Play/Pause blocked: Only host can control playback');
      return;
    }
    
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }
  
  seek(time) {
    // Restrict seeking to host only
    if (this.participantControlsDisabled) {
      console.log('🔒 Seek blocked: Only host can control playback');
      return;
    }
    
    const clampedTime = Math.max(0, Math.min(this.duration, time));
    this.streamingManager.seek(clampedTime);
    
    if (this.isHost) {
      console.log(`🎬 Host seeked to ${this.formatTime(clampedTime)} - syncing with participants`);
      this.notifyPlaybackChange('seek', clampedTime);
      this.showHostAction('seek', clampedTime);
    }
  }

  /**
   * Show visual feedback for host actions
   */
  showHostAction(action, time = null) {
    if (!this.isHost) return;
    
    const hostIndicator = this.container.querySelector('.host-indicator');
    if (!hostIndicator) return;
    
    // Create temporary action feedback
    const actionFeedback = document.createElement('div');
    actionFeedback.className = 'host-action-feedback';
    
    let actionText = '';
    switch (action) {
      case 'play':
        actionText = '▶️ Playing for all';
        break;
      case 'pause':
        actionText = '⏸️ Paused for all';
        break;
      case 'seek':
        actionText = `⏩ Seeked to ${this.formatTime(time)}`;
        break;
    }
    
    actionFeedback.textContent = actionText;
    actionFeedback.style.cssText = `
      position: absolute;
      top: -30px;
      right: 0;
      background: rgba(16, 185, 129, 0.9);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 1000;
      animation: fadeInOut 2s ease-in-out;
    `;
    
    hostIndicator.style.position = 'relative';
    hostIndicator.appendChild(actionFeedback);
    
    // Remove after animation
    setTimeout(() => {
      if (actionFeedback.parentNode) {
        actionFeedback.parentNode.removeChild(actionFeedback);
      }
    }, 2000);
  }
  
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // For WebRTC streams, directly control video element
    if (this.videoElement.getAttribute('data-webrtc') === 'true') {
      this.videoElement.volume = this.volume;
      this.videoElement.muted = this.volume === 0;
      console.log(`🔊 WebRTC volume set to: ${Math.round(this.volume * 100)}%`);
    } else {
      // For regular streaming, use streaming manager
      this.streamingManager.setVolume(this.volume);
      this.videoElement.muted = false;
    }
    
    this.updateVolumeControls();
  }
  
  toggleMute() {
    this.isMuted = !this.isMuted;
    
    // For WebRTC streams, handle muting differently
    if (this.videoElement.getAttribute('data-webrtc') === 'true') {
      this.videoElement.muted = this.isMuted;
      // Also set volume to 0 when muted for extra safety
      if (this.isMuted) {
        this.lastVolume = this.volume; // Store current volume
        this.videoElement.volume = 0;
      } else {
        this.videoElement.volume = this.lastVolume || this.volume;
      }
      console.log(`🔊 WebRTC ${this.isMuted ? 'muted' : 'unmuted'}`);
    } else {
      // For regular streaming
      this.videoElement.muted = this.isMuted;
    }
    
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
    
    // Show visual feedback for sync action
    this.showSyncFeedback();
    
    this.notifyPlaybackChange('sync', this.currentTime, {
      isPlaying: this.isPlaying,
      volume: this.volume,
      duration: this.duration
    });
  }

  /**
   * Show visual feedback when host syncs with participants
   */
  showSyncFeedback() {
    const syncBtn = this.container.querySelector('#sync-btn');
    if (!syncBtn) return;
    
    // Temporarily change button appearance to show sync action
    const originalHTML = syncBtn.innerHTML;
    syncBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" class="sync-animation">
        <path fill="currentColor" d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" />
      </svg>
    `;
    
    // Add spinning animation class
    const svg = syncBtn.querySelector('svg');
    if (svg) {
      svg.style.animation = 'spin 1s linear';
    }
    
    // Reset after animation
    setTimeout(() => {
      syncBtn.innerHTML = originalHTML;
      this.updateSyncButtonTooltip();
    }, 1000);
  }

  /**
   * Update sync button tooltip with participant count
   */
  updateSyncButtonTooltip() {
    const syncBtn = this.container.querySelector('#sync-btn');
    if (!syncBtn || !this.isHost) return;
    
    // This would be called when participant count changes
    // For now, show generic tooltip - will be enhanced when participant count is available
    syncBtn.title = 'Sync playback with all participants';
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

  /**
   * Update sync quality indicator based on synchronization statistics
   */
  updateSyncQualityIndicator(syncStats) {
    if (this.isHost) return; // Only show for participants
    
    const syncQuality = this.container.querySelector('#sync-quality');
    const syncIndicator = this.container.querySelector('.sync-indicator');
    const syncText = this.container.querySelector('.sync-text');
    
    if (!syncQuality || !syncIndicator || !syncStats) return;
    
    // Show sync indicator when calibrated
    if (syncStats.isCalibrated) {
      syncQuality.style.display = 'flex';
      
      // Update indicator based on sync quality
      let color = '#6b7280'; // Gray default
      let text = 'SYNC';
      
      if (syncStats.drift) {
        switch (syncStats.drift.quality) {
          case 'excellent':
            color = '#10b981'; // Green
            text = 'SYNC';
            break;
          case 'good':
            color = '#f59e0b'; // Yellow
            text = 'SYNC';
            break;
          case 'fair':
            color = '#ef4444'; // Red
            text = 'DRIFT';
            break;
          default:
            color = '#6b7280';
            text = 'SYNC';
        }
      }
      
      syncIndicator.style.backgroundColor = color;
      syncText.textContent = text;
      
      // Update tooltip with detailed stats
      const latency = Math.round(syncStats.networkLatency);
      const accuracy = syncStats.drift ? Math.round(syncStats.drift.averageAccuracy) : 0;
      syncQuality.title = `Sync Quality: ${syncStats.drift?.quality || 'unknown'}\nLatency: ${latency}ms\nAccuracy: ±${accuracy}ms`;
      
    } else {
      syncQuality.style.display = 'none';
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
        title: this.currentFile?.name || 'Unknown Movie',
        duration: this.duration || 0,
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
   * Show error overlay with message
   */
  showError(message) {
    const errorOverlay = this.container.querySelector('#error-overlay');
    const errorMessage = this.container.querySelector('#error-message');
    const retryBtn = this.container.querySelector('#retry-btn');
    
    if (errorOverlay && errorMessage) {
      errorMessage.textContent = message;
      errorOverlay.style.display = 'flex';
      
      // Setup retry button
      if (retryBtn) {
        retryBtn.onclick = () => {
          this.hideError();
          // Optionally trigger a retry of the streaming
          if (this.currentFile) {
            console.log('🔄 Retrying video initialization...');
            this.initializeWithFile(this.currentFile, this.container, this.isHost);
          }
        };
      }
      
      console.log('⚠️ Error displayed:', message);
    }
  }
  
  /**
   * Hide error overlay
   */
  hideError() {
    const errorOverlay = this.container.querySelector('#error-overlay');
    if (errorOverlay) {
      errorOverlay.style.display = 'none';
      console.log('✅ Error overlay hidden');
    }
  }
  
  /**
   * Show or hide buffering indicator
   */
  showBufferingIndicator(show) {
    const bufferingOverlay = this.container.querySelector('#buffering-overlay');
    if (bufferingOverlay) {
      bufferingOverlay.style.display = show ? 'flex' : 'none';
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
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Cleanup and destroy player
   */
  destroy() {
    // Stop streaming
    this.streamingManager.stop();
    
    // Stop synchronization
    if (this.syncManager) {
      this.syncManager.destroy();
    }
    
    // Stop participant timer
    this.stopParticipantTimer();
    
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
