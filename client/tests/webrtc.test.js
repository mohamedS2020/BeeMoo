import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebRTCUtils } from '../js/utils/webrtc.js';

describe('WebRTCUtils', () => {
  // Mock navigator.mediaDevices
  const mockGetUserMedia = vi.fn();
  const mockEnumerateDevices = vi.fn();
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: mockGetUserMedia,
        enumerateDevices: mockEnumerateDevices
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAudioConstraints()', () => {
    it('should return default audio constraints', () => {
      const constraints = WebRTCUtils.getAudioConstraints();
      
      expect(constraints).toEqual({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    });

    it('should apply custom audio options', () => {
      const options = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      };
      
      const constraints = WebRTCUtils.getAudioConstraints(options);
      
      expect(constraints.audio.echoCancellation).toBe(false);
      expect(constraints.audio.noiseSuppression).toBe(false);
      expect(constraints.audio.autoGainControl).toBe(false);
      expect(constraints.video).toBe(false);
    });

    it('should apply device ID constraint when provided', () => {
      const options = {
        deviceId: 'test-device-id-123'
      };
      
      const constraints = WebRTCUtils.getAudioConstraints(options);
      
      expect(constraints.audio.deviceId).toEqual({
        exact: 'test-device-id-123'
      });
    });

    it('should not include device ID when not provided', () => {
      const constraints = WebRTCUtils.getAudioConstraints();
      
      expect(constraints.audio.deviceId).toBeUndefined();
    });

    it('should merge custom options with defaults', () => {
      const options = {
        echoCancellation: false,
        deviceId: 'device-123'
      };
      
      const constraints = WebRTCUtils.getAudioConstraints(options);
      
      expect(constraints.audio.echoCancellation).toBe(false);
      expect(constraints.audio.noiseSuppression).toBe(true); // default
      expect(constraints.audio.autoGainControl).toBe(true); // default
      expect(constraints.audio.deviceId.exact).toBe('device-123');
    });
  });

  describe('requestMicrophonePermissions()', () => {
    it('should request microphone permissions successfully', async () => {
      const mockStream = {
        getTracks: vi.fn(() => [
          { stop: vi.fn() },
          { stop: vi.fn() }
        ])
      };
      
      mockGetUserMedia.mockResolvedValue(mockStream);
      
      const result = await WebRTCUtils.requestMicrophonePermissions();
      
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: true,
        video: false
      });
      expect(result.granted).toBe(true);
      expect(result.error).toBeUndefined();
      
      // Verify tracks were stopped
    expect(mockStream.getTracks).toHaveBeenCalled();
      mockStream.getTracks().forEach(track => {
        expect(track.stop).toHaveBeenCalled();
      });
    });

    it('should handle permission denied', async () => {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      
      mockGetUserMedia.mockRejectedValue(error);
      
      const result = await WebRTCUtils.requestMicrophonePermissions();
      
      expect(result.granted).toBe(false);
      expect(result.error).toBe(error);
    });

    it('should handle device not found error', async () => {
      const error = new Error('Microphone not found');
      error.name = 'NotFoundError';
      
      mockGetUserMedia.mockRejectedValue(error);
      
      const result = await WebRTCUtils.requestMicrophonePermissions();
      
      expect(result.granted).toBe(false);
      expect(result.error).toBe(error);
    });

    it('should handle constraint not satisfied error', async () => {
      const error = new Error('Constraint not satisfied');
      error.name = 'OverconstrainedError';
      
      mockGetUserMedia.mockRejectedValue(error);
      
      const result = await WebRTCUtils.requestMicrophonePermissions();
      
      expect(result.granted).toBe(false);
      expect(result.error).toBe(error);
    });

    it('should handle generic errors', async () => {
      const error = new Error('Unknown error');
      
      mockGetUserMedia.mockRejectedValue(error);
      
      const result = await WebRTCUtils.requestMicrophonePermissions();
      
      expect(result.granted).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('listAudioInputDevices()', () => {
    it('should list audio input devices successfully', async () => {
      const mockDevices = [
        {
          deviceId: 'microphone-1',
          kind: 'audioinput',
          label: 'Built-in Microphone',
          groupId: 'group-1'
        },
        {
          deviceId: 'microphone-2',
          kind: 'audioinput',
          label: 'USB Microphone',
          groupId: 'group-2'
        },
        {
          deviceId: 'speaker-1',
          kind: 'audiooutput',
          label: 'Built-in Speaker',
          groupId: 'group-3'
        },
        {
          deviceId: 'camera-1',
          kind: 'videoinput',
          label: 'Built-in Camera',
          groupId: 'group-4'
        }
      ];
      
      mockEnumerateDevices.mockResolvedValue(mockDevices);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(mockEnumerateDevices).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.devices).toHaveLength(2); // Only audio input devices
      
      expect(result.devices[0]).toEqual({
        deviceId: 'microphone-1',
        label: 'Built-in Microphone',
        groupId: 'group-1'
      });
      
      expect(result.devices[1]).toEqual({
        deviceId: 'microphone-2',
        label: 'USB Microphone',
        groupId: 'group-2'
      });
    });

    it('should handle devices without labels', async () => {
      const mockDevices = [
        {
          deviceId: 'microphone-1',
          kind: 'audioinput',
          label: '',
          groupId: 'group-1'
        },
        {
          deviceId: 'microphone-2',
          kind: 'audioinput',
          label: 'USB Microphone'
          // No groupId
        }
      ];
      
      mockEnumerateDevices.mockResolvedValue(mockDevices);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(result.success).toBe(true);
      expect(result.devices).toHaveLength(2);
      
      expect(result.devices[0]).toEqual({
        deviceId: 'microphone-1',
        label: 'Microphone', // Default label
        groupId: 'group-1'
      });
      
      expect(result.devices[1]).toEqual({
        deviceId: 'microphone-2',
        label: 'USB Microphone',
        groupId: undefined
      });
    });

    it('should handle empty device list', async () => {
      mockEnumerateDevices.mockResolvedValue([]);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(result.success).toBe(true);
      expect(result.devices).toHaveLength(0);
    });

    it('should handle no audio input devices', async () => {
      const mockDevices = [
        {
          deviceId: 'speaker-1',
          kind: 'audiooutput',
          label: 'Built-in Speaker'
        },
        {
          deviceId: 'camera-1',
          kind: 'videoinput',
          label: 'Built-in Camera'
        }
      ];
      
      mockEnumerateDevices.mockResolvedValue(mockDevices);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(result.success).toBe(true);
      expect(result.devices).toHaveLength(0);
    });

    it('should handle enumerate devices error', async () => {
      const error = new Error('Device enumeration failed');
      
      mockEnumerateDevices.mockRejectedValue(error);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.devices).toBeUndefined();
    });

    it('should handle permission denied during enumeration', async () => {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      
      mockEnumerateDevices.mockRejectedValue(error);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('Integration Tests', () => {
    it('should work with real browser environment simulation', async () => {
      // Simulate a successful permission flow
      const mockStream = {
        getTracks: vi.fn(() => [{ stop: vi.fn() }])
      };
      
      const mockDevices = [
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'Default - Built-in Microphone',
          groupId: 'group-1'
        }
      ];
      
      mockGetUserMedia.mockResolvedValue(mockStream);
      mockEnumerateDevices.mockResolvedValue(mockDevices);
      
      // Request permissions first
      const permissionResult = await WebRTCUtils.requestMicrophonePermissions();
      expect(permissionResult.granted).toBe(true);
      
      // Then list devices
      const devicesResult = await WebRTCUtils.listAudioInputDevices();
      expect(devicesResult.success).toBe(true);
      expect(devicesResult.devices).toHaveLength(1);
      
      // Get constraints for specific device
      const constraints = WebRTCUtils.getAudioConstraints({
        deviceId: devicesResult.devices[0].deviceId,
        echoCancellation: true,
        noiseSuppression: true
      });
      
      expect(constraints.audio.deviceId.exact).toBe('default');
      expect(constraints.audio.echoCancellation).toBe(true);
      expect(constraints.audio.noiseSuppression).toBe(true);
    });

    it('should handle complete failure scenario', async () => {
      const permissionError = new Error('Permission denied');
      const enumerationError = new Error('Enumeration failed');
      
      mockGetUserMedia.mockRejectedValue(permissionError);
      mockEnumerateDevices.mockRejectedValue(enumerationError);
      
      const permissionResult = await WebRTCUtils.requestMicrophonePermissions();
      expect(permissionResult.granted).toBe(false);
      expect(permissionResult.error).toBe(permissionError);
      
      const devicesResult = await WebRTCUtils.listAudioInputDevices();
      expect(devicesResult.success).toBe(false);
      expect(devicesResult.error).toBe(enumerationError);
      
      // Constraints should still work regardless
      const constraints = WebRTCUtils.getAudioConstraints();
      expect(constraints.video).toBe(false);
      expect(constraints.audio.echoCancellation).toBe(true);
    });
  });

  describe('Browser Compatibility', () => {
    it('should handle missing navigator.mediaDevices', async () => {
      // Remove mediaDevices support
      Object.defineProperty(navigator, 'mediaDevices', {
        value: undefined
      });
      
      // Should return error results, not throw
      const permResult = await WebRTCUtils.requestMicrophonePermissions();
      expect(permResult.granted).toBe(false);
      expect(permResult.error).toBeDefined();
      
      const devicesResult = await WebRTCUtils.listAudioInputDevices();
      expect(devicesResult.success).toBe(false);
      expect(devicesResult.error).toBeDefined();
    });

    it('should handle missing getUserMedia', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
          enumerateDevices: mockEnumerateDevices
          // Missing getUserMedia
        }
      });
      
      const permResult = await WebRTCUtils.requestMicrophonePermissions();
      expect(permResult.granted).toBe(false);
      expect(permResult.error).toBeDefined();
      
      // Device enumeration should still work
      mockEnumerateDevices.mockResolvedValue([]);
      const result = await WebRTCUtils.listAudioInputDevices();
      expect(result.success).toBe(true);
    });

        it('should handle missing enumerateDevices', async () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: mockGetUserMedia
          // Missing enumerateDevices
        }
      });
      
      // Permission request should still work
      const mockStream = { getTracks: vi.fn(() => [{ stop: vi.fn() }]) };
      mockGetUserMedia.mockResolvedValue(mockStream);
      
      const permissionResult = await WebRTCUtils.requestMicrophonePermissions();
      expect(permissionResult.granted).toBe(true);
      
      // Device listing should fail gracefully
      const devicesResult = await WebRTCUtils.listAudioInputDevices();
      expect(devicesResult.success).toBe(false);
      expect(devicesResult.error).toBeDefined();
    });
});

  describe('Edge Cases', () => {
    it('should handle null/undefined options in getAudioConstraints', () => {
      expect(() => WebRTCUtils.getAudioConstraints(null)).not.toThrow();
      expect(() => WebRTCUtils.getAudioConstraints(undefined)).not.toThrow();
      
      const constraints1 = WebRTCUtils.getAudioConstraints(null);
      const constraints2 = WebRTCUtils.getAudioConstraints(undefined);
      
      expect(constraints1.audio.echoCancellation).toBe(true);
      expect(constraints2.audio.echoCancellation).toBe(true);
    });

    it('should handle empty options object', () => {
      const constraints = WebRTCUtils.getAudioConstraints({});
      
      expect(constraints.audio.echoCancellation).toBe(true);
      expect(constraints.audio.noiseSuppression).toBe(true);
      expect(constraints.audio.autoGainControl).toBe(true);
      expect(constraints.audio.deviceId).toBeUndefined();
    });

    it('should handle malformed device data', async () => {
      const malformedDevices = [
        null,
        undefined,
        {},
        { kind: 'audioinput' }, // Missing deviceId
        { deviceId: 'test' }, // Missing kind
        { 
          deviceId: 'valid',
          kind: 'audioinput',
          label: null,
          groupId: null
        }
      ];
      
      mockEnumerateDevices.mockResolvedValue(malformedDevices);
      
      const result = await WebRTCUtils.listAudioInputDevices();
      
      expect(result.success).toBe(true);
      // Should filter out malformed entries and fix null values
      expect(result.devices.length).toBeGreaterThan(0);
      
      const validDevice = result.devices.find(d => d.deviceId === 'valid');
      expect(validDevice.label).toBe('Microphone'); // Default label
      expect(validDevice.groupId).toBeUndefined();
    });
  });
});