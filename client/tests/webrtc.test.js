import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebRTCUtils } from '../js/utils/webrtc.js';

const originalMediaDevices = navigator.mediaDevices;

describe('WebRTCUtils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests microphone permissions successfully', async () => {
    const mockStream = { getTracks: vi.fn(() => [{ stop: vi.fn() }]) };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        enumerateDevices: vi.fn()
      },
      configurable: true
    });

    const res = await WebRTCUtils.requestMicrophonePermissions();
    expect(res.granted).toBe(true);
    expect(mockStream.getTracks).toHaveBeenCalled();
  });

  it('handles microphone permission denial', async () => {
    const err = new Error('denied');
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(err),
        enumerateDevices: vi.fn()
      },
      configurable: true
    });

    const res = await WebRTCUtils.requestMicrophonePermissions();
    expect(res.granted).toBe(false);
    expect(res.error).toBe(err);
  });

  it('lists audio input devices', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(),
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'v1', label: 'Cam' },
          { kind: 'audioinput', deviceId: 'm1', label: 'Mic 1' },
          { kind: 'audioinput', deviceId: 'm2', label: '' }
        ])
      },
      configurable: true
    });

    const res = await WebRTCUtils.listAudioInputDevices();
    expect(res.success).toBe(true);
    expect(res.devices.length).toBe(2);
    expect(res.devices[0].label).toContain('Mic');
  });
});
