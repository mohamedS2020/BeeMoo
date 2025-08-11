// BeeMoo - Movie File Selector
// Handles video file selection with format validation and upload progress

export class MovieFileSelector {
  constructor(socketClient, onFileSelected) {
    this.socketClient = socketClient;
    this.onFileSelected = onFileSelected; // Callback when file is ready
    this.selectedFile = null;
    this.isUploading = false;
    
    // Supported video formats for browser compatibility
    this.supportedFormats = {
      'video/mp4': { ext: 'mp4', name: 'MP4 (H.264)' },
      'video/webm': { ext: 'webm', name: 'WebM' },
      'video/ogg': { ext: 'ogv', name: 'Ogg Video' },
      'video/quicktime': { ext: 'mov', name: 'QuickTime (limited support)' }
    };
    
    // Maximum file size (1GB)
    this.maxFileSize = 1024 * 1024 * 1024;
  }

  render() {
    return `
      <div class="movie-file-selector" id="movie-file-selector">
        <div class="file-selector-header">
          <h3>Select Movie File</h3>
          <p class="file-selector-desc">Choose a video file to stream to your party</p>
        </div>
        
        <div class="file-input-container">
          <label for="movie-file-input" class="file-input-label">
            <div class="file-input-drop-zone" id="drop-zone">
              <div class="file-input-content">
                <svg class="file-upload-icon" viewBox="0 0 24 24" width="48" height="48">
                  <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                </svg>
                <div class="file-input-text">
                  <span class="file-input-primary">Drop video file here or click to browse</span>
                  <span class="file-input-secondary">Supports MP4, WebM, OGG • Max 1GB</span>
                </div>
              </div>
            </div>
            <input 
              type="file" 
              id="movie-file-input" 
              accept="video/mp4,video/webm,video/ogg,video/quicktime" 
              class="file-input-hidden"
            />
          </label>
        </div>

        <div class="file-validation-info" id="validation-info" style="display: none;">
          <div class="file-info">
            <div class="file-details">
              <span class="file-name" id="file-name"></span>
              <span class="file-meta" id="file-meta"></span>
            </div>
            <div class="file-status" id="file-status"></div>
          </div>
          <div class="file-actions">
            <button type="button" class="btn btn-secondary btn-small" id="clear-file">
              Remove File
            </button>
            <button type="button" class="btn btn-primary" id="start-streaming" disabled>
              Start Streaming
            </button>
          </div>
        </div>

        <div class="upload-progress" id="upload-progress" style="display: none;">
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill" style="width: 0%;"></div>
          </div>
          <div class="progress-text">
            <span id="progress-percent">0%</span>
            <span id="progress-status">Preparing file...</span>
          </div>
        </div>

        <div class="format-support-info">
          <details class="support-details">
            <summary>Supported Video Formats</summary>
            <div class="format-list">
              <div class="format-item recommended">
                <strong>MP4 (H.264)</strong> - Best compatibility, recommended
              </div>
              <div class="format-item">
                <strong>WebM</strong> - Good compression, modern browsers
              </div>
              <div class="format-item">
                <strong>OGG Video</strong> - Open source format
              </div>
              <div class="format-item limited">
                <strong>QuickTime (MOV)</strong> - Limited browser support
              </div>
            </div>
          </details>
        </div>
      </div>
    `;
  }

  mount(container) {
    if (!container) return;
    
    container.innerHTML = this.render();
    this.setupEventListeners();
  }

  setupEventListeners() {
    const fileInput = document.getElementById('movie-file-input');
    const dropZone = document.getElementById('drop-zone');
    const clearBtn = document.getElementById('clear-file');
    const streamBtn = document.getElementById('start-streaming');

    // File input change
    fileInput?.addEventListener('change', (e) => {
      this.handleFileSelection(e.target.files[0]);
    });

    // Drag and drop
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });

    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.handleFileSelection(files[0]);
      }
    });

    // Clear file
    clearBtn?.addEventListener('click', () => {
      this.clearFile();
    });

    // Start streaming
    streamBtn?.addEventListener('click', () => {
      this.startStreaming();
    });
  }

  async handleFileSelection(file) {
    if (!file) return;

    // Reset UI
    this.hideUploadProgress();
    
    // Validate file with advanced checks
    const validation = await this.validateFileAdvanced(file);
    
    if (!validation.valid) {
      this.showValidationError(validation.error);
      return;
    }

    // File is valid
    this.selectedFile = file;
    this.showFileInfo(file);
    this.showValidationInfo();
    
    // Enable streaming button
    const streamBtn = document.getElementById('start-streaming');
    if (streamBtn) {
      streamBtn.disabled = false;
    }

    console.log('✅ File selected:', file.name, this.formatFileSize(file.size));
  }

  validateFile(file) {
    // Check if file exists
    if (!file) {
      return { valid: false, error: 'No file selected' };
    }

    // Check file type
    if (!this.supportedFormats[file.type]) {
      const supportedTypes = Object.values(this.supportedFormats).map(f => f.name).join(', ');
      return { 
        valid: false, 
        error: `Unsupported video format. Please use: ${supportedTypes}` 
      };
    }

    // Check file size
    if (file.size > this.maxFileSize) {
      return { 
        valid: false, 
        error: `File too large. Maximum size is ${this.formatFileSize(this.maxFileSize)}` 
      };
    }

    // Basic validation passed
    return { valid: true };
  }

  async validateFileAdvanced(file) {
    // First do basic validation
    const basicValidation = this.validateFile(file);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    // Check if file is actually a video by reading first few bytes
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = new Uint8Array(e.target.result);
        const isVideo = this.isVideoFile(buffer, file.type);
        
        if (!isVideo) {
          resolve({ valid: false, error: 'File does not appear to be a valid video' });
        } else {
          resolve({ valid: true });
        }
      };
      reader.onerror = () => {
        resolve({ valid: false, error: 'Could not read file' });
      };
      reader.readAsArrayBuffer(file.slice(0, 1024)); // Read first 1KB
    });
  }

  isVideoFile(buffer, mimeType) {
    // Basic file signature validation
    const signatures = {
      'video/mp4': [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], // ftyp box
      'video/webm': [0x1A, 0x45, 0xDF, 0xA3], // EBML header
      'video/ogg': [0x4F, 0x67, 0x67, 0x53], // OggS
    };

    const signature = signatures[mimeType];
    if (!signature) return true; // Unknown format, let browser handle

    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== null && buffer[i] !== signature[i]) {
        return false;
      }
    }
    
    return true;
  }

  showFileInfo(file) {
    const fileName = document.getElementById('file-name');
    const fileMeta = document.getElementById('file-meta');
    const fileStatus = document.getElementById('file-status');

    if (fileName) fileName.textContent = file.name;
    if (fileMeta) {
      const format = this.supportedFormats[file.type];
      fileMeta.textContent = `${format.name} • ${this.formatFileSize(file.size)}`;
    }
    if (fileStatus) {
      fileStatus.innerHTML = '<span class="status-ready">✓ Ready to stream</span>';
    }
  }

  showValidationInfo() {
    const validationInfo = document.getElementById('validation-info');
    if (validationInfo) {
      validationInfo.style.display = 'block';
    }
  }

  showValidationError(error) {
    const fileStatus = document.getElementById('file-status');
    if (fileStatus) {
      fileStatus.innerHTML = `<span class="status-error">✗ ${this.escapeHtml(error)}</span>`;
    }
    this.showValidationInfo();
    
    // Disable streaming button
    const streamBtn = document.getElementById('start-streaming');
    if (streamBtn) {
      streamBtn.disabled = true;
    }
  }

  clearFile() {
    this.selectedFile = null;
    
    // Reset file input
    const fileInput = document.getElementById('movie-file-input');
    if (fileInput) fileInput.value = '';
    
    // Hide validation info
    const validationInfo = document.getElementById('validation-info');
    if (validationInfo) validationInfo.style.display = 'none';
    
    // Hide upload progress
    this.hideUploadProgress();
    
    console.log('📝 File selection cleared');
  }

  async startStreaming() {
    if (!this.selectedFile || this.isUploading) return;

    this.isUploading = true;
    this.showUploadProgress();
    
    try {
      // Simulate upload progress (in real implementation, this would be actual upload)
      await this.simulateUpload();
      
      // Notify parent component that file is ready
      // NOTE: We don't create a blob URL here because we're using MediaSource Extensions
      if (this.onFileSelected) {
        this.onFileSelected({
          file: this.selectedFile,
          type: this.selectedFile.type,
          size: this.selectedFile.size,
          name: this.selectedFile.name
        });
      }
      
      console.log('🎬 Movie streaming started:', this.selectedFile.name);
      
    } catch (error) {
      console.error('❌ Streaming failed:', error);
      this.showValidationError('Failed to start streaming: ' + error.message);
    } finally {
      this.isUploading = false;
      this.hideUploadProgress();
    }
  }

  async simulateUpload() {
    // Simulate chunked upload progress
    const totalChunks = 20;
    
    for (let i = 0; i <= totalChunks; i++) {
      const percent = Math.round((i / totalChunks) * 100);
      this.updateProgress(percent, i === 0 ? 'Preparing file...' : 
                         i === totalChunks ? 'Ready to stream!' : 'Processing...');
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  showUploadProgress() {
    const uploadProgress = document.getElementById('upload-progress');
    if (uploadProgress) {
      uploadProgress.style.display = 'block';
    }
    
    // Disable streaming button during upload
    const streamBtn = document.getElementById('start-streaming');
    if (streamBtn) {
      streamBtn.disabled = true;
      streamBtn.textContent = 'Processing...';
    }
  }

  hideUploadProgress() {
    const uploadProgress = document.getElementById('upload-progress');
    if (uploadProgress) {
      uploadProgress.style.display = 'none';
    }
    
    // Reset streaming button
    const streamBtn = document.getElementById('start-streaming');
    if (streamBtn) {
      streamBtn.disabled = !this.selectedFile;
      streamBtn.textContent = 'Start Streaming';
    }
  }

  updateProgress(percent, status) {
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressStatus = document.getElementById('progress-status');
    
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressStatus) progressStatus.textContent = status;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  destroy() {
    // Clean up any blob URLs
    if (this.selectedFile) {
      this.clearFile();
    }
  }
}
