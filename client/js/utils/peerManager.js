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
        { urls: 'stun:stun.l.google.com:19302' }
      ]
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
          console.log(`🎙️ Voice chat audio track from peer ${peerId}`);
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
      this.updateConnectionQuality(peerId, pc);
    };

    // Attach local audio tracks
    const local = await this._getOrCreateLocalStream();
    local.getTracks().forEach(t => pc.addTrack(t, local));

    // Attach video stream if host
    if (this.isHost && this.currentVideoStream) {
      this.currentVideoStream.getVideoTracks().forEach(track => {
        const sender = pc.addTrack(track, this.currentVideoStream);
        this.configureVideoSender(sender, peerId);
      });
    }

    this.peerIdToPc.set(peerId, pc);
    return pc;
  }

  async callPeer(peerId) {
    const pc = await this.ensurePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendOffer(offer, peerId);
  }

  async handleOffer(fromPeerId, sdp) {
    const pc = await this.ensurePeer(fromPeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.sendAnswer(answer, fromPeerId);
  }

  async handleAnswer(fromPeerId, sdp) {
    const pc = this.peerIdToPc.get(fromPeerId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  closePeer(peerId) {
    const pc = this.peerIdToPc.get(peerId);
    if (pc) {
      pc.getSenders().forEach(s => { try { pc.removeTrack(s); } catch {} });
      pc.close();
      this.peerIdToPc.delete(peerId);
    }
  }

  async replaceLocalStream(newStream) {
    this.currentLocalStream = newStream;
    for (const pc of this.peerIdToPc.values()) {
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'audio');
      const newTrack = newStream.getAudioTracks()[0];
      for (const s of senders) {
        try { await s.replaceTrack(newTrack); } catch {}
      }
    }
  }

  /**
   * Start video streaming from host to all participants
   */
  async startVideoStreaming(videoElement, options = {}) {
    if (!this.isHost) {
      throw new Error('Only host can start video streaming');
    }

    try {
      // Check WebRTC support
      const support = WebRTCUtils.checkWebRTCSupport();
      if (!support.supported) {
        throw new Error('Browser does not support required WebRTC features');
      }

      // Create video stream from video element
      const result = WebRTCUtils.createVideoStreamFromElement(videoElement, options);
      if (!result.success) {
        throw new Error(`Failed to create video stream: ${result.error.message}`);
      }

      this.currentVideoStream = result.stream;
      console.log('🎥 Video streaming started successfully');

      // Add video and audio tracks to all existing peer connections
      for (const [peerId, pc] of this.peerIdToPc.entries()) {
        // Add video tracks
        for (const track of this.currentVideoStream.getVideoTracks()) {
          const sender = pc.addTrack(track, this.currentVideoStream);
          this.configureVideoSender(sender, peerId);
          console.log(`🎥 Added video track to peer ${peerId}`);
        }
        
        // Add audio tracks from video stream (movie audio)
        for (const track of this.currentVideoStream.getAudioTracks()) {
          const sender = pc.addTrack(track, this.currentVideoStream);
          console.log(`🔊 Added video audio track to peer ${peerId}:`, {
            id: track.id,
            label: track.label,
            enabled: track.enabled
          });
        }
        
        // Renegotiate connection to include video and audio
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
   */
  async stopVideoStreaming() {
    if (!this.currentVideoStream) return;

    try {
      // Remove video tracks from all peer connections
      for (const pc of this.peerIdToPc.values()) {
        const videoSenders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
        for (const sender of videoSenders) {
          pc.removeTrack(sender);
        }
      }

      // Stop video stream tracks
      this.currentVideoStream.getVideoTracks().forEach(track => track.stop());
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
   * Configure video sender with quality parameters
   */
  async configureVideoSender(sender, peerId) {
    if (!sender || !sender.track || sender.track.kind !== 'video') return;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      // Get connection quality for this peer
      const quality = this.getConnectionQuality(peerId);
      const encodingParams = WebRTCUtils.getVideoEncodingParams(this.videoQuality, quality);

      // Apply encoding parameters
      params.encodings[0].maxBitrate = encodingParams.maxBitrate;
      params.encodings[0].scaleResolutionDownBy = encodingParams.scaleResolutionDownBy;
      
      if (encodingParams.degradationPreference) {
        params.degradationPreference = encodingParams.degradationPreference;
      }

      await sender.setParameters(params);
      console.log(`🎥 Configured video sender for peer ${peerId}:`, encodingParams);
      
    } catch (error) {
      console.warn(`⚠️ Failed to configure video sender for peer ${peerId}:`, error);
    }
  }

  /**
   * Update connection quality metrics
   */
  updateConnectionQuality(peerId, pc) {
    if (!pc) return;

    pc.getStats().then(stats => {
      let quality = 'fast'; // default
      let rtt = 0;
      let packetLoss = 0;

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = report.currentRoundTripTime * 1000; // Convert to ms
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          packetLoss = report.packetsLost || 0;
        }
      });

      // Determine quality based on RTT and packet loss
      if (rtt > 500 || packetLoss > 5) {
        quality = 'slow';
      } else if (rtt > 200 || packetLoss > 2) {
        quality = 'medium';
      } else if (rtt < 100) {
        quality = 'excellent';
      }

      this.connectionQuality.set(peerId, quality);
      
      // Reconfigure video sender if quality changed significantly
      this.adaptVideoQuality(peerId, quality);
    }).catch(err => {
      console.warn(`⚠️ Failed to get stats for peer ${peerId}:`, err);
    });
  }

  /**
   * Adapt video quality based on connection
   */
  async adaptVideoQuality(peerId, quality) {
    const pc = this.peerIdToPc.get(peerId);
    if (!pc || !this.isHost) return;

    const videoSenders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
    for (const sender of videoSenders) {
      await this.configureVideoSender(sender, peerId);
    }
  }

  /**
   * Get connection quality for a peer
   */
  getConnectionQuality(peerId) {
    return this.connectionQuality.get(peerId) || 'fast';
  }

  /**
   * Renegotiate peer connection (for adding/removing tracks)
   */
  async renegotiatePeer(peerId) {
    const pc = this.peerIdToPc.get(peerId);
    if (!pc) return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signaling.sendOffer(offer, peerId);
    } catch (error) {
      console.error(`❌ Failed to renegotiate peer ${peerId}:`, error);
    }
  }

  /**
   * Set video quality for streaming
   */
  setVideoQuality(quality) {
    this.videoQuality = quality;
    console.log(`🎥 Video quality set to: ${quality}`);

    // Update all existing video senders
    if (this.isHost) {
      for (const peerId of this.peerIdToPc.keys()) {
        this.adaptVideoQuality(peerId, this.getConnectionQuality(peerId));
      }
    }
  }

  /**
   * Set whether this peer is the host
   */
  setHost(isHost) {
    this.isHost = isHost;
    console.log(`🎥 Peer role set to: ${isHost ? 'HOST' : 'PARTICIPANT'}`);
  }

  async _getOrCreateLocalStream() {
    if (this.currentLocalStream) return this.currentLocalStream;
    this.currentLocalStream = await this.localStreamProvider();
    return this.currentLocalStream;
  }

  destroy() {
    // Stop video streaming if active
    if (this.currentVideoStream) {
      this.currentVideoStream.getVideoTracks().forEach(track => track.stop());
      this.currentVideoStream = null;
    }

    // Close all peer connections
    for (const peerId of Array.from(this.peerIdToPc.keys())) {
      this.closePeer(peerId);
    }
    
    // Clean up
    this.signaling.offAll();
    this.connectionQuality.clear();
    
    console.log('🎥 PeerManager destroyed');
  }
}
