import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoPlayer } from '../js/components/VideoPlayer.js';

// Mock ShakaStreamingManager
vi.mock('../js/utils/shakaStreaming.js', () => ({
  ShakaStreamingManager: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    initializeStreaming: vi.fn().mockResolvedValue({
      duration: 120,
      totalChunks: 10,
      chunkSize: 1024 * 1024,
      mimeType: 'video/mp4',
      mode: 'shaka-direct',
      player: 'shaka'
    }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    stop: vi.fn(),
    getStats: vi.fn(() => ({
      isStreaming: true,
      currentTime: 30,
      duration: 120,
      bufferedPercent: 50,
      mode: 'shaka',
      shakaStats: {
        estimatedBandwidth: 2000000,
        droppedFrames: 0
      }
    })),
    getQualityLevels: vi.fn(() => [
      { id: 1, height: 720, width: 1280, bandwidth: 2500000, active: true },
      { id: 2, height: 480, width: 854, bandwidth: 1500000, active: false }
    ]),
    setQuality: vi.fn(),
    setAdaptiveStreaming: vi.fn(),
    cleanup: vi.fn()
  }))
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock fullscreen API
Object.defineProperty(document, 'fullscreenElement', {
  writable: true,
  value: null
});

document.requestFullscreen = vi.fn().mockResolvedValue(undefined);
document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

describe('VideoPlayer Component', () => {
  let videoPlayer;
  let mockSocketClient;
  let mockStateChangeCallback;
  let container;
  let mockFile;

  beforeEach(() => {
    // Mock socket client
    mockSocketClient = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      socket: { id: 'test-socket-id' }
    };

    // Mock state change callback
    mockStateChangeCallback = vi.fn();

    // Create container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock file
    mockFile = new File(['test content'], 'test-movie.mp4', {
      type: 'video/mp4'
    });
    Object.defineProperty(mockFile, 'size', {
      value: 10 * 1024 * 1024, // 10MB
      writable: false
    });

    // Create video player
    videoPlayer = new VideoPlayer(mockSocketClient, mockStateChangeCallback);
  });

  afterEach(() => {
    if (videoPlayer && videoPlayer.destroy) {
      videoPlayer.destroy();
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(videoPlayer.socketClient).toBe(mockSocketClient);
      expect(videoPlayer.onStateChange).toBe(mockStateChangeCallback);
      expect(videoPlayer.isInitialized).toBe(false);
      expect(videoPlayer.isHost).toBe(false);
      expect(videoPlayer.currentFile).toBe(null);
      expect(videoPlayer.isPlaying).toBe(false);
      expect(videoPlayer.volume).toBe(1.0);
    });

    it('should set up streaming manager events', () => {
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('timeupdate', expect.any(Function));
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('buffering', expect.any(Function));
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('Initialization', () => {
    it('should initialize with file successfully', async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);

      expect(videoPlayer.currentFile).toBe(mockFile);
      expect(videoPlayer.container).toBe(container);
      expect(videoPlayer.isHost).toBe(true);
      expect(videoPlayer.isInitialized).toBe(true);
      expect(videoPlayer.streamingManager.initializeStreaming).toHaveBeenCalledWith(
        mockFile,
        expect.any(HTMLVideoElement),
        expect.objectContaining({
          chunkSize: expect.any(Number),
          bufferTimeAhead: 30
        })
      );
    });

    it('should reject initialization without container', async () => {
      await expect(
        videoPlayer.initializeWithFile(mockFile, null, true)
      ).rejects.toThrow('Container element is required');
    });

    it('should handle streaming initialization errors', async () => {
      const error = new Error('Streaming failed');
      videoPlayer.streamingManager.initializeStreaming.mockRejectedValue(error);

      await expect(
        videoPlayer.initializeWithFile(mockFile, container, true)
      ).rejects.toThrow('Streaming failed');
    });

    it('should calculate optimal chunk size based on file size', () => {
      // Small file
      expect(videoPlayer.calculateOptimalChunkSize(30 * 1024 * 1024)).toBe(512 * 1024);
      
      // Medium file
      expect(videoPlayer.calculateOptimalChunkSize(100 * 1024 * 1024)).toBe(1024 * 1024);
      
      // Large file
      expect(videoPlayer.calculateOptimalChunkSize(500 * 1024 * 1024)).toBe(2 * 1024 * 1024);
      
      // Very large file
      expect(videoPlayer.calculateOptimalChunkSize(2 * 1024 * 1024 * 1024)).toBe(4 * 1024 * 1024);
    });
  });

  describe('UI Rendering', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should render video player HTML structure', () => {
      const videoElement = container.querySelector('#video-element');
      const controls = container.querySelector('#video-controls');
      const playPauseBtn = container.querySelector('#play-pause-btn');
      const volumeBtn = container.querySelector('#volume-btn');
      const fullscreenBtn = container.querySelector('#fullscreen-btn');

      expect(videoElement).toBeTruthy();
      expect(controls).toBeTruthy();
      expect(playPauseBtn).toBeTruthy();
      expect(volumeBtn).toBeTruthy();
      expect(fullscreenBtn).toBeTruthy();
    });

    it('should render sync button for hosts', async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
      const syncBtn = container.querySelector('#sync-btn');
      expect(syncBtn).toBeTruthy();
    });

    it('should not render sync button for non-hosts', async () => {
      await videoPlayer.initializeWithFile(mockFile, container, false);
      const syncBtn = container.querySelector('#sync-btn');
      expect(syncBtn).toBeFalsy();
    });

    it('should render loading overlay initially', () => {
      const loadingOverlay = container.querySelector('#loading-overlay');
      expect(loadingOverlay).toBeTruthy();
    });

    it('should render error overlay when needed', () => {
      videoPlayer.showError('Test error message');
      const errorOverlay = container.querySelector('#error-overlay');
      const errorMessage = container.querySelector('#error-message');
      
      expect(errorOverlay.style.display).toBe('flex');
      expect(errorMessage.textContent).toBe('Test error message');
    });
  });

  describe('Playback Controls', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
      // Mock video element properties
      videoPlayer.videoElement.duration = 120;
      videoPlayer.videoElement.currentTime = 0;
    });

    it('should play video', async () => {
      await videoPlayer.play();
      expect(videoPlayer.streamingManager.play).toHaveBeenCalled();
    });

    it('should pause video', () => {
      videoPlayer.pause();
      expect(videoPlayer.streamingManager.pause).toHaveBeenCalled();
    });

    it('should toggle play/pause', async () => {
      // Initially not playing
      expect(videoPlayer.isPlaying).toBe(false);
      
      await videoPlayer.togglePlayPause();
      expect(videoPlayer.streamingManager.play).toHaveBeenCalled();
      
      // Simulate playing state
      videoPlayer.isPlaying = true;
      videoPlayer.togglePlayPause();
      expect(videoPlayer.streamingManager.pause).toHaveBeenCalled();
    });

    it('should seek to specific time', () => {
      videoPlayer.seek(60);
      expect(videoPlayer.streamingManager.seek).toHaveBeenCalledWith(60);
    });

    it('should clamp seek time to valid range', () => {
      videoPlayer.seek(-10); // Before start
      expect(videoPlayer.streamingManager.seek).toHaveBeenCalledWith(0);
      
      videoPlayer.seek(200); // After end
      expect(videoPlayer.streamingManager.seek).toHaveBeenCalledWith(120);
    });

    it('should set volume', () => {
      videoPlayer.setVolume(0.5);
      expect(videoPlayer.volume).toBe(0.5);
      expect(videoPlayer.streamingManager.setVolume).toHaveBeenCalledWith(0.5);
    });

    it('should clamp volume to valid range', () => {
      videoPlayer.setVolume(1.5);
      expect(videoPlayer.volume).toBe(1);
      
      videoPlayer.setVolume(-0.5);
      expect(videoPlayer.volume).toBe(0);
    });

    it('should toggle mute', () => {
      expect(videoPlayer.isMuted).toBe(false);
      
      videoPlayer.toggleMute();
      expect(videoPlayer.isMuted).toBe(true);
      expect(videoPlayer.videoElement.muted).toBe(true);
      
      videoPlayer.toggleMute();
      expect(videoPlayer.isMuted).toBe(false);
      expect(videoPlayer.videoElement.muted).toBe(false);
    });
  });

  describe('Host Controls', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should notify server when host plays video', async () => {
      await videoPlayer.play();
      expect(mockSocketClient.emit).toHaveBeenCalledWith('movie-control', {
        action: 'play',
        movieState: { currentTime: 0 }
      });
    });

    it('should notify server when host pauses video', () => {
      videoPlayer.pause();
      expect(mockSocketClient.emit).toHaveBeenCalledWith('movie-control', {
        action: 'pause',
        movieState: { currentTime: 0 }
      });
    });

    it('should notify server when host seeks', () => {
      videoPlayer.seek(60);
      expect(mockSocketClient.emit).toHaveBeenCalledWith('movie-control', {
        action: 'seek',
        movieState: { currentTime: 60 }
      });
    });

    it('should sync with participants', () => {
      videoPlayer.currentTime = 45;
      videoPlayer.isPlaying = true;
      videoPlayer.volume = 0.8;
      videoPlayer.duration = 120;
      
      videoPlayer.syncWithParticipants();
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('movie-control', {
        action: 'sync',
        movieState: {
          currentTime: 45,
          isPlaying: true,
          volume: 0.8,
          duration: 120
        }
      });
    });

    it('should not notify server for non-host actions', async () => {
      // Reinitialize as non-host
      videoPlayer.destroy();
      videoPlayer = new VideoPlayer(mockSocketClient, mockStateChangeCallback);
      await videoPlayer.initializeWithFile(mockFile, container, false);
      
      await videoPlayer.play();
      videoPlayer.pause();
      videoPlayer.seek(30);
      
      expect(mockSocketClient.emit).not.toHaveBeenCalled();
    });
  });

  describe('UI Updates', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should update play/pause button state', () => {
      const playIcon = container.querySelector('.play-icon');
      const pauseIcon = container.querySelector('.pause-icon');
      
      // Initially not playing
      videoPlayer.updatePlayPauseButton();
      expect(playIcon.style.display).toBe('block');
      expect(pauseIcon.style.display).toBe('none');
      
      // Playing
      videoPlayer.isPlaying = true;
      videoPlayer.updatePlayPauseButton();
      expect(playIcon.style.display).toBe('none');
      expect(pauseIcon.style.display).toBe('block');
    });

    it('should update volume controls', () => {
      const volumeIcon = container.querySelector('.volume-icon');
      const muteIcon = container.querySelector('.mute-icon');
      const volumeFill = container.querySelector('#volume-fill');
      
      // Normal volume
      videoPlayer.volume = 0.7;
      videoPlayer.isMuted = false;
      videoPlayer.updateVolumeControls();
      
      expect(volumeIcon.style.display).toBe('block');
      expect(muteIcon.style.display).toBe('none');
      expect(volumeFill.style.width).toBe('70%');
      
      // Muted
      videoPlayer.isMuted = true;
      videoPlayer.updateVolumeControls();
      
      expect(volumeIcon.style.display).toBe('none');
      expect(muteIcon.style.display).toBe('block');
    });

    it('should update time display', () => {
      const currentTimeElement = container.querySelector('.current-time');
      const durationTimeElement = container.querySelector('.duration-time');
      
      videoPlayer.currentTime = 65; // 1:05
      videoPlayer.duration = 3665; // 1:01:05
      videoPlayer.updateTimeDisplay();
      
      expect(currentTimeElement.textContent).toBe('1:05');
      expect(durationTimeElement.textContent).toBe('1:01:05');
    });

    it('should update progress bar', () => {
      const progressPlayed = container.querySelector('#progress-played');
      const progressBuffered = container.querySelector('#progress-buffered');
      
      videoPlayer.currentTime = 30;
      videoPlayer.duration = 120;
      videoPlayer.bufferedPercent = 50;
      
      videoPlayer.updateProgressBar();
      
      expect(progressPlayed.style.width).toBe('25%'); // 30/120 = 25%
      expect(progressBuffered.style.width).toBe('50%');
    });

    it('should update buffer indicator', () => {
      const bufferIndicator = container.querySelector('.buffer-indicator');
      
      // Good buffer health
      videoPlayer.updateBufferIndicator({ health: 90 });
      expect(bufferIndicator.style.backgroundColor).toBe('rgb(16, 185, 129)'); // Green
      
      // Warning buffer health
      videoPlayer.updateBufferIndicator({ health: 60 });
      expect(bufferIndicator.style.backgroundColor).toBe('rgb(245, 158, 11)'); // Yellow
      
      // Poor buffer health
      videoPlayer.updateBufferIndicator({ health: 20 });
      expect(bufferIndicator.style.backgroundColor).toBe('rgb(239, 68, 68)'); // Red
    });
  });

  describe('Keyboard Controls', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
      videoPlayer.duration = 120;
      videoPlayer.currentTime = 60;
      videoPlayer.volume = 0.5;
    });

    it('should handle space key for play/pause', () => {
      const playPauseSpy = vi.spyOn(videoPlayer, 'togglePlayPause');
      
      const event = new KeyboardEvent('keydown', { code: 'Space' });
      videoPlayer.handleKeyPress(event);
      
      expect(playPauseSpy).toHaveBeenCalled();
    });

    it('should handle arrow keys for seek and volume', () => {
      const seekSpy = vi.spyOn(videoPlayer, 'seek');
      const setVolumeSpy = vi.spyOn(videoPlayer, 'setVolume');
      
      // Left arrow - seek back
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
      expect(seekSpy).toHaveBeenCalledWith(50); // 60 - 10
      
      // Right arrow - seek forward
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
      expect(seekSpy).toHaveBeenCalledWith(70); // 60 + 10
      
      // Up arrow - volume up
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
      expect(setVolumeSpy).toHaveBeenCalledWith(0.6); // 0.5 + 0.1
      
      // Down arrow - volume down
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      expect(setVolumeSpy).toHaveBeenCalledWith(0.4); // 0.5 - 0.1
    });

    it('should handle M key for mute toggle', () => {
      const muteSpy = vi.spyOn(videoPlayer, 'toggleMute');
      
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'KeyM' }));
      expect(muteSpy).toHaveBeenCalled();
    });

    it('should handle F key for fullscreen', () => {
      const fullscreenSpy = vi.spyOn(videoPlayer, 'toggleFullscreen');
      
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'KeyF' }));
      expect(fullscreenSpy).toHaveBeenCalled();
    });

    it('should ignore keys when input is focused', () => {
      const playPauseSpy = vi.spyOn(videoPlayer, 'togglePlayPause');
      
      // Mock focused input
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      
      videoPlayer.handleKeyPress(new KeyboardEvent('keydown', { code: 'Space' }));
      expect(playPauseSpy).not.toHaveBeenCalled();
      
      document.body.removeChild(input);
    });
  });

  describe('Fullscreen', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should enter fullscreen', async () => {
      container.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      
      await videoPlayer.toggleFullscreen();
      expect(container.requestFullscreen).toHaveBeenCalled();
    });

    it('should exit fullscreen', async () => {
      videoPlayer.isFullscreen = true;
      
      await videoPlayer.toggleFullscreen();
      expect(document.exitFullscreen).toHaveBeenCalled();
    });

    it('should handle fullscreen errors gracefully', async () => {
      container.requestFullscreen = vi.fn().mockRejectedValue(new Error('Fullscreen failed'));
      
      // Should not throw
      await expect(videoPlayer.toggleFullscreen()).resolves.toBeUndefined();
    });

    it('should update fullscreen button state', () => {
      const fullscreenIcon = container.querySelector('.fullscreen-icon');
      const fullscreenExitIcon = container.querySelector('.fullscreen-exit-icon');
      
      // Not fullscreen
      videoPlayer.isFullscreen = false;
      videoPlayer.updateFullscreenButton();
      expect(fullscreenIcon.style.display).toBe('block');
      expect(fullscreenExitIcon.style.display).toBe('none');
      
      // Fullscreen
      videoPlayer.isFullscreen = true;
      videoPlayer.updateFullscreenButton();
      expect(fullscreenIcon.style.display).toBe('none');
      expect(fullscreenExitIcon.style.display).toBe('block');
    });
  });

  describe('State Management', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should notify state changes', () => {
      videoPlayer.isPlaying = true;
      videoPlayer.currentTime = 45;
      videoPlayer.duration = 120;
      videoPlayer.volume = 0.8;
      videoPlayer.isMuted = false;
      videoPlayer.bufferedPercent = 60;
      
      videoPlayer.notifyStateChange();
      
      expect(mockStateChangeCallback).toHaveBeenCalledWith({
        isPlaying: true,
        currentTime: 45,
        duration: 120,
        volume: 0.8,
        isMuted: false,
        bufferedPercent: 60
      });
    });

    it('should return comprehensive statistics', () => {
      const stats = videoPlayer.getStats();
      
      expect(stats).toEqual({
        isStreaming: true,
        currentChunk: 5,
        totalChunks: 10,
        bufferedPercent: 50,
        isInitialized: true,
        isHost: true,
        fileName: 'test-movie.mp4',
        fileSize: 10 * 1024 * 1024
      });
    });
  });

  describe('Time Formatting', () => {
    it('should format time correctly', () => {
      expect(videoPlayer.formatTime(0)).toBe('0:00');
      expect(videoPlayer.formatTime(65)).toBe('1:05');
      expect(videoPlayer.formatTime(3665)).toBe('1:01:05');
      expect(videoPlayer.formatTime(NaN)).toBe('0:00');
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should retry video loading', async () => {
      videoPlayer.showError('Test error');
      
      const retryBtn = container.querySelector('#retry-btn');
      expect(retryBtn).toBeTruthy();
      
      // Mock successful retry
      videoPlayer.streamingManager.initializeStreaming.mockResolvedValueOnce({
        duration: 120,
        totalChunks: 10,
        chunkSize: 1024 * 1024,
        mimeType: 'video/mp4'
      });
      
      await videoPlayer.retry();
      expect(videoPlayer.streamingManager.initializeStreaming).toHaveBeenCalledTimes(2);
    });

    it('should handle retry failures', async () => {
      const error = new Error('Retry failed');
      videoPlayer.streamingManager.initializeStreaming.mockRejectedValue(error);
      
      await videoPlayer.retry();
      
      const errorMessage = container.querySelector('#error-message');
      expect(errorMessage.textContent).toContain('Retry failed');
    });
  });

  describe('Shaka Player Integration', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should show quality menu when quality button is clicked', () => {
      const qualityBtn = container.querySelector('#quality-btn');
      expect(qualityBtn).toBeTruthy();
      
      // Click quality button
      qualityBtn.click();
      
      const qualityMenu = container.querySelector('#quality-menu');
      expect(qualityMenu).toBeTruthy();
    });

    it('should display available quality levels in menu', () => {
      videoPlayer.showQualityMenu();
      
      const qualityMenu = container.querySelector('#quality-menu');
      const qualityOptions = qualityMenu.querySelectorAll('.quality-option');
      
      // Should have auto option + 2 quality levels
      expect(qualityOptions).toHaveLength(3);
      
      // Check for auto option
      expect(qualityOptions[0].textContent).toContain('Auto');
      
      // Check for quality levels
      expect(qualityOptions[1].textContent).toContain('720p');
      expect(qualityOptions[2].textContent).toContain('480p');
    });

    it('should set quality when option is selected', () => {
      videoPlayer.showQualityMenu();
      
      const qualityMenu = container.querySelector('#quality-menu');
      const qualityOptions = qualityMenu.querySelectorAll('.quality-option');
      
      // Click on 720p option (index 1, since 0 is auto)
      qualityOptions[1].click();
      
      expect(videoPlayer.streamingManager.setAdaptiveStreaming).toHaveBeenCalledWith(false);
      expect(videoPlayer.streamingManager.setQuality).toHaveBeenCalledWith(1);
    });

    it('should enable adaptive streaming when auto is selected', () => {
      videoPlayer.showQualityMenu();
      
      const qualityMenu = container.querySelector('#quality-menu');
      const autoOption = qualityMenu.querySelector('.quality-option');
      
      autoOption.click();
      
      expect(videoPlayer.streamingManager.setAdaptiveStreaming).toHaveBeenCalledWith(true);
    });

    it('should update quality indicator on quality change', () => {
      const qualityInfo = {
        height: 720,
        width: 1280,
        bandwidth: 2500000
      };
      
      videoPlayer.updateQualityIndicator(qualityInfo);
      
      const qualityDisplay = container.querySelector('#quality-display');
      expect(qualityDisplay.textContent).toContain('720p');
      expect(qualityDisplay.textContent).toContain('2500k');
    });

    it('should handle enhanced streaming events', () => {
      const qualityChangeHandler = vi.fn();
      const statsHandler = vi.fn();
      
      videoPlayer.on = vi.fn();
      videoPlayer.setupStreamingEvents();
      
      // Verify Shaka-specific events are registered
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('quality-change', expect.any(Function));
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('stats-updated', expect.any(Function));
      expect(videoPlayer.streamingManager.on).toHaveBeenCalledWith('buffer-warning', expect.any(Function));
    });

    it('should show and hide buffer warnings', () => {
      const warning = { message: 'Low buffer detected' };
      
      videoPlayer.showBufferWarning(warning);
      
      const warningElement = container.querySelector('#buffer-warning');
      expect(warningElement).toBeTruthy();
      expect(warningElement.textContent).toContain('Low buffer detected');
      
      videoPlayer.hideBufferWarning();
      expect(warningElement.style.display).toBe('none');
    });

    it('should display advanced stats in development mode', () => {
      // Mock development environment
      const originalEnv = import.meta.env;
      import.meta.env = { ...originalEnv, DEV: true };
      
      const stats = {
        bufferHealth: 85,
        adaptationCount: 3,
        shakaStats: {
          estimatedBandwidth: 2000000,
          droppedFrames: 2
        }
      };
      
      videoPlayer.updateAdvancedStats(stats);
      
      const statsDisplay = container.querySelector('#advanced-stats');
      expect(statsDisplay).toBeTruthy();
      expect(statsDisplay.textContent).toContain('2000k'); // Bandwidth
      expect(statsDisplay.textContent).toContain('2'); // Dropped frames
      expect(statsDisplay.textContent).toContain('85%'); // Buffer health
      
      // Restore environment
      import.meta.env = originalEnv;
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      await videoPlayer.initializeWithFile(mockFile, container, true);
    });

    it('should cleanup resources on destroy', () => {
      videoPlayer.destroy();
      
      expect(videoPlayer.streamingManager.stop).toHaveBeenCalled();
      expect(container.innerHTML).toBe('');
    });

    it('should remove event listeners on destroy', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      
      videoPlayer.destroy();
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', videoPlayer.handleKeyPress);
    });
  });
});
