import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MovieFileSelector } from '../js/components/MovieFileSelector.js';

describe('MovieFileSelector Component', () => {
  let movieFileSelector;
  let mockSocketClient;
  let mockCallback;
  let container;

  beforeEach(() => {
    // Mock socket client
    mockSocketClient = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    // Mock callback
    mockCallback = vi.fn();

    // Create container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Create component
    movieFileSelector = new MovieFileSelector(mockSocketClient, mockCallback);
  });

  afterEach(() => {
    if (movieFileSelector) {
      movieFileSelector.destroy();
    }
    if (container) {
      container.remove();
    }
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(movieFileSelector.socketClient).toBe(mockSocketClient);
      expect(movieFileSelector.onFileSelected).toBe(mockCallback);
      expect(movieFileSelector.selectedFile).toBe(null);
      expect(movieFileSelector.isUploading).toBe(false);
      expect(movieFileSelector.maxFileSize).toBe(1024 * 1024 * 1024); // 1GB
    });

    it('should have supported formats defined', () => {
      expect(movieFileSelector.supportedFormats).toEqual({
        'video/mp4': { ext: 'mp4', name: 'MP4 (H.264)' },
        'video/webm': { ext: 'webm', name: 'WebM' },
        'video/ogg': { ext: 'ogv', name: 'Ogg Video' },
        'video/quicktime': { ext: 'mov', name: 'QuickTime (limited support)' }
      });
    });
  });

  describe('render()', () => {
    it('should return proper HTML structure', () => {
      const html = movieFileSelector.render();
      
      expect(html).toContain('movie-file-selector');
      expect(html).toContain('Select Movie File');
      expect(html).toContain('Drop video file here or click to browse');
      expect(html).toContain('Supports MP4, WebM, OGG • Max 1GB');
      expect(html).toContain('type="file"');
      expect(html).toContain('accept="video/mp4,video/webm,video/ogg,video/quicktime"');
    });

    it('should include format support information', () => {
      const html = movieFileSelector.render();
      
      expect(html).toContain('Supported Video Formats');
      expect(html).toContain('MP4 (H.264)');
      expect(html).toContain('WebM');
      expect(html).toContain('OGG Video');
      expect(html).toContain('QuickTime (MOV)');
    });
  });

  describe('mount()', () => {
    it('should mount component to container', () => {
      movieFileSelector.mount(container);
      
      expect(container.innerHTML).toContain('movie-file-selector');
      expect(container.querySelector('#movie-file-input')).toBeDefined();
      expect(container.querySelector('#drop-zone')).toBeDefined();
    });

    it('should not mount if no container provided', () => {
      movieFileSelector.mount(null);
      expect(container.innerHTML).toBe('');
    });
  });

  describe('validateFile()', () => {
    it('should accept valid MP4 file', () => {
      const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      const result = movieFileSelector.validateFile(file);
      
      expect(result.valid).toBe(true);
    });

    it('should reject unsupported file type', () => {
      const file = new File(['test'], 'test.avi', { type: 'video/avi' });
      const result = movieFileSelector.validateFile(file);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported video format');
    });

    it('should reject files that are too large', () => {
      // Create a mock file object with large size
      const file = new File(['test'], 'large.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { 
        value: 1.5 * 1024 * 1024 * 1024, // 1.5GB
        writable: false 
      });
      
      const result = movieFileSelector.validateFile(file);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('File too large');
    });

    it('should reject null/undefined file', () => {
      const result = movieFileSelector.validateFile(null);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No file selected');
    });
  });

  describe('validateFileAdvanced()', () => {
    it('should perform advanced validation with file signature check', async () => {
      const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      
      // Mock FileReader for signature validation
      const mockFileReader = {
        onload: null,
        onerror: null,
        readAsArrayBuffer: vi.fn(function() {
          // Simulate successful read with MP4 signature
          const mp4Header = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
          setTimeout(() => {
            this.onload({ target: { result: mp4Header.buffer } });
          }, 0);
        })
      };
      
      global.FileReader = vi.fn(() => mockFileReader);
      
      const result = await movieFileSelector.validateFileAdvanced(file);
      
      expect(result.valid).toBe(true);
    });

    it('should reject files that fail basic validation', async () => {
      const file = new File(['test'], 'test.avi', { type: 'video/avi' });
      
      const result = await movieFileSelector.validateFileAdvanced(file);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported video format');
    });
  });

  describe('formatFileSize()', () => {
    it('should format bytes correctly', () => {
      expect(movieFileSelector.formatFileSize(0)).toBe('0 Bytes');
      expect(movieFileSelector.formatFileSize(1024)).toBe('1 KB');
      expect(movieFileSelector.formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(movieFileSelector.formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should handle decimal places', () => {
      expect(movieFileSelector.formatFileSize(1536)).toBe('1.5 KB'); // 1.5 KB
      expect(movieFileSelector.formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
    });
  });

  describe('handleFileSelection()', () => {
    beforeEach(() => {
      movieFileSelector.mount(container);
    });

    it('should handle valid file selection', async () => {
      const file = new File(['test content'], 'test.mp4', { type: 'video/mp4' });
      
      await movieFileSelector.handleFileSelection(file);
      
      expect(movieFileSelector.selectedFile).toBe(file);
    });

    it('should handle null file', () => {
      movieFileSelector.handleFileSelection(null);
      
      expect(movieFileSelector.selectedFile).toBe(null);
    });
  });

  describe('clearFile()', () => {
    beforeEach(() => {
      movieFileSelector.mount(container);
      const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      movieFileSelector.selectedFile = file;
    });

    it('should clear selected file', () => {
      movieFileSelector.clearFile();
      
      expect(movieFileSelector.selectedFile).toBe(null);
    });

    it('should reset file input value', () => {
      movieFileSelector.clearFile();
      
      const fileInput = container.querySelector('#movie-file-input');
      expect(fileInput.value).toBe('');
    });

    it('should hide validation info', () => {
      movieFileSelector.clearFile();
      
      const validationInfo = container.querySelector('#validation-info');
      expect(validationInfo.style.display).toBe('none');
    });
  });

  describe('startStreaming()', () => {
    beforeEach(() => {
      movieFileSelector.mount(container);
    });

    it('should not start if no file selected', async () => {
      await movieFileSelector.startStreaming();
      
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should not start if already uploading', async () => {
      const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      movieFileSelector.selectedFile = file;
      movieFileSelector.isUploading = true;
      
      await movieFileSelector.startStreaming();
      
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should call callback with file data when successful', async () => {
      const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      movieFileSelector.selectedFile = file;
      
      // Mock URL.createObjectURL
      const mockUrl = 'blob:http://localhost/test';
      global.URL.createObjectURL = vi.fn(() => mockUrl);
      
      await movieFileSelector.startStreaming();
      
      expect(mockCallback).toHaveBeenCalledWith({
        file: file,
        url: mockUrl,
        type: file.type,
        size: file.size,
        name: file.name
      });
      
      expect(movieFileSelector.isUploading).toBe(false);
    });
  });

  describe('escapeHtml()', () => {
    it('should escape HTML entities', () => {
      const input = '<script>alert("xss")</script>';
      const output = movieFileSelector.escapeHtml(input);
      
      expect(output).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should handle special characters', () => {
      expect(movieFileSelector.escapeHtml('&')).toBe('&amp;');
      expect(movieFileSelector.escapeHtml('<')).toBe('&lt;');
      expect(movieFileSelector.escapeHtml('>')).toBe('&gt;');
      expect(movieFileSelector.escapeHtml('"')).toBe('&quot;');
      expect(movieFileSelector.escapeHtml("'")).toBe('&#039;');
    });
  });

  describe('destroy()', () => {
    it('should clean up resources', () => {
      const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      movieFileSelector.selectedFile = file;
      
      movieFileSelector.destroy();
      
      expect(movieFileSelector.selectedFile).toBe(null);
    });
  });

  describe('File Signature Validation', () => {
    it('should validate MP4 file signature', () => {
      const mp4Header = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
      const result = movieFileSelector.isVideoFile(mp4Header, 'video/mp4');
      
      expect(result).toBe(true);
    });

    it('should validate WebM file signature', () => {
      const webmHeader = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]);
      const result = movieFileSelector.isVideoFile(webmHeader, 'video/webm');
      
      expect(result).toBe(true);
    });

    it('should validate OGG file signature', () => {
      const oggHeader = new Uint8Array([0x4F, 0x67, 0x67, 0x53]);
      const result = movieFileSelector.isVideoFile(oggHeader, 'video/ogg');
      
      expect(result).toBe(true);
    });

    it('should return true for unknown formats', () => {
      const unknownHeader = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const result = movieFileSelector.isVideoFile(unknownHeader, 'video/unknown');
      
      expect(result).toBe(true); // Let browser handle unknown formats
    });

    it('should return false for invalid MP4 signature', () => {
      const invalidHeader = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
      const result = movieFileSelector.isVideoFile(invalidHeader, 'video/mp4');
      
      expect(result).toBe(false);
    });
  });
});
