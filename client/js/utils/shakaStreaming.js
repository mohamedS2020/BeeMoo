// BeeMoo - Shaka Player Streaming Manager
// Advanced streaming with adaptive bitrate and enhanced synchronization

import shaka from 'shaka-player/dist/shaka-player.compiled.js';

export class ShakaStreamingManager {
  constructor() {
    this.player = null;
    this.videoElement = null;
    this.file = null;
    this.isStreaming = false;
    this.isPaused = false;
    this.isHost = false;
    this.useFallbackMode = false;
    this.eventListeners = {};
    
    // Shaka-specific properties
    this.manifestUri = null;
    this.currentManifest = null;
    this.availableVariants = [];
    this.currentVariant = null;
    this.segmentUrls = []; // Store segment URLs for cleanup
    
    // Performance monitoring (enhanced with Shaka stats)
    this.stats = {
      chunksLoaded: 0,
      totalLoadTime: 0,
      averageChunkTime: 0,
      bufferHealth: 100,
      stallCount: 0,
      seekCount: 0,
      adaptationCount: 0,
      currentBandwidth: 0,
      estimatedBandwidth: 0,
      droppedFrames: 0
    };
    
    // BeeMoo compatibility - preserve existing API
    this.currentTime = 0;
    this.duration = 0;
    this.bufferedPercent = 0;
    
    // Simple Shaka Player configuration - let Shaka handle the complexity
    this.shakaConfig = {
      streaming: {
        bufferingGoal: 30,          // 30s buffer ahead
        rebufferingGoal: 5,         // 5s minimum buffer
        bufferBehind: 10            // Keep 10s behind current position
      },
      abr: {
        enabled: false              // Disable ABR for local blob files
      }
    };
    
    this.initializeShaka();
  }
  
  /**
   * Initialize Shaka Player and check browser support
   */
  async initializeShaka() {
    // Install built-in polyfills to patch browser incompatibilities
    shaka.polyfill.installAll();
    
    // Check if browser is supported
    if (!shaka.Player.isBrowserSupported()) {
      console.warn('⚠️ Browser not supported by Shaka Player, falling back to legacy streaming');
      this.useFallbackMode = true;
      // Import the legacy streaming manager for fallback
      const { StreamingManager } = await import('./streaming.js');
      this.legacyManager = new StreamingManager();
      return;
    }
    
    console.log('✅ Shaka Player initialized and browser supported');
    this.emit('shaka-ready');
  }
  
  /**
   * Initialize streaming with file - simplified to use Shaka's native capabilities
   */
  async initializeStreaming(file, videoElement, options = {}) {
    this.file = file;
    this.videoElement = videoElement;
    this.isHost = options.isHost || false;

    // If browser doesn't support Shaka, use legacy manager
    if (this.useFallbackMode && this.legacyManager) {
      console.log('🔄 Using legacy streaming manager for unsupported browser');
      return this.legacyManager.initializeStreaming(file, videoElement, options);
    }

    try {
      // Create Shaka Player instance
      this.player = new shaka.Player(videoElement);
      
      // Simple, clean configuration - let Shaka handle the complexity
      this.player.configure({
        streaming: {
          bufferingGoal: 30,
          rebufferingGoal: 5,
          bufferBehind: 10
        },
        abr: {
          enabled: false // Disable ABR for local files
        }
      });
      
      // Setup Shaka event listeners
      this.setupShakaEvents();
      
      // Let Shaka handle the blob URL directly - it knows what to do
      console.log('🎬 Initializing Shaka Player with native blob URL handling');
      const blobUrl = URL.createObjectURL(file);
      this.manifestUri = blobUrl; // Store for cleanup
      
      await this.player.load(blobUrl);
      
      this.isStreaming = true;
      this.emit('ready');
      
      return {
        duration: this.videoElement.duration || 0,
        totalChunks: 1,
        chunkSize: file.size,
        mimeType: file.type || 'video/mp4',
        mode: 'shaka-native',
        player: 'shaka'
      };
      
    } catch (error) {
      console.error('❌ Shaka Player initialization failed, falling back to legacy:', error);
      
      // Fallback to legacy streaming manager
      if (!this.legacyManager) {
        const { StreamingManager } = await import('./streaming.js');
        this.legacyManager = new StreamingManager();
      }
      
      return this.legacyManager.initializeStreaming(file, videoElement, options);
    }
  }  /**
   * Initialize direct streaming for smaller files using Shaka Player
   */
  async initializeDirectStreaming(file, videoElement, options = {}) {
    try {
      // Create Shaka Player instance
      this.player = new shaka.Player(videoElement);
      this.player.configure(this.shakaConfig);
      this.setupShakaEvents();
      
      // Create blob URL for direct playback
      const blobUrl = URL.createObjectURL(file);
      
      // Load the video directly through Shaka Player
      await this.player.load(blobUrl);
      
      console.log('✅ Direct streaming initialized with Shaka Player');
      
      this.isStreaming = true;
      this.emit('ready');
      
      return {
        duration: this.videoElement.duration || 0,
        totalChunks: 1,
        chunkSize: file.size,
        mimeType: file.type || 'video/mp4',
        mode: 'shaka-direct',
        player: 'shaka'
      };
      
    } catch (error) {
      console.error('❌ Shaka direct streaming failed:', error);
      throw error;
    }
  }
  
  /**
   * Initialize Shaka Player with enhanced streaming for large files
   * Uses direct blob URL streaming with optimized configuration (no complex DASH manifests)
   */
  async initializeShakaWithMSE(file, options = {}) {
    try {
      console.log('🏗️ Initializing enhanced Shaka streaming for large file...');
      
      // Create Shaka Player instance if not already created
      if (!this.player) {
        this.player = new shaka.Player(this.videoElement);
        this.setupShakaEvents();
      }
      
      // FIXED: Enhanced configuration for large local files (removed invalid config keys)
      this.player.configure({
        streaming: {
          bufferingGoal: 60,        // Buffer 60 seconds ahead
          rebufferingGoal: 10,      // Start rebuffering at 10 seconds
          bufferBehind: 30,         // Keep 30 seconds behind
          maxDisabledTime: 30,
          retryParameters: {
            maxAttempts: 3,
            timeout: 15000,
            stallTimeout: 10000,
            connectionTimeout: 10000
          }
        },
        manifest: {
          retryParameters: {
            maxAttempts: 3,
            timeout: 10000
          }
        },
        abr: {
          enabled: false, // Disable ABR for local files to prevent interference
          useNetworkInformation: false
        }
      });
      
      // Create direct blob URL for the entire file
      const fileUrl = URL.createObjectURL(file);
      this.manifestUri = fileUrl; // Store for cleanup
      
      console.log('📥 Loading content directly through Shaka Player...');
      
      // Load the file URL directly - Shaka will handle it as a direct media file
      await this.player.load(fileUrl);
      
      // Get available variants after loading
      this.availableVariants = this.player.getVariantTracks() || [];
      console.log('📊 Available quality variants:', this.availableVariants.length);
      
      // Get file metadata
      const duration = this.videoElement.duration || 0;
      
      console.log('✅ Enhanced Shaka streaming initialized successfully');
      
      return {
        duration: duration,
        totalChunks: Math.ceil(file.size / (2 * 1024 * 1024)), // Estimate 2MB chunks
        chunkSize: 2 * 1024 * 1024,
        mimeType: file.type || 'video/mp4',
        mode: 'shaka-enhanced',
        player: 'shaka',
        variants: this.availableVariants.length,
        qualities: this.availableVariants.length > 0 ? 
          this.availableVariants.map(v => `${v.height}p@${Math.round(v.bandwidth/1000)}k`) : ['Auto']
      };
      
    } catch (error) {
      console.error('❌ Enhanced Shaka streaming initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Analyze video file to extract metadata for adaptive streaming
   */
  async analyzeVideoFile(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      
      const cleanup = () => {
        URL.revokeObjectURL(video.src);
        video.remove();
      };
      
      video.addEventListener('loadedmetadata', () => {
        const metadata = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          aspectRatio: video.videoWidth / video.videoHeight,
          fileSize: file.size,
          mimeType: file.type || 'video/mp4'
        };
        
        cleanup();
        resolve(metadata);
      });
      
      video.addEventListener('error', (e) => {
        console.error('Video analysis failed:', e);
        cleanup();
        
        // Provide fallback metadata
        resolve({
          duration: 0,
          width: 1920,
          height: 1080,
          aspectRatio: 16/9,
          fileSize: file.size,
          mimeType: file.type || 'video/mp4'
        });
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (video.readyState < 1) {
          console.warn('Video analysis timeout, using fallback metadata');
          cleanup();
          resolve({
            duration: 0,
            width: 1920,
            height: 1080,
            aspectRatio: 16/9,
            fileSize: file.size,
            mimeType: file.type || 'video/mp4'
          });
        }
      }, 10000);
      
      // Load video for analysis
      video.src = URL.createObjectURL(file);
    });
  }
  
  /**
   * Generate dynamic DASH manifest for adaptive streaming of local files
   */
  async generateDynamicDASHManifest(file, metadata, options = {}) {
    const segmentDuration = options.segmentDuration || 10; // 10 second segments
    const totalSegments = Math.ceil(metadata.duration / segmentDuration) || 1;
    const segmentSize = Math.ceil(file.size / totalSegments);
    
    // Define quality levels based on original video dimensions
    const qualityLevels = this.generateQualityLevels(metadata);
    
    // Create segment URLs for each quality level
    const segmentUrls = [];
    const representations = [];
    
    for (const quality of qualityLevels) {
      const representationId = `video_${quality.height}p`;
      const segments = [];
      
      // Generate segments for this quality level
      for (let i = 0; i < totalSegments; i++) {
        const segmentInfo = await this.createVideoSegment(file, i, segmentDuration, quality, totalSegments);
        segments.push(segmentInfo);
        segmentUrls.push(segmentInfo.url);
      }
      
      // Create representation XML
      const representation = this.createRepresentationXML(quality, representationId, segments, segmentDuration);
      representations.push(representation);
    }
    
    // Generate complete DASH manifest
    const manifest = this.createDASHManifestXML(metadata, representations, segmentDuration);
    
    return {
      manifest,
      segmentUrls,
      totalSegments,
      segmentSize,
      qualityLevels
    };
  }
  
  /**
   * Generate quality levels based on original video metadata
   */
  generateQualityLevels(metadata) {
    const { width, height, aspectRatio } = metadata;
    const levels = [];
    
    // Standard quality levels with appropriate bitrates
    const standardQualities = [
      { height: 240, bitrate: 400000 },   // 240p - 400 kbps
      { height: 360, bitrate: 800000 },   // 360p - 800 kbps
      { height: 480, bitrate: 1500000 },  // 480p - 1.5 Mbps
      { height: 720, bitrate: 2500000 },  // 720p - 2.5 Mbps
      { height: 1080, bitrate: 4000000 }, // 1080p - 4 Mbps
      { height: 1440, bitrate: 8000000 }, // 1440p - 8 Mbps
      { height: 2160, bitrate: 15000000 } // 4K - 15 Mbps
    ];
    
    // Only include qualities that are equal to or less than the original
    for (const quality of standardQualities) {
      if (quality.height <= height) {
        levels.push({
          ...quality,
          width: Math.round(quality.height * aspectRatio),
          id: `video_${quality.height}p`,
          codecs: 'avc1.64001E' // H.264 High Profile
        });
      }
    }
    
    // Ensure we have at least one quality level
    if (levels.length === 0) {
      levels.push({
        height,
        width,
        bitrate: 2500000,
        id: 'video_original',
        codecs: 'avc1.64001E'
      });
    }
    
    return levels;
  }
  
  /**
   * Create video segment with specified quality parameters
   */
  async createVideoSegment(file, segmentIndex, segmentDuration, quality, totalSegments) {
    // Calculate segment byte range
    const segmentSize = Math.ceil(file.size / totalSegments);
    const startByte = segmentIndex * segmentSize;
    const endByte = Math.min(startByte + segmentSize - 1, file.size - 1);
    
    // Create segment blob
    const segmentBlob = file.slice(startByte, endByte + 1);
    const segmentUrl = URL.createObjectURL(segmentBlob);
    
    return {
      url: segmentUrl,
      startByte,
      endByte,
      size: endByte - startByte + 1,
      duration: segmentDuration,
      index: segmentIndex
    };
  }
  
  /**
   * Create DASH representation XML for a quality level
   */
  createRepresentationXML(quality, representationId, segments, segmentDuration) {
    const segmentList = segments.map((segment, index) => {
      return `        <SegmentURL media="${segment.url}" mediaRange="${segment.startByte}-${segment.endByte}"/>`;
    }).join('\n');
    
    return `      <Representation id="${representationId}"
                   mimeType="video/mp4"
                   codecs="${quality.codecs}"
                   width="${quality.width}"
                   height="${quality.height}"
                   bandwidth="${quality.bitrate}">
        <SegmentList duration="${segmentDuration}">
${segmentList}
        </SegmentList>
      </Representation>`;
  }
  
  /**
   * Create complete DASH manifest XML
   */
  createDASHManifestXML(metadata, representations, segmentDuration) {
    const totalDuration = `PT${Math.ceil(metadata.duration || 0)}S`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     type="static"
     mediaPresentationDuration="${totalDuration}"
     minBufferTime="PT${segmentDuration}S"
     profiles="urn:mpeg:dash:profile:isoff-main:2011">
  
  <Period id="0" duration="${totalDuration}">
    <AdaptationSet id="0" 
                   mimeType="video/mp4" 
                   segmentAlignment="true" 
                   startWithSAP="1">
${representations.join('\n')}
    </AdaptationSet>
  </Period>
</MPD>`;
  }
  
  /**
   * Setup Shaka Player event listeners
   */
  setupShakaEvents() {
    if (!this.player) return;
    
    // Error handling
    this.player.addEventListener('error', (event) => {
      const error = event.detail;
      console.error('❌ Shaka Player error:', error);
      this.stats.stallCount++;
      this.emit('error', error);
    });
    
    // Adaptation events (quality changes)
    this.player.addEventListener('adaptation', (event) => {
      this.stats.adaptationCount++;
      const variant = this.player.getVariantTracks().find(v => v.active);
      if (variant) {
        this.currentVariant = variant;
        console.log(`📊 Quality adapted to: ${variant.height}p @ ${Math.round(variant.bandwidth / 1000)}kbps`);
        this.emit('quality-change', {
          height: variant.height,
          width: variant.width,
          bandwidth: variant.bandwidth,
          language: variant.language
        });
      }
    });
    
    // Buffer events
    this.player.addEventListener('buffering', (event) => {
      const isBuffering = event.buffering;
      if (isBuffering) {
        this.stats.stallCount++;
      }
      console.log(isBuffering ? '⏳ Buffering...' : '▶️ Playback resumed');
      this.emit('buffering', isBuffering);
    });
    
    // Loading events
    this.player.addEventListener('loading', () => {
      console.log('📥 Loading content...');
      this.emit('loading', true);
    });
    
    this.player.addEventListener('loaded', () => {
      console.log('✅ Content loaded');
      this.emit('loading', false);
      this.updateStats();
    });
    
    // Setup video element events for compatibility
    this.setupVideoEvents();
  }
  
  /**
   * Setup video element events (maintains compatibility with existing code)
   */
  setupVideoEvents() {
    if (!this.videoElement) return;
    
    this.videoElement.addEventListener('loadedmetadata', () => {
      this.duration = this.videoElement.duration;
      console.log(`📊 Video metadata loaded - Duration: ${this.duration}s`);
      this.emit('metadata-loaded', {
        duration: this.duration,
        videoWidth: this.videoElement.videoWidth,
        videoHeight: this.videoElement.videoHeight
      });
    });
    
    this.videoElement.addEventListener('timeupdate', () => {
      this.currentTime = this.videoElement.currentTime;
      this.bufferedPercent = this.getBufferedPercent();
      
      this.emit('timeupdate', {
        currentTime: this.currentTime,
        duration: this.duration,
        buffered: this.bufferedPercent
      });
    });
    
    this.videoElement.addEventListener('play', () => {
      this.isPaused = false;
      console.log('▶️ Playback started');
      this.emit('play');
    });
    
    this.videoElement.addEventListener('pause', () => {
      this.isPaused = true;
      console.log('⏸️ Playback paused');
      this.emit('pause');
    });
    
    this.videoElement.addEventListener('seeking', () => {
      this.stats.seekCount++;
      console.log(`⏩ Seeking to ${this.videoElement.currentTime.toFixed(2)}s`);
      this.emit('seeking');
    });
    
    this.videoElement.addEventListener('waiting', () => {
      this.stats.stallCount++;
      console.log('⏳ Video waiting for data');
      this.emit('buffering', true);
    });
    
    this.videoElement.addEventListener('playing', () => {
      console.log('▶️ Video playing');
      this.emit('buffering', false);
      this.emit('playing');
    });
    
    this.videoElement.addEventListener('progress', () => {
      this.updateStats();
      this.monitorBufferHealth();
    });
  }
  
  /**
   * Update streaming statistics
   */
  updateStats() {
    if (!this.player) return;
    
    // Get Shaka Player statistics
    const shakaStats = this.player.getStats();
    
    this.stats.estimatedBandwidth = shakaStats.estimatedBandwidth || 0;
    this.stats.currentBandwidth = this.currentVariant?.bandwidth || 0;
    this.stats.droppedFrames = shakaStats.droppedFrames || 0;
    
    // Calculate buffer health
    this.stats.bufferHealth = this.calculateBufferHealth();
    
    this.emit('stats-updated', this.stats);
  }
  
  /**
   * Calculate buffer health percentage
   */
  calculateBufferHealth() {
    if (!this.videoElement || !this.videoElement.buffered.length) return 0;
    
    const currentTime = this.videoElement.currentTime;
    const bufferedAhead = this.getBufferedTimeAhead(currentTime);
    const targetBuffer = this.shakaConfig.streaming.bufferingGoal;
    
    return Math.min(100, (bufferedAhead / targetBuffer) * 100);
  }
  
  /**
   * Get buffered time ahead of current position
   */
  getBufferedTimeAhead(currentTime) {
    if (!this.videoElement.buffered.length) return 0;
    
    for (let i = 0; i < this.videoElement.buffered.length; i++) {
      const start = this.videoElement.buffered.start(i);
      const end = this.videoElement.buffered.end(i);
      
      if (currentTime >= start && currentTime <= end) {
        return end - currentTime;
      }
    }
    
    return 0;
  }
  
  /**
   * Get buffered percentage of total duration
   */
  getBufferedPercent() {
    if (!this.videoElement.buffered.length || !this.videoElement.duration) return 0;
    
    let bufferedTime = 0;
    for (let i = 0; i < this.videoElement.buffered.length; i++) {
      bufferedTime += this.videoElement.buffered.end(i) - this.videoElement.buffered.start(i);
    }
    
    return (bufferedTime / this.videoElement.duration) * 100;
  }
  
  /**
   * Monitor buffer health and emit warnings
   */
  monitorBufferHealth() {
    const health = this.calculateBufferHealth();
    
    if (health < 20) {
      this.emit('buffer-warning', { 
        health, 
        message: 'Low buffer - may experience interruptions' 
      });
    } else if (health > 80) {
      this.emit('buffer-healthy', { 
        health, 
        message: 'Buffer healthy' 
      });
    }
    
    this.emit('buffer-health', {
      health,
      bufferedAhead: this.getBufferedTimeAhead(this.currentTime),
      recommended: this.shakaConfig.streaming.bufferingGoal
    });
  }
  
  /**
   * Playback control methods (maintaining API compatibility)
   */
  async play() {
    if (!this.videoElement) return;
    
    try {
      await this.videoElement.play();
      this.isPaused = false;
      console.log('▶️ Playback started');
    } catch (error) {
      console.error('❌ Play failed:', error);
      this.emit('error', error);
    }
  }
  
  pause() {
    if (!this.videoElement) return;
    
    this.videoElement.pause();
    this.isPaused = true;
    console.log('⏸️ Playback paused');
  }
  
  seek(time) {
    if (!this.videoElement) return;
    
    const clampedTime = Math.max(0, Math.min(this.videoElement.duration || 0, time));
    this.videoElement.currentTime = clampedTime;
    console.log(`⏩ Seeking to ${clampedTime.toFixed(2)}s`);
  }
  
  setVolume(volume) {
    if (!this.videoElement) return;
    this.videoElement.volume = Math.max(0, Math.min(1, volume));
  }
  
  /**
   * Shaka Player specific methods
   */
  
  /**
   * Get available quality variants
   */
  getQualityLevels() {
    if (!this.player) return [];
    
    return this.player.getVariantTracks().map(variant => ({
      id: variant.id,
      width: variant.width,
      height: variant.height,
      bandwidth: variant.bandwidth,
      language: variant.language,
      active: variant.active
    }));
  }
  
  /**
   * Set quality level
   */
  setQuality(variantId) {
    if (!this.player) return;
    
    this.player.selectVariantTrack(variantId);
    console.log(`📊 Quality set to variant ${variantId}`);
  }
  
  /**
   * Enable/disable adaptive streaming
   */
  setAdaptiveStreaming(enabled) {
    if (!this.player) return;
    
    this.player.configure({
      abr: { enabled }
    });
    
    console.log(`📊 Adaptive streaming ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Get current streaming statistics (enhanced)
   */
  getStats() {
    const baseStats = {
      ...this.stats,
      isStreaming: this.isStreaming,
      isPaused: this.isPaused,
      currentTime: this.currentTime,
      duration: this.duration,
      bufferedPercent: this.bufferedPercent,
      mode: this.useFallbackMode ? 'legacy' : 'shaka'
    };
    
    if (this.player) {
      const shakaStats = this.player.getStats();
      return {
        ...baseStats,
        shakaStats: {
          estimatedBandwidth: shakaStats.estimatedBandwidth,
          width: shakaStats.width,
          height: shakaStats.height,
          streamBandwidth: shakaStats.streamBandwidth,
          decodedFrames: shakaStats.decodedFrames,
          droppedFrames: shakaStats.droppedFrames,
          loadLatency: shakaStats.loadLatency,
          playTime: shakaStats.playTime,
          pauseTime: shakaStats.pauseTime,
          bufferingTime: shakaStats.bufferingTime
        },
        currentVariant: this.currentVariant,
        availableVariants: this.availableVariants.length
      };
    }
    
    return baseStats;
  }
  
  /**
   * Cleanup and destroy resources
   */
  async cleanup() {
    if (this.player) {
      try {
        await this.player.destroy();
        this.player = null;
        console.log('🧹 Shaka Player destroyed');
      } catch (error) {
        console.warn('⚠️ Error destroying Shaka Player:', error);
      }
    }
    
    // Cleanup legacy manager if used
    if (this.legacyManager) {
      this.legacyManager.cleanup();
    }
    
    // Revoke manifest URL
    if (this.manifestUri) {
      URL.revokeObjectURL(this.manifestUri);
      this.manifestUri = null;
    }
    
    // Revoke segment URLs
    if (this.segmentUrls && Array.isArray(this.segmentUrls)) {
      this.segmentUrls.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (error) {
          console.warn('⚠️ Error revoking segment URL:', error);
        }
      });
      this.segmentUrls = [];
    }
    
    // Revoke blob URLs from video element
    if (this.videoElement && this.videoElement.src && this.videoElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.videoElement.src);
    }
    
    console.log('🧹 All streaming resources cleaned up');
  }
  
  /**
   * Stop streaming and reset state
   */
  async stop() {
    this.isStreaming = false;
    this.isPaused = false;
    
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
    }
    
    await this.cleanup();
    
    // Reset state
    this.currentTime = 0;
    this.duration = 0;
    this.bufferedPercent = 0;
    this.currentVariant = null;
    this.availableVariants = [];
    
    console.log('⏹️ Shaka streaming stopped and cleaned up');
  }
  
  /**
   * Event emitter functionality (maintaining compatibility)
   */
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }
  
  off(event, callback) {
    if (!this.eventListeners[event]) return;
    
    const index = this.eventListeners[event].indexOf(callback);
    if (index > -1) {
      this.eventListeners[event].splice(index, 1);
    }
  }
  
  emit(event, data) {
    if (!this.eventListeners[event]) return;
    
    this.eventListeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ Event callback error for ${event}:`, error);
      }
    });
  }
  
  /**
   * Utility: Format bytes (maintaining compatibility)
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Export for use in other modules
export { ShakaStreamingManager as default };
