// BeeMoo - Advanced Video Streaming Utility
// Fixed version with better error handling and large file support

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
    this.bufferTimeAhead = 30;
    this.maxBufferTime = 60;
    this.minBufferTime = 5;
    this.chunks = [];
    this.bufferedRanges = [];
    this.eventListeners = {};
    
    // Buffer management
    this.appendQueue = [];
    this.isAppending = false;
    this.bufferSchedulerActive = false;
    
    // Fallback mode flag
    this.useFallbackMode = false;
    
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
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4; codecs="avc1.64001E,mp4a.40.2"',
      'video/mp4; codecs="avc1.4D401E,mp4a.40.2"',
      'video/webm; codecs="vp9,opus"',
      'video/webm; codecs="vp8,vorbis"'
    ];
    
    this.initializeCapabilities();
  }
  
  initializeCapabilities() {
    this.capabilities = {
      mseSupported: this.checkMSESupport(),
      supportedMimeTypes: this.getSupportedMimeTypes(),
      maxSourceBuffers: this.getMaxSourceBuffers()
    };
    
    console.log('🎬 Streaming capabilities:', this.capabilities);
  }
  
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
  
  getSupportedMimeTypes() {
    return this.supportedTypes.filter(type => MediaSource.isTypeSupported(type));
  }
  
  getMaxSourceBuffers() {
    try {
      const mediaSource = new MediaSource();
      return mediaSource.sourceBuffers.length || 16;
    } catch (e) {
      return 1;
    }
  }
  
  async initializeStreaming(file, videoElement, options = {}) {
    // For files over 100MB, use fallback mode immediately
    if (file.size > 100 * 1024 * 1024) {
      console.log('📦 Large file detected, using fallback streaming mode');
      return this.initializeFallbackStreaming(file, videoElement, options);
    }
    
    if (!this.capabilities.mseSupported) {
      throw new Error('Media Source Extensions not supported in this browser');
    }
    
    this.file = file;
    this.videoElement = videoElement;
    this.chunkSize = options.chunkSize || this.chunkSize;
    this.bufferTimeAhead = options.bufferTimeAhead || this.bufferTimeAhead;
    
    // Detect and validate MIME type
    const mimeType = await this.detectMimeType(file);
    this.currentMimeType = mimeType;
    
    if (!this.capabilities.supportedMimeTypes.includes(mimeType)) {
      console.warn(`⚠️ Unsupported format ${mimeType}, trying fallback mode`);
      return this.initializeFallbackStreaming(file, videoElement, options);
    }
    
    // Calculate chunks
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    console.log(`🎬 Initializing streaming: ${this.totalChunks} chunks of ${this.formatBytes(this.chunkSize)}`);
    
    try {
      // Create and setup MediaSource
      this.mediaSource = new MediaSource();
      this.setupMediaSourceEvents();
      
      // Set video source to MediaSource object URL
      const objectURL = URL.createObjectURL(this.mediaSource);
      this.videoElement.src = objectURL;
      
      console.log(`📺 Video source set: ${objectURL}`);
      
      // Setup video element events
      this.setupVideoEvents();
      
      return new Promise((resolve, reject) => {
        this.mediaSource.addEventListener('sourceopen', async () => {
          try {
            await this.initializeSourceBuffer(mimeType);
            await this.startOptimizedStreaming();
            resolve({
              duration: this.videoElement.duration,
              totalChunks: this.totalChunks,
              chunkSize: this.chunkSize,
              mimeType: mimeType,
              mode: 'mse'
            });
          } catch (error) {
            console.error('❌ MSE initialization failed, switching to fallback:', error);
            // Switch to fallback mode
            this.cleanup();
            const result = await this.initializeFallbackStreaming(file, videoElement, options);
            resolve(result);
          }
        }, { once: true });
        
        this.mediaSource.addEventListener('error', async () => {
          console.error('❌ MediaSource error, switching to fallback mode');
          this.cleanup();
          const result = await this.initializeFallbackStreaming(file, videoElement, options);
          resolve(result);
        }, { once: true });
      });
    } catch (error) {
      console.error('❌ Failed to initialize MSE, using fallback:', error);
      return this.initializeFallbackStreaming(file, videoElement, options);
    }
  }
  
  async initializeFallbackStreaming(file, videoElement, options = {}) {
    console.log('🔄 Initializing fallback streaming mode');
    
    this.file = file;
    this.videoElement = videoElement;
    this.useFallbackMode = true;
    
    // Create a blob URL for the entire file
    const blob = new Blob([file], { type: file.type || 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    
    // Setup video events before setting source
    this.setupVideoEvents();
    
    // Set the video source
    this.videoElement.src = blobUrl;
    
    // Wait for metadata to load
    return new Promise((resolve) => {
      const onLoadedMetadata = () => {
        this.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        console.log('✅ Fallback streaming ready');
        
        this.isStreaming = true;
        this.emit('ready');
        
        resolve({
          duration: this.videoElement.duration,
          totalChunks: 1,
          chunkSize: file.size,
          mimeType: file.type || 'video/mp4',
          mode: 'fallback'
        });
      };
      
      const onError = (e) => {
        this.videoElement.removeEventListener('error', onError);
        console.error('❌ Fallback streaming also failed:', e);
        
        // Last resort: let the browser handle it directly
        resolve({
          duration: 0,
          totalChunks: 1,
          chunkSize: file.size,
          mimeType: file.type || 'video/mp4',
          mode: 'direct',
          error: 'Video format not supported'
        });
      };
      
      this.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      this.videoElement.addEventListener('error', onError);
      
      // Timeout fallback
      setTimeout(() => {
        if (!this.isStreaming) {
          console.warn('⚠️ Metadata loading timeout, continuing anyway');
          onLoadedMetadata();
        }
      }, 5000);
    });
  }
  
  async detectMimeType(file) {
    // Check if it's an unsupported format
    const unsupportedFormats = ['video/avi', 'video/wmv', 'video/flv'];
    if (file.type && unsupportedFormats.includes(file.type)) {
      throw new Error('Unsupported video format');
    }
    
    // Start with file.type if available
    if (file.type && this.capabilities.supportedMimeTypes.includes(file.type)) {
      return file.type;
    }
    
    // Read file header to detect format
    const header = await this.readFileHeader(file, 64);
    
    // MP4 detection
    if (this.isMP4Header(header)) {
      // Try different codec combinations
      const codecCombos = [
        'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
        'video/mp4; codecs="avc1.4D401E,mp4a.40.2"',
        'video/mp4; codecs="avc1.64001E,mp4a.40.2"'
      ];
      
      for (const codec of codecCombos) {
        if (MediaSource.isTypeSupported(codec)) {
          return codec;
        }
      }
    }
    
    // WebM detection
    if (this.isWebMHeader(header)) {
      return 'video/webm; codecs="vp9,opus"';
    }
    
    // Default fallback
    return 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
  }
  
  async readFileHeader(file, bytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(0, bytes));
    });
  }
  
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
  
  isWebMHeader(header) {
    return header[0] === 0x1A && header[1] === 0x45 && 
           header[2] === 0xDF && header[3] === 0xA3;
  }
  
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
  
  setupVideoEvents() {
    this.videoElement.addEventListener('progress', () => {
      this.updateBufferedRanges();
      this.monitorBufferHealth();
    });
    
    this.videoElement.addEventListener('loadedmetadata', () => {
      console.log(`📊 Video metadata loaded - Duration: ${this.videoElement.duration}s`);
      this.emit('metadata-loaded', {
        duration: this.videoElement.duration,
        videoWidth: this.videoElement.videoWidth,
        videoHeight: this.videoElement.videoHeight
      });
    });
    
    this.videoElement.addEventListener('waiting', () => {
      console.log('⏳ Video waiting for data');
      this.stats.stallCount++;
      this.emit('buffering', true);
    });
    
    this.videoElement.addEventListener('playing', () => {
      console.log('▶️ Video playing');
      this.emit('buffering', false);
    });
    
    this.videoElement.addEventListener('seeking', () => {
      this.stats.seekCount++;
      if (!this.useFallbackMode) {
        this.handleSeek();
      }
    });
    
    this.videoElement.addEventListener('error', (e) => {
      console.error('❌ Video error:', e);
      this.emit('error', e);
    });
    
    this.videoElement.addEventListener('timeupdate', () => {
      this.emit('timeupdate', {
        currentTime: this.videoElement.currentTime,
        duration: this.videoElement.duration,
        buffered: this.getBufferedPercent()
      });
    });
  }
  
  async initializeSourceBuffer(mimeType) {
    try {
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
      
      this.sourceBuffer.addEventListener('updateend', () => {
        this.isAppending = false;
        this.processAppendQueue();
        this.handleBufferUpdate();
      });
      
      this.sourceBuffer.addEventListener('error', (e) => {
        console.error('❌ SourceBuffer error:', e);
        this.handleSourceBufferError(e);
      });
      
      console.log(`📺 SourceBuffer initialized with ${mimeType}`);
    } catch (error) {
      throw new Error(`Failed to initialize SourceBuffer: ${error.message}`);
    }
  }
  
  async startOptimizedStreaming() {
    if (this.isStreaming) return;
    
    this.isStreaming = true;
    this.currentChunk = 0;
    this.bufferSchedulerActive = true;
    
    console.log('🚀 Starting optimized streaming...');
    
    try {
      // Load initial chunks
      await this.loadInitialChunks();
      
      this.emit('ready');
      
      // Start background buffering
      this.startBufferScheduler();
    } catch (error) {
      console.error('❌ Failed to start streaming:', error);
      throw error;
    }
  }
  
  async loadInitialChunks() {
    console.log('📦 Loading initial chunks...');
    
    // Load first few chunks to start playback
    const initialChunks = Math.min(3, this.totalChunks);
    
    for (let i = 0; i < initialChunks; i++) {
      try {
        const chunk = await this.loadChunk(i);
        await this.queueAppend(chunk, `initial-chunk-${i}`);
        this.currentChunk = i + 1;
        
        // Check if video is ready after first chunk
        if (i === 0 && this.videoElement.readyState >= 2) {
          console.log('✅ Video ready for playback');
          break;
        }
      } catch (error) {
        console.error(`❌ Failed to load initial chunk ${i}:`, error);
        
        // If first chunk fails, we can't continue with MSE
        if (i === 0) {
          throw new Error('Failed to load initial video data');
        }
        
        // Otherwise, try to continue with what we have
        break;
      }
    }
  }
  
  async loadChunk(chunkIndex) {
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.stats.chunksLoaded++;
        resolve(e.target.result);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(this.file.slice(start, end));
    });
  }
  
  async queueAppend(data, chunkId) {
    return new Promise((resolve, reject) => {
      this.appendQueue.push({
        data,
        chunkId,
        resolve,
        reject
      });
      
      this.processAppendQueue();
    });
  }
  
  processAppendQueue() {
    if (this.isAppending || this.appendQueue.length === 0) return;
    if (!this.sourceBuffer || this.sourceBuffer.updating) return;
    if (!this.mediaSource || this.mediaSource.readyState !== 'open') return;
    
    const item = this.appendQueue.shift();
    this.isAppending = true;
    
    try {
      console.log(`⬆️ Appending ${item.chunkId} (${item.data.byteLength} bytes)`);
      this.sourceBuffer.appendBuffer(item.data);
      
      // Resolve will be called in updateend event
      this.sourceBuffer.addEventListener('updateend', () => {
        console.log(`✅ ${item.chunkId} appended successfully`);
        item.resolve();
      }, { once: true });
      
      this.sourceBuffer.addEventListener('error', (e) => {
        console.error(`❌ Failed to append ${item.chunkId}:`, e);
        item.reject(new Error(`Failed to append ${item.chunkId}`));
      }, { once: true });
      
    } catch (error) {
      console.error(`❌ Exception appending ${item.chunkId}:`, error);
      this.isAppending = false;
      item.reject(error);
      
      // Clear the queue on critical errors
      if (this.mediaSource.readyState !== 'open') {
        this.appendQueue.forEach(item => item.reject(new Error('MediaSource closed')));
        this.appendQueue = [];
        this.bufferSchedulerActive = false;
      }
    }
  }
  
  startBufferScheduler() {
    if (!this.bufferSchedulerActive) return;
    
    const scheduleNext = () => {
      if (!this.bufferSchedulerActive || !this.isStreaming) return;
      
      this.checkAndBufferNext().then(() => {
        if (this.bufferSchedulerActive) {
          setTimeout(scheduleNext, 1000);
        }
      }).catch(error => {
        console.warn('⚠️ Buffer scheduler error:', error);
        if (this.bufferSchedulerActive) {
          setTimeout(scheduleNext, 2000);
        }
      });
    };
    
    scheduleNext();
  }
  
  async checkAndBufferNext() {
    if (!this.videoElement || this.useFallbackMode) return;
    if (!this.mediaSource || this.mediaSource.readyState !== 'open') return;
    if (this.currentChunk >= this.totalChunks) return;
    
    const currentTime = this.videoElement.currentTime;
    const bufferedAhead = this.getBufferedTimeAhead(currentTime);
    
    // Only buffer more if needed
    if (bufferedAhead < this.bufferTimeAhead) {
      try {
        const chunk = await this.loadChunk(this.currentChunk);
        await this.queueAppend(chunk, `chunk-${this.currentChunk}`);
        this.currentChunk++;
      } catch (error) {
        console.warn(`⚠️ Failed to buffer chunk ${this.currentChunk}:`, error);
      }
    }
  }
  
  handleBufferUpdate() {
    // Check buffer status
    if (this.sourceBuffer && this.sourceBuffer.buffered.length > 0) {
      const ranges = [];
      for (let i = 0; i < this.sourceBuffer.buffered.length; i++) {
        ranges.push({
          start: this.sourceBuffer.buffered.start(i),
          end: this.sourceBuffer.buffered.end(i)
        });
      }
      console.log('📊 Buffer ranges:', ranges);
    }
  }
  
  handleSourceBufferError(error) {
    console.error('🔄 Handling SourceBuffer error:', error);
    
    // Stop buffering to prevent further errors
    this.bufferSchedulerActive = false;
    this.appendQueue = [];
    
    // Try to recover
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch (e) {
        console.warn('⚠️ Could not end stream:', e);
      }
    }
    
    // Emit error for UI handling
    this.emit('error', new Error('Streaming error occurred'));
  }
  
  handleSeek() {
    const seekTime = this.videoElement.currentTime;
    console.log(`⏩ Seeking to ${seekTime.toFixed(2)}s`);
    
    // Calculate which chunk we need
    const duration = this.videoElement.duration || 0;
    if (duration > 0) {
      const seekChunk = Math.floor((seekTime / duration) * this.totalChunks);
      
      // Update current chunk position
      this.currentChunk = Math.max(seekChunk, this.currentChunk);
    }
  }
  
  monitorBufferHealth() {
    if (!this.videoElement || this.useFallbackMode) return;
    
    const currentTime = this.videoElement.currentTime;
    const bufferedAhead = this.getBufferedTimeAhead(currentTime);
    
    this.stats.bufferHealth = Math.min(100, (bufferedAhead / this.bufferTimeAhead) * 100);
    
    this.emit('buffer-health', {
      health: this.stats.bufferHealth,
      bufferedAhead: bufferedAhead,
      recommended: this.bufferTimeAhead
    });
  }
  
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
  
  getBufferedPercent() {
    if (!this.videoElement.buffered.length || !this.videoElement.duration) return 0;
    
    let bufferedTime = 0;
    for (let i = 0; i < this.videoElement.buffered.length; i++) {
      bufferedTime += this.videoElement.buffered.end(i) - this.videoElement.buffered.start(i);
    }
    
    return (bufferedTime / this.videoElement.duration) * 100;
  }
  
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
  
  getStats() {
    return {
      ...this.stats,
      isStreaming: this.isStreaming,
      currentChunk: this.currentChunk,
      totalChunks: this.totalChunks,
      bufferedPercent: this.getBufferedPercent(),
      currentTime: this.videoElement?.currentTime || 0,
      duration: this.videoElement?.duration || 0,
      mode: this.useFallbackMode ? 'fallback' : 'mse'
    };
  }
  
  cleanup() {
    // Stop buffer scheduler
    this.bufferSchedulerActive = false;
    
    // Clear append queue
    this.appendQueue.forEach(item => item.reject(new Error('Streaming stopped')));
    this.appendQueue = [];
    
    // Close MediaSource if open
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch (e) {
        console.warn('⚠️ Could not end MediaSource stream:', e);
      }
    }
    
    // Clear references
    this.sourceBuffer = null;
    this.mediaSource = null;
  }
  
  stop() {
    this.isStreaming = false;
    this.isPaused = false;
    this.bufferSchedulerActive = false;
    
    if (this.videoElement) {
      this.videoElement.pause();
      
      // Revoke blob URL if in fallback mode
      if (this.useFallbackMode && this.videoElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.videoElement.src);
      }
      
      this.videoElement.src = '';
    }
    
    this.cleanup();
    
    // Reset state
    this.chunks = [];
    this.currentChunk = 0;
    this.useFallbackMode = false;
    
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