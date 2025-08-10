import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamingManager } from '../js/utils/streaming.js';

// Increase timeout for these tests
const testTimeout = 15000;

// Mock MediaSource and related APIs
global.MediaSource = vi.fn().mockImplementation(() => {
  const mockMediaSource = {
    sourceBuffers: [],
    readyState: 'closed',
    addEventListener: vi.fn((event, callback) => {
      if (event === 'sourceopen') {
        // Trigger sourceopen event immediately for tests
        setTimeout(() => {
          mockMediaSource.readyState = 'open';
          callback();
        }, 0);
      }
    }),
    removeEventListener: vi.fn(),
    addSourceBuffer: vi.fn(() => ({
      addEventListener: vi.fn((event, callback) => {
        if (event === 'updateend') {
          // Trigger updateend event immediately
          setTimeout(() => callback(), 0);
        }
      }),
      appendBuffer: vi.fn(),
      remove: vi.fn(),
      updating: false,
      buffered: {
        length: 1,
        start: vi.fn(() => 0),
        end: vi.fn(() => 30)
      }
    })),
    endOfStream: vi.fn()
  };
  return mockMediaSource;
});

global.MediaSource.isTypeSupported = vi.fn((type) => {
  return type.includes('mp4') || type.includes('webm');
});

global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock FileReader
global.FileReader = vi.fn().mockImplementation(() => ({
  onload: null,
  onerror: null,
  readAsArrayBuffer: vi.fn(function() {
    // Simulate MP4 header
    const mockBuffer = new ArrayBuffer(64);
    const mockArray = new Uint8Array(mockBuffer);
    mockArray[4] = 0x66; // 'f'
    mockArray[5] = 0x74; // 't'
    mockArray[6] = 0x79; // 'y'
    mockArray[7] = 0x70; // 'p'
    
    setTimeout(() => {
      if (this.onload) {
        this.onload({ target: { result: mockBuffer } });
      }
    }, 0);
  })
}));

describe('StreamingManager', () => {
  let streamingManager;
  let mockVideoElement;
  let mockFile;

  beforeEach(() => {
    streamingManager = new StreamingManager();
    
    // Mock video element
    mockVideoElement = {
      src: '',
      duration: 120, // 2 minutes
      currentTime: 0,
      buffered: {
        length: 1,
        start: vi.fn(() => 0),
        end: vi.fn(() => 30)
      },
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      volume: 1,
      muted: false
    };
    
    // Mock file
    mockFile = new File(['test content'], 'test-movie.mp4', {
      type: 'video/mp4'
    });
    Object.defineProperty(mockFile, 'size', {
      value: 10 * 1024 * 1024, // 10MB
      writable: false
    });
  });

  afterEach(() => {
    if (streamingManager) {
      streamingManager.stop();
    }
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with correct default values', () => {
      expect(streamingManager.mediaSource).toBe(null);
      expect(streamingManager.sourceBuffer).toBe(null);
      expect(streamingManager.isStreaming).toBe(false);
      expect(streamingManager.chunkSize).toBe(1024 * 1024); // 1MB
      expect(streamingManager.bufferTimeAhead).toBe(30);
    });

    it('should check MSE support', () => {
      const capabilities = streamingManager.capabilities;
      expect(capabilities.mseSupported).toBe(true);
      expect(capabilities.supportedMimeTypes).toContain('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
    });

    it('should detect supported MIME types', () => {
      const supportedTypes = streamingManager.getSupportedMimeTypes();
      expect(supportedTypes.length).toBeGreaterThan(0);
      expect(supportedTypes).toEqual(
        expect.arrayContaining([
          expect.stringContaining('video/mp4'),
          expect.stringContaining('video/webm')
        ])
      );
    });
  });

  describe('File Format Detection', () => {
    it('should detect MP4 format from file header', async () => {
      const mimeType = await streamingManager.detectMimeType(mockFile);
      expect(mimeType).toContain('video/mp4');
    });

    it('should validate MP4 header signature', () => {
      // Create header with 'ftyp' signature at the right position
      const mp4Header = new Uint8Array(64);
      mp4Header[4] = 0x66; // 'f'
      mp4Header[5] = 0x74; // 't'
      mp4Header[6] = 0x79; // 'y'
      mp4Header[7] = 0x70; // 'p'
      
      const isValid = streamingManager.isMP4Header(mp4Header);
      expect(isValid).toBe(true);
    });

    it('should validate WebM header signature', () => {
      const webmHeader = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]);
      const isValid = streamingManager.isWebMHeader(webmHeader);
      expect(isValid).toBe(true);
    });

    it('should reject invalid MP4 header', () => {
      const invalidHeader = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
      const isValid = streamingManager.isMP4Header(invalidHeader);
      expect(isValid).toBe(false);
    });
  });

  describe('Streaming Initialization', () => {
    it('should initialize streaming successfully', async () => {
      const result = await streamingManager.initializeStreaming(
        mockFile,
        mockVideoElement,
        { chunkSize: 512 * 1024 }
      );

      expect(result).toEqual({
        duration: 120,
        totalChunks: expect.any(Number),
        chunkSize: 512 * 1024,
        mimeType: expect.stringContaining('video/mp4')
      });
      expect(streamingManager.file).toBe(mockFile);
      expect(streamingManager.videoElement).toBe(mockVideoElement);
    }, testTimeout);

    it('should reject unsupported file formats', async () => {
      const unsupportedFile = new File(['test'], 'test.avi', { type: 'video/avi' });
      
      await expect(
        streamingManager.initializeStreaming(unsupportedFile, mockVideoElement)
      ).rejects.toThrow('Unsupported video format');
    });

    it('should reject when MSE is not supported', async () => {
      streamingManager.capabilities.mseSupported = false;
      
      await expect(
        streamingManager.initializeStreaming(mockFile, mockVideoElement)
      ).rejects.toThrow('Media Source Extensions not supported');
    });

    it('should calculate correct number of chunks', async () => {
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
      
      const expectedChunks = Math.ceil(mockFile.size / streamingManager.chunkSize);
      expect(streamingManager.totalChunks).toBe(expectedChunks);
    });
  });

  describe('Chunk Management', () => {
    beforeEach(async () => {
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
    });

    it('should calculate optimal chunk size based on file size', () => {
      // This test doesn't need to wait for initialization
      const streamingManagerTest = new StreamingManager();
      
      // Small file (< 50MB)
      expect(streamingManagerTest.calculateOptimalChunkSize(30 * 1024 * 1024)).toBe(512 * 1024);
      
      // Medium file (< 200MB)
      expect(streamingManagerTest.calculateOptimalChunkSize(100 * 1024 * 1024)).toBe(1024 * 1024);
      
      // Large file (< 1GB)
      expect(streamingManagerTest.calculateOptimalChunkSize(500 * 1024 * 1024)).toBe(2 * 1024 * 1024);
      
      // Very large file (> 1GB)
      expect(streamingManagerTest.calculateOptimalChunkSize(2 * 1024 * 1024 * 1024)).toBe(4 * 1024 * 1024);
    });

    it('should not load the same chunk twice', async () => {
      const readFileSpy = vi.spyOn(streamingManager, 'readFileChunk').mockResolvedValue(new ArrayBuffer(1024));
      
      await streamingManager.loadChunk(0);
      await streamingManager.loadChunk(0); // Try to load same chunk again
      
      expect(readFileSpy).toHaveBeenCalledTimes(1);
      readFileSpy.mockRestore();
    });

    it('should emit chunk-loaded events', async () => {
      let eventData = null;
      streamingManager.on('chunk-loaded', (data) => {
        eventData = data;
      });
      
      const readFileSpy = vi.spyOn(streamingManager, 'readFileChunk').mockResolvedValue(new ArrayBuffer(1024));
      
      await streamingManager.loadChunk(0);
      
      expect(eventData).toEqual({
        index: 0,
        total: streamingManager.totalChunks,
        loadTime: expect.any(Number),
        progress: expect.any(Number)
      });
      
      readFileSpy.mockRestore();
    });
  });

  describe('Buffer Management', () => {
    beforeEach(async () => {
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
    });

    it('should calculate buffered time ahead correctly', () => {
      const bufferedAhead = streamingManager.getBufferedTimeAhead(10); // Current time: 10s
      expect(bufferedAhead).toBe(20); // Buffered until 30s, so 20s ahead
    });

    it('should calculate buffered percentage correctly', () => {
      const bufferedPercent = streamingManager.getBufferedPercent();
      expect(bufferedPercent).toBe(25); // 30s buffered out of 120s total = 25%
    });

    it('should update buffered ranges', () => {
      streamingManager.updateBufferedRanges();
      expect(streamingManager.bufferedRanges).toEqual([
        { start: 0, end: 30 }
      ]);
    });

    it('should monitor buffer health', () => {
      let healthData = null;
      streamingManager.on('buffer-health', (data) => {
        healthData = data;
      });
      
      streamingManager.monitorBufferHealth();
      
      expect(healthData).toEqual({
        health: expect.any(Number),
        bufferedAhead: expect.any(Number),
        recommended: 30
      });
    });
  });

  describe('Playback Controls', () => {
    beforeEach(async () => {
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
    });

    it('should play video successfully', async () => {
      await streamingManager.play();
      expect(mockVideoElement.play).toHaveBeenCalled();
    });

    it('should pause video', () => {
      streamingManager.pause();
      expect(mockVideoElement.pause).toHaveBeenCalled();
    });

    it('should seek to specific time', () => {
      streamingManager.seek(60);
      expect(mockVideoElement.currentTime).toBe(60);
    });

    it('should set volume correctly', () => {
      streamingManager.setVolume(0.5);
      expect(mockVideoElement.volume).toBe(0.5);
    });

    it('should clamp volume to valid range', () => {
      streamingManager.setVolume(1.5); // Too high
      expect(mockVideoElement.volume).toBe(1);
      
      streamingManager.setVolume(-0.5); // Too low
      expect(mockVideoElement.volume).toBe(0);
    });
  });

  describe('Event Handling', () => {
    it('should register event listeners', () => {
      const callback = vi.fn();
      streamingManager.on('test-event', callback);
      
      expect(streamingManager.eventListeners['test-event']).toContain(callback);
    });

    it('should remove event listeners', () => {
      const callback = vi.fn();
      streamingManager.on('test-event', callback);
      streamingManager.off('test-event', callback);
      
      expect(streamingManager.eventListeners['test-event']).not.toContain(callback);
    });

    it('should emit events to listeners', () => {
      const callback = vi.fn();
      streamingManager.on('test-event', callback);
      
      streamingManager.emit('test-event', { data: 'test' });
      
      expect(callback).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalCallback = vi.fn();
      
      streamingManager.on('test-event', errorCallback);
      streamingManager.on('test-event', normalCallback);
      
      // Should not throw, should call both callbacks
      expect(() => {
        streamingManager.emit('test-event', { data: 'test' });
      }).not.toThrow();
      
      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('Statistics and Performance', () => {
    beforeEach(async () => {
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
    });

    it('should track loading statistics', async () => {
      const readFileSpy = vi.spyOn(streamingManager, 'readFileChunk').mockResolvedValue(new ArrayBuffer(1024));
      
      await streamingManager.loadChunk(0);
      
      const stats = streamingManager.getStats();
      expect(stats.chunksLoaded).toBe(1);
      expect(stats.totalLoadTime).toBeGreaterThan(0);
      expect(stats.averageChunkTime).toBeGreaterThan(0);
      
      readFileSpy.mockRestore();
    });

    it('should return comprehensive statistics', () => {
      const stats = streamingManager.getStats();
      
      expect(stats).toEqual({
        chunksLoaded: expect.any(Number),
        totalLoadTime: expect.any(Number),
        averageChunkTime: expect.any(Number),
        bufferHealth: expect.any(Number),
        stallCount: expect.any(Number),
        seekCount: expect.any(Number),
        isStreaming: expect.any(Boolean),
        currentChunk: expect.any(Number),
        totalChunks: expect.any(Number),
        bufferedPercent: expect.any(Number),
        currentTime: expect.any(Number),
        duration: expect.any(Number)
      });
    });
  });

  describe('Cleanup and Teardown', () => {
    beforeEach(async () => {
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
    });

    it('should stop streaming and cleanup resources', () => {
      streamingManager.stop();
      
      expect(streamingManager.isStreaming).toBe(false);
      expect(streamingManager.chunks).toEqual([]);
      expect(streamingManager.currentChunk).toBe(0);
      expect(streamingManager.sourceBuffer).toBe(null);
      expect(streamingManager.mediaSource).toBe(null);
    });

    it('should handle MediaSource cleanup errors gracefully', () => {
      const mockMediaSource = streamingManager.mediaSource;
      mockMediaSource.endOfStream = vi.fn(() => {
        throw new Error('End stream failed');
      });
      
      expect(() => {
        streamingManager.stop();
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors', async () => {
      let errorData = null;
      streamingManager.on('chunk-error', (data) => {
        errorData = data;
      });
      
      const errorSpy = vi.spyOn(streamingManager, 'readFileChunk').mockRejectedValue(new Error('Read failed'));
      
      await streamingManager.initializeStreaming(mockFile, mockVideoElement);
      await streamingManager.loadChunk(0);
      
      expect(errorData).toEqual({
        index: 0,
        error: expect.any(Error)
      });
      
      errorSpy.mockRestore();
    });

    it('should emit errors for MediaSource failures', () => {
      let errorData = null;
      streamingManager.on('error', (data) => {
        errorData = data;
      });
      
      // Simulate MediaSource error
      const mockMediaSource = new MediaSource();
      streamingManager.mediaSource = mockMediaSource;
      streamingManager.setupMediaSourceEvents();
      
      // Trigger error event
      const errorEvent = new Event('error');
      mockMediaSource.addEventListener.mock.calls
        .find(call => call[0] === 'error')[1](errorEvent);
      
      expect(errorData).toBe(errorEvent);
    });
  });

  describe('Utility Functions', () => {
    it('should format bytes correctly', () => {
      expect(streamingManager.formatBytes(0)).toBe('0 Bytes');
      expect(streamingManager.formatBytes(1024)).toBe('1 KB');
      expect(streamingManager.formatBytes(1024 * 1024)).toBe('1 MB');
      expect(streamingManager.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
      expect(streamingManager.formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small files', async () => {
      const tinyFile = new File(['tiny'], 'tiny.mp4', { type: 'video/mp4' });
      Object.defineProperty(tinyFile, 'size', { value: 100 });
      
      await streamingManager.initializeStreaming(tinyFile, mockVideoElement);
      
      expect(streamingManager.totalChunks).toBe(1);
    });

    it('should handle empty buffered ranges', () => {
      mockVideoElement.buffered = { length: 0 };
      streamingManager.videoElement = mockVideoElement;
      
      const bufferedPercent = streamingManager.getBufferedPercent();
      expect(bufferedPercent).toBe(0);
      
      const bufferedAhead = streamingManager.getBufferedTimeAhead(10);
      expect(bufferedAhead).toBe(0);
    });

    it('should handle invalid seek times', () => {
      streamingManager.videoElement = mockVideoElement;
      mockVideoElement.duration = 120;
      
      // Seek beyond duration
      streamingManager.seek(200);
      expect(mockVideoElement.currentTime).toBe(120);
      
      // Seek before start
      streamingManager.seek(-10);
      expect(mockVideoElement.currentTime).toBe(0);
    });
  });
});
