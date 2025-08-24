/**
 * StreamStateManager - Manages WebRTC audio/video streaming states
 * Prevents audio conflicts and ensures predictable state transitions
 */
import { WebRTCUtils } from './webrtc.js';

export class StreamStateManager {
  constructor() {
    this.state = {
      // Audio states
      microphoneState: 'disconnected', // disconnected, connecting, connected, muted
      movieAudioState: 'unavailable',  // unavailable, available, streaming
      
      // Video states  
      videoState: 'none',              // none, loading, ready, streaming
      
      // Connection states
      connectionState: 'idle',         // idle, voice_only, video_ready, streaming
      
      // Peer states
      peers: new Map(),                // peerId -> peerState
      
      // Stream references
      streams: {
        microphone: null,
        video: null,
        movieAudio: null
      },
      
      // Audio context for debugging
      audioContext: null,
      lastTransition: null
    };
    
    this.listeners = new Map();
    this.transitions = new Map();
    
    this._setupTransitions();
    console.log('🏗️ StreamStateManager initialized');
  }

  // State transition definitions
  _setupTransitions() {
    this.transitions.set('START_VOICE_CHAT', {
      from: ['idle'],
      to: 'voice_only',
      actions: ['initializeMicrophone', 'connectPeers']
    });
    
    this.transitions.set('LOAD_VIDEO', {
      from: ['voice_only'],
      to: 'video_loading',
      actions: ['loadVideoFile']
    });
    
    this.transitions.set('VIDEO_READY', {
      from: ['voice_only', 'video_loading'],
      to: 'video_ready',
      actions: ['prepareVideoStreaming']
    });
    
    this.transitions.set('START_STREAMING', {
      from: ['video_ready'],
      to: 'streaming',
      actions: ['startVideoStreaming', 'preserveMicrophone']
    });
    
    this.transitions.set('STOP_STREAMING', {
      from: ['streaming'],
      to: 'voice_only',
      actions: ['stopVideoStreaming', 'preserveMicrophone']
    });
    
    this.transitions.set('PAUSE_STREAMING', {
      from: ['streaming'],
      to: 'video_ready',
      actions: ['pauseVideoStreaming', 'preserveMicrophone']
    });
    
    this.transitions.set('RESET_TO_VOICE', {
      from: ['video_ready', 'streaming', 'video_loading'],
      to: 'voice_only',
      actions: ['stopVideoStreaming', 'preserveMicrophone']
    });
  }

  // Safe state transitions
  async transition(event, payload = {}) {
    const transition = this.transitions.get(event);
    if (!transition) {
      console.warn(`⚠️ Unknown transition: ${event}`);
      return { success: false, error: `Unknown transition: ${event}` };
    }
    
    if (!transition.from.includes(this.state.connectionState)) {
      console.warn(`⚠️ Invalid transition ${event} from state ${this.state.connectionState}`);
      return { 
        success: false, 
        error: `Invalid transition ${event} from state ${this.state.connectionState}` 
      };
    }
    
    const oldState = this.state.connectionState;
    console.log(`🔄 State transition: ${oldState} → ${transition.to} (${event})`);
    
    try {
      // Execute actions in sequence
      for (const action of transition.actions) {
        await this._executeAction(action, payload);
      }
      
      // Update state
      this.state.connectionState = transition.to;
      this.state.lastTransition = {
        event,
        from: oldState,
        to: transition.to,
        timestamp: Date.now()
      };
      
      // Notify listeners
      this._notifyListeners('stateChanged', {
        from: oldState,
        to: transition.to,
        event,
        payload
      });
      
      console.log(`✅ State transition completed: ${oldState} → ${transition.to}`);
      return { success: true, newState: transition.to };
      
    } catch (error) {
      console.error(`❌ State transition failed: ${event}`, error);
      return { success: false, error: error.message };
    }
  }

  // Action implementations
  async _executeAction(action, payload) {
    console.log(`🎬 Executing action: ${action}`);
    
    switch (action) {
      case 'initializeMicrophone':
        await this._initializeMicrophone(payload);
        break;
      case 'connectPeers':
        await this._connectPeers(payload);
        break;
      case 'loadVideoFile':
        await this._loadVideoFile(payload);
        break;
      case 'prepareVideoStreaming':
        await this._prepareVideoStreaming(payload);
        break;
      case 'startVideoStreaming':
        await this._startVideoStreaming(payload);
        break;
      case 'stopVideoStreaming':
        await this._stopVideoStreaming(payload);
        break;
      case 'pauseVideoStreaming':
        await this._pauseVideoStreaming(payload);
        break;
      case 'preserveMicrophone':
        await this._preserveMicrophone(payload);
        break;
    }
  }

  async _initializeMicrophone({ peerManager }) {
    console.log('🎙️ Initializing microphone...');
    this.state.microphoneState = 'connecting';
    
    if (!peerManager.currentLocalStream) {
      await peerManager._getOrCreateLocalStream();
    }
    
    this.state.streams.microphone = peerManager.currentLocalStream;
    this.state.microphoneState = 'connected';
    console.log('🎙️ Microphone initialized successfully');
  }

  async _connectPeers({ peerManager }) {
    console.log('🔗 Connecting peers for voice chat...');
    // Peers are already connected, just ensure microphone is active
    for (const [peerId, sender] of peerManager.microphoneSenders.entries()) {
      if (sender.track) {
        sender.track.enabled = true;
        console.log(`🎙️ Microphone enabled for peer ${peerId}`);
      }
    }
  }

  async _loadVideoFile({ videoElement }) {
    console.log('🎬 Loading video file...');
    this.state.videoState = 'loading';
    // Video loading is handled externally, just update state
  }

  async _prepareVideoStreaming({ videoElement }) {
    console.log('🎥 Preparing video streaming...');
    this.state.videoState = 'ready';
    this.state.movieAudioState = 'available';
    console.log('🎥 Video streaming prepared');
  }

  async _startVideoStreaming({ peerManager, videoElement, options }) {
    console.log('🎥 Starting video streaming with combined audio...');
    this.state.videoState = 'streaming';
    
    // SOLUTION: Create combined audio stream (microphone + movie audio)
    const result = await WebRTCUtils.createCombinedAudioVideoStream(
      videoElement, 
      peerManager.currentLocalStream, 
      options
    );
    
    if (!result.success) {
      throw new Error(`Failed to create combined stream: ${result.error?.message}`);
    }
    
    this.state.streams.video = result.stream;
    this.state.audioContext = result.audioContext;
    this.state.micGain = result.micGain;
    this.state.movieGain = result.movieGain;
    this.state.cleanup = result.cleanup;
    
    // Add the SINGLE combined stream to all peers
    for (const [peerId, pc] of peerManager.peerIdToPc.entries()) {
      // Remove existing audio tracks to prevent conflicts
      const existingSenders = pc.getSenders();
      for (const sender of existingSenders) {
        if (sender.track && sender.track.kind === 'audio') {
          try {
            pc.removeTrack(sender);
            console.log(`🗑️ Removed existing audio track for peer ${peerId}`);
          } catch (error) {
            console.warn(`⚠️ Failed to remove existing audio track:`, error);
          }
        }
      }
      
      // Clear audio sender maps since we're using combined audio
      peerManager.microphoneSenders.delete(peerId);
      peerManager.movieAudioSenders.delete(peerId);
      
      // Add tracks from the combined stream
      for (const track of result.stream.getTracks()) {
        const sender = pc.addTrack(track, result.stream);
        
        if (track.kind === 'video') {
          peerManager.videoSenders.set(peerId, sender);
          peerManager.configureVideoSender(sender, peerId);
          console.log(`🎥 Added combined video track to peer ${peerId}`);
        } else if (track.kind === 'audio') {
          // This single audio track contains both microphone and movie audio
          peerManager.microphoneSenders.set(peerId, sender); // Store as microphone sender for compatibility
          console.log(`🎙️🔊 Added combined audio track (mic + movie) to peer ${peerId}:`, track.label);
        }
      }
      
      console.log(`📊 Peer ${peerId} now has combined stream:`, {
        totalSenders: pc.getSenders().length,
        videoTrack: peerManager.videoSenders.has(peerId),
        combinedAudioTrack: peerManager.microphoneSenders.has(peerId)
      });
    }
    
    console.log('✅ Video streaming started with combined audio (solves WebRTC limitation)');
  }

  async _stopVideoStreaming({ peerManager }) {
    console.log('🛑 Stopping combined video streaming...');
    
    // Remove video and combined audio tracks from all peers
    for (const [peerId, pc] of peerManager.peerIdToPc.entries()) {
      const videoSender = peerManager.videoSenders.get(peerId);
      if (videoSender) {
        try {
          pc.removeTrack(videoSender);
          peerManager.videoSenders.delete(peerId);
          console.log(`🗑️ Removed video track from peer ${peerId}`);
        } catch (error) {
          console.warn(`⚠️ Failed to remove video track from peer ${peerId}:`, error);
        }
      }
      
      // Remove combined audio sender (stored as microphone sender)
      const combinedAudioSender = peerManager.microphoneSenders.get(peerId);
      if (combinedAudioSender && combinedAudioSender.track && combinedAudioSender.track.label === 'combined-audio') {
        try {
          pc.removeTrack(combinedAudioSender);
          peerManager.microphoneSenders.delete(peerId);
          console.log(`🗑️ Removed combined audio track from peer ${peerId}`);
        } catch (error) {
          console.warn(`⚠️ Failed to remove combined audio track from peer ${peerId}:`, error);
        }
      }
    }
    
    // Stop video stream tracks
    if (this.state.streams.video) {
      this.state.streams.video.getTracks().forEach(track => {
        track.stop();
        console.log(`🛑 Stopped track: ${track.id} (${track.kind})`);
      });
      this.state.streams.video = null;
    }
    
    // Clean up Web Audio API context
    if (this.state.cleanup) {
      this.state.cleanup();
      this.state.cleanup = null;
      this.state.audioContext = null;
      this.state.micGain = null;
      this.state.movieGain = null;
    }
    
    // Re-add original microphone-only stream to all peers
    if (peerManager.currentLocalStream) {
      console.log('🔄 Re-adding microphone-only stream...');
      for (const [peerId, pc] of peerManager.peerIdToPc.entries()) {
        for (const track of peerManager.currentLocalStream.getTracks()) {
          if (track.kind === 'audio') {
            const sender = pc.addTrack(track, peerManager.currentLocalStream);
            peerManager.microphoneSenders.set(peerId, sender);
            console.log(`🎙️ Re-added microphone-only track for peer ${peerId}`);
          }
        }
      }
    }
    
    this.state.videoState = 'none';
    this.state.movieAudioState = 'unavailable';
    console.log('🛑 Combined video streaming stopped - reverted to microphone-only');
  }

  async _pauseVideoStreaming({ peerManager }) {
    console.log('⏸️ Pausing combined video streaming...');
    await this._stopVideoStreaming({ peerManager });
    this.state.videoState = 'ready';
  }

  async _preserveMicrophone({ peerManager }) {
    console.log('🛡️ Preserving microphone tracks...');
    
    // Ensure microphone tracks remain active and enabled
    for (const [peerId, sender] of peerManager.microphoneSenders.entries()) {
      if (sender.track) {
        sender.track.enabled = true;
        console.log(`🎙️ Preserved microphone for peer ${peerId}: ${sender.track.id}`);
      } else {
        console.warn(`⚠️ No microphone track found for peer ${peerId}`);
        
        // Re-add microphone if missing
        if (peerManager.currentLocalStream) {
          const pc = peerManager.peerIdToPc.get(peerId);
          if (pc) {
            for (const track of peerManager.currentLocalStream.getAudioTracks()) {
              const newSender = pc.addTrack(track, peerManager.currentLocalStream);
              peerManager.microphoneSenders.set(peerId, newSender);
              console.log(`🔧 Re-added microphone track for peer ${peerId}`);
            }
          }
        }
      }
    }
    
    this.state.microphoneState = 'connected';
    console.log('🛡️ Microphone preservation completed');
  }

  // State queries
  canStartStreaming() {
    return this.state.connectionState === 'video_ready';
  }

  canLoadVideo() {
    return this.state.connectionState === 'voice_only';
  }

  isMicrophoneActive() {
    return this.state.microphoneState === 'connected';
  }

  isStreaming() {
    return this.state.connectionState === 'streaming';
  }

  hasMovieAudio() {
    return this.state.movieAudioState === 'streaming';
  }

  canStopStreaming() {
    return this.state.connectionState === 'streaming';
  }

  // Event system
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  _notifyListeners(event, data) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ Listener error for ${event}:`, error);
      }
    });
  }

  // Debug helpers
  getCurrentState() {
    return {
      connection: this.state.connectionState,
      microphone: this.state.microphoneState,
      video: this.state.videoState,
      movieAudio: this.state.movieAudioState,
      peers: Array.from(this.state.peers.keys()),
      lastTransition: this.state.lastTransition,
      streams: {
        microphone: !!this.state.streams.microphone,
        video: !!this.state.streams.video,
        movieAudio: !!this.state.streams.movieAudio
      }
    };
  }

  getDetailedState() {
    return {
      ...this.getCurrentState(),
      availableTransitions: this._getAvailableTransitions(),
      streamDetails: {
        microphone: this.state.streams.microphone ? {
          id: this.state.streams.microphone.id,
          tracks: this.state.streams.microphone.getTracks().length
        } : null,
        video: this.state.streams.video ? {
          id: this.state.streams.video.id,
          tracks: this.state.streams.video.getTracks().length
        } : null,
        movieAudio: this.state.streams.movieAudio ? {
          id: this.state.streams.movieAudio.id,
          tracks: this.state.streams.movieAudio.getTracks().length
        } : null
      }
    };
  }

  _getAvailableTransitions() {
    const available = [];
    for (const [event, transition] of this.transitions.entries()) {
      if (transition.from.includes(this.state.connectionState)) {
        available.push(event);
      }
    }
    return available;
  }

  // Cleanup
  destroy() {
    console.log('🧹 Destroying StreamStateManager...');
    
    // Stop all streams
    Object.values(this.state.streams).forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    });
    
    // Clear listeners
    this.listeners.clear();
    this.transitions.clear();
    
    console.log('🧹 StreamStateManager destroyed');
  }
}
