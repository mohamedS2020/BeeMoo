// BeeMoo - Room View
// Minimal scaffold that hosts the participant list and room header

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

    const participantsContainer = this.root.querySelector('#participants-container');
    this.participantList.attach(participantsContainer);

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
        console.log(`🎙️ Requesting microphone access for ${this.isHost ? 'HOST' : 'PARTICIPANT'}`);
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }, 
          video: false 
        });
        console.log('✅ Microphone access granted:', {
          tracks: stream.getAudioTracks().length,
          trackEnabled: stream.getAudioTracks()[0]?.enabled
        });
        return stream;
      } catch (e) {
        console.warn('⚠️ Microphone not available, using silent stream:', e.message);
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        return dest.stream; // silent stream
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

      // If I'm a participant and this is from the host, store video stream and attach combined stream
      const hostPeerId = this.getHostPeerId();
      const isFromHost = !!hostPeerId && peerId === hostPeerId;
      if (!this.isHost && isFromHost) {
        this.remoteHostVideoStream = stream;
        // Combine host video with any host audio streams (mic) and attach
        this.combineAndAttachHostStreamsIfReady();
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
    micToggle?.addEventListener('click', () => this.toggleMic(micToggle));
    applyBtn?.addEventListener('click', () => this.applyAudioSettings());
    
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
        // Show file selector for hosts, waiting screen for participants
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
    
    changeBtn?.addEventListener('click', () => this.changeMovie());
    retryBtn?.addEventListener('click', () => this.retryMovie());
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

  changeMovie() {
    // Clean up existing video player
    if (this.videoPlayer) {
      this.videoPlayer.destroy();
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
      this.changeMovie();
      return;
    }
    
    console.log('🔄 Retrying movie initialization...');
    
    // Clean up existing video player
    if (this.videoPlayer) {
      this.videoPlayer.destroy();
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

  unmount() {
    if (this.participantList) this.participantList.destroy();
    if (this.movieFileSelector) this.movieFileSelector.destroy();
    if (this.videoPlayer) this.videoPlayer.destroy();
    if (this.peerManager) this.peerManager.destroy();
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
    const select = this.root.querySelector('#mic-device');
    const aec = this.root.querySelector('#aec')?.checked;
    const ns = this.root.querySelector('#ns')?.checked;
    const agc = this.root.querySelector('#agc')?.checked;
    const deviceId = select?.value || undefined;

    try {
      const constraints = WebRTCUtils.getAudioConstraints({
        echoCancellation: aec,
        noiseSuppression: ns,
        autoGainControl: agc,
        deviceId
      });
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      await this.peerManager.replaceLocalStream(newStream);
    } catch (e) {
      alert('Failed to apply audio settings. Check permissions and try again.');
    }
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
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }, 
            video: false 
          });
          console.log('✅ Microphone stream recreated');
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
    };
    this._onLeft = ({ participant, participants }) => {
      if (participants) {
        this.participants.clear();
        for (const p of participants) this.participants.set(p.socketId, p);
      } else if (participant) {
        this.participants.delete(participant.socketId);
        if (this.voiceActive) this.peerManager.closePeer(participant.socketId);
      }
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

      // Ensure host video element has audio enabled for streaming
      console.log('🔊 Host video audio check before streaming:', {
        muted: this.videoPlayer.videoElement.muted,
        volume: this.videoPlayer.videoElement.volume
      });
      
      // Temporarily unmute host video to ensure audio is captured
      const hostOriginalMuted = this.videoPlayer.videoElement.muted;
      this.videoPlayer.videoElement.muted = false;
      this.videoPlayer.videoElement.volume = 1.0;

      // Start video streaming through PeerManager
      console.log('🎥 Calling peerManager.startVideoStreaming...');
      const result = await this.peerManager.startVideoStreaming(
        this.videoPlayer.videoElement,
        { 
          frameRate: 30,
          quality: 'high',
          includeAudio: true
        }
      );

      // Restore host video muted state (host usually mutes their own video to avoid echo)
      this.videoPlayer.videoElement.muted = hostOriginalMuted;

      console.log('🎥 Video streaming result:', result);

      if (result.success) {
        console.log('✅ Video streaming started successfully');
        
        // Show streaming status in UI
        this.showVideoStreamingStatus(true);
        
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
      this.videoPlayer.videoElement.volume = 1.0; // Ensure volume is at maximum
      
      // Video audio is handled by existing video player controls
      
      // Mark video element as WebRTC stream
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
      
      // Stop participant virtual timer since we have real video
      this.videoPlayer.stopParticipantTimer();
      
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
        this.handleHostStoppedStreaming();
        break;

      case 'sync':
        // Treat 'sync' as a full state update: show video player, set movie info, and sync playback position
        await this.handleHostStartedStreaming(movieState);
        if (movieState && typeof movieState.currentTime === 'number') {
          // Seek to the correct time and play/pause as needed
          if (this.videoPlayer && this.videoPlayer.videoElement) {
            this.videoPlayer.videoElement.currentTime = movieState.currentTime;
            if (movieState.isPlaying) {
              this.videoPlayer.videoElement.play();
            } else {
              this.videoPlayer.videoElement.pause();
            }
          }
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
    console.log('▶️ Host started playback');
    
    // Ensure movie title is included for sync display
    const syncState = {
      ...movieState,
      title: movieState.title || this.selectedMovie?.name || 'Unknown Movie'
    };
    
    this.videoPlayer.syncWithHost('play', syncState);
  }

  handleHostPause(movieState) {
    if (!this.videoPlayer) return;
    console.log('⏸️ Host paused playback');
    
    // Ensure movie title is included for sync display
    const syncState = {
      ...movieState,
      title: movieState.title || this.selectedMovie?.name || 'Unknown Movie'
    };
    
    this.videoPlayer.syncWithHost('pause', syncState);
  }

  handleHostSeek(movieState) {
    if (!this.videoPlayer) return;
    console.log('⏩ Host seeked to:', movieState.currentTime);
    
    // Ensure movie title is included for sync display
    const syncState = {
      ...movieState,
      title: movieState.title || this.selectedMovie?.name || 'Unknown Movie'
    };
    
    this.videoPlayer.syncWithHost('seek', syncState);
  }

  handleHostStoppedStreaming() {
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
      this.videoPlayer.destroy();
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
                <div class="participant-count">
                  <span class="participant-icon">👥</span>
                  <span class="participant-text">${participantCount} participant${participantCount !== 1 ? 's' : ''}</span>
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
            </div>
          </div>
        </header>

        <div class="room-layout">
          <aside class="participants-panel" aria-label="Participants">
            <div class="participants-header">
              <h3 class="participants-title">
                <span class="participants-icon">👥</span>
                Participants
              </h3>
            </div>
            <div id="participants-container" class="participants-content"></div>
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
}
