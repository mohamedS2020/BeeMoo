import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RTCSignaling } from '../js/utils/rtcSignaling.js';

describe('RTCSignaling', () => {
  let mockSocketClient;
  let rtcSignaling;

  beforeEach(() => {
    // Create mock socket client
    mockSocketClient = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn()
    };
    
    // Create RTCSignaling instance
    rtcSignaling = new RTCSignaling(mockSocketClient);
  });

  afterEach(() => {
    // Clean up
    rtcSignaling.offAll();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(rtcSignaling.socket).toBe(mockSocketClient);
      expect(rtcSignaling.handlers).toEqual({
        offer: null,
        answer: null,
        ice: null
      });
    });

    it('should store reference to socket client', () => {
      expect(rtcSignaling.socket).toBe(mockSocketClient);
    });
  });

  describe('onOffer()', () => {
    it('should register offer handler and socket listener', () => {
      const offerHandler = vi.fn();
      
      rtcSignaling.onOffer(offerHandler);
      
      expect(rtcSignaling.handlers.offer).toBe(offerHandler);
      expect(mockSocketClient.on).toHaveBeenCalledWith('webrtc-offer', offerHandler);
    });

    it('should replace existing offer handler', () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();
      
      rtcSignaling.onOffer(firstHandler);
      rtcSignaling.onOffer(secondHandler);
      
      expect(rtcSignaling.handlers.offer).toBe(secondHandler);
      expect(mockSocketClient.on).toHaveBeenCalledTimes(2);
      expect(mockSocketClient.on).toHaveBeenLastCalledWith('webrtc-offer', secondHandler);
    });

    it('should handle null handler', () => {
      rtcSignaling.onOffer(null);
      
      expect(rtcSignaling.handlers.offer).toBe(null);
      expect(mockSocketClient.on).toHaveBeenCalledWith('webrtc-offer', null);
    });
  });

  describe('onAnswer()', () => {
    it('should register answer handler and socket listener', () => {
      const answerHandler = vi.fn();
      
      rtcSignaling.onAnswer(answerHandler);
      
      expect(rtcSignaling.handlers.answer).toBe(answerHandler);
      expect(mockSocketClient.on).toHaveBeenCalledWith('webrtc-answer', answerHandler);
    });

    it('should replace existing answer handler', () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();
      
      rtcSignaling.onAnswer(firstHandler);
      rtcSignaling.onAnswer(secondHandler);
      
      expect(rtcSignaling.handlers.answer).toBe(secondHandler);
      expect(mockSocketClient.on).toHaveBeenCalledTimes(2);
      expect(mockSocketClient.on).toHaveBeenLastCalledWith('webrtc-answer', secondHandler);
    });
  });

  describe('onIceCandidate()', () => {
    it('should register ICE candidate handler and socket listener', () => {
      const iceHandler = vi.fn();
      
      rtcSignaling.onIceCandidate(iceHandler);
      
      expect(rtcSignaling.handlers.ice).toBe(iceHandler);
      expect(mockSocketClient.on).toHaveBeenCalledWith('webrtc-ice-candidate', iceHandler);
    });

    it('should replace existing ICE handler', () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();
      
      rtcSignaling.onIceCandidate(firstHandler);
      rtcSignaling.onIceCandidate(secondHandler);
      
      expect(rtcSignaling.handlers.ice).toBe(secondHandler);
      expect(mockSocketClient.on).toHaveBeenCalledTimes(2);
      expect(mockSocketClient.on).toHaveBeenLastCalledWith('webrtc-ice-candidate', secondHandler);
    });
  });

  describe('offAll()', () => {
    it('should remove all handlers and socket listeners', () => {
      const offerHandler = vi.fn();
      const answerHandler = vi.fn();
      const iceHandler = vi.fn();
      
      // Register all handlers
      rtcSignaling.onOffer(offerHandler);
      rtcSignaling.onAnswer(answerHandler);
      rtcSignaling.onIceCandidate(iceHandler);
      
      // Remove all
      rtcSignaling.offAll();
      
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-offer', offerHandler);
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-answer', answerHandler);
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-ice-candidate', iceHandler);
      
      expect(rtcSignaling.handlers).toEqual({
        offer: null,
        answer: null,
        ice: null
      });
    });

    it('should handle offAll when no handlers are registered', () => {
      expect(() => rtcSignaling.offAll()).not.toThrow();
      
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-offer', null);
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-answer', null);
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-ice-candidate', null);
    });

    it('should handle partial handlers registered', () => {
      const offerHandler = vi.fn();
      rtcSignaling.onOffer(offerHandler);
      
      rtcSignaling.offAll();
      
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-offer', offerHandler);
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-answer', null);
      expect(mockSocketClient.off).toHaveBeenCalledWith('webrtc-ice-candidate', null);
    });
  });

  describe('sendOffer()', () => {
    it('should emit webrtc-offer with SDP and target', () => {
      const sdp = { type: 'offer', sdp: 'test-offer-sdp' };
      const targetPeer = 'peer-123';
      
      rtcSignaling.sendOffer(sdp, targetPeer);
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-offer', {
        sdp: sdp,
        to: targetPeer
      });
    });

    it('should emit webrtc-offer without target (broadcast)', () => {
      const sdp = { type: 'offer', sdp: 'test-offer-sdp' };
      
      rtcSignaling.sendOffer(sdp);
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-offer', {
        sdp: sdp,
        to: undefined
      });
    });

    it('should handle null SDP', () => {
      rtcSignaling.sendOffer(null, 'peer-123');
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-offer', {
        sdp: null,
        to: 'peer-123'
      });
    });
  });

  describe('sendAnswer()', () => {
    it('should emit webrtc-answer with SDP and target', () => {
      const sdp = { type: 'answer', sdp: 'test-answer-sdp' };
      const targetPeer = 'peer-456';
      
      rtcSignaling.sendAnswer(sdp, targetPeer);
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-answer', {
        sdp: sdp,
        to: targetPeer
      });
    });

    it('should emit webrtc-answer without target (broadcast)', () => {
      const sdp = { type: 'answer', sdp: 'test-answer-sdp' };
      
      rtcSignaling.sendAnswer(sdp);
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-answer', {
        sdp: sdp,
        to: undefined
      });
    });
  });

  describe('sendIceCandidate()', () => {
    it('should emit webrtc-ice-candidate with candidate and target', () => {
      const candidate = {
        candidate: 'candidate:1 UDP 2122194687 192.168.1.100 54400 typ host',
        sdpMLineIndex: 0,
        sdpMid: '0'
      };
      const targetPeer = 'peer-789';
      
      rtcSignaling.sendIceCandidate(candidate, targetPeer);
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-ice-candidate', {
        candidate: candidate,
        to: targetPeer
      });
    });

    it('should emit webrtc-ice-candidate without target (broadcast)', () => {
      const candidate = {
        candidate: 'candidate:1 UDP 2122194687 192.168.1.100 54400 typ host',
        sdpMLineIndex: 0,
        sdpMid: '0'
      };
      
      rtcSignaling.sendIceCandidate(candidate);
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-ice-candidate', {
        candidate: candidate,
        to: undefined
      });
    });

    it('should handle null candidate', () => {
      rtcSignaling.sendIceCandidate(null, 'peer-123');
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-ice-candidate', {
        candidate: null,
        to: 'peer-123'
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete WebRTC signaling flow', () => {
      const offerHandler = vi.fn();
      const answerHandler = vi.fn();
      const iceHandler = vi.fn();
      
      // Set up all handlers
      rtcSignaling.onOffer(offerHandler);
      rtcSignaling.onAnswer(answerHandler);
      rtcSignaling.onIceCandidate(iceHandler);
      
      // Verify all handlers are registered
      expect(mockSocketClient.on).toHaveBeenCalledTimes(3);
      expect(rtcSignaling.handlers.offer).toBe(offerHandler);
      expect(rtcSignaling.handlers.answer).toBe(answerHandler);
      expect(rtcSignaling.handlers.ice).toBe(iceHandler);
      
      // Send various messages
      const offerSdp = { type: 'offer', sdp: 'offer-sdp' };
      const answerSdp = { type: 'answer', sdp: 'answer-sdp' };
      const iceCandidate = { candidate: 'ice-candidate', sdpMLineIndex: 0 };
      
      rtcSignaling.sendOffer(offerSdp, 'peer-1');
      rtcSignaling.sendAnswer(answerSdp, 'peer-1');
      rtcSignaling.sendIceCandidate(iceCandidate, 'peer-1');
      
      expect(mockSocketClient.emit).toHaveBeenCalledTimes(3);
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(1, 'webrtc-offer', {
        sdp: offerSdp,
        to: 'peer-1'
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(2, 'webrtc-answer', {
        sdp: answerSdp,
        to: 'peer-1'
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(3, 'webrtc-ice-candidate', {
        candidate: iceCandidate,
        to: 'peer-1'
      });
      
      // Clean up
      rtcSignaling.offAll();
      expect(mockSocketClient.off).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple peer connections', () => {
      const offerSdp = { type: 'offer', sdp: 'multi-peer-offer' };
      
      // Send to multiple peers
      rtcSignaling.sendOffer(offerSdp, 'peer-1');
      rtcSignaling.sendOffer(offerSdp, 'peer-2');
      rtcSignaling.sendOffer(offerSdp, 'peer-3');
      
      expect(mockSocketClient.emit).toHaveBeenCalledTimes(3);
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(1, 'webrtc-offer', {
        sdp: offerSdp,
        to: 'peer-1'
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(2, 'webrtc-offer', {
        sdp: offerSdp,
        to: 'peer-2'
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(3, 'webrtc-offer', {
        sdp: offerSdp,
        to: 'peer-3'
      });
    });

    it('should handle broadcast messages (no target)', () => {
      const offerSdp = { type: 'offer', sdp: 'broadcast-offer' };
      const answerSdp = { type: 'answer', sdp: 'broadcast-answer' };
      const iceCandidate = { candidate: 'broadcast-ice' };
      
      rtcSignaling.sendOffer(offerSdp);
      rtcSignaling.sendAnswer(answerSdp);
      rtcSignaling.sendIceCandidate(iceCandidate);
      
      expect(mockSocketClient.emit).toHaveBeenCalledTimes(3);
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(1, 'webrtc-offer', {
        sdp: offerSdp,
        to: undefined
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(2, 'webrtc-answer', {
        sdp: answerSdp,
        to: undefined
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(3, 'webrtc-ice-candidate', {
        candidate: iceCandidate,
        to: undefined
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle socket client being null', () => {
      const nullSignaling = new RTCSignaling(null);
      
      expect(() => {
        nullSignaling.onOffer(vi.fn());
        nullSignaling.sendOffer({ type: 'offer' });
        nullSignaling.offAll();
      }).not.toThrow();
    });

    it('should handle invalid handler types', () => {
      expect(() => {
        rtcSignaling.onOffer('not-a-function');
        rtcSignaling.onAnswer(123);
        rtcSignaling.onIceCandidate({});
      }).not.toThrow();
    });

    it('should handle malformed SDP data', () => {
      const malformedSdp = { invalidProperty: 'test' };
      
      expect(() => {
        rtcSignaling.sendOffer(malformedSdp, 'peer-1');
        rtcSignaling.sendAnswer(malformedSdp, 'peer-1');
      }).not.toThrow();
      
      expect(mockSocketClient.emit).toHaveBeenCalledTimes(2);
    });

    it('should handle malformed ICE candidate data', () => {
      const malformedCandidate = { invalid: 'data' };
      
      expect(() => {
        rtcSignaling.sendIceCandidate(malformedCandidate, 'peer-1');
      }).not.toThrow();
      
      expect(mockSocketClient.emit).toHaveBeenCalledWith('webrtc-ice-candidate', {
        candidate: malformedCandidate,
        to: 'peer-1'
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple offAll calls', () => {
      rtcSignaling.onOffer(vi.fn());
      
      rtcSignaling.offAll();
      rtcSignaling.offAll();
      rtcSignaling.offAll();
      
      expect(mockSocketClient.off).toHaveBeenCalledTimes(6); // 3 calls × 2 offAll()
    });

    it('should handle handler replacement after offAll', () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();
      
      rtcSignaling.onOffer(firstHandler);
      rtcSignaling.offAll();
      rtcSignaling.onOffer(secondHandler);
      
      expect(rtcSignaling.handlers.offer).toBe(secondHandler);
      expect(mockSocketClient.on).toHaveBeenLastCalledWith('webrtc-offer', secondHandler);
    });

    it('should handle empty string targets', () => {
      const sdp = { type: 'offer', sdp: 'test' };
      
      rtcSignaling.sendOffer(sdp, '');
      rtcSignaling.sendAnswer(sdp, '');
      rtcSignaling.sendIceCandidate({}, '');
      
      expect(mockSocketClient.emit).toHaveBeenCalledTimes(3);
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(1, 'webrtc-offer', {
        sdp: sdp,
        to: ''
      });
    });

    it('should handle numeric and boolean targets', () => {
      const sdp = { type: 'offer', sdp: 'test' };
      
      rtcSignaling.sendOffer(sdp, 123);
      rtcSignaling.sendAnswer(sdp, true);
      rtcSignaling.sendIceCandidate({}, false);
      
      expect(mockSocketClient.emit).toHaveBeenCalledTimes(3);
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(1, 'webrtc-offer', {
        sdp: sdp,
        to: 123
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(2, 'webrtc-answer', {
        sdp: sdp,
        to: true
      });
      expect(mockSocketClient.emit).toHaveBeenNthCalledWith(3, 'webrtc-ice-candidate', {
        candidate: {},
        to: false
      });
    });
  });
});