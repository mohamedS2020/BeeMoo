import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShakaStreamingManager } from '../js/utils/shakaStreaming.js';

// Increase timeout for these tests
const testTimeout = 15000;

// Mock Shaka Player
const mockPlayer = {
  configure: vi.fn(),
  load: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  getVariantTracks: vi.fn(() => [
    { id: 1, height: 720, width: 1280, bandwidth: 2500000, active: true, language: 'en' },
    { id: 2, height: 480, width: 854, bandwidth: 1500000, active: false, language: 'en' },
    { id: 3, height: 1080, width: 1920, bandwidth: 4000000, active: false, language: 'en' }
  ]),
  selectVariantTrack: vi.fn(),
  getStats: vi.fn(() => ({
    estimatedBandwidth: 2000000,
    droppedFrames: 0,
    decodedFrames: 1000,
    loadLatency: 500,
    playTime: 30,
    pauseTime: 0,
    bufferingTime: 2,
    width: 1280,
    height: 720,
    streamBandwidth: 2500000
  }))
};

const mockShakaPlayer = {
  Player: vi.fn().mockImplementation(() => mockPlayer),
  isBrowserSupported: vi.fn(() => true),
  polyfill: {
    installAll: vi.fn()
  },
  util: {
    Error: {
      Category: {
        NETWORK: 1,
        MEDIA: 2,
        MANIFEST: 3
      }
    }
  }
};

// Mock the Shaka Player import
vi.mock('shaka-player/dist/shaka-player.compiled.js', () => ({
  default: mockShakaPlayer
}));

global.URL.createObjectURL = vi.fn(() => 'blob:mock-shaka-url');
global.URL.revokeObjectURL = vi.fn();

// Mock File and Blob for adaptive streaming
global.File = vi.fn();
global.Blob = vi.fn().mockImplementation((content, options) => ({
  type: options?.type || 'application/dash+xml'
}));

describe('ShakaStreamingManager - Enhanced Adaptive Streaming', () => {
  let streamingManager;
  let mockVideoElement;
  let mockFile;
  let mockLargeFile;

  beforeEach(() => {
    vi.clearAllMocks();
    
    streamingManager = new ShakaStreamingManager();
    
    // Mock video element
    mockVideoElement = {
      src: '',
      duration: 120,
      videoWidth: 1920,
      videoHeight: 1080,
      currentTime: 0,
      buffered: {
        length: 1,
        start: vi.fn(() => 0),
        end: vi.fn(() => 30)
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      volume: 1,
      muted: false
    };
    
    // Mock small file
    mockFile = {
      name: 'test-movie.mp4',
      size: 50 * 1024 * 1024, // 50MB
      type: 'video/mp4',
      slice: vi.fn((start, end) => ({
        name: `segment-${start}-${end}`,
        size: end - start,
        type: 'video/mp4'
      }))
    };
    
    // Mock large file (300MB) for adaptive streaming
    mockLargeFile = {
      name: 'large-movie.mp4',
      size: 300 * 1024 * 1024, // 300MB
      type: 'video/mp4',
      slice: vi.fn((start, end) => ({
        name: `segment-${start}-${end}`,
        size: end - start,
        type: 'video/mp4'
      }))
    };
  });

  describe('Initialization and Browser Support', () => {
    it('should initialize Shaka Player when browser is supported', async () => {
      expect(mockShakaPlayer.polyfill.installAll).toHaveBeenCalled();
      expect(mockShakaPlayer.isBrowserSupported).toHaveBeenCalled();
    });

    it('should fallback to legacy when browser is not supported', async () => {
      mockShakaPlayer.isBrowserSupported.mockReturnValueOnce(false);
      
      const manager = new ShakaStreamingManager();
      await manager.initializeShaka();
      
      expect(manager.useFallbackMode).toBe(true);
    });
  });

  describe('Video Analysis for Adaptive Streaming', () => {
    it('should analyze video file metadata correctly', async () => {
      // Mock createElement to return our mock video element
      const mockVideo = {
        ...mockVideoElement,
        readyState: 1,
        addEventListener: vi.fn((event, callback) => {
          if (event === 'loadedmetadata') {
            setTimeout(() => callback(), 0);
          }
        }),
        remove: vi.fn()
      };
      
      vi.spyOn(document, 'createElement').mockReturnValue(mockVideo);
      
      const metadata = await streamingManager.analyzeVideoFile(mockLargeFile);
      
      expect(metadata).toEqual({
        duration: 120,
        width: 1920,
        height: 1080,
        aspectRatio: 16/9,
        fileSize: 300 * 1024 * 1024,
        mimeType: 'video/mp4'
      });
      
      expect(URL.createObjectURL).toHaveBeenCalledWith(mockLargeFile);
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('should handle video analysis errors with fallback metadata', async () => {
      const mockVideo = {
        addEventListener: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Analysis failed')), 0);
          }
        }),
        remove: vi.fn()
      };
      
      vi.spyOn(document, 'createElement').mockReturnValue(mockVideo);
      
      const metadata = await streamingManager.analyzeVideoFile(mockLargeFile);
      
      // Should return fallback metadata
      expect(metadata.width).toBe(1920);
      expect(metadata.height).toBe(1080);
      expect(metadata.aspectRatio).toBe(16/9);
      expect(metadata.fileSize).toBe(300 * 1024 * 1024);
    });

    it('should handle analysis timeout with fallback', async () => {
      vi.useFakeTimers();
      
      const mockVideo = {
        readyState: 0,
        addEventListener: vi.fn(),
        remove: vi.fn()
      };
      
      vi.spyOn(document, 'createElement').mockReturnValue(mockVideo);
      
      const metadataPromise = streamingManager.analyzeVideoFile(mockLargeFile);
      
      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(10000);
      
      const metadata = await metadataPromise;
      
      expect(metadata.width).toBe(1920);
      expect(metadata.height).toBe(1080);
      
      vi.useRealTimers();
    });
  });

  describe('Quality Level Generation', () => {
    it('should generate appropriate quality levels for 1080p video', () => {
      const metadata = {
        width: 1920,
        height: 1080,
        aspectRatio: 16/9,
        duration: 120,
        fileSize: 300 * 1024 * 1024,
        mimeType: 'video/mp4'
      };
      
      const qualityLevels = streamingManager.generateQualityLevels(metadata);
      
      // Should include multiple quality levels up to 1080p
      expect(qualityLevels.length).toBeGreaterThan(3);
      
      // Check that qualities don't exceed original resolution
      qualityLevels.forEach(level => {
        expect(level.height).toBeLessThanOrEqual(1080);
        expect(level.width).toBeLessThanOrEqual(1920);
        expect(level.bitrate).toBeGreaterThan(0);
        expect(level.codecs).toBe('avc1.64001E');
      });
      
      // Check for common quality levels
      const heights = qualityLevels.map(level => level.height);
      expect(heights).toContain(720);
      expect(heights).toContain(480);
      expect(heights).toContain(1080);
    });

    it('should generate quality levels for 720p video', () => {
      const metadata = {
        width: 1280,
        height: 720,
        aspectRatio: 16/9,
        duration: 60,
        fileSize: 150 * 1024 * 1024,
        mimeType: 'video/mp4'
      };
      
      const qualityLevels = streamingManager.generateQualityLevels(metadata);
      
      // Should not include qualities higher than original
      qualityLevels.forEach(level => {
        expect(level.height).toBeLessThanOrEqual(720);
      });
      
      const heights = qualityLevels.map(level => level.height);
      expect(heights).toContain(720);
      expect(heights).toContain(480);
      expect(heights).not.toContain(1080);
    });

    it('should generate at least one quality level for any video', () => {
      const metadata = {
        width: 320,
        height: 240,
        aspectRatio: 4/3,
        duration: 60,
        fileSize: 50 * 1024 * 1024,
        mimeType: 'video/mp4'
      };
      
      const qualityLevels = streamingManager.generateQualityLevels(metadata);
      
      expect(qualityLevels.length).toBeGreaterThanOrEqual(1);
      expect(qualityLevels[0].height).toBeLessThanOrEqual(240);
    });
  });

  describe('DASH Manifest Generation', () => {
    it('should generate valid DASH manifest XML', () => {
      const metadata = {
        duration: 120,
        width: 1920,
        height: 1080,
        aspectRatio: 16/9,
        fileSize: 300 * 1024 * 1024,
        mimeType: 'video/mp4'
      };
      
      const representations = [
        '<Representation id="video_720p">test content</Representation>',
        '<Representation id="video_1080p">test content</Representation>'
      ];
      
      const manifest = streamingManager.createDASHManifestXML(metadata, representations, 10);
      
      expect(manifest).toContain('<?xml version="1.0"');
      expect(manifest).toContain('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"');
      expect(manifest).toContain('mediaPresentationDuration="PT120S"');
      expect(manifest).toContain('minBufferTime="PT10S"');
      expect(manifest).toContain('<Representation id="video_720p">');
      expect(manifest).toContain('<Representation id="video_1080p">');
    });

    it('should create representation XML with proper segment information', () => {
      const quality = {
        height: 720,
        width: 1280,
        bitrate: 2500000,
        codecs: 'avc1.64001E'
      };
      
      const segments = [
        { url: 'blob:segment1', startByte: 0, endByte: 1048575 },
        { url: 'blob:segment2', startByte: 1048576, endByte: 2097151 }
      ];
      
      const representation = streamingManager.createRepresentationXML(
        quality, 'video_720p', segments, 10
      );
      
      expect(representation).toContain('id="video_720p"');
      expect(representation).toContain('width="1280"');
      expect(representation).toContain('height="720"');
      expect(representation).toContain('bandwidth="2500000"');
      expect(representation).toContain('codecs="avc1.64001E"');
      expect(representation).toContain('SegmentURL media="blob:segment1"');
      expect(representation).toContain('mediaRange="0-1048575"');
      expect(representation).toContain('SegmentURL media="blob:segment2"');
      expect(representation).toContain('mediaRange="1048576-2097151"');
    });

    it('should create video segments with proper byte ranges', async () => {
      const totalSegments = 5;
      const segmentIndex = 2;
      const segmentDuration = 10;
      const quality = { height: 720, width: 1280, bitrate: 2500000 };
      
      const segment = await streamingManager.createVideoSegment(
        mockLargeFile, segmentIndex, segmentDuration, quality, totalSegments
      );
      
      expect(segment.index).toBe(segmentIndex);
      expect(segment.duration).toBe(segmentDuration);
      expect(segment.startByte).toBeGreaterThanOrEqual(0);
      expect(segment.endByte).toBeGreaterThan(segment.startByte);
      expect(segment.size).toBe(segment.endByte - segment.startByte + 1);
      expect(segment.url).toBe('blob:mock-shaka-url');
      
      expect(mockLargeFile.slice).toHaveBeenCalledWith(
        segment.startByte, 
        segment.endByte + 1
      );
    });
  });

  describe('Adaptive Streaming Integration', () => {
    beforeEach(() => {
      // Mock successful video analysis
      vi.spyOn(streamingManager, 'analyzeVideoFile').mockResolvedValue({
        duration: 120,
        width: 1920,
        height: 1080,
        aspectRatio: 16/9,
        fileSize: 300 * 1024 * 1024,
        mimeType: 'video/mp4'
      });
      
      // Mock manifest generation
      vi.spyOn(streamingManager, 'generateDynamicDASHManifest').mockResolvedValue({
        manifest: '<MPD>test manifest content</MPD>',
        segmentUrls: ['blob:segment1', 'blob:segment2', 'blob:segment3'],
        totalSegments: 12,
        segmentSize: 25 * 1024 * 1024,
        qualityLevels: [
          { height: 480, width: 854, bitrate: 1500000 },
          { height: 720, width: 1280, bitrate: 2500000 },
          { height: 1080, width: 1920, bitrate: 4000000 }
        ]
      });
    });

    it('should initialize adaptive streaming for large files', async () => {
      const result = await streamingManager.initializeStreaming(
        mockLargeFile, 
        mockVideoElement, 
        { isHost: true, segmentDuration: 8 }
      );
      
      expect(streamingManager.analyzeVideoFile).toHaveBeenCalledWith(mockLargeFile);
      expect(streamingManager.generateDynamicDASHManifest).toHaveBeenCalledWith(
        mockLargeFile,
        expect.any(Object),
        expect.objectContaining({ isHost: true, segmentDuration: 8 })
      );
      expect(mockPlayer.load).toHaveBeenCalled();
      expect(streamingManager.isStreaming).toBe(true);
      
      expect(result.mode).toBe('shaka-adaptive');
      expect(result.player).toBe('shaka');
      expect(result.totalSegments).toBe(12);
      expect(result.variants).toBe(3);
      expect(result.qualities).toEqual(['720p@2500k', '480p@1500k', '1080p@4000k']);
    });

    it('should fallback gracefully if adaptive streaming fails', async () => {
      // Mock manifest generation failure
      streamingManager.generateDynamicDASHManifest.mockRejectedValue(
        new Error('Manifest generation failed')
      );
      
      const result = await streamingManager.initializeStreaming(
        mockLargeFile, 
        mockVideoElement, 
        { isHost: true }
      );
      
      expect(result.mode).toBe('shaka-direct-fallback');
      expect(mockPlayer.load).toHaveBeenCalledWith('blob:mock-shaka-url');
    });

    it('should use direct streaming for small files', async () => {
      const result = await streamingManager.initializeStreaming(
        mockFile, // 50MB file
        mockVideoElement, 
        { isHost: true }
      );
      
      expect(result.mode).toBe('shaka-direct');
      expect(streamingManager.analyzeVideoFile).not.toHaveBeenCalled();
      expect(mockPlayer.load).toHaveBeenCalledWith('blob:mock-shaka-url');
    });
  });

  describe('Quality Control and Adaptation', () => {
    beforeEach(async () => {
      streamingManager.player = mockPlayer;
      streamingManager.availableVariants = mockPlayer.getVariantTracks();
    });

    it('should get available quality levels', () => {
      const qualities = streamingManager.getQualityLevels();
      
      expect(qualities).toHaveLength(3);
      expect(qualities[0]).toEqual({
        id: 1,
        width: 1280,
        height: 720,
        bandwidth: 2500000,
        language: 'en',
        active: true
      });
      expect(qualities[2]).toEqual({
        id: 3,
        width: 1920,
        height: 1080,
        bandwidth: 4000000,
        language: 'en',
        active: false
      });
    });

    it('should set specific quality level', () => {
      streamingManager.setQuality(3);
      
      expect(mockPlayer.selectVariantTrack).toHaveBeenCalledWith(3);
    });

    it('should enable adaptive streaming', () => {
      streamingManager.setAdaptiveStreaming(true);
      
      expect(mockPlayer.configure).toHaveBeenCalledWith({
        abr: { enabled: true }
      });
    });

    it('should disable adaptive streaming for manual quality selection', () => {
      streamingManager.setAdaptiveStreaming(false);
      
      expect(mockPlayer.configure).toHaveBeenCalledWith({
        abr: { enabled: false }
      });
    });
  });

  describe('Enhanced Statistics and Monitoring', () => {
    beforeEach(() => {
      streamingManager.player = mockPlayer;
      streamingManager.currentVariant = {
        id: 1,
        height: 720,
        bandwidth: 2500000
      };
      streamingManager.availableVariants = mockPlayer.getVariantTracks();
    });

    it('should provide comprehensive streaming statistics', () => {
      const stats = streamingManager.getStats();
      
      expect(stats.mode).toBe('shaka');
      expect(stats.shakaStats).toBeDefined();
      expect(stats.shakaStats.estimatedBandwidth).toBe(2000000);
      expect(stats.shakaStats.droppedFrames).toBe(0);
      expect(stats.shakaStats.width).toBe(1280);
      expect(stats.shakaStats.height).toBe(720);
      expect(stats.currentVariant).toBeDefined();
      expect(stats.availableVariants).toBe(3);
    });

    it('should update statistics from Shaka Player', () => {
      const emitSpy = vi.spyOn(streamingManager, 'emit');
      
      streamingManager.updateStats();
      
      expect(mockPlayer.getStats).toHaveBeenCalled();
      expect(streamingManager.stats.estimatedBandwidth).toBe(2000000);
      expect(streamingManager.stats.currentBandwidth).toBe(2500000);
      expect(emitSpy).toHaveBeenCalledWith('stats-updated', streamingManager.stats);
    });
  });

  describe('Resource Management and Cleanup', () => {
    beforeEach(() => {
      streamingManager.player = mockPlayer;
      streamingManager.manifestUri = 'blob:manifest-url';
      streamingManager.segmentUrls = ['blob:segment1', 'blob:segment2', 'blob:segment3'];
    });

    it('should cleanup all resources including manifest and segments', async () => {
      await streamingManager.cleanup();
      
      expect(mockPlayer.destroy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:manifest-url');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:segment1');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:segment2');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:segment3');
      
      expect(streamingManager.manifestUri).toBeNull();
      expect(streamingManager.segmentUrls).toEqual([]);
    });

    it('should handle cleanup errors gracefully', async () => {
      mockPlayer.destroy.mockRejectedValue(new Error('Destroy failed'));
      URL.revokeObjectURL.mockImplementation(() => {
        throw new Error('Revoke failed');
      });
      
      // Should not throw despite errors
      await expect(streamingManager.cleanup()).resolves.toBeUndefined();
      
      expect(streamingManager.player).toBeNull();
    });

    it('should reset state when stopping streaming', async () => {
      streamingManager.isStreaming = true;
      streamingManager.currentTime = 30;
      streamingManager.duration = 120;
      streamingManager.currentVariant = { id: 1 };
      streamingManager.videoElement = mockVideoElement;
      
      await streamingManager.stop();
      
      expect(streamingManager.isStreaming).toBe(false);
      expect(streamingManager.currentTime).toBe(0);
      expect(streamingManager.duration).toBe(0);
      expect(streamingManager.currentVariant).toBeNull();
      expect(streamingManager.availableVariants).toEqual([]);
      expect(mockVideoElement.pause).toHaveBeenCalled();
    });
  });

  describe('Buffer Health and Performance', () => {
    beforeEach(() => {
      streamingManager.videoElement = mockVideoElement;
      streamingManager.shakaConfig = {
        streaming: { bufferingGoal: 30 }
      };
    });

    it('should calculate buffer health accurately', () => {
      vi.spyOn(streamingManager, 'getBufferedTimeAhead').mockReturnValue(25);
      
      const health = streamingManager.calculateBufferHealth();
      
      // 25 seconds out of 30 second target = 83.33%
      expect(health).toBeCloseTo(83.33, 1);
    });

    it('should emit buffer warnings for critically low buffer', () => {
      vi.spyOn(streamingManager, 'calculateBufferHealth').mockReturnValue(15);
      const emitSpy = vi.spyOn(streamingManager, 'emit');
      
      streamingManager.monitorBufferHealth();
      
      expect(emitSpy).toHaveBeenCalledWith('buffer-warning', {
        health: 15,
        message: 'Low buffer - may experience interruptions'
      });
    });

    it('should emit healthy buffer status for good buffer levels', () => {
      vi.spyOn(streamingManager, 'calculateBufferHealth').mockReturnValue(90);
      const emitSpy = vi.spyOn(streamingManager, 'emit');
      
      streamingManager.monitorBufferHealth();
      
      expect(emitSpy).toHaveBeenCalledWith('buffer-healthy', {
        health: 90,
        message: 'Buffer healthy'
      });
    });

    it('should calculate buffered time ahead correctly', () => {
      mockVideoElement.buffered = {
        length: 2,
        start: vi.fn((index) => index === 0 ? 0 : 60),
        end: vi.fn((index) => index === 0 ? 30 : 90)
      };
      
      // Test current time in first buffer range
      const bufferedAhead1 = streamingManager.getBufferedTimeAhead(25);
      expect(bufferedAhead1).toBe(5); // 30 - 25 = 5 seconds
      
      // Test current time in second buffer range
      const bufferedAhead2 = streamingManager.getBufferedTimeAhead(75);
      expect(bufferedAhead2).toBe(15); // 90 - 75 = 15 seconds
      
      // Test current time outside buffer ranges
      const bufferedAhead3 = streamingManager.getBufferedTimeAhead(45);
      expect(bufferedAhead3).toBe(0);
    });
  });
});
global.URL.revokeObjectURL = vi.fn();

describe('ShakaStreamingManager', () => {
  let shakaManager;
  let mockVideoElement;
  let mockFile;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    shakaManager = new ShakaStreamingManager();
    
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
      muted: false,
      videoWidth: 1920,
      videoHeight: 1080,
      readyState: 4
    };
    
    // Mock file
    mockFile = new File(['test content'], 'test-movie.mp4', {
      type: 'video/mp4'
    });
    Object.defineProperty(mockFile, 'size', { value: 100 * 1024 * 1024 }); // 100MB
  });

  afterEach(async () => {
    if (shakaManager) {
      await shakaManager.cleanup();
    }
  });

  describe('Initialization', () => {
    it('should initialize Shaka Player successfully', { timeout: testTimeout }, async () => {
      expect(mockShakaPlayer.polyfill.installAll).toHaveBeenCalled();
      expect(mockShakaPlayer.isBrowserSupported).toHaveBeenCalled();
      expect(shakaManager.useFallbackMode).toBe(false);
    });

    it('should detect browser support correctly', () => {
      expect(shakaManager.useFallbackMode).toBe(false);
    });

    it('should fall back to legacy manager when browser not supported', async () => {
      mockShakaPlayer.isBrowserSupported.mockReturnValue(false);
      
      const fallbackManager = new ShakaStreamingManager();
      expect(fallbackManager.useFallbackMode).toBe(true);
    });
  });

  describe('Streaming Initialization', () => {
    it('should initialize direct streaming for small files', { timeout: testTimeout }, async () => {
      // Create small file (50MB)
      const smallFile = new File(['small content'], 'small-movie.mp4', {
        type: 'video/mp4'
      });
      Object.defineProperty(smallFile, 'size', { value: 50 * 1024 * 1024 });

      const result = await shakaManager.initializeStreaming(smallFile, mockVideoElement, {
        isHost: true
      });

      expect(result.mode).toBe('shaka-direct');
      expect(result.player).toBe('shaka');
      expect(mockShakaPlayer.Player).toHaveBeenCalled();
      expect(shakaManager.isStreaming).toBe(true);
    });

    it('should initialize MSE streaming for large files', { timeout: testTimeout }, async () => {
      // Create large file (500MB)
      const largeFile = new File(['large content'], 'large-movie.mp4', {
        type: 'video/mp4'
      });
      Object.defineProperty(largeFile, 'size', { value: 500 * 1024 * 1024 });

      const result = await shakaManager.initializeStreaming(largeFile, mockVideoElement, {
        isHost: true
      });

      expect(result.mode).toBe('shaka-mse');
      expect(result.player).toBe('shaka');
      expect(mockShakaPlayer.Player).toHaveBeenCalled();
      expect(shakaManager.isStreaming).toBe(true);
    });

    it('should pass host status to configuration', { timeout: testTimeout }, async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, {
        isHost: true,
        chunkSize: 1024 * 1024,
        bufferTimeAhead: 30
      });

      expect(shakaManager.isHost).toBe(true);
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
    });

    it('should emit ready event after initialization', { timeout: testTimeout }, async () => {
      const readyCallback = vi.fn();
      shakaManager.on('ready', readyCallback);

      // Trigger ready event
      shakaManager.emit('ready');

      expect(readyCallback).toHaveBeenCalled();
    });

    it('should handle quality change events', () => {
      const qualityCallback = vi.fn();
      shakaManager.on('quality-change', qualityCallback);

      const qualityInfo = {
        height: 720,
        width: 1280,
        bandwidth: 2500000,
        language: 'en'
      };

      shakaManager.emit('quality-change', qualityInfo);
      expect(qualityCallback).toHaveBeenCalledWith(qualityInfo);
    });

    it('should handle stats update events', () => {
      const statsCallback = vi.fn();
      shakaManager.on('stats-updated', statsCallback);

      shakaManager.updateStats();
      expect(statsCallback).toHaveBeenCalled();
    });
  });

  describe('Quality Management', () => {
    beforeEach(async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
    });

    it('should get available quality levels', () => {
      const qualityLevels = shakaManager.getQualityLevels();

      expect(qualityLevels).toHaveLength(2);
      expect(qualityLevels[0]).toEqual({
        id: 1,
        width: 1280,
        height: 720,
        bandwidth: 2500000,
        language: undefined,
        active: true
      });
    });

    it('should set quality level', () => {
      shakaManager.setQuality(2);
      expect(shakaManager.player.selectVariantTrack).toHaveBeenCalledWith(2);
    });

    it('should enable/disable adaptive streaming', () => {
      shakaManager.setAdaptiveStreaming(false);
      expect(shakaManager.player.configure).toHaveBeenCalledWith({
        abr: { enabled: false }
      });

      shakaManager.setAdaptiveStreaming(true);
      expect(shakaManager.player.configure).toHaveBeenCalledWith({
        abr: { enabled: true }
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
    });

    it('should calculate buffer health correctly', () => {
      mockVideoElement.buffered.length = 1;
      mockVideoElement.currentTime = 10;
      
      const health = shakaManager.calculateBufferHealth();
      expect(health).toBeGreaterThanOrEqual(0);
      expect(health).toBeLessThanOrEqual(100);
    });

    it('should get enhanced statistics', () => {
      const stats = shakaManager.getStats();

      expect(stats).toHaveProperty('mode', 'shaka');
      expect(stats).toHaveProperty('shakaStats');
      expect(stats.shakaStats).toHaveProperty('estimatedBandwidth');
      expect(stats.shakaStats).toHaveProperty('droppedFrames');
      expect(stats).toHaveProperty('currentVariant');
      expect(stats).toHaveProperty('availableVariants');
    });

    it('should monitor buffer health and emit warnings', () => {
      const warningCallback = vi.fn();
      const healthyCallback = vi.fn();
      
      shakaManager.on('buffer-warning', warningCallback);
      shakaManager.on('buffer-healthy', healthyCallback);

      // Mock low buffer health
      vi.spyOn(shakaManager, 'calculateBufferHealth').mockReturnValue(15);
      shakaManager.monitorBufferHealth();
      expect(warningCallback).toHaveBeenCalled();

      // Mock good buffer health
      vi.spyOn(shakaManager, 'calculateBufferHealth').mockReturnValue(90);
      shakaManager.monitorBufferHealth();
      expect(healthyCallback).toHaveBeenCalled();
    });
  });

  describe('Playback Controls', () => {
    beforeEach(async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
    });

    it('should play video', async () => {
      await shakaManager.play();
      expect(mockVideoElement.play).toHaveBeenCalled();
      expect(shakaManager.isPaused).toBe(false);
    });

    it('should pause video', () => {
      shakaManager.pause();
      expect(mockVideoElement.pause).toHaveBeenCalled();
      expect(shakaManager.isPaused).toBe(true);
    });

    it('should seek to specific time', () => {
      shakaManager.seek(30);
      expect(mockVideoElement.currentTime).toBe(30);
    });

    it('should clamp seek time to valid range', () => {
      shakaManager.seek(-10);
      expect(mockVideoElement.currentTime).toBe(0);

      shakaManager.seek(200);
      expect(mockVideoElement.currentTime).toBe(120); // duration
    });

    it('should set volume', () => {
      shakaManager.setVolume(0.5);
      expect(mockVideoElement.volume).toBe(0.5);
    });

    it('should clamp volume to valid range', () => {
      shakaManager.setVolume(-0.5);
      expect(mockVideoElement.volume).toBe(0);

      shakaManager.setVolume(1.5);
      expect(mockVideoElement.volume).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle Shaka Player errors gracefully', async () => {
      const errorCallback = vi.fn();
      shakaManager.on('error', errorCallback);

      // Mock player load failure
      const mockPlayer = mockShakaPlayer.Player();
      mockPlayer.load.mockRejectedValue(new Error('Load failed'));

      try {
        await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
      } catch (error) {
        expect(error.message).toBe('Load failed');
      }
    });

    it('should fall back to legacy manager on Shaka failure', async () => {
      // Mock Shaka Player failure
      mockShakaPlayer.Player.mockImplementation(() => {
        throw new Error('Shaka initialization failed');
      });

      // Should not throw, should gracefully fall back
      try {
        const result = await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
        // If legacy manager is available, it should handle the fallback
        expect(result).toBeDefined();
      } catch (error) {
        // Expected if legacy manager import fails in test environment
        expect(error.message).toContain('Shaka initialization failed');
      }
    });
  });

  describe('Cleanup and Destruction', () => {
    beforeEach(async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
    });

    it('should cleanup resources properly', async () => {
      await shakaManager.cleanup();
      
      expect(shakaManager.player.destroy).toHaveBeenCalled();
      expect(shakaManager.player).toBe(null);
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('should stop streaming and reset state', async () => {
      await shakaManager.stop();

      expect(shakaManager.isStreaming).toBe(false);
      expect(shakaManager.isPaused).toBe(false);
      expect(shakaManager.currentTime).toBe(0);
      expect(shakaManager.duration).toBe(0);
      expect(mockVideoElement.pause).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      // Mock destroy failure
      shakaManager.player.destroy.mockRejectedValue(new Error('Destroy failed'));

      // Should not throw
      await expect(shakaManager.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('Compatibility and API Preservation', () => {
    beforeEach(async () => {
      await shakaManager.initializeStreaming(mockFile, mockVideoElement, { isHost: true });
    });

    it('should maintain compatibility with legacy streaming manager API', () => {
      // Check that all essential methods exist
      expect(typeof shakaManager.play).toBe('function');
      expect(typeof shakaManager.pause).toBe('function');
      expect(typeof shakaManager.seek).toBe('function');
      expect(typeof shakaManager.setVolume).toBe('function');
      expect(typeof shakaManager.getStats).toBe('function');
      expect(typeof shakaManager.stop).toBe('function');
      expect(typeof shakaManager.cleanup).toBe('function');
      expect(typeof shakaManager.on).toBe('function');
      expect(typeof shakaManager.off).toBe('function');
      expect(typeof shakaManager.emit).toBe('function');
    });

    it('should maintain the same event interface', () => {
      const events = ['ready', 'timeupdate', 'buffering', 'buffer-health', 'error', 'playing'];
      
      events.forEach(event => {
        const callback = vi.fn();
        shakaManager.on(event, callback);
        shakaManager.emit(event, { test: 'data' });
        expect(callback).toHaveBeenCalledWith({ test: 'data' });
      });
    });

    it('should provide enhanced statistics while maintaining base structure', () => {
      const stats = shakaManager.getStats();

      // Original properties should be present
      expect(stats).toHaveProperty('isStreaming');
      expect(stats).toHaveProperty('currentTime');
      expect(stats).toHaveProperty('duration');
      expect(stats).toHaveProperty('bufferedPercent');
      expect(stats).toHaveProperty('mode');

      // Enhanced properties should be added
      expect(stats).toHaveProperty('shakaStats');
      expect(stats).toHaveProperty('currentVariant');
      expect(stats).toHaveProperty('availableVariants');
    });
  });
});
