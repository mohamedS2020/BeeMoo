// BeeMoo - Advanced Video Streaming Utility
// Fixed version with proper MP4 handling and MediaSource compatibility

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
    this.bufferTimeAhead = 30; // Target 30 seconds ahead
    this.maxBufferTime = 60; // Maximum 60 seconds in buffer
    this.minBufferTime = 5; // Minimum 5 seconds before rebuffering
    this.chunks = [];
    this.bufferedRanges = [];
    this.eventListeners = {};
    
    // Metadata loading state
    this.moovFound = false;
    this.moovChunkIndex = -1;
    this.moovAtomInfo = null;
    this.metadataLoadAttempts = 0;
    this.currentMimeType = null;
    this.initSegmentAppended = false;
    
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
      'video/mp4; codecs="avc1.4D401E,mp4a.40.2"', // H.264 Main + AAC
      'video/webm; codecs="vp9,opus"', // VP9 + Opus
      'video/webm; codecs="vp8,vorbis"' // VP8 + Vorbis
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
      this.handleSeek();
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
  
  /**
   * NEW: Optimized streaming approach
   * Instead of trying to reconstruct MP4, we'll use a simpler approach
   */
  async startOptimizedStreaming() {
    if (this.isStreaming) return;
    
    this.isStreaming = true;
    this.currentChunk = 0;
    
    console.log('🚀 Starting optimized streaming...');
    
    // For MP4 files with moov at the end, we need a different strategy
    // Try to load the file in a way that works with MediaSource
    await this.loadWithMoovHandling();
    
    this.emit('ready');
    
    // Continue buffering in background
    this.scheduleBuffering();
  }
  
  /**
   * NEW: Handle MP4 files with moov atom at the end
   */
  async loadWithMoovHandling() {
    console.log('🔍 Analyzing MP4 structure...');
    
    // First, check where the moov atom is located
    const moovLocation = await this.findMoovLocation();
    
    if (moovLocation.found && moovLocation.position === 'end') {
      console.log('📦 Moov atom found at end of file - using range-based loading');
      
      // For files with moov at the end, we need to load it first
      // But since it's too large, we'll use a different approach
      await this.useSimplifiedStreaming();
    } else if (moovLocation.found && moovLocation.position === 'beginning') {
      console.log('📦 Moov atom found at beginning - using progressive loading');
      await this.useProgressiveStreaming();
    } else {
      console.log('⚠️ Moov atom not found - trying simplified approach');
      await this.useSimplifiedStreaming();
    }
  }
  
  /**
   * NEW: Find moov atom location without loading entire chunks
   */
  async findMoovLocation() {
    // Check beginning of file
    const startSample = await this.readFileChunk(0, Math.min(10000, this.file.size));
    if (this.containsAtom(startSample, 'moov')) {
      return { found: true, position: 'beginning' };
    }
    
    // Check end of file
    const endStart = Math.max(0, this.file.size - 2 * 1024 * 1024); // Check last 2MB
    const endSample = await this.readFileChunk(endStart, this.file.size);
    if (this.containsAtom(endSample, 'moov')) {
      return { found: true, position: 'end' };
    }
    
    return { found: false };
  }
  
  /**
   * NEW: Check if a buffer contains a specific atom
   */
  containsAtom(buffer, atomType) {
    const view = new DataView(buffer);
    let offset = 0;
    
    while (offset < buffer.byteLength - 8) {
      try {
        const size = view.getUint32(offset);
        if (size < 8) {
          offset++;
          continue;
        }
        
        const type = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7)
        );
        
        if (type === atomType) {
          return true;
        }
        
        if (size > buffer.byteLength - offset) break;
        offset += size;
      } catch (e) {
        offset++;
      }
    }
    
    return false;
  }
  
  /**
   * NEW: Simplified streaming for problematic files
   */
  async useSimplifiedStreaming() {
    console.log('🔄 Using simplified streaming approach...');
    
    try {
      // For files with moov at the end, we can't stream them traditionally
      // Instead, we'll load the entire file or use a different approach
      
      // Option 1: If file is small enough, load it entirely
      if (this.file.size < 100 * 1024 * 1024) { // Less than 100MB
        console.log('📦 File is small enough - loading entire file');
        await this.loadEntireFile();
      } else {
        // Option 2: Load chunks but handle errors gracefully
        console.log('📦 File is large - using error-tolerant chunked loading');
        await this.loadChunksWithErrorHandling();
      }
    } catch (error) {
      console.error('❌ Simplified streaming failed:', error);
      throw error;
    }
  }
  
  /**
   * NEW: Load entire file for small videos
   */
  async loadEntireFile() {
    console.log('📦 Loading entire file into memory...');
    
    try {
      const fileBuffer = await this.readFileChunk(0, this.file.size);
      
      // Append the entire file to the SourceBuffer
      await this.appendToSourceBuffer(fileBuffer, 'entire-file');
      
      console.log('✅ Entire file loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load entire file:', error);
      
      // Fallback to chunked loading
      await this.loadChunksWithErrorHandling();
    }
  }
  
  /**
   * NEW: Load chunks with better error handling
   */
  async loadChunksWithErrorHandling() {
    console.log('📦 Loading chunks with error handling...');
    
    // First, try to load the file in larger chunks
    const largeChunkSize = 5 * 1024 * 1024; // 5MB chunks
    const numLargeChunks = Math.ceil(this.file.size / largeChunkSize);
    
    for (let i = 0; i < Math.min(3, numLargeChunks); i++) {
      const start = i * largeChunkSize;
      const end = Math.min(start + largeChunkSize, this.file.size);
      
      try {
        const chunk = await this.readFileChunk(start, end);
        
        // Only append if MediaSource is still open
        if (this.mediaSource.readyState === 'open') {
          await this.safeAppendToSourceBuffer(chunk, `large-chunk-${i}`);
        } else {
          console.warn('⚠️ MediaSource not open, stopping chunk loading');
          break;
        }
        
        // Check if we have playable content
        if (this.videoElement.readyState >= 2) { // HAVE_CURRENT_DATA
          console.log('✅ Video has enough data to start playback');
          break;
        }
      } catch (error) {
        console.warn(`⚠️ Failed to load chunk ${i}:`, error);
        
        // If first chunk fails, the file might not be compatible
        if (i === 0) {
          throw new Error('File appears to be incompatible with streaming');
        }
        
        // Otherwise, continue with what we have
        break;
      }
    }
  }
  
  /**
   * NEW: Progressive streaming for files with moov at beginning
   */
  async useProgressiveStreaming() {
    console.log('📦 Using progressive streaming...');
    
    for (let i = 0; i < Math.min(5, this.totalChunks); i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.file.size);
      
      try {
        const chunk = await this.readFileChunk(start, end);
        await this.safeAppendToSourceBuffer(chunk, `chunk-${i}`);
        
        this.currentChunk = i + 1;
        
        // Check if video is ready
        if (this.videoElement.readyState >= 2) {
          console.log('✅ Video ready for playback');
          break;
        }
      } catch (error) {
        console.error(`❌ Failed to load chunk ${i}:`, error);
        break;
      }
    }
  }
  
  /**
   * NEW: Safe append to SourceBuffer with validation
   */
  async safeAppendToSourceBuffer(chunk, chunkId) {
    return new Promise((resolve, reject) => {
      // Validate MediaSource state
      if (!this.mediaSource || this.mediaSource.readyState !== 'open') {
        reject(new Error(`MediaSource not ready: ${this.mediaSource?.readyState}`));
        return;
      }
      
      // Validate SourceBuffer
      if (!this.sourceBuffer) {
        reject(new Error('SourceBuffer not available'));
        return;
      }
      
      if (this.sourceBuffer.updating) {
        // Wait for current update to finish
        const onUpdateEnd = () => {
          this.sourceBuffer.removeEventListener('updateend', onUpdateEnd);
          this.safeAppendToSourceBuffer(chunk, chunkId).then(resolve).catch(reject);
        };
        this.sourceBuffer.addEventListener('updateend', onUpdateEnd);
        return;
      }
      
      console.log(`⬆️ Appending ${chunkId} (${chunk.byteLength} bytes)`);
      
      const onSuccess = () => {
        this.sourceBuffer.removeEventListener('updateend', onSuccess);
        this.sourceBuffer.removeEventListener('error', onError);
        console.log(`✅ ${chunkId} appended successfully`);
        resolve();
      };
      
      const onError = (e) => {
        this.sourceBuffer.removeEventListener('updateend', onSuccess);
        this.sourceBuffer.removeEventListener('error', onError);
        
        // Check if it's a decode error
        if (this.mediaSource.readyState === 'ended') {
          console.warn('⚠️ MediaSource ended due to decode error');
          
          // Try to recover by creating a new MediaSource
          this.recoverFromDecodeError().then(resolve).catch(reject);
        } else {
          reject(new Error(`Failed to append ${chunkId}`));
        }
      };
      
      this.sourceBuffer.addEventListener('updateend', onSuccess);
      this.sourceBuffer.addEventListener('error', onError);
      
      try {
        this.sourceBuffer.appendBuffer(chunk);
      } catch (error) {
        console.error(`❌ Exception appending ${chunkId}:`, error);
        reject(error);
      }
    });
  }
  
  /**
   * NEW: Recover from decode errors
   */
  async recoverFromDecodeError() {
    console.log('🔄 Attempting to recover from decode error...');
    
    // For files with moov at the end, we can't use MediaSource
    // Fall back to direct blob URL
    console.log('📦 Falling back to direct blob URL streaming');
    
    const blob = new Blob([this.file], { type: this.file.type || 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    
    this.videoElement.src = blobUrl;
    
    // Wait for metadata to load
    return new Promise((resolve) => {
      const onLoadedMetadata = () => {
        this.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        console.log('✅ Direct blob URL streaming ready');
        resolve();
      };
      
      const onError = () => {
        this.videoElement.removeEventListener('error', onError);
        console.error('❌ Direct blob URL streaming also failed');
        resolve(); // Resolve anyway to prevent hanging
      };
      
      this.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      this.videoElement.addEventListener('error', onError);
    });
  }
  
  async readFileChunk(start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this.file.slice(start, end));
    });
  }
  
  async appendToSourceBuffer(chunk, chunkIndex) {
    return this.safeAppendToSourceBuffer(chunk, chunkIndex);
  }
  
  scheduleBuffering() {
    if (!this.isStreaming || !this.videoElement) return;
    
    const currentTime = this.videoElement.currentTime;
    const bufferedAhead = this.getBufferedTimeAhead(currentTime);
    
    // Only buffer more if needed
    if (bufferedAhead < this.bufferTimeAhead && this.currentChunk < this.totalChunks) {
      const start = this.currentChunk * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.file.size);
      
      this.readFileChunk(start, end).then(chunk => {
        return this.safeAppendToSourceBuffer(chunk, `chunk-${this.currentChunk}`);
      }).then(() => {
        this.currentChunk++;
      }).catch(error => {
        console.warn(`⚠️ Failed to buffer chunk ${this.currentChunk}:`, error);
      });
    }
    
    // Schedule next check
    setTimeout(() => this.scheduleBuffering(), 1000);
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
      
      // Load chunks around seek position
      for (let i = Math.max(0, seekChunk - 1); i <= Math.min(seekChunk + 1, this.totalChunks - 1); i++) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, this.file.size);
        
        this.readFileChunk(start, end).then(chunk => {
          return this.safeAppendToSourceBuffer(chunk, `seek-chunk-${i}`);
        }).catch(error => {
          console.warn(`⚠️ Failed to load seek chunk ${i}:`, error);
        });
      }
    }
  }
  
  monitorBufferHealth() {
    if (!this.videoElement) return;
    
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
      duration: this.videoElement?.duration || 0
    };
  }
  
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
    
    // Reset metadata tracking
    this.moovFound = false;
    this.moovChunkIndex = -1;
    this.moovAtomInfo = null;
    this.metadataLoadAttempts = 0;
    this.currentMimeType = null;
    this.isReconstructing = false;
    
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
