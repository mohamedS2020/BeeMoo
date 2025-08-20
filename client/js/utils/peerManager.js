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
    
    // Track senders separately to maintain control
    this.microphoneSenders = new Map(); // peerId -> RTCRtpSender for mic audio
    this.videoSenders = new Map(); // peerId -> RTCRtpSender for video
    this.videoAudioSenders = new Map(); // peerId -> RTCRtpSender for video audio

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
          this.microphoneSenders.set(peerId, sender);
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
        this.videoSenders.set(peerId, sender);
        this.configureVideoSender(sender, peerId);
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
        this.videoAudioSenders.set(peerId, sender);
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
      this.microphoneSenders.delete(peerId);
      this.videoSenders.delete(peerId);
      this.videoAudioSenders.delete(peerId);
    }
  }

  async replaceLocalStream(newStream) {
    this.currentLocalStream = newStream;
    const newTrack = newStream.getAudioTracks()[0];
    
    // Only replace microphone tracks using our stored references
    for (const [peerId, sender] of this.microphoneSenders.entries()) {
      try {
        await sender.replaceTrack(newTrack);
        console.log(`🎙️ Replaced microphone audio track for peer ${peerId}`);
      } catch (error) {
        console.warn(`⚠️ Failed to replace audio track for peer ${peerId}:`, error);
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
        // First, ensure microphone track is still present
        if (!this.microphoneSenders.has(peerId) && this.currentLocalStream) {
          const micTracks = this.currentLocalStream.getAudioTracks();
          for (const track of micTracks) {
            const sender = pc.addTrack(track, this.currentLocalStream);
            this.microphoneSenders.set(peerId, sender);
            console.log(`🎙️ Re-added microphone track to peer ${peerId}`);
          }
        }
        
        // Add video tracks
        for (const track of this.currentVideoStream.getVideoTracks()) {
          const sender = pc.addTrack(track, this.currentVideoStream);
          this.videoSenders.set(peerId, sender);
          this.configureVideoSender(sender, peerId);
          console.log(`🎥 Added video track to peer ${peerId}`);
        }
        
        // Add audio tracks from video stream (movie audio) with label
        for (const track of this.currentVideoStream.getAudioTracks()) {
          // Clone the track and set a label to distinguish it from mic audio
          const clonedTrack = track.clone();
          Object.defineProperty(clonedTrack, 'label', {
            value: 'video-audio',
            writable: false
          });
          const sender = pc.addTrack(clonedTrack, this.currentVideoStream);
          this.videoAudioSenders.set(peerId, sender);
          console.log(`🔊 Added video audio track to peer ${peerId}:`, {
            id: clonedTrack.id,
            label: clonedTrack.label,
            enabled: clonedTrack.enabled
          });
        }
        
        // Verify all tracks are present
        const senders = pc.getSenders();
        const audioSenders = senders.filter(s => s.track && s.track.kind === 'audio');
        const videoSenderCount = senders.filter(s => s.track && s.track.kind === 'video').length;
        
        console.log(`📊 Peer ${peerId} track summary after video streaming:`, {
          totalSenders: senders.length,
          audioSenders: audioSenders.length,
          videoSenders: videoSenderCount,
          hasMicrophone: this.microphoneSenders.has(peerId),
          hasVideoAudio: this.videoAudioSenders.has(peerId),
          hasVideo: this.videoSenders.has(peerId)
        });
        
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
      // Remove only video-related tracks from all peer connections
      for (const [peerId, pc] of this.peerIdToPc.entries()) {
        // Remove video senders
        const videoSender = this.videoSenders.get(peerId);
        if (videoSender) {
          pc.removeTrack(videoSender);
          this.videoSenders.delete(peerId);
        }
        
        // Remove video audio senders
        const videoAudioSender = this.videoAudioSenders.get(peerId);
        if (videoAudioSender) {
          pc.removeTrack(videoAudioSender);
          this.videoAudioSenders.delete(peerId);
        }
        
        console.log(`🎥 Removed video and video audio tracks from peer ${peerId}`);
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

    const videoSender = this.videoSenders.get(peerId);
    if (videoSender) {
      await this.configureVideoSender(videoSender, peerId);
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

  async ensureLocalStream() {
    return await this._getOrCreateLocalStream();
  }

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
    this.microphoneSenders.clear();
    this.videoSenders.clear();
    this.videoAudioSenders.clear();
    
    console.log('🎥 PeerManager destroyed');
  }
}