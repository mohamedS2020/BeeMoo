import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RTCSignaling } from '../js/utils/rtcSignaling.js';

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

describe('RTCSignaling', () => {
  let sig;

  beforeEach(() => {
    vi.clearAllMocks();
    sig = new RTCSignaling(mockSocket);
  });

  afterEach(() => {
    sig.offAll();
  });

  it('registers and unregisters offer handler', () => {
    const handler = vi.fn();
    sig.onOffer(handler);
    expect(mockSocket.on).toHaveBeenCalledWith('webrtc-offer', handler);
    sig.offAll();
    expect(mockSocket.off).toHaveBeenCalledWith('webrtc-offer', handler);
  });

  it('emits offer/answer/ice messages', () => {
    sig.sendOffer({ type: 'offer' }, 'peer1');
    sig.sendAnswer({ type: 'answer' }, 'peer1');
    sig.sendIceCandidate({ candidate: 'abc' }, 'peer1');

    expect(mockSocket.emit).toHaveBeenCalledWith('webrtc-offer', { sdp: { type: 'offer' }, to: 'peer1' });
    expect(mockSocket.emit).toHaveBeenCalledWith('webrtc-answer', { sdp: { type: 'answer' }, to: 'peer1' });
    expect(mockSocket.emit).toHaveBeenCalledWith('webrtc-ice-candidate', { candidate: { candidate: 'abc' }, to: 'peer1' });
  });
});
