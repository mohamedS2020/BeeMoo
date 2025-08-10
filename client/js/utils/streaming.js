// BeeMoo - Advanced Video Streaming Utility
// Implements chunked streaming using Media Source Extensions for progressive playback

export class StreamingManager {
  constructor() {
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.videoElement = null;
    this.file = null;
    this.isStreaming = false;
    this.isPaused = false;
    this.currentChunk = 0;
    this.totalChunks = 0;
    this.chunkSize = 1024 * 1024; // 1MB default chunk size
    this.bufferTimeAhead = 10; // Buffer 10 seconds ahead for more progressive loading
    this.maxBufferTime = 60; // Maximum 60 seconds in buffer
    this.minBufferTime = 5; // Minimum 5 seconds before rebuffering
    this.chunks = [];
    this.bufferedRanges = [];
    this.eventListeners = {};
    
    // Performance monitoring
    this.stats = {
      chunksLoaded: 0,
      totalLoadTime: 0,
      averageChunkTime: 0,
      bufferHealth: 100,
      stallCount: 0,
      seekCount: 0
    };
    
    // Supported MIME types for MSE
    this.supportedTypes = [
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"', // H.264 + AAC
      'video/mp4; codecs="avc1.64001E,mp4a.40.2"', // H.264 High + AAC
      'video/webm; codecs="vp9,opus"', // VP9 + Opus
      'video/webm; codecs="vp8,vorbis"' // VP8 + Vorbis
    ];
    
    this.initializeCapabilities();
  }
  
  /**
   * Initialize and check MSE capabilities
   */
  initializeCapabilities() {
    this.capabilities = {
      mseSupported: this.checkMSESupport(),
      supportedMimeTypes: this.getSupportedMimeTypes(),
      maxSourceBuffers: this.getMaxSourceBuffers()
    };
    
    console.log('🎬 Streaming capabilities:', this.capabilities);
  }
  
  /**
   * Check if Media Source Extensions are supported
   */
  checkMSESupport() {
    if (!window.MediaSource) {
      console.error('❌ Media Source Extensions not supported');
      return false;
    }
    
    if (!MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) {
      console.warn('⚠️ MP4 H.264 support limited');
    }
    
    return true;
  }
  
  /**
   * Get list of supported MIME types
   */
  getSupportedMimeTypes() {
    return this.supportedTypes.filter(type => MediaSource.isTypeSupported(type));
  }
  
  /**
   * Get maximum number of source buffers
   */
  getMaxSourceBuffers() {
    try {
      const mediaSource = new MediaSource();
      return mediaSource.sourceBuffers.length || 16; // Default fallback
    } catch (e) {
      return 1; // Conservative fallback
    }
  }
  
  /**
   * Initialize streaming for a video file
   * @param {File} file - Video file to stream
   * @param {HTMLVideoElement} videoElement - Video element to stream to
   * @param {Object} options - Streaming options
   */
  async initializeStreaming(file, videoElement, options = {}) {
    if (!this.capabilities.mseSupported) {
      throw new Error('Media Source Extensions not supported in this browser');
    }
    
    this.file = file;
    this.videoElement = videoElement;
    this.chunkSize = options.chunkSize || this.chunkSize;
    this.bufferTimeAhead = options.bufferTimeAhead || this.bufferTimeAhead;
    
    // Validate file format
    const mimeType = await this.detectMimeType(file);
    if (!this.capabilities.supportedMimeTypes.includes(mimeType)) {
      throw new Error(`Unsupported video format: ${mimeType}`);
    }
    
    // Calculate chunks
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    console.log(`🎬 Initializing streaming: ${this.totalChunks} chunks of ${this.formatBytes(this.chunkSize)}`);
    
    // Create and setup MediaSource
    this.mediaSource = new MediaSource();
    this.setupMediaSourceEvents();
    
    // Set video source to MediaSource object URL
    const objectURL = URL.createObjectURL(this.mediaSource);
    this.videoElement.src = objectURL;
    
    console.log(`📺 Video source set: ${objectURL}`);
    console.log(`📺 Video element ready state: ${this.videoElement.readyState}`);
    console.log(`📺 MediaSource ready state: ${this.mediaSource.readyState}`);
    
    // Setup video element events
    this.setupVideoEvents();
    
    return new Promise((resolve, reject) => {
      this.mediaSource.addEventListener('sourceopen', async () => {
        try {
          await this.initializeSourceBuffer(mimeType);
          await this.startBuffering();
          resolve({
            duration: this.videoElement.duration,
            totalChunks: this.totalChunks,
            chunkSize: this.chunkSize,
            mimeType: mimeType
          });
        } catch (error) {
          reject(error);
        }
      }, { once: true });
      
      this.mediaSource.addEventListener('error', () => {
        reject(new Error('Failed to initialize MediaSource'));
      }, { once: true });
    });
  }
  
  /**
   * Detect video MIME type and codec
   */
  async detectMimeType(file) {
    // Start with file.type if available
    if (file.type && this.capabilities.supportedMimeTypes.includes(file.type)) {
      return file.type;
    }
    
    // Fallback: analyze first few bytes for format detection
    const header = await this.readFileHeader(file, 64);
    
    // MP4 detection (ftyp box)
    if (this.isMP4Header(header)) {
      return 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
    }
    
    // WebM detection (EBML header)
    if (this.isWebMHeader(header)) {
      return 'video/webm; codecs="vp9,opus"';
    }
    
    // Default fallback
    return 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
  }
  
  /**
   * Read file header for format detection
   */
  async readFileHeader(file, bytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(0, bytes));
    });
  }
  
  /**
   * Check if header indicates MP4 format
   */
  isMP4Header(header) {
    // Look for ftyp box signature
    for (let i = 0; i < header.length - 4; i++) {
      if (header[i] === 0x66 && header[i+1] === 0x74 && 
          header[i+2] === 0x79 && header[i+3] === 0x70) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Check if header indicates WebM format
   */
  isWebMHeader(header) {
    // EBML header signature
    return header[0] === 0x1A && header[1] === 0x45 && 
           header[2] === 0xDF && header[3] === 0xA3;
  }
  
  /**
   * Setup MediaSource event listeners
   */
  setupMediaSourceEvents() {
    this.mediaSource.addEventListener('sourceopen', () => {
      console.log('📺 MediaSource opened');
      this.emit('sourceopen');
    });
    
    this.mediaSource.addEventListener('sourceended', () => {
      console.log('📺 MediaSource ended');
      this.emit('sourceended');
    });
    
    this.mediaSource.addEventListener('error', (e) => {
      console.error('❌ MediaSource error:', e);
      this.emit('error', e);
    });
  }
  
  /**
   * Setup video element event listeners
   */
  setupVideoEvents() {
    // Buffer monitoring
    this.videoElement.addEventListener('progress', () => {
      this.updateBufferedRanges();
      this.monitorBufferHealth();
    });
    
    // Metadata events
    this.videoElement.addEventListener('loadedmetadata', () => {
      console.log(`📊 Video metadata loaded - Duration: ${this.videoElement.duration}s`);
      this.emit('metadata-loaded', {
        duration: this.videoElement.duration,
        videoWidth: this.videoElement.videoWidth,
        videoHeight: this.videoElement.videoHeight
      });
    });
    
    // Playback events
    this.videoElement.addEventListener('waiting', () => {
      console.log('⏳ Video waiting for data');
      this.stats.stallCount++;
      this.emit('buffering', true);
    });
    
    this.videoElement.addEventListener('playing', () => {
      console.log('▶️ Video playing');
      this.emit('buffering', false);
    });
    
    // Seek events
    this.videoElement.addEventListener('seeking', () => {
      this.stats.seekCount++;
      this.handleSeek();
    });
    
    // Error handling
    this.videoElement.addEventListener('error', (e) => {
      console.error('❌ Video error:', e);
      this.emit('error', e);
    });
    
    // Update events
    this.videoElement.addEventListener('timeupdate', () => {
      this.emit('timeupdate', {
        currentTime: this.videoElement.currentTime,
        duration: this.videoElement.duration,
        buffered: this.getBufferedPercent()
      });
    });
  }
  
  /**
   * Initialize SourceBuffer with appropriate MIME type
   */
  async initializeSourceBuffer(mimeType) {
    try {
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
      
      this.sourceBuffer.addEventListener('updateend', () => {
        this.handleBufferUpdate();
      });
      
      this.sourceBuffer.addEventListener('error', (e) => {
        console.error('❌ SourceBuffer error:', e);
        console.error('📊 SourceBuffer state:', {
          readyState: this.mediaSource.readyState,
          sourceBuffers: this.mediaSource.sourceBuffers.length,
          updating: this.sourceBuffer.updating,
          buffered: this.sourceBuffer.buffered.length > 0 ? 
            `${this.sourceBuffer.buffered.start(0)}-${this.sourceBuffer.buffered.end(0)}` : 'none'
        });
        
        // Try to recover from SourceBuffer errors
        this.handleSourceBufferError(e);
        this.emit('error', e);
      });
      
      console.log(`📺 SourceBuffer initialized with ${mimeType}`);
    } catch (error) {
      throw new Error(`Failed to initialize SourceBuffer: ${error.message}`);
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
   * Start buffering video data
   */
  async startBuffering() {
    if (this.isStreaming) return;
    
    this.isStreaming = true;
    this.currentChunk = 0;
    
    console.log('🚀 Starting progressive buffering...');
    
    // For MP4 files, we need to ensure the first chunk contains complete initialization data
    // Load more initial chunks to ensure we have the complete moov atom
    const initialChunks = Math.min(5, this.totalChunks); // Load more chunks initially
    for (let i = 0; i < initialChunks; i++) {
      await this.loadChunk(i);
      
      // Try to trigger metadata loading after each chunk
      if (i === 2) {
        console.log('🔄 Attempting to load video metadata...');
        this.videoElement.load();
      }
    }
    
    this.emit('ready');
    
    // Continue buffering in background
    this.scheduleBuffering();
  }
  
  /**
   * Load a specific chunk
   */
  async loadChunk(chunkIndex) {
    if (chunkIndex >= this.totalChunks) return;
    if (this.chunks[chunkIndex]) return; // Already loaded
    
    const startTime = performance.now();
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    
    try {
      const chunk = await this.readFileChunk(start, end);
      this.chunks[chunkIndex] = chunk;
      
      // Debug MP4 structure for first few chunks
      if (chunkIndex < 3) {
        this.debugMP4Structure(chunk, chunkIndex);
      }
      
      // Append to SourceBuffer - wait for it to be ready
      await this.appendToSourceBuffer(chunk, chunkIndex);
      
      // Update stats
      const loadTime = performance.now() - startTime;
      this.stats.chunksLoaded++;
      this.stats.totalLoadTime += loadTime;
      this.stats.averageChunkTime = this.stats.totalLoadTime / this.stats.chunksLoaded;
      
      console.log(`📦 Chunk ${chunkIndex}/${this.totalChunks} loaded (${loadTime.toFixed(2)}ms)`);
      
      this.emit('chunk-loaded', {
        index: chunkIndex,
        total: this.totalChunks,
        loadTime: loadTime,
        progress: (chunkIndex + 1) / this.totalChunks
      });
      
      // Signal end of stream when all chunks are loaded
      if (chunkIndex === this.totalChunks - 1) {
        console.log('🏁 All chunks loaded, ending stream...');
        try {
          if (this.mediaSource.readyState === 'open') {
            this.mediaSource.endOfStream();
            console.log('✅ MediaSource stream ended successfully');
          }
        } catch (error) {
          console.error('❌ Failed to end MediaSource stream:', error);
        }
      }
      
    } catch (error) {
      console.error(`❌ Failed to load chunk ${chunkIndex}:`, error);
      this.emit('chunk-error', { index: chunkIndex, error });
    }
  }
  
  /**
   * Debug MP4 structure to understand what's in the chunks
   */
  debugMP4Structure(chunk, chunkIndex) {
    const view = new DataView(chunk);
    console.log(`🔍 Analyzing chunk ${chunkIndex} structure:`);
    
    try {
      // Look for MP4 atoms/boxes in the first few bytes
      let offset = 0;
      const maxAtoms = 5;
      let atomCount = 0;
      
      while (offset < chunk.byteLength - 8 && atomCount < maxAtoms) {
        const size = view.getUint32(offset);
        if (size < 8 || size > chunk.byteLength - offset) break;
        
        const type = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5), 
          view.getUint8(offset + 6),
          view.getUint8(offset + 7)
        );
        
        console.log(`  📦 Atom: ${type} (${size} bytes) at offset ${offset}`);
        
        // Check for important atoms
        if (type === 'moov') {
          console.log(`  ✅ Found moov atom (metadata) in chunk ${chunkIndex}!`);
        } else if (type === 'mdat') {
          console.log(`  📹 Found mdat atom (media data) in chunk ${chunkIndex}`);
        } else if (type === 'ftyp') {
          console.log(`  🏷️ Found ftyp atom (file type) in chunk ${chunkIndex}`);
        }
        
        offset += size;
        atomCount++;
      }
    } catch (error) {
      console.error(`❌ Error analyzing MP4 structure for chunk ${chunkIndex}:`, error);
    }
  }
  
  /**
   * Append chunk to SourceBuffer with proper async handling
   */
  async appendToSourceBuffer(chunk, chunkIndex) {
    return new Promise((resolve, reject) => {
      if (this.sourceBuffer.updating) {
        console.log(`⏳ SourceBuffer updating, waiting for chunk ${chunkIndex}`);
        // Wait for current operation to finish
        const onUpdateEnd = () => {
          this.sourceBuffer.removeEventListener('updateend', onUpdateEnd);
          this.appendToSourceBuffer(chunk, chunkIndex).then(resolve).catch(reject);
        };
        this.sourceBuffer.addEventListener('updateend', onUpdateEnd);
        return;
      }
      
      try {
        console.log(`⬆️ Appending chunk ${chunkIndex} (${chunk.byteLength} bytes) to SourceBuffer`);
        
        // Set up success handler
        const onSuccess = () => {
          this.sourceBuffer.removeEventListener('updateend', onSuccess);
          this.sourceBuffer.removeEventListener('error', onError);
          console.log(`✅ Chunk ${chunkIndex} appended successfully`);
          resolve();
        };
        
        // Set up error handler
        const onError = (e) => {
          this.sourceBuffer.removeEventListener('updateend', onSuccess);
          this.sourceBuffer.removeEventListener('error', onError);
          console.error(`❌ Failed to append chunk ${chunkIndex}:`, e);
          reject(e);
        };
        
        this.sourceBuffer.addEventListener('updateend', onSuccess);
        this.sourceBuffer.addEventListener('error', onError);
        
        // Append the chunk
        this.sourceBuffer.appendBuffer(chunk);
        
      } catch (error) {
        console.error(`❌ Failed to append chunk ${chunkIndex}:`, error);
        reject(error);
      }
    });
  }
  
  /**
   * Read file chunk as ArrayBuffer
   */
  async readFileChunk(start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this.file.slice(start, end));
    });
  }
  
  /**
   * Schedule intelligent buffering based on playback position
   */
  scheduleBuffering() {
    if (!this.isStreaming || !this.videoElement) return;
    
    const currentTime = this.videoElement.currentTime;
    const bufferedAhead = this.getBufferedTimeAhead(currentTime);
    const isPlaying = !this.videoElement.paused;
    const hasMetadata = this.videoElement.duration && !isNaN(this.videoElement.duration);
    
    // Only continue buffering if we actually need more data AND conditions are met
    if (this.currentChunk < this.totalChunks) {
      let shouldBuffer = false;
      
      if (this.currentChunk < 5) {
        // Always load first 5 chunks for metadata and basic playability
        shouldBuffer = true;
      } else if (hasMetadata && isPlaying && bufferedAhead < this.bufferTimeAhead) {
        // Video has metadata, is playing and needs more buffer
        shouldBuffer = true;
      } else if (hasMetadata && bufferedAhead < 2) {
        // Critical low buffer with valid metadata
        shouldBuffer = true;
      }
      
      if (shouldBuffer) {
        console.log(`🔄 Loading chunk ${this.currentChunk} (buffered: ${bufferedAhead.toFixed(1)}s, playing: ${isPlaying}, duration: ${this.videoElement.duration || 'unknown'})`);
        this.loadChunk(this.currentChunk++);
      }
    }
    
    // Schedule next check - adapt based on playback state and metadata availability
    const checkInterval = (isPlaying && hasMetadata) ? 1000 : 3000;
    setTimeout(() => this.scheduleBuffering(), checkInterval);
  }
  
  /**
   * Handle SourceBuffer errors and attempt recovery
   */
  handleSourceBufferError(error) {
    console.log('🔄 Attempting SourceBuffer error recovery...');
    
    try {
      // Stop aggressive buffering on error
      this.isStreaming = false;
      
      // If MediaSource is still open, try to end it gracefully
      if (this.mediaSource && this.mediaSource.readyState === 'open') {
        console.log('🛑 Ending MediaSource due to SourceBuffer error');
        this.mediaSource.endOfStream('decode');
      }
    } catch (recoveryError) {
      console.error('❌ Failed to recover from SourceBuffer error:', recoveryError);
    }
  }
  
  /**
   * Handle SourceBuffer update completion
   */
  handleBufferUpdate() {
    console.log(`🔄 SourceBuffer update completed`);
    
    // Log current buffer state
    if (this.sourceBuffer.buffered.length > 0) {
      console.log(`📊 SourceBuffer has ${this.sourceBuffer.buffered.length} buffered range(s):`);
      for (let i = 0; i < this.sourceBuffer.buffered.length; i++) {
        const start = this.sourceBuffer.buffered.start(i);
        const end = this.sourceBuffer.buffered.end(i);
        console.log(`  Range ${i}: ${start.toFixed(2)}s - ${end.toFixed(2)}s (${(end - start).toFixed(2)}s duration)`);
      }
      
      // Try to trigger video metadata loading if we have buffer data but no duration
      if (!this.videoElement.duration || isNaN(this.videoElement.duration)) {
        console.log('🔄 Triggering video metadata loading...');
        // Force the video element to re-examine the buffered data
        this.videoElement.currentTime = 0;
      }
    } else {
      console.log(`❌ SourceBuffer has no buffered ranges`);
      
      // Check if video element has different buffered ranges
      if (this.videoElement.buffered.length > 0) {
        console.log(`🔍 Video element has ${this.videoElement.buffered.length} buffered range(s) while SourceBuffer has none!`);
        for (let i = 0; i < this.videoElement.buffered.length; i++) {
          const start = this.videoElement.buffered.start(i);
          const end = this.videoElement.buffered.end(i);
          console.log(`  Video Range ${i}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
        }
      }
    }
    
    // Manage buffer size to prevent memory issues
    if (this.sourceBuffer.buffered.length > 0) {
      const currentTime = this.videoElement.currentTime;
      const bufferedStart = this.sourceBuffer.buffered.start(0);
      
      // Remove old buffered data if we have too much
      if (currentTime - bufferedStart > this.maxBufferTime) {
        const removeEnd = currentTime - this.minBufferTime;
        if (removeEnd > bufferedStart) {
          try {
            this.sourceBuffer.remove(bufferedStart, removeEnd);
          } catch (e) {
            console.warn('⚠️ Could not remove old buffer data:', e);
          }
        }
      }
    }
  }
  
  /**
   * Handle seek operations
   */
  handleSeek() {
    if (!this.videoElement) return;
    
    const seekTime = this.videoElement.currentTime;
    console.log(`⏩ Seeking to ${seekTime.toFixed(2)}s`);
    
    // Calculate which chunk we need for this time
    const duration = this.videoElement.duration || 0;
    if (duration > 0) {
      const seekChunk = Math.floor((seekTime / duration) * this.totalChunks);
      
      // Ensure we have chunks around the seek position
      const chunksNeeded = Math.min(3, this.totalChunks - seekChunk);
      for (let i = 0; i < chunksNeeded; i++) {
        if (seekChunk + i < this.totalChunks) {
          this.loadChunk(seekChunk + i);
        }
      }
    }
  }
  
  /**
   * Monitor buffer health
   */
  monitorBufferHealth() {
    if (!this.videoElement) return;
    
    const currentTime = this.videoElement.currentTime;
    const bufferedAhead = this.getBufferedTimeAhead(currentTime);
    
    // Calculate buffer health percentage
    this.stats.bufferHealth = Math.min(100, (bufferedAhead / this.bufferTimeAhead) * 100);
    
    this.emit('buffer-health', {
      health: this.stats.bufferHealth,
      bufferedAhead: bufferedAhead,
      recommended: this.bufferTimeAhead
    });
  }
  
  /**
   * Get buffered time ahead of current playback position
   */
  getBufferedTimeAhead(currentTime) {
    if (!this.videoElement.buffered.length) {
      console.log('🔍 No buffered ranges available');
      return 0;
    }
    
    console.log(`🔍 Buffered ranges: ${this.videoElement.buffered.length}, current time: ${currentTime}`);
    for (let i = 0; i < this.videoElement.buffered.length; i++) {
      const start = this.videoElement.buffered.start(i);
      const end = this.videoElement.buffered.end(i);
      console.log(`  Range ${i}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
      
      if (currentTime >= start && currentTime <= end) {
        const ahead = end - currentTime;
        console.log(`✅ Found matching range, ${ahead.toFixed(2)}s ahead`);
        return ahead;
      }
    }
    
    console.log('❌ Current time not in any buffered range');
    return 0;
  }
  
  /**
   * Get buffered percentage
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
   * Update buffered ranges for monitoring
   */
  updateBufferedRanges() {
    this.bufferedRanges = [];
    if (!this.videoElement.buffered) return;
    
    for (let i = 0; i < this.videoElement.buffered.length; i++) {
      this.bufferedRanges.push({
        start: this.videoElement.buffered.start(i),
        end: this.videoElement.buffered.end(i)
      });
    }
  }
  
  /**
   * Play video
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
  
  /**
   * Pause video
   */
  pause() {
    if (!this.videoElement) return;
    
    this.videoElement.pause();
    this.isPaused = true;
    console.log('⏸️ Playback paused');
  }
  
  /**
   * Seek to specific time
   */
  seek(time) {
    if (!this.videoElement) return;
    
    // Clamp time to valid range
    const clampedTime = Math.max(0, Math.min(this.videoElement.duration || 0, time));
    this.videoElement.currentTime = clampedTime;
    console.log(`⏩ Seeking to ${clampedTime.toFixed(2)}s`);
  }
  
  /**
   * Set playback volume
   */
  setVolume(volume) {
    if (!this.videoElement) return;
    
    this.videoElement.volume = Math.max(0, Math.min(1, volume));
  }
  
  /**
   * Get streaming statistics
   */
  getStats() {
    return {
      ...this.stats,
      isStreaming: this.isStreaming,
      currentChunk: this.currentChunk,
      totalChunks: this.totalChunks,
      bufferedPercent: this.getBufferedPercent(),
      currentTime: this.videoElement?.currentTime || 0,
      duration: this.videoElement?.duration || 0
    };
  }
  
  /**
   * Stop streaming and cleanup
   */
  stop() {
    this.isStreaming = false;
    this.isPaused = false;
    
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
    }
    
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch (e) {
        console.warn('⚠️ Could not end MediaSource stream:', e);
      }
    }
    
    // Cleanup
    this.chunks = [];
    this.currentChunk = 0;
    this.sourceBuffer = null;
    this.mediaSource = null;
    
    console.log('⏹️ Streaming stopped and cleaned up');
  }
  
  /**
   * Event emitter functionality
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
   * Utility: Format bytes
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
export { StreamingManager as default };
