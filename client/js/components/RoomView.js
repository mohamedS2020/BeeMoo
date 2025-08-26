// BeeMoo - Room View
// Minimal scaffold that hosts the audience list and room header

import { ParticipantList } from './ParticipantList.js';
import { WebRTCUtils } from '../utils/webrtc.js';
import { PeerManager } from '../utils/peerManager.js';
import { MovieFileSelector } from './MovieFileSelector.js';
import { VideoPlayer } from './VideoPlayer.js';

export class RoomView {
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.root = null;
    this.participantList = new ParticipantList(socketClient);
    this.movieFileSelector = null;
    this.videoPlayer = null;
    this.peerManager = null;
    this.voiceActive = false;
    this.participants = new Map();
    this.boundHandlers = false;
    this.isHost = false;
    this.selectedMovie = null;
    this.movieState = 'none'; // 'none', 'selecting', 'loading', 'ready', 'playing'
    this.pendingHostVideoStream = null; // Store video stream if received before VideoPlayer is ready

  // Remote host media combination for participants
  this.remoteHostVideoStream = null; // MediaStream with video (+ possibly video audio)
  this.remoteHostAudioStreams = []; // Array of MediaStreams containing host mic audio
  }

  mount(container, initialData) {
    if (!container) return;
    this.root = container;
    
    // Check if current user is host
    this.isHost = initialData?.user?.isHost || false;
    
    // Debug: Log host detection
    console.log('🔍 RoomView host detection:', {
      initialData: initialData,
      user: initialData?.user,
      isHost: this.isHost,
      socketId: this.socketClient?.socket?.id
    });
    
    this.root.innerHTML = this.render(initialData);

    const audienceContainer = this.root.querySelector('#audience-container');
    this.participantList.attach(audienceContainer);

    if (initialData?.participants) {
      this.participantList.setParticipants(initialData.participants);
      for (const p of initialData.participants) {
        if (p && p.socketId) this.participants.set(p.socketId, p);
      }
    }
    
    // CRITICAL FIX: Ensure host adds themselves to participants map for voice chat
    if (this.isHost && initialData?.user && this.socketClient?.socket?.id) {
      const hostUser = {
        socketId: this.socketClient.socket.id,
        username: initialData.user.username,
        isHost: true
      };
      this.participants.set(hostUser.socketId, hostUser);
      console.log('✅ Host added to participants map for voice chat:', hostUser);
    }

    // Initialize movie stage based on current state
    this.updateMovieStage();
    
    // Initialize MovieFileSelector for hosts
    if (this.isHost && (this.movieState === 'selecting' || this.movieState === 'none')) {
      this.initializeMovieFileSelector();
    }

    // Minimal mic permission CTA (non-blocking)
    const micBtn = this.root.querySelector('#request-mic');
    if (micBtn) {
      micBtn.addEventListener('click', async () => {
        micBtn.disabled = true;
        const res = await WebRTCUtils.requestMicrophonePermissions();
        if (!res.granted) {
          alert('Microphone permission denied. You can enable it later from browser settings.');
        }
        const list = await WebRTCUtils.listAudioInputDevices();
        console.log('🎙️ Devices:', list);
        micBtn.disabled = false;
      });
    }

    // Initialize PeerManager with a local stream provider
    this.peerManager = new PeerManager(this.socketClient, async () => {
      try {
        console.log(`🎙️ Requesting HIGH-QUALITY microphone access for ${this.isHost ? 'HOST' : 'PARTICIPANT'}`);
        
        // Use enhanced audio constraints for crystal clear voice
        const constraints = WebRTCUtils.getAudioConstraints({ 
          highQuality: true,  // Enable high-quality voice settings
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        });
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('✅ HIGH-QUALITY microphone access granted:', {
          tracks: stream.getAudioTracks().length,
          trackEnabled: stream.getAudioTracks()[0]?.enabled,
          sampleRate: stream.getAudioTracks()[0]?.getSettings?.()?.sampleRate,
          constraints: 'Enhanced for voice clarity'
        });
        return stream;
      } catch (e) {
        console.warn('⚠️ High-quality microphone not available, falling back to standard:', e.message);
        
        // Fallback to standard enhanced constraints
        try {
          const fallbackConstraints = WebRTCUtils.getAudioConstraints({ 
            highQuality: false,  // Disable some high-quality features for compatibility
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          });
          const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
          console.log('✅ Enhanced microphone access granted as fallback');
          return stream;
        } catch (fallbackError) {
          console.warn('⚠️ Microphone not available, using silent stream:', fallbackError.message);
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          return dest.stream; // silent stream
        }
      }
    });

    // Set peer manager role based on host status
    this.peerManager.setHost(this.isHost);

    // Render remote audio when tracks arrive (participants: route host audio into VideoPlayer instead of <audio>)
    this.peerManager.onRemoteTrack = (peerId, stream) => {
      try {
        const isLocalHost = this.isHost === true;
        const hostPeerId = this.getHostPeerId();
        const isFromHost = !!hostPeerId && peerId === hostPeerId;

        console.log(`🎙️ Handling remote track from ${peerId}:`, {
          isLocalHost,
          hostPeerId,
          isFromHost,
          streamId: stream.id,
          audioTracks: stream.getAudioTracks().length
        });

        // SIMPLIFIED: Always create audio element for voice chat - no special routing
        let el = this.root.querySelector(`audio[data-peer="${peerId}"]`);
        if (!el) {
          el = document.createElement('audio');
          el.dataset.peer = peerId;
          el.autoplay = true;
          el.playsInline = true;
          el.volume = 1.0;
          el.muted = false;
          this.root.appendChild(el);
          console.log(`🔊 Created audio element for peer ${peerId}`);
        }
        
        el.srcObject = stream;
        
        // Try to play explicitly to overcome autoplay restrictions
        el.play().then(() => {
          console.log(`✅ Audio playing for peer ${peerId}`);
        }).catch(error => {
          console.warn(`⚠️ Audio autoplay blocked for peer ${peerId}:`, error);
          // Show user notification to click to enable audio
          this.showAudioPlaybackNotification(peerId);
        });

      } catch (e) {
        console.error('Failed handling remote audio track:', e);
      }
    };

    // Handle remote video tracks for participants
    this.peerManager.onRemoteVideoTrack = (peerId, stream) => {
      console.log(`🎥 Received video stream from peer ${peerId}`);

      // If I'm a participant and this is from the host, use the video stream directly
      const hostPeerId = this.getHostPeerId();
      const isFromHost = !!hostPeerId && peerId === hostPeerId;
      if (!this.isHost && isFromHost) {
        console.log(`🎥 Participant received host video stream - attaching directly`);
        
        // Store stream for later attachment if VideoPlayer not ready
        this.pendingHostVideoStream = stream;
        
        if (this.videoPlayer && this.videoPlayer.videoElement) {
          this.attachHostVideoStream(stream);
        } else {
          console.log(`📦 Storing host video stream for later attachment`);
        }
        return;
      }

      // Fallback: non-host or unknown, attach video stream as-is
      this.handleRemoteVideoStream(peerId, stream);
    };

    // Hook participant-volume changes to adjust remote audio elements
    this.participantList.onVolumeChange = (socketId, volume) => {
      const hostPeerId = this.getHostPeerId();
      if (!this.isHost && socketId === hostPeerId) {
        // Host movie+mic audio volume is controlled by VideoPlayer now
        // Optionally, we could proxy this to videoPlayer.setVolume(volume)
        return;
      }
      const el = this.root.querySelector(`audio[data-peer="${socketId}"]`);
      if (el) el.volume = volume;
    };

    // Bind participant events
    this.bindRoomParticipantEvents();
    
    // Bind movie synchronization events
    this.bindMovieEvents();

    // Populate devices and bind audio controls
    this.populateMicDevices();

    // --- AUTO-START VOICE FOR ALL USERS ON ROOM JOIN ---
    // Start PeerManager/WebRTC immediately so host/participants get audio+video streams without manual click
    // This ensures participants joining mid-stream are synced and see/hear the host right away
    this.startVoice();

    // Audio controls
    const micToggle = this.root.querySelector('#mic-toggle');
    const applyBtn = this.root.querySelector('#apply-audio');
    const leaveBtn = this.root.querySelector('#leave-room');
    micToggle?.addEventListener('click', () => this.toggleMic(micToggle));
    applyBtn?.addEventListener('click', () => this.applyAudioSettings());
    leaveBtn?.addEventListener('click', () => this.handleLeaveRoom());
    
    // Copy room code functionality
    const copyBtn = this.root.querySelector('.copy-btn');
    const roomCode = this.root.querySelector('.room-code');
    if (copyBtn && roomCode) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(roomCode.textContent);
          copyBtn.textContent = '✅';
          setTimeout(() => {
            copyBtn.textContent = '📋';
          }, 2000);
        } catch (err) {
          console.warn('Failed to copy to clipboard:', err);
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = roomCode.textContent;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          copyBtn.textContent = '✅';
          setTimeout(() => {
            copyBtn.textContent = '📋';
          }, 2000);
        }
      });
      
      roomCode.addEventListener('click', () => {
        copyBtn.click();
      });
    }
    
    // Audio panel toggle
    const audioPanelToggle = this.root.querySelector('#audio-panel-toggle');
    const audioContent = this.root.querySelector('#audio-content');
    if (audioPanelToggle && audioContent) {
      audioPanelToggle.addEventListener('click', () => {
        const isVisible = audioContent.style.display !== 'none';
        audioContent.style.display = isVisible ? 'none' : 'block';
        audioPanelToggle.textContent = isVisible ? '⚙️' : '❌';
      });
    }
  }

  initializeMovieFileSelector() {
    console.log('🎬 Attempting to initialize MovieFileSelector:', {
      isHost: this.isHost,
      hasRoot: !!this.root
    });
    
    if (!this.isHost) {
      console.log('🚫 Not host, skipping file selector initialization');
      return;
    }
    
    const fileSelectorContainer = this.root.querySelector('#movie-file-selector-container');
    console.log('🎬 File selector container found:', !!fileSelectorContainer);
    
    if (!fileSelectorContainer) {
      console.error('❌ movie-file-selector-container not found in DOM');
      return;
    }
    
    this.movieFileSelector = new MovieFileSelector(
      this.socketClient,
      (movieData) => this.handleMovieSelected(movieData)
    );
    
    this.movieFileSelector.mount(fileSelectorContainer);
    console.log('✅ Movie file selector initialized for host');
  }

  async handleMovieSelected(movieData) {
    this.selectedMovie = movieData;
    this.movieState = 'loading';
    console.log('🎬 Movie selected:', movieData.name, movieData.size);
    
    try {
      // Update UI to show loading state
      this.updateMovieStage();
      
      // Change to ready state to create video player container
      this.movieState = 'ready';
      this.updateMovieStage();
      
      // Now initialize video player with the selected file
      const videoPlayerContainer = this.root.querySelector('#video-player-container');
      if (videoPlayerContainer) {
        this.videoPlayer = new VideoPlayer(
          this.socketClient,
          (state) => this.handleVideoStateChange(state)
        );
        
        // Initialize the video player with the file
        await this.videoPlayer.initializeWithFile(
          movieData.file,
          videoPlayerContainer,
          this.isHost
        );
        
        this.movieState = 'ready';
        console.log('✅ Video player initialized successfully');
        
        // Prepare video for streaming via state manager
        if (this.isHost && this.peerManager) {
          const prepResult = await this.peerManager.prepareVideoStreaming(this.videoPlayer.videoElement);
          if (prepResult.success) {
            console.log('🎬 Video prepared for streaming via state manager');
          } else {
            console.warn('⚠️ Failed to prepare video for streaming:', prepResult.error);
          }
        }
        
        // Wait for video metadata to load before notifying server
        await this.waitForVideoMetadata();
        
        // Start WebRTC video streaming if host
        if (this.isHost) {
          await this.startVideoStreaming();
        }
        
        // Get comprehensive video metadata from the video player
        const videoMetadata = this.getVideoMetadata(movieData);
        
        // Notify server about movie being ready with complete metadata
        this.socketClient.emit('movie-control', {
          action: 'start-streaming',
          movieState: videoMetadata
        });
        
      } else {
        throw new Error('Video player container not found');
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize video player:', error);
      this.movieState = 'error';
      this.updateMovieStage();
      
      // Show error to user
      alert(`Failed to load video: ${error.message}`);
    }
  }

  updateMovieStage() {
    const movieStage = this.root.querySelector('#movie-stage');
    if (!movieStage) return;
    
    switch (this.movieState) {
      case 'none':
      case 'selecting':
        // Show file selector for hosts, waiting screen for viewers
        movieStage.innerHTML = this.isHost ? 
          '<div id="movie-file-selector-container"></div>' :
          this.renderWaitingForHost();
        break;
        
      case 'loading':
        // Show loading state
        movieStage.innerHTML = this.renderLoadingState();
        break;
        
      case 'ready':
      case 'playing':
        // Show video player
        movieStage.innerHTML = `
          <div class="video-player-wrapper">
            <div id="video-player-container"></div>
            ${this.isHost ? this.renderHostControls() : ''}
          </div>
        `;
        this.bindMovieControls();
        break;
        
      case 'error':
        // Show error state
        movieStage.innerHTML = this.renderErrorState();
        this.bindMovieControls();
        break;
    }
  }
  
  renderWaitingForHost() {
    return `
      <div class="waiting-for-host">
        <div class="waiting-content">
          <svg class="waiting-icon" viewBox="0 0 24 24" width="64" height="64">
            <path fill="currentColor" d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.5L17,15L15.5,17.5L11.5,15V7H12.5Z" />
          </svg>
          <h3>Waiting for Host</h3>
          <p>The host will select and start the movie when ready.</p>
        </div>
      </div>
    `;
  }
  
  renderLoadingState() {
    return `
      <div class="movie-loading">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <h3>Loading Movie...</h3>
          <p>Preparing ${this.escapeHtml(this.selectedMovie?.name || 'video')} for streaming</p>
          <div class="loading-details">
            <div class="loading-stat">
              <span class="stat-label">Size:</span>
              <span class="stat-value">${this.formatFileSize(this.selectedMovie?.size || 0)}</span>
            </div>
            <div class="loading-stat">
              <span class="stat-label">Format:</span>
              <span class="stat-value">${this.escapeHtml(this.selectedMovie?.type || 'Unknown')}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  renderHostControls() {
    return `
      <div class="host-movie-controls">
        <button class="btn btn-secondary btn-small" id="change-movie" title="Select different movie">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M12,6V9L16,5L12,1V4A8,8 0 0,0 4,12C4,13.57 4.46,15.03 5.24,16.26L6.7,14.8C6.25,13.97 6,13 6,12A6,6 0 0,1 12,6M18.76,7.74L17.3,9.2C17.74,10.03 18,11 18,12A6,6 0 0,1 12,18V15L8,19L12,23V20A8,8 0 0,0 20,12C20,10.43 19.54,8.97 18.76,7.74Z" />
          </svg>
          Change Movie
        </button>
        <button class="btn btn-info btn-small" id="verify-mic" title="Verify microphone tracks">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z" />
          </svg>
          Verify Mic
        </button>
      </div>
    `;
  }
  
  renderErrorState() {
    return `
      <div class="movie-error">
        <div class="error-content">
          <div class="error-icon">⚠️</div>
          <h3>Movie Loading Failed</h3>
          <p>There was an error loading the selected movie file.</p>
          <div class="error-actions">
            <button class="btn btn-primary" id="retry-movie">Try Again</button>
            <button class="btn btn-secondary" id="change-movie">Select Different Movie</button>
          </div>
        </div>
      </div>
    `;
  }
  
  bindMovieControls() {
    const changeBtn = this.root.querySelector('#change-movie');
    const retryBtn = this.root.querySelector('#retry-movie');
    const verifyMicBtn = this.root.querySelector('#verify-mic');
    
    changeBtn?.addEventListener('click', async () => await this.changeMovie());
    retryBtn?.addEventListener('click', () => this.retryMovie());
    verifyMicBtn?.addEventListener('click', () => this.verifyMicrophoneTracks());
  }
  
  handleVideoStateChange(state) {
    console.log('🎬 Video state changed:', state);
    
    // Update movie state based on video player state
    if (state.isPlaying) {
      this.movieState = 'playing';
    } else if (this.movieState === 'playing') {
      this.movieState = 'ready';
    }
    
    // Emit state change events for other components to listen to
    this.emit('movie-state-change', {
      movieState: this.movieState,
      videoState: state,
      selectedMovie: this.selectedMovie
    });
  }

  async changeMovie() {
    // Clean up existing video player
    if (this.videoPlayer) {
      await this.videoPlayer.destroy();
      this.videoPlayer = null;
    }
    
    // Reset state
    this.selectedMovie = null;
    this.movieState = 'selecting';
    
    // Update UI to show file selector
    this.updateMovieStage();
    
    if (this.isHost) {
      this.initializeMovieFileSelector();
    }
    
    console.log('🔄 Movie selection reset');
  }
  
  async retryMovie() {
    if (!this.selectedMovie) {
      await this.changeMovie();
      return;
    }
    
    console.log('🔄 Retrying movie initialization...');
    
    // Clean up existing video player
    if (this.videoPlayer) {
      await this.videoPlayer.destroy();
      this.videoPlayer = null;
    }
    
    // Retry with the same movie data
    await this.handleMovieSelected(this.selectedMovie);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async unmount() {
    if (this.participantList) this.participantList.destroy();
    if (this.movieFileSelector) this.movieFileSelector.destroy();
    if (this.videoPlayer) await this.videoPlayer.destroy();
    if (this.peerManager) this.peerManager.destroy();
    
    // Stop microphone health check
    this.stopMicrophoneHealthCheck();
    
    this.unbindRoomParticipantEvents();
    if (this.root) this.root.innerHTML = '';
    this.root = null;
  }

  async populateMicDevices() {
    const select = this.root.querySelector('#mic-device');
    if (!select) return;
    const { devices } = await WebRTCUtils.listAudioInputDevices();
    select.innerHTML = '';
    (devices || []).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'Microphone';
      select.appendChild(opt);
    });
  }

  async toggleMic(buttonEl) {
    const local = this.peerManager?.currentLocalStream;
    const track = local?.getAudioTracks()[0];
    if (!track) return;
    
    const nextEnabled = !track.enabled;
    track.enabled = nextEnabled;
    
    // Update button appearance and text
    const muted = !nextEnabled;
    buttonEl.setAttribute('data-muted', muted);
    const micText = buttonEl.querySelector('.mic-text');
    if (micText) {
      micText.textContent = nextEnabled ? 'Mute Mic' : 'Unmute Mic';
    }
    
    // Notify server about mic status for participant list update
    this.socketClient.emit('mic-toggle', { muted });
  }

  async applyAudioSettings() {
    // DISABLED: This function was causing host voice to disappear during video streaming
    console.warn('⚠️ Audio settings changes disabled to prevent host voice issues');
    console.warn('⚠️ Restart the voice chat if you need to change audio settings');
    return;
    
    // Original code commented out to prevent track replacement issues:
    // const select = this.root.querySelector('#mic-device');
    // const aec = this.root.querySelector('#aec')?.checked;
    // const ns = this.root.querySelector('#ns')?.checked;
    // const agc = this.root.querySelector('#agc')?.checked;
    // const deviceId = select?.value || undefined;
    //
    // try {
    //   const constraints = WebRTCUtils.getAudioConstraints({
    //     echoCancellation: aec,
    //     noiseSuppression: ns,
    //     autoGainControl: agc,
    //     deviceId
    //   });
    //   const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    //   await this.peerManager.replaceLocalStream(newStream);
    // } catch (e) {
    //   alert('Failed to apply audio settings. Check permissions and try again.');
    // }
  }

  async startVoice() {
    this.voiceActive = true;
    const selfId = this.socketClient.socket?.id;
    
    // Ensure local audio stream is ready before establishing connections
    await this.peerManager.ensureLocalStream();
    
    console.log(`🎙️ Starting voice chat as ${this.isHost ? 'HOST' : 'PARTICIPANT'}`);
    console.log(`🔍 Self ID: ${selfId}, Participants:`, Array.from(this.participants.entries()));
    
    // Both host and participants should initiate calls to ensure bidirectional connections
    for (const [peerId] of this.participants.entries()) {
      if (!peerId || peerId === selfId) {
        console.log(`⏭️ Skipping self or invalid peer: ${peerId}`);
        continue;
      }
      try { 
        console.log(`🔄 Calling peer ${peerId}`);
        await this.peerManager.callPeer(peerId); 
      } catch (error) {
        console.error(`❌ Failed to call peer ${peerId}:`, error);
      }
    }
    
    console.log(`✅ Voice chat started with ${this.participants.size - 1} peers`);
  }

  stopVoice() {
    this.voiceActive = false;
    if (this.peerManager) {
      this.peerManager.destroy();
      // Recreate with the same stream provider
      this.peerManager = new PeerManager(this.socketClient, async () => {
        try { 
          console.log(`🎙️ Recreating microphone stream for ${this.isHost ? 'HOST' : 'PARTICIPANT'}`);
          // Use enhanced audio constraints for microphone stream recreation
          const constraints = WebRTCUtils.getAudioConstraints({ 
            highQuality: true,  // High-quality voice for recreated stream
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          });
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('✅ Enhanced microphone stream recreated');
          return stream;
        }
        catch (error) {
          console.warn('⚠️ Microphone not available during recreation:', error.message);
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          return dest.stream;
        }
      });
      
      // Set host status
      this.peerManager.setHost(this.isHost);
      
      this.peerManager.onRemoteTrack = (peerId, stream) => {
        // Respect the unified host media policy even after re-init
        const hostPeerId = this.getHostPeerId();
        const isFromHost = !!hostPeerId && peerId === hostPeerId;
        if (!this.isHost && isFromHost) {
          this.upsertHostAudioStream(stream);
          this.combineAndAttachHostStreamsIfReady();
          return;
        }
        let el = this.root.querySelector(`audio[data-peer="${peerId}"]`);
        if (!el) {
          el = document.createElement('audio');
          el.dataset.peer = peerId;
          el.autoplay = true;
          el.playsInline = true;
          this.root.appendChild(el);
        }
        el.srcObject = stream;
      };
    }
    // Remove all non-host voice audio elements on stop; host audio is now merged into VideoPlayer
    this.root?.querySelectorAll('audio[data-peer]')?.forEach(el => el.remove());
    // Reset merged host media state
    this.remoteHostVideoStream = null;
    this.remoteHostAudioStreams = [];
  }

  bindRoomParticipantEvents() {
    if (this.boundHandlers) return;
    this._onJoined = ({ participant, participants }) => {
      console.log('👥 Participant joined event:', { participant, participants });
      if (participants) {
        for (const p of participants) this.participants.set(p.socketId, p);
      } else if (participant) {
        this.participants.set(participant.socketId, participant);
        console.log(`✅ Added participant ${participant.socketId} to map. Total participants: ${this.participants.size}`);
        if (this.voiceActive) {
          console.log(`🔄 Calling new participant ${participant.socketId}`);
          this.peerManager.callPeer(participant.socketId).catch((error) => {
            console.error(`❌ Failed to call new participant ${participant.socketId}:`, error);
          });
          // --- Ensure late joiners get the real video stream if host is streaming ---
          if (this.isHost && this.peerManager.currentVideoStream) {
            // Renegotiate to add video stream for the new participant
            this.peerManager.renegotiatePeer(participant.socketId).catch(() => {});
          }
        }
      }
      // Update viewer count display
      this.updateViewerCount();
    };
    this._onLeft = ({ participant, participants }) => {
      if (participants) {
        this.participants.clear();
        for (const p of participants) this.participants.set(p.socketId, p);
      } else if (participant) {
        this.participants.delete(participant.socketId);
        if (this.voiceActive) this.peerManager.closePeer(participant.socketId);
      }
      // Update viewer count display
      this.updateViewerCount();
    };
    this._onDisconnected = this._onLeft;
    this.socketClient.on('participant-joined', this._onJoined);
    this.socketClient.on('participant-left', this._onLeft);
    this.socketClient.on('participant-disconnected', this._onDisconnected);
    this.boundHandlers = true;
  }

  unbindRoomParticipantEvents() {
    if (!this.boundHandlers) return;
    this.socketClient.off('participant-joined', this._onJoined);
    this.socketClient.off('participant-left', this._onLeft);
    this.socketClient.off('participant-disconnected', this._onDisconnected);
    this.boundHandlers = false;
  }

  /**
   * Update the viewer count display in the room header
   */
  updateViewerCount() {
    if (!this.root) return;
    
    const viewerCountElement = this.root.querySelector('.viewer-text');
    if (viewerCountElement) {
      const count = this.participants.size;
      viewerCountElement.textContent = `${count} viewer${count !== 1 ? 's' : ''}`;
      console.log(`📊 Updated viewer count display to: ${count}`);
    }
  }

  /**
   * Bind movie synchronization events for participants
   */
  bindMovieEvents() {
    if (this.movieEventsbound) return;
    
    // Listen for movie state updates from the host
    this.socketClient.on('movie-sync', (data) => {
      console.log('🎬 Received movie sync from host:', data);
      this.handleMovieSync(data);
    });
    
    // Listen for movie control errors
    this.socketClient.on('movie-control-error', (data) => {
      console.error('❌ Movie control error:', data);
      alert(`Movie error: ${data.error}`);
    });
    
    this.movieEventsbound = true;
  }

  /**
   * Wait for video metadata to load completely
   */
  async waitForVideoMetadata(timeout = 5000) {
    if (!this.videoPlayer || !this.videoPlayer.videoElement) {
      console.warn('⚠️ No video player available for metadata loading');
      return;
    }

    const videoElement = this.videoPlayer.videoElement;
    
    // If metadata is already loaded, return immediately
    if (videoElement.duration && !isNaN(videoElement.duration)) {
      console.log('✅ Video metadata already loaded');
      return;
    }

    console.log('⏳ Waiting for video metadata to load...');
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.warn('⚠️ Video metadata loading timeout, continuing anyway...');
        resolve();
      }, timeout);

      const onMetadataLoaded = () => {
        console.log('✅ Video metadata loaded successfully');
        clearTimeout(timeoutId);
        videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
        videoElement.removeEventListener('durationchange', onMetadataLoaded);
        videoElement.removeEventListener('loadeddata', onMetadataLoaded);
        resolve();
      };

      videoElement.addEventListener('loadedmetadata', onMetadataLoaded);
      videoElement.addEventListener('durationchange', onMetadataLoaded);
      videoElement.addEventListener('loadeddata', onMetadataLoaded);
    });
  }

  /**
   * Get comprehensive video metadata for sharing with participants
   */
  getVideoMetadata(movieData) {
    const videoElement = this.videoPlayer?.videoElement;
    const streamingStats = this.videoPlayer?.streamingManager?.getStats();
    
    console.log('🔍 Getting video metadata:', {
      hasVideoElement: !!videoElement,
      videoDuration: videoElement?.duration,
      videoReadyState: videoElement?.readyState
    });
    
    const metadata = {
      // Basic file information
      title: movieData.name,
      type: movieData.type,
      size: movieData.size,
      
      // Video properties
      duration: videoElement?.duration || 0,
      width: videoElement?.videoWidth || 0,
      height: videoElement?.videoHeight || 0,
      
      // Streaming information
      totalChunks: streamingStats?.totalChunks || 0,
      chunkSize: streamingStats?.chunkSize || 0,
      mimeType: streamingStats?.mimeType || movieData.type,
      
      // Playback state
      currentTime: videoElement?.currentTime || 0,
      isPlaying: false,
      
      // Additional metadata for future features
      hasVideo: !!(videoElement?.videoWidth && videoElement?.videoHeight),
      hasAudio: !!(videoElement?.webkitAudioDecodedByteCount || videoElement?.audioTracks?.length),
      
      // Timestamp for sync
      timestamp: Date.now()
    };
    
    console.log('📊 Generated video metadata for participants:', metadata);
    return metadata;
  }

  /**
   * Start WebRTC video streaming from host to participants
   */
  async startVideoStreaming() {
    if (!this.isHost) {
      console.warn('⚠️ Cannot start video streaming: not host');
      return;
    }

    if (!this.videoPlayer || !this.videoPlayer.videoElement) {
      console.warn('⚠️ Cannot start video streaming: video player not ready');
      return;
    }

    try {
      console.log('🎥 Starting WebRTC video streaming...');
      console.log('🔍 Video element state:', {
        readyState: this.videoPlayer.videoElement.readyState,
        videoWidth: this.videoPlayer.videoElement.videoWidth,
        videoHeight: this.videoPlayer.videoElement.videoHeight,
        currentSrc: this.videoPlayer.videoElement.currentSrc,
        paused: this.videoPlayer.videoElement.paused
      });
      
      // Check browser support
      const support = WebRTCUtils.checkWebRTCSupport();
      console.log('🔍 WebRTC support check:', support);
      
      if (!support.supported) {
        throw new Error(`Browser missing WebRTC features: ${Object.entries(support).filter(([k,v]) => !v && k !== 'supported').map(([k]) => k).join(', ')}`);
      }

      // Check if video element supports captureStream
      if (typeof this.videoPlayer.videoElement.captureStream !== 'function') {
        throw new Error('Video element does not support captureStream - try a different browser');
      }

      // Wait for video to be ready
      if (this.videoPlayer.videoElement.readyState < 2) {
        console.log('🎥 Waiting for video metadata to load...');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Video metadata loading timeout'));
          }, 5000);
          
          this.videoPlayer.videoElement.addEventListener('loadedmetadata', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }

      // Check peer connections exist
      const peerCount = this.peerManager.peerIdToPc.size;
      console.log(`🔍 Active peer connections: ${peerCount}`);
      
      if (peerCount === 0) {
        console.warn('⚠️ No active peer connections - participants may need to start voice chat first');
        // Continue anyway - peers might connect later
      }

      // Check current streaming state before starting
      const currentState = this.peerManager.getStreamingState();
      console.log('🔍 Current streaming state before starting:', currentState);
      
      if (!this.peerManager.stateManager.canStartStreaming()) {
        console.warn('⚠️ Cannot start streaming in current state:', currentState.connection);
        return;
      }

      // Ensure host video element has audio enabled and at full volume
      console.log('🔊 Host video audio check before streaming:', {
        muted: this.videoPlayer.videoElement.muted,
        volume: this.videoPlayer.videoElement.volume
      });
      
      // Ensure host video has full volume for local playback
      this.videoPlayer.videoElement.volume = 1.0;
      this.videoPlayer.videoElement.muted = false;
      
      console.log('🔊 Host video audio ensured at full volume:', {
        muted: this.videoPlayer.videoElement.muted,
        volume: this.videoPlayer.videoElement.volume
      });

      // CRITICAL: Mute the video element locally to prevent audio conflicts
      const originalMuted = this.videoPlayer.videoElement.muted;
      const originalVolume = this.videoPlayer.videoElement.volume;
      this.videoPlayer.videoElement.muted = true;
      console.log('🔇 Muted video element locally to prevent microphone conflicts');

      // Start video streaming through PeerManager (VIDEO + MOVIE AUDIO)
      console.log('🎥 Calling peerManager.startVideoStreaming...');
      const result = await this.peerManager.startVideoStreaming(
        this.videoPlayer.videoElement,
        { 
          frameRate: 30,
          quality: 'high',
          includeMovieAudio: true // Enable movie audio capture with video
        }
      );

      console.log('🎥 Video streaming result:', result);
      console.log('🔍 Streaming state after start attempt:', this.peerManager.getStreamingState());

      // Restore video element state for local playback
      this.videoPlayer.videoElement.muted = originalMuted;
      this.videoPlayer.videoElement.volume = originalVolume;
      console.log('🔊 Restored video element audio state for local playback');

      if (result.success) {
        console.log('✅ Video streaming started successfully');
        
        // CRITICAL: Verify microphone tracks are still active after video streaming
        setTimeout(async () => {
          try {
            const trackStatus = this.peerManager.getTrackStatus();
            console.log('🔍 Track status after video streaming:', trackStatus);
            
            // Check if host microphone is still active
            if (this.isHost) {
              const hostPeerId = this.getHostPeerId();
              if (hostPeerId && trackStatus.peers[hostPeerId]) {
                const hostStatus = trackStatus.peers[hostPeerId];
                if (!hostStatus.hasMicrophone) {
                  console.warn('⚠️ Host microphone track missing after video streaming - attempting recovery');
                  await this.peerManager.ensureMicrophoneTracks();
                }
              }
            }
          } catch (error) {
            console.error('❌ Error checking track status:', error);
          }
        }, 1000);
        
        // Show streaming status in UI
        this.showVideoStreamingStatus(true);
        
        // CRITICAL: Start periodic microphone track health check during video streaming
        this.startMicrophoneHealthCheck();
        
        // Notify participants
        this.showTemporaryMessage('🎥 Video streaming to participants started!', 'success');
      } else {
        throw new Error(result.error);
      }
      
    } catch (error) {
      console.error('❌ Failed to start video streaming:', error);
      
      // Show detailed error to user
      const message = `Video streaming failed: ${error.message}. Audio and sync will still work.`;
      this.showTemporaryMessage(message, 'warning');
      
      // Also log technical details
      console.log('🔍 Technical details:', {
        hasVideoPlayer: !!this.videoPlayer,
        hasVideoElement: !!this.videoPlayer?.videoElement,
        videoElementReady: this.videoPlayer?.videoElement?.readyState,
        peerConnections: this.peerManager?.peerIdToPc?.size || 0,
        isHost: this.isHost
      });
    }
  }

  /**
   * Stop WebRTC video streaming
   */
  async stopVideoStreaming() {
    try {
      // Stop microphone health check
      this.stopMicrophoneHealthCheck();
      
      await this.peerManager.stopVideoStreaming();
      this.showVideoStreamingStatus(false);
      console.log('🎥 Video streaming stopped');
    } catch (error) {
      console.error('❌ Failed to stop video streaming:', error);
    }
  }

  /**
   * Handle remote video stream for participants
   */
  handleRemoteVideoStream(peerId, stream) {
    try {
      console.log(`🎥 Setting up remote video stream from peer ${peerId}`, {
        streamId: stream.id,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      });

      // Log detailed track information
      stream.getVideoTracks().forEach((track, i) => {
        console.log(`🎥 Video track ${i}:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState
        });
      });

      stream.getAudioTracks().forEach((track, i) => {
        console.log(`🔊 Audio track ${i}:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState
        });
      });
      
      // Check if we have a video player ready
      if (!this.videoPlayer || !this.videoPlayer.videoElement) {
        console.error('❌ Video player not ready for remote stream');
        return;
      }

      // Log current video element state
      console.log('🔍 Video element before stream:', {
        src: this.videoPlayer.videoElement.src,
        srcObject: this.videoPlayer.videoElement.srcObject,
        readyState: this.videoPlayer.videoElement.readyState
      });
      
      // Replace the participant's virtual video with actual stream
      this.videoPlayer.videoElement.srcObject = stream;
      this.videoPlayer.videoElement.autoplay = true;
      this.videoPlayer.videoElement.playsInline = true;
      this.videoPlayer.videoElement.muted = false; // Ensure video audio is not muted
      
      // Mark video element as WebRTC stream BEFORE setting volume
      this.videoPlayer.videoElement.setAttribute('data-webrtc', 'true');
      
      // Restore participant's chosen volume (don't force to 1.0)
      this.videoPlayer.videoElement.volume = this.videoPlayer.volume || 1.0;
      console.log(`🔊 Restored participant volume to: ${Math.round(this.videoPlayer.videoElement.volume * 100)}%`);
      this.videoPlayer.videoElement.setAttribute('data-webrtc', 'true');
      
      // Listen for stream events
      this.videoPlayer.videoElement.addEventListener('loadedmetadata', () => {
        console.log('🎥 Remote video metadata loaded:', {
          videoWidth: this.videoPlayer.videoElement.videoWidth,
          videoHeight: this.videoPlayer.videoElement.videoHeight,
          duration: this.videoPlayer.videoElement.duration,
          muted: this.videoPlayer.videoElement.muted,
          volume: this.videoPlayer.videoElement.volume
        });

        // Check if stream has audio tracks
        const streamAudioTracks = stream.getAudioTracks();
        if (streamAudioTracks.length > 0) {
          console.log('🔊 Video stream has audio tracks - should have sound');
        } else {
          console.warn('⚠️ Video stream has no audio tracks - no sound expected');
        }
        
        // Ensure participant volume controls work after stream loads
        this.videoPlayer.ensureVolumeControlsWork();
      }, { once: true });
      
      this.videoPlayer.videoElement.addEventListener('canplay', () => {
        console.log('🎥 Remote video can play');
        
        // Double-check audio settings
        console.log('🔊 Final audio check:', {
          muted: this.videoPlayer.videoElement.muted,
          volume: this.videoPlayer.videoElement.volume,
          audioTracks: stream.getAudioTracks().length
        });
        
        // Hide loading overlay and show video
        this.videoPlayer.hideLoadingOverlay();
        
        // Update participant status message
        const audioMessage = stream.getAudioTracks().length > 0 ? ' with sound' : ' (no audio)';
        this.showTemporaryMessage(`🎥 Video stream connected${audioMessage}!`, 'success');
      }, { once: true });

      this.videoPlayer.videoElement.addEventListener('error', (e) => {
        console.error('❌ Remote video error:', e);
        this.showTemporaryMessage('Video playback error', 'error');
      }, { once: true });
      
      // IMPORTANT: Keep the virtual duration for UI display
      // WebRTC streams don't have duration, so we keep using the original movie duration
      const originalDuration = this.videoPlayer.duration;
      
      // Keep participant timer running for UI display (WebRTC video + timer-based UI)
      console.log('🕐 Keeping participant timer for WebRTC UI display');
      
      // Restore the original duration after stream assignment
      if (originalDuration && originalDuration > 0) {
        console.log(`🕐 Preserving original duration: ${originalDuration}s`);
        
        // Wait for stream to be ready, then set duration
        this.videoPlayer.videoElement.addEventListener('loadedmetadata', () => {
          // Override the WebRTC stream's duration with the original movie duration
          Object.defineProperty(this.videoPlayer.videoElement, 'duration', {
            value: originalDuration,
            writable: false,
            configurable: true
          });
          
          this.videoPlayer.duration = originalDuration;
          this.videoPlayer.updateTimeDisplay(); // Update UI
          
          console.log('🕐 Duration restored for WebRTC stream');
        }, { once: true });
      }
      
      console.log('✅ Remote video stream setup completed');
      
    } catch (error) {
      console.error('❌ Failed to handle remote video stream:', error);
      this.showTemporaryMessage('Video stream connection failed', 'error');
    }
  }

  /**
   * Identify current host peer id from participants map if available
   */
  getHostPeerId() {
    // participants map stores objects with isHost flag according to server model
    for (const [socketId, p] of this.participants.entries()) {
      if (p && p.isHost) return socketId;
    }
    return null;
  }

  showAudioPlaybackNotification(peerId) {
    // Show a temporary notification that user needs to interact to hear audio
    const notification = document.createElement('div');
    notification.className = 'audio-notification';
    notification.innerHTML = `
      <div style="background: #ff6b35; color: white; padding: 10px; border-radius: 5px; margin: 5px; cursor: pointer;">
        🔊 Click to enable audio from peer
      </div>
    `;
    
    notification.onclick = async () => {
      const audioEl = this.root.querySelector(`audio[data-peer="${peerId}"]`);
      if (audioEl) {
        try {
          await audioEl.play();
          console.log(`✅ Audio manually started for peer ${peerId}`);
          notification.remove();
        } catch (error) {
          console.error(`❌ Failed to start audio for peer ${peerId}:`, error);
        }
      }
    };
    
    this.root.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 10000);
  }

  /**
   * Maintain host mic audio streams list (avoid duplicates)
   */
  upsertHostAudioStream(stream) {
    // Remove ended streams
    this.remoteHostAudioStreams = this.remoteHostAudioStreams.filter(s =>
      s && s.getTracks().some(t => t.readyState !== 'ended')
    );

    // Avoid adding the same stream twice
    const exists = this.remoteHostAudioStreams.some(s => s.id === stream.id);
    if (!exists) this.remoteHostAudioStreams.push(stream);
  }

  /**
   * Combine host video stream + any host audio streams into a single MediaStream
   * and attach to the participant VideoPlayer element
   */
  combineAndAttachHostStreamsIfReady() {
    if (this.isHost) return; // host flow unchanged
    if (!this.videoPlayer || !this.videoPlayer.videoElement) return;

    // --- Force participant VideoPlayer to exit virtual mode and use real stream ---
    if (this.videoPlayer && typeof this.videoPlayer.exitVirtualMode === 'function') {
      this.videoPlayer.exitVirtualMode();
    }

    const videoStream = this.remoteHostVideoStream;

    // Build a combined stream (can be audio-only if video not yet available)
    const combined = new MediaStream();

    // Add the single video track from host
    if (videoStream) {
      const vTracks = videoStream.getVideoTracks();
      if (vTracks.length > 0) combined.addTrack(vTracks[0]);
    }

    // Add audio tracks: prefer videoStream audio (movie audio) and include host mic audio
    if (videoStream) {
      const movieAudioTracks = videoStream.getAudioTracks();
      for (const a of movieAudioTracks) combined.addTrack(a);
    }

    for (const micStream of this.remoteHostAudioStreams) {
      micStream.getAudioTracks().forEach(a => combined.addTrack(a));
    }

    // Attach to video element
    const ve = this.videoPlayer.videoElement;
    ve.srcObject = combined;
    ve.autoplay = true;
    ve.playsInline = true;
    // Ensure VideoPlayer controls will manage volume/mute of this single element
    ve.setAttribute('data-webrtc', 'true');

    // Keep original duration metadata for UI
    const originalDuration = this.videoPlayer.duration;
    if (originalDuration && originalDuration > 0) {
      const setDuration = () => {
        try {
          Object.defineProperty(ve, 'duration', {
            value: originalDuration,
            writable: false,
            configurable: true
          });
          this.videoPlayer.duration = originalDuration;
          this.videoPlayer.updateTimeDisplay();
        } catch {}
      };
      if (ve.readyState >= 1) setDuration();
      else ve.addEventListener('loadedmetadata', setDuration, { once: true });
    }

    // Remove any existing <audio> for the host to avoid duplicates
    const hostPeerId = this.getHostPeerId();
    if (hostPeerId) {
      this.root?.querySelectorAll(`audio[data-peer="${hostPeerId}"]`)?.forEach(el => el.remove());
    }

    // Hide loading overlay
    this.videoPlayer.hideLoadingOverlay();

    console.log('✅ Host video+audio attached to participant VideoPlayer element');
  }

  /**
   * Show video streaming status indicator
   */
  showVideoStreamingStatus(isStreaming) {
    // Update host indicator if exists
    const hostIndicator = this.root.querySelector('.host-indicator');
    if (hostIndicator && this.isHost) {
      const statusElement = hostIndicator.querySelector('.stream-status');
      
      if (statusElement) {
        statusElement.remove();
      }
      
      if (isStreaming) {
        const status = document.createElement('div');
        status.className = 'stream-status';
        status.innerHTML = '🎥 LIVE';
        status.style.cssText = `
          font-size: 8px;
          color: #ef4444;
          font-weight: 700;
          margin-top: 2px;
        `;
        hostIndicator.appendChild(status);
      }
    }
  }

  /**
   * Show temporary message to user
   */
  showTemporaryMessage(message, type = 'info') {
    const messageEl = document.createElement('div');
    messageEl.className = `temp-message temp-message-${type}`;
    messageEl.textContent = message;
    messageEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
      background: ${type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : type === 'error' ? '#ef4444' : '#3b82f6'};
    `;
    
    document.body.appendChild(messageEl);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
          if (messageEl.parentNode) {
            messageEl.parentNode.removeChild(messageEl);
          }
        }, 300);
      }
    }, 4000);
  }



  /**
   * Handle movie synchronization from host
   */
  async handleMovieSync(data) {
    const { action, movieState } = data;
    
    console.log('🎬 Processing movie sync:', { action, movieState });
    
    switch (action) {
      case 'start-streaming':
        await this.handleHostStartedStreaming(movieState);
        break;

      case 'play':
        this.handleHostPlay(movieState);
        break;

      case 'pause':
        this.handleHostPause(movieState);
        break;

      case 'seek':
        this.handleHostSeek(movieState);
        break;

      case 'stop-streaming':
        await this.handleHostStoppedStreaming();
        break;

      case 'sync':
        // Host should NOT process their own sync events
        if (this.isHost) {
          console.log('🔄 Host ignoring own sync event (no self-sync needed)');
          return;
        }
        
        // For participants only: update playback state - DO NOT reinitialize video player
        console.log('🔄 Participant processing sync from host');
        
        if (this.videoPlayer && movieState) {
          // Use the existing syncWithHost method which handles WebRTC vs virtual mode correctly
          this.videoPlayer.syncWithHost('seek', movieState);
          
          // Then apply play/pause state
          if (movieState.isPlaying) {
            this.videoPlayer.syncWithHost('play', movieState);
          } else {
            this.videoPlayer.syncWithHost('pause', movieState);
          }
        } else if (!this.videoPlayer) {
          // Only if video player doesn't exist (new participant), then initialize
          console.log('🎬 New participant - initializing video player for sync');
          await this.handleHostStartedStreaming(movieState);
        }
        break;

      default:
        console.warn('Unknown movie sync action:', action);
    }
  }

  /**
   * Handle when host starts streaming (participants see video player)
   */
  async handleHostStartedStreaming(movieState) {
    if (this.isHost) return; // Host already has the video player
    
    console.log('🎬 Host started streaming, transitioning from waiting screen to video player');
    
    // Update movie state
    this.selectedMovie = {
      name: movieState.title || 'Unknown Movie',
      type: movieState.type || 'video/mp4',
      size: movieState.size || 0
    };
    this.movieState = 'ready';
    
    // Update UI to show video player container
    this.updateMovieStage();
    
    // Initialize video player for participant (but without file - they'll receive stream)
    const videoPlayerContainer = this.root.querySelector('#video-player-container');
    if (videoPlayerContainer) {
      try {
        // Import VideoPlayer dynamically to avoid circular dependencies
        const { VideoPlayer } = await import('./VideoPlayer.js');
        
        this.videoPlayer = new VideoPlayer(
          this.socketClient,
          (state) => this.handleVideoStateChange(state)
        );
        
        // For participants, we create a placeholder video element that will be controlled by the host
        this.videoPlayer.initializeAsParticipant(videoPlayerContainer, movieState);
        
        console.log('✅ Participant video player initialized');
        
        // Check if we have a pending video stream to attach
        if (this.pendingHostVideoStream) {
          console.log('📦 Attaching pending host video stream');
          this.attachHostVideoStream(this.pendingHostVideoStream);
          this.pendingHostVideoStream = null;
        }
        
      } catch (error) {
        console.error('❌ Failed to initialize participant video player:', error);
        this.movieState = 'error';
        this.updateMovieStage();
      }
    }
  }

  /**
   * Handle host play/pause/seek events
   */
  handleHostPlay(movieState) {
    if (!this.videoPlayer) return;
    
    // Host should NOT sync with themselves - these events are FOR participants only
    if (this.isHost) {
      console.log('▶️ Host ignoring own play event (no self-sync needed)');
      return;
    }
    
    console.log('▶️ Participant syncing with host play');
    
    // Ensure movie title is included for sync display
    const syncState = {
      ...movieState,
      title: movieState.title || this.selectedMovie?.name || 'Unknown Movie'
    };
    
    this.videoPlayer.syncWithHost('play', syncState);
  }

  handleHostPause(movieState) {
    if (!this.videoPlayer) return;
    
    // Host should NOT sync with themselves - these events are FOR participants only
    if (this.isHost) {
      console.log('⏸️ Host ignoring own pause event (no self-sync needed)');
      return;
    }
    
    console.log('⏸️ Participant syncing with host pause');
    
    // Ensure movie title is included for sync display
    const syncState = {
      ...movieState,
      title: movieState.title || this.selectedMovie?.name || 'Unknown Movie'
    };
    
    this.videoPlayer.syncWithHost('pause', syncState);
  }

  handleHostSeek(movieState) {
    if (!this.videoPlayer) return;
    
    // Host should NOT sync with themselves - these events are FOR participants only
    if (this.isHost) {
      console.log('⏩ Host ignoring own seek event (no self-sync needed)');
      return;
    }
    
    console.log('⏩ Participant syncing with host seek to:', movieState.currentTime);
    
    // Ensure movie title is included for sync display
    const syncState = {
      ...movieState,
      title: movieState.title || this.selectedMovie?.name || 'Unknown Movie'
    };
    
    this.videoPlayer.syncWithHost('seek', syncState);
  }

  async handleHostStoppedStreaming() {
    console.log('⏹️ Host stopped streaming');
    
    // Stop video streaming if host
    if (this.isHost) {
      this.stopVideoStreaming();
    }
    
    // Reset movie state
    this.selectedMovie = null;
    this.movieState = 'none';
    
    // Clean up video player
    if (this.videoPlayer) {
      await this.videoPlayer.destroy();
      this.videoPlayer = null;
    }
    
    // Update UI back to waiting state
    this.updateMovieStage();
  }

  renderMovieStage() {
    // Set initial movie state
    if (this.movieState === 'none') {
      this.movieState = 'selecting';
    }
    
    return `<div class="movie-stage" id="movie-stage"></div>`;
  }
  
  /**
   * Handle leave room request with confirmation
   */
  async handleLeaveRoom() {
    // Show confirmation dialog
    const confirmed = await this.showLeaveConfirmation();
    if (!confirmed) return;

    console.log('🚪 User initiated hard leave...');

    try {
      // Show loading state on leave button
      const leaveBtn = this.root.querySelector('#leave-room');
      if (leaveBtn) {
        leaveBtn.disabled = true;
        leaveBtn.innerHTML = '<span class="leave-icon">⏳</span>Leaving...';
      }

      // Emit leave room event to server
      this.socketClient.emit('leave-room');
      
      // Listen for server confirmation
      this.socketClient.on('room-left', async (data) => {
        console.log('✅ Server confirmed room left:', data);
        await this.performHardLeave();
      });

      // Also handle errors
      this.socketClient.on('leave-room-error', async (error) => {
        console.error('❌ Leave room error:', error);
        // Still perform hard leave even if server error
        await this.performHardLeave();
      });

      // Fallback timeout - perform hard leave anyway after 3 seconds
      setTimeout(async () => {
        console.log('⏰ Leave timeout - performing hard leave anyway');
        await this.performHardLeave();
      }, 3000);

    } catch (error) {
      console.error('❌ Error during leave process:', error);
      // Still perform hard leave on error
      await this.performHardLeave();
    }
  }

  /**
   * Show leave confirmation dialog
   */
  async showLeaveConfirmation() {
    return new Promise((resolve) => {
      // Create confirmation modal
      const modal = document.createElement('div');
      modal.className = 'modal-overlay leave-confirmation-modal';
      modal.innerHTML = `
        <div class="modal-content" role="dialog" aria-labelledby="leave-title" aria-modal="true">
          <div class="modal-header">
            <h3 id="leave-title">🚪 Leave Room</h3>
          </div>
          <div class="modal-body">
            <p><strong>Are you sure you want to leave?</strong></p>
            <ul style="margin: 10px 0; padding-left: 20px; color: #666;">
              <li>You'll be disconnected from the movie party</li>
              <li>Your session will be completely cleared</li>
              <li>You'll need to rejoin manually if you want to come back</li>
            </ul>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="cancel-leave">Cancel</button>
            <button class="btn btn-danger" id="confirm-leave">
              <span>🚪</span> Leave Room
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Handle confirmation
      const confirmBtn = modal.querySelector('#confirm-leave');
      const cancelBtn = modal.querySelector('#cancel-leave');

      const cleanup = () => {
        modal.remove();
      };

      confirmBtn.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      // ESC key and overlay click to cancel
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          cleanup();
          resolve(false);
          document.removeEventListener('keydown', handleEscape);
        }
      };

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(false);
        }
      });

      document.addEventListener('keydown', handleEscape);

      // Focus the cancel button by default
      setTimeout(() => cancelBtn.focus(), 100);
    });
  }

  /**
   * Perform complete hard leave - clear everything and go to landing
   */
  async performHardLeave() {
    console.log('🧹 Performing hard leave - clearing all data...');

    // Stop all ongoing activities
    await this.cleanup();

    // Clear all local storage related to BeeMoo
    try {
      localStorage.removeItem('beemoo-room-session');
      localStorage.removeItem('beemoo-user-preferences');
      localStorage.removeItem('beemoo-audio-settings');
      // Clear any other BeeMoo related storage
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('beemoo-')) {
          localStorage.removeItem(key);
        }
      });
      console.log('✅ Cleared local storage');
    } catch (error) {
      console.warn('⚠️ Failed to clear some local storage:', error);
    }

    // Clear session storage too
    try {
      sessionStorage.removeItem('beemoo-room-session');
      const keys = Object.keys(sessionStorage);
      keys.forEach(key => {
        if (key.startsWith('beemoo-')) {
          sessionStorage.removeItem(key);
        }
      });
      console.log('✅ Cleared session storage');
    } catch (error) {
      console.warn('⚠️ Failed to clear some session storage:', error);
    }

    // Disconnect from socket completely
    if (this.socketClient) {
      this.socketClient.disconnect();
      console.log('✅ Disconnected from socket');
    }

    // Navigate back to landing page
    this.navigateToLanding();
  }

  /**
   * Navigate back to landing page with fresh state
   */
  navigateToLanding() {
    console.log('🏠 Navigating to landing page...');

    // Emit leave event for parent app
    this.emit('leave-room', { 
      reason: 'user-initiated',
      hardLeave: true 
    });

    // Fallback: manually reload page if parent doesn't handle the event
    setTimeout(() => {
      console.log('🔄 Fallback: Reloading page to ensure clean state');
      window.location.href = window.location.origin;
    }, 1000);
  }

  /**
   * Cleanup all resources and connections
   */
  async cleanup() {
    console.log('🧹 Cleaning up RoomView resources...');

    // Stop video player
    if (this.videoPlayer) {
      await this.videoPlayer.destroy();
      this.videoPlayer = null;
    }

    // Stop peer manager and WebRTC connections
    if (this.peerManager) {
      this.peerManager.destroy();
      this.peerManager = null;
    }

    // Stop voice chat
    if (this.voiceActive) {
      this.stopVoice();
    }

    // Clean up participant list
    if (this.participantList) {
      this.participantList.destroy();
    }

    // Clear participants map
    this.participants.clear();

    // Remove all socket event listeners related to room
    if (this.socketClient) {
      this.socketClient.off('participant-joined');
      this.socketClient.off('participant-left');
      this.socketClient.off('participant-disconnected');
      this.socketClient.off('host-disconnected');
      this.socketClient.off('room-deleted');
      this.socketClient.off('movie-state-updated');
      this.socketClient.off('movie-control');
      this.socketClient.off('mic-status-updated');
      this.socketClient.off('room-left');
      this.socketClient.off('leave-room-error');
    }

    // Stop any ongoing timers or intervals
    if (this.videoSyncInterval) {
      clearInterval(this.videoSyncInterval);
      this.videoSyncInterval = null;
    }

    console.log('✅ RoomView cleanup complete');
  }

  /**
   * Start periodic microphone track health check during video streaming
   * This prevents the host's voice from disappearing
   */
  startMicrophoneHealthCheck() {
    if (this.microphoneHealthCheckInterval) {
      clearInterval(this.microphoneHealthCheckInterval);
    }
    
    this.microphoneHealthCheckInterval = setInterval(async () => {
      try {
        if (!this.isHost || !this.peerManager) return;
        
        const trackStatus = this.peerManager.getTrackStatus();
        const hostPeerId = this.getHostPeerId();
        
        if (hostPeerId && trackStatus.peers[hostPeerId]) {
          const hostStatus = trackStatus.peers[hostPeerId];
          
          // Check if microphone track is missing or invalid
          if (!hostStatus.hasMicrophone || hostStatus.audioSenders === 0) {
            console.warn('⚠️ Host microphone track health check failed - attempting recovery');
            await this.peerManager.ensureMicrophoneTracks();
            
            // Log recovery attempt
            const newStatus = this.peerManager.getTrackStatus();
            if (newStatus.peers[hostPeerId]?.hasMicrophone) {
              console.log('✅ Host microphone track recovered successfully');
            } else {
              console.error('❌ Failed to recover host microphone track');
            }
          }
        }
      } catch (error) {
        console.error('❌ Error in microphone health check:', error);
      }
    }, 5000); // Check every 5 seconds
    
    console.log('🔍 Microphone health check started');
  }

  /**
   * Stop microphone health check
   */
  stopMicrophoneHealthCheck() {
    if (this.microphoneHealthCheckInterval) {
      clearInterval(this.microphoneHealthCheckInterval);
      this.microphoneHealthCheckInterval = null;
      console.log('🔍 Microphone health check stopped');
    }
  }

  /**
   * Manually verify and fix microphone tracks (for debugging/testing)
   */
  async verifyMicrophoneTracks() {
    if (!this.isHost || !this.peerManager) {
      console.warn('⚠️ Cannot verify microphone tracks: not host or no peer manager');
      return;
    }
    
    try {
      console.log('🔍 Manually verifying microphone tracks...');
      
      const trackStatus = this.peerManager.getTrackStatus();
      console.log('📊 Current track status:', trackStatus);
      
      // Check if microphone tracks are missing
      const hostPeerId = this.getHostPeerId();
      if (hostPeerId && trackStatus.peers[hostPeerId]) {
        const hostStatus = trackStatus.peers[hostPeerId];
        
        if (!hostStatus.hasMicrophone || hostStatus.audioSenders === 0) {
          console.warn('⚠️ Microphone tracks missing - attempting recovery...');
          await this.peerManager.ensureMicrophoneTracks();
          
          // Verify recovery
          const newStatus = this.peerManager.getTrackStatus();
          if (newStatus.peers[hostPeerId]?.hasMicrophone) {
            console.log('✅ Microphone tracks recovered successfully');
            this.showTemporaryMessage('🎙️ Microphone tracks recovered!', 'success');
          } else {
            console.error('❌ Failed to recover microphone tracks');
            this.showTemporaryMessage('❌ Failed to recover microphone tracks', 'error');
          }
        } else {
          console.log('✅ Microphone tracks are healthy');
          this.showTemporaryMessage('🎙️ Microphone tracks are healthy', 'success');
        }
      }
    } catch (error) {
      console.error('❌ Error verifying microphone tracks:', error);
      this.showTemporaryMessage('❌ Error verifying microphone tracks', 'error');
    }
  }

  /**
   * Event emitter functionality
   */
  emit(event, data) {
    // Dispatch custom event for external listeners
    if (this.root) {
      const customEvent = new CustomEvent(`roomview:${event}`, { detail: data });
      this.root.dispatchEvent(customEvent);
    }
  }

  render(initialData) {
    const roomCode = initialData?.roomCode || '######';
    const title = initialData?.room?.title || 'BeeMoo Room';
    const participantCount = initialData?.participants?.length || 0;

    return `
      <section class="room-container" aria-label="Room">
        <header class="room-header">
          <div class="room-header-content">
            <div class="room-info">
              <h1 class="room-title">
                <span class="room-title-text">${this.escapeHtml(title)}</span>
                ${this.isHost ? '<span class="host-badge">HOST</span>' : ''}
              </h1>
              <div class="room-details">
                <div class="room-code-container">
                  <span class="room-code-label">Room Code:</span>
                  <span class="room-code" title="Click to copy">${this.escapeHtml(roomCode)}</span>
                  <button class="copy-btn" title="Copy room code">📋</button>
                </div>
                <div class="viewer-count">
                  <span class="viewer-icon">👥</span>
                  <span class="viewer-text">${participantCount} viewer${participantCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
            
            <div class="room-controls">
              <div class="voice-controls">
                <button id="request-mic" class="btn btn-secondary btn-sm" title="Test microphone access">
                  <span class="mic-icon">🔧</span>
                  Setup Mic
                </button>
              </div>
              <div class="room-actions">
                <button id="leave-room" class="btn btn-danger btn-sm" title="Leave room permanently">
                  <span class="leave-icon">🚪</span>
                  Leave Room
                </button>
              </div>
            </div>
          </div>
        </header>

        <div class="room-layout">
          <aside class="audience-panel" aria-label="Audience">
            <div class="audience-header">
              <h3 class="audience-title">
                <span class="audience-icon">👥</span>
                Audience
              </h3>
            </div>
            <div id="audience-container" class="audience-content"></div>
          </aside>

          <main class="room-stage" aria-label="Movie Stage">
            <div class="stage-container">
              ${this.renderMovieStage()}
            </div>
          </main>

          <aside class="audio-panel" aria-label="Audio Controls">
            <div class="audio-header">
              <h3 class="audio-title">
                <span class="audio-icon">🎵</span>
                Audio Settings
              </h3>
              <button class="audio-toggle" id="audio-panel-toggle" title="Toggle audio settings">⚙️</button>
            </div>
            
            <div class="audio-content" id="audio-content">
              <div class="audio-controls-group">
                <div class="control-row">
                  <button id="mic-toggle" class="btn btn-mic" data-muted="false">
                    <span class="mic-icon">🎤</span>
                    <span class="mic-text">Mute Mic</span>
                  </button>
                </div>
                
                <div class="control-row">
                  <label class="control-label">Microphone Device:</label>
                  <select id="mic-device" class="control-select"></select>
                </div>
                
                <div class="audio-features">
                  <label class="feature-toggle">
                    <input type="checkbox" id="aec" checked />
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">Echo Cancellation</span>
                  </label>
                  
                  <label class="feature-toggle">
                    <input type="checkbox" id="ns" checked />
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">Noise Suppression</span>
                  </label>
                  
                  <label class="feature-toggle">
                    <input type="checkbox" id="agc" checked />
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">Auto Gain Control</span>
                  </label>
                </div>
                
                <div class="control-row">
                  <button id="apply-audio" class="btn btn-primary btn-block">
                    <span class="apply-icon">✅</span>
                    Apply Settings
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Console testing methods for volume adjustment
  testMicrophoneVolume(level = 3.0) {
    if (this.peerManager) {
      const result = this.peerManager.boostMicrophoneVolume(level);
      console.log(`🎙️ Microphone volume test:`, result);
      return result;
    }
    console.warn('⚠️ No peer manager available');
  }

  testAudioLevels(micVolume = 2.5, movieVolume = 0.15) {
    if (this.peerManager) {
      const result = this.peerManager.adjustAudioLevels({
        micVolume,
        movieVolume
      });
      console.log(`🎚️ Audio levels test:`, result);
      return result;
    }
    console.warn('⚠️ No peer manager available');
  }

  /**
   * Attach host video stream to participant video player
   */
  attachHostVideoStream(stream) {
    if (!this.videoPlayer || !this.videoPlayer.videoElement) {
      console.warn('⚠️ Cannot attach stream: VideoPlayer not ready');
      return;
    }

    console.log('🔗 Attaching host video stream to participant');
    
    // Exit virtual mode if needed
    if (typeof this.videoPlayer.exitVirtualMode === 'function') {
      this.videoPlayer.exitVirtualMode();
    }
    
    // Attach video stream directly to video element
    this.videoPlayer.videoElement.srcObject = stream;
    this.videoPlayer.videoElement.autoplay = true;
    this.videoPlayer.videoElement.playsInline = true;
    this.videoPlayer.videoElement.setAttribute('data-webrtc', 'true');
    
    console.log('✅ Host video stream attached to participant');
  }
}
