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
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        console.warn('Microphone not available, using silent stream');
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        return dest.stream; // silent stream
      }
    });

    // Render remote audio when tracks arrive
    this.peerManager.onRemoteTrack = (peerId, stream) => {
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

    // Hook participant-volume changes to adjust remote audio elements
    this.participantList.onVolumeChange = (socketId, volume) => {
      const el = this.root.querySelector(`audio[data-peer="${socketId}"]`);
      if (el) el.volume = volume;
    };

    // Bind participant events
    this.bindRoomParticipantEvents();

    // Voice toggle
    const voiceBtn = this.root.querySelector('#toggle-voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', async () => {
        if (this.voiceActive) {
          this.stopVoice();
          voiceBtn.textContent = 'Start Voice';
        } else {
          await this.startVoice();
          voiceBtn.textContent = 'Stop Voice';
        }
      });
    }

    // Populate devices and bind audio controls
    this.populateMicDevices();
    const micToggle = this.root.querySelector('#mic-toggle');
    const applyBtn = this.root.querySelector('#apply-audio');
    micToggle?.addEventListener('click', () => this.toggleMic(micToggle));
    applyBtn?.addEventListener('click', () => this.applyAudioSettings());
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
        
        // Notify server about movie being ready
        this.socketClient.emit('movie-control', {
          action: 'start-streaming',
          movieState: {
            title: movieData.name,
            type: movieData.type,
            size: movieData.size,
            duration: this.videoPlayer.duration || 0
          }
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
    buttonEl.textContent = nextEnabled ? 'Mute Mic' : 'Unmute Mic';
    // Notify server about mic status for participant list update
    const muted = !nextEnabled;
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
    for (const [peerId] of this.participants.entries()) {
      if (!peerId || peerId === selfId) continue;
      try { await this.peerManager.callPeer(peerId); } catch {}
    }
  }

  stopVoice() {
    this.voiceActive = false;
    if (this.peerManager) {
      this.peerManager.destroy();
      // Recreate
      this.peerManager = new PeerManager(this.socketClient, async () => {
        try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
        catch {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          return dest.stream;
        }
      });
      this.peerManager.onRemoteTrack = (peerId, stream) => {
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
    this.root?.querySelectorAll('audio[data-peer]')?.forEach(el => el.remove());
  }

  bindRoomParticipantEvents() {
    if (this.boundHandlers) return;
    this._onJoined = ({ participant, participants }) => {
      if (participants) {
        for (const p of participants) this.participants.set(p.socketId, p);
      } else if (participant) {
        this.participants.set(participant.socketId, participant);
        if (this.voiceActive) this.peerManager.callPeer(participant.socketId).catch(() => {});
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

    return `
      <section class="room-shell" aria-label="Room">
        <header class="room-header">
          <h2 class="room-title">${this.escapeHtml(title)}</h2>
          <div class="room-meta">
            <span class="room-code-inline" title="Room Code">${this.escapeHtml(roomCode)}</span>
            <button id="request-mic" class="btn btn-secondary btn-small" style="margin-left:8px">Enable Mic</button>
            <button id="toggle-voice" class="btn btn-primary btn-small" style="margin-left:8px">Start Voice</button>
          </div>
        </header>
        <div class="room-content">
          <aside class="room-sidebar" aria-label="Participants">
            <div id="participants-container"></div>
          </aside>
          <main class="room-main" aria-label="Stage">
            ${this.renderMovieStage()}
            <div class="audio-controls" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
              <button id="mic-toggle" class="btn btn-secondary btn-small">Mute Mic</button>
              <select id="mic-device" class="form-input" style="max-width:260px;"></select>
              <label style="display:flex; align-items:center; gap:6px; font-size:0.9rem;">
                <input type="checkbox" id="aec" checked /> Echo Cancellation
              </label>
              <label style="display:flex; align-items:center; gap:6px; font-size:0.9rem;">
                <input type="checkbox" id="ns" checked /> Noise Suppression
              </label>
              <label style="display:flex; align-items:center; gap:6px; font-size:0.9rem;">
                <input type="checkbox" id="agc" checked /> Auto Gain
              </label>
              <button id="apply-audio" class="btn btn-primary btn-small">Apply</button>
            </div>
          </main>
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
