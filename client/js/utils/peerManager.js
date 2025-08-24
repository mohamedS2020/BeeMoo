// BeeMoo - Peer Manager
// Manages per-peer RTCPeerConnection and integrates with RTCSignaling

import { RTCSignaling } from './rtcSignaling.js';
import { WebRTCUtils } from './webrtc.js';

export class PeerManager {
  constructor(socketClient, localStreamProvider) {
    this.socketClient = socketClient;
    this.signaling = new RTCSignaling(socketClient);
    this.peerIdToPc = new Map();
    this.localStreamProvider = localStreamProvider; // () => Promise<MediaStream>
    this.onRemoteTrack = null; // (peerId, MediaStream) => void
    this.onRemoteVideoTrack = null; // (peerId, MediaStream) => void
    this.currentLocalStream = null;
    this.currentVideoStream = null;
    this.isHost = false;
    this.videoQuality = 'high';
    this.connectionQuality = new Map(); // peerId -> quality metrics
    
    // SIMPLE: Keep track of what we've added to each peer
    this.peerTracks = new Map(); // peerId -> { mic: sender, video: sender, videoAudio: sender }

    // Bind signaling events
    this.signaling.onOffer(async ({ from, sdp }) => {
      await this.handleOffer(from, sdp);
    });
    this.signaling.onAnswer(async ({ from, sdp }) => {
      await this.handleAnswer(from, sdp);
    });
    this.signaling.onIceCandidate(async ({ from, candidate }) => {
      const pc = this.peerIdToPc.get(from);
      if (pc && candidate) {
        try { await pc.addIceCandidate(candidate); } catch {}
      }
    });
  }

  async ensurePeer(peerId) {
    if (this.peerIdToPc.has(peerId)) return this.peerIdToPc.get(peerId);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    });

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.signaling.sendIceCandidate(evt.candidate, peerId);
      }
    };

    pc.ontrack = (evt) => {
      if (evt.streams && evt.streams[0]) {
        const stream = evt.streams[0];
        const track = evt.track;
        
        console.log(`📡 Received ${track.kind} track from peer ${peerId}:`, {
          trackId: track.id,
          trackLabel: track.label,
          streamId: stream.id,
          streamTracks: {
            video: stream.getVideoTracks().length,
            audio: stream.getAudioTracks().length
          }
        });
        
        // Handle voice chat audio tracks (separate from video audio)
        if (track.kind === 'audio' && track.label !== 'video-audio' && this.onRemoteTrack) {
          console.log(`🎙️ Voice chat audio track from peer ${peerId}:`, {
            trackId: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            settings: track.getSettings ? track.getSettings() : 'N/A'
          });
          this.onRemoteTrack(peerId, stream);
        }
        
        // Handle video tracks (and their associated video stream)
        if (track.kind === 'video' && this.onRemoteVideoTrack) {
          console.log(`🎥 Video track from peer ${peerId} - calling onRemoteVideoTrack`);
          this.onRemoteVideoTrack(peerId, stream);
        }
        
        // Handle video audio tracks
        if (track.kind === 'audio' && (track.label === 'video-audio' || stream.getVideoTracks().length > 0)) {
          console.log(`🔊 Video audio track from peer ${peerId} - will be handled with video stream`);
          // Video audio will be handled by the video element when stream is assigned
        }
      }
    };

    // Monitor connection quality for adaptive streaming
    pc.oniceconnectionstatechange = () => {
      console.log(`🔌 ICE connection state for peer ${peerId}: ${pc.iceConnectionState}`);
      this.updateConnectionQuality(peerId, pc);
    };

    pc.onconnectionstatechange = () => {
      console.log(`🔗 Connection state for peer ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        console.log(`✅ Peer ${peerId} successfully connected`);
      } else if (pc.connectionState === 'failed') {
        console.error(`❌ Connection to peer ${peerId} failed, attempting restart...`);
        // Attempt to restart the connection
        setTimeout(() => {
          if (pc.connectionState === 'failed') {
            console.log(`🔄 Restarting connection to peer ${peerId}`);
            this.restartConnection(peerId);
          }
        }, 2000);
      }
    };

    // Attach local audio tracks
    const local = await this._getOrCreateLocalStream();
    if (local && local.getAudioTracks().length > 0) {
      local.getTracks().forEach(track => {
        console.log(`🎙️ Adding ${track.kind} track to peer ${peerId}:`, {
          trackId: track.id,
          enabled: track.enabled,
          readyState: track.readyState
        });
        const sender = pc.addTrack(track, local);
        // Store microphone sender reference
        if (track.kind === 'audio') {
          this.peerTracks.set(peerId, { ...this.peerTracks.get(peerId), mic: sender });
        }
      });
    } else {
      console.warn(`⚠️ No local audio tracks available for peer ${peerId}`);
    }

    // Attach video stream if host and already streaming
    if (this.isHost && this.currentVideoStream) {
      // Add video tracks
      this.currentVideoStream.getVideoTracks().forEach(track => {
        const sender = pc.addTrack(track, this.currentVideoStream);
        this.peerTracks.set(peerId, { ...this.peerTracks.get(peerId), video: sender });
      });
      
      // Add video audio tracks with label
      this.currentVideoStream.getAudioTracks().forEach(track => {
        // Clone the track and set a label to distinguish it
        const clonedTrack = track.clone();
        Object.defineProperty(clonedTrack, 'label', {
          value: 'video-audio',
          writable: false
        });
        const sender = pc.addTrack(clonedTrack, this.currentVideoStream);
        this.peerTracks.set(peerId, { ...this.peerTracks.get(peerId), videoAudio: sender });
      });
    }

    this.peerIdToPc.set(peerId, pc);
    return pc;
  }

  async callPeer(peerId) {
    console.log(`📞 Initiating call to peer ${peerId}`);
    const pc = await this.ensurePeer(peerId);
    
    // Ensure we have local tracks before creating offer
    const localStream = await this._getOrCreateLocalStream();
    if (!localStream || localStream.getAudioTracks().length === 0) {
      console.error(`❌ No local audio tracks available for call to ${peerId}`);
      return;
    }
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendOffer(offer, peerId);
    console.log(`📞 Sent offer to peer ${peerId}`);
  }

  async handleOffer(fromPeerId, sdp) {
    console.log(`📞 Received offer from peer ${fromPeerId}`);
    const pc = await this.ensurePeer(fromPeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.sendAnswer(answer, fromPeerId);
    console.log(`📞 Sent answer to peer ${fromPeerId}`);
  }

  async handleAnswer(fromPeerId, sdp) {
    console.log(`📞 Received answer from peer ${fromPeerId}`);
    const pc = this.peerIdToPc.get(fromPeerId);
    if (!pc) {
      console.warn(`⚠️ No peer connection found for ${fromPeerId}`);
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    console.log(`✅ Connection established with peer ${fromPeerId}`);
  }

  closePeer(peerId) {
    const pc = this.peerIdToPc.get(peerId);
    if (pc) {
      pc.getSenders().forEach(s => { try { pc.removeTrack(s); } catch {} });
      pc.close();
      this.peerIdToPc.delete(peerId);
      // Clean up sender references
      this.peerTracks.delete(peerId);
    }
  }

  /**
   * Start video streaming from host to all participants
   * SIMPLE: Just add video tracks without touching microphone tracks
   */
  async startVideoStreaming(videoElement, options = {}) {
    try {
      if (!this.isHost) {
        throw new Error('Only hosts can start video streaming');
      }

      if (!videoElement || typeof videoElement.captureStream !== 'function') {
        const errorMessage = 'Video element does not support captureStream';
        console.error(`❌ ${errorMessage}`);
        return { success: false, error: errorMessage };
      }

      // Create video stream from video element
      const result = WebRTCUtils.createVideoStreamFromElement(videoElement, options);
      if (!result.success) {
        console.error(`❌ Failed to create video stream: ${result.error?.message}`);
        return { success: false, error: `Failed to create video stream: ${result.error?.message}` };
      }

      this.currentVideoStream = result.stream;
      console.log('🎥 Video streaming started successfully');

      // SIMPLE: Just add video tracks to existing peer connections
      // Don't touch microphone tracks at all - keep them separate
      for (const [peerId, pc] of this.peerIdToPc.entries()) {
        console.log(`🎥 Adding video tracks to peer ${peerId}`);
        
        // Add video tracks
        for (const track of this.currentVideoStream.getVideoTracks()) {
          const sender = pc.addTrack(track, this.currentVideoStream);
          this.peerTracks.set(peerId, { ...this.peerTracks.get(peerId), video: sender });
          console.log(`🎥 Added video track to peer ${peerId}`);
        }
        
        // Add video audio tracks (movie audio) with label
        for (const track of this.currentVideoStream.getAudioTracks()) {
          // Clone the track and set a label to distinguish it from mic audio
          const clonedTrack = track.clone();
          Object.defineProperty(clonedTrack, 'label', {
            value: 'video-audio',
            writable: false
          });
          const sender = pc.addTrack(clonedTrack, this.currentVideoStream);
          this.peerTracks.set(peerId, { ...this.peerTracks.get(peerId), videoAudio: sender });
          console.log(`🔊 Added video audio track to peer ${peerId}`);
        }
        
        // Log what we have
        const peerTrackInfo = this.peerTracks.get(peerId) || {};
        console.log(`📊 Peer ${peerId} tracks:`, {
          hasMic: !!peerTrackInfo.mic,
          hasVideo: !!peerTrackInfo.video,
          hasVideoAudio: !!peerTrackInfo.videoAudio
        });
        
        // Renegotiate to include video tracks
        await this.renegotiatePeer(peerId);
      }

      return { success: true, stream: this.currentVideoStream };
      
    } catch (error) {
      console.error('❌ Failed to start video streaming:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop video streaming
   * SIMPLE: Just remove video tracks, leave microphone tracks alone
   */
  async stopVideoStreaming() {
    if (!this.currentVideoStream) return;

    try {
      console.log('🎥 Stopping video streaming...');
      
      // SIMPLE: Remove only video-related tracks from all peer connections
      // Don't touch microphone tracks at all
      for (const [peerId, pc] of this.peerIdToPc.entries()) {
        const peerTrackInfo = this.peerTracks.get(peerId) || {};
        
        // Remove video senders
        if (peerTrackInfo.video) {
          pc.removeTrack(peerTrackInfo.video);
          console.log(`🎥 Removed video track from peer ${peerId}`);
        }
        
        // Remove video audio senders
        if (peerTrackInfo.videoAudio) {
          pc.removeTrack(peerTrackInfo.videoAudio);
          console.log(`🔊 Removed video audio track from peer ${peerId}`);
        }
        
        // Update peer tracks info
        this.peerTracks.set(peerId, {
          ...peerTrackInfo,
          video: undefined,
          videoAudio: undefined
        });
      }

      // Stop video stream tracks
      this.currentVideoStream.getTracks().forEach(track => track.stop());
      this.currentVideoStream = null;

      // Renegotiate all connections
      for (const peerId of this.peerIdToPc.keys()) {
        await this.renegotiatePeer(peerId);
      }

      console.log('🎥 Video streaming stopped');
      return { success: true };
      
    } catch (error) {
      console.error('❌ Failed to stop video streaming:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Manually reset critical operation flag (for debugging/testing)
   */
  resetCriticalOperationFlag() {
    this.isPerformingCriticalOperation = false;
    console.log('🔓 Critical operation flag manually reset');
  }

  /**
   * Configure video sender with quality parameters
   */
  async configureVideoSender(sender, peerId) {
    try {
      const params = sender.getParameters();
      if (!params.encodings) return;

      // Apply quality settings
      const encoding = params.encodings[0];
      if (encoding) {
        encoding.maxBitrate = this.getMaxBitrate();
        encoding.scaleResolutionDownBy = this.getScaleFactor();
        encoding.degradationPreference = 'maintain-resolution';
        
        await sender.setParameters(params);
        console.log(`🎥 Configured video sender for peer ${peerId}:`, {
          maxBitrate: encoding.maxBitrate,
          scaleResolutionDownBy: encoding.scaleResolutionDownBy,
          degradationPreference: encoding.degradationPreference
        });
      }
    } catch (error) {
      console.warn(`⚠️ Failed to configure video sender for peer ${peerId}:`, error);
    }
  }

  /**
   * Get max bitrate based on quality setting
   */
  getMaxBitrate() {
    const bitrates = {
      low: 500000,
      medium: 1000000,
      high: 2500000,
      ultra: 4000000
    };
    return bitrates[this.videoQuality] || bitrates.high;
  }

  /**
   * Get scale factor based on quality setting
   */
  getScaleFactor() {
    const factors = {
      low: 4,
      medium: 2,
      high: 1,
      ultra: 1
    };
    return factors[this.videoQuality] || factors.high;
  }

  /**
   * Get connection quality metrics for a peer
   */
  getConnectionQuality(peerId) {
    return this.connectionQuality.get(peerId) || { speed: 'fast', latency: 0 };
  }

  /**
   * Update connection quality metrics
   */
  updateConnectionQuality(peerId, pc) {
    const quality = {
      speed: 'fast',
      latency: 0,
      iceState: pc.iceConnectionState,
      connectionState: pc.connectionState
    };
    
    // Simple quality assessment
    if (pc.iceConnectionState === 'connected' && pc.connectionState === 'connected') {
      quality.speed = 'fast';
    } else if (pc.iceConnectionState === 'checking') {
      quality.speed = 'medium';
    } else {
      quality.speed = 'slow';
    }
    
    this.connectionQuality.set(peerId, quality);
  }

  /**
   * Restart connection to a peer
   */
  async restartConnection(peerId) {
    try {
      console.log(`🔄 Restarting connection to peer ${peerId}`);
      // Close existing connection
      this.closePeer(peerId);
      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Recreate connection
      await this.callPeer(peerId);
    } catch (error) {
      console.error(`❌ Failed to restart connection to peer ${peerId}:`, error);
    }
  }

  /**
   * Set video quality for streaming
   */
  setVideoQuality(quality) {
    this.videoQuality = quality;
    console.log(`🎥 Video quality set to: ${quality}`);
  }

  /**
   * Set whether this peer is the host
   */
  setHost(isHost) {
    this.isHost = isHost;
    console.log(`🎥 Peer role set to: ${isHost ? 'HOST' : 'PARTICIPANT'}`);
  }

  async _getOrCreateLocalStream() {
    if (this.currentLocalStream) {
      // Check if stream is still active
      const activeTracks = this.currentLocalStream.getTracks().filter(t => t.readyState === 'live');
      if (activeTracks.length > 0) {
        return this.currentLocalStream;
      }
    }
    
    console.log('🎙️ Creating new local audio stream...');
    try {
      this.currentLocalStream = await this.localStreamProvider();
      console.log('✅ Local audio stream created:', {
        tracks: this.currentLocalStream.getTracks().length,
        audio: this.currentLocalStream.getAudioTracks().length
      });
      return this.currentLocalStream;
    } catch (error) {
      console.error('❌ Failed to create local stream:', error);
      throw error;
    }
  }

  /**
   * Renegotiate peer connection (for adding/removing tracks)
   * SIMPLE: Just renegotiate, don't touch existing tracks
   */
  async renegotiatePeer(peerId) {
    const pc = this.peerIdToPc.get(peerId);
    if (!pc) return;

    try {
      console.log(`🔄 Renegotiating peer ${peerId}`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signaling.sendOffer(offer, peerId);
    } catch (error) {
      console.error(`❌ Failed to renegotiate peer ${peerId}:`, error);
    }
  }

  /**
   * Ensure local stream is available
   */
  async ensureLocalStream() {
    return await this._getOrCreateLocalStream();
  }

  /**
   * Destroy all connections and clean up
   */
  destroy() {
    // Stop video streaming if active
    if (this.currentVideoStream) {
      this.currentVideoStream.getTracks().forEach(track => track.stop());
      this.currentVideoStream = null;
    }

    // Close all peer connections
    for (const peerId of Array.from(this.peerIdToPc.keys())) {
      this.closePeer(peerId);
    }
    
    // Clean up
    this.signaling.offAll();
    this.connectionQuality.clear();
    this.peerTracks.clear();
  }
}