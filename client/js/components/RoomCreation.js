// BeeMoo - Room Creation Component
// Handles the flow for creating a new movie party room

export class RoomCreation {
  constructor(socketClient, onRoomCreated) {
    this.socketClient = socketClient;
    this.onRoomCreated = onRoomCreated;
    this.isVisible = false;
    this.isCreating = false;
    this.modal = null;
    this.focusTimeoutId = null;
    
    // Bind methods
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.handleUsernameSubmit = this.handleUsernameSubmit.bind(this);
    this.handleCopyRoomCode = this.handleCopyRoomCode.bind(this);
    this.handleJoinCreatedRoom = this.handleJoinCreatedRoom.bind(this);
  }

  show() {
    if (this.isVisible) return;
    
    this.isVisible = true;
    this.render();
    this.setupEventListeners();
    
    // Focus on username input
    if (typeof document !== 'undefined') {
      this.focusTimeoutId = setTimeout(() => {
        if (!this.isVisible || typeof document === 'undefined') return;
        const usernameInput = document.getElementById('create-username-input');
        if (usernameInput) {
          usernameInput.focus();
        }
      }, 100);
    }
  }

  hide() {
    if (!this.isVisible) return;
    
    this.isVisible = false;
    if (this.focusTimeoutId) {
      clearTimeout(this.focusTimeoutId);
      this.focusTimeoutId = null;
    }
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }

  render() {
    // Create modal HTML
    const modalHTML = `
      <div class="modal-overlay" id="room-creation-modal">
        <div class="modal-content" role="dialog" aria-labelledby="create-room-title" aria-modal="true">
          <div class="modal-header">
            <h2 id="create-room-title">🏠 Create New Room</h2>
            <button class="modal-close" aria-label="Close" id="close-create-modal">&times;</button>
          </div>
          
          <div class="modal-body">
            <div id="username-step" class="step-content active">
              <div class="step-header">
                <h3>Choose Your Username</h3>
                <p>You'll be the host and control movie playback</p>
              </div>
              
              <form id="username-form" class="form-group">
                <label for="create-username-input" class="form-label">Username</label>
                <input 
                  type="text" 
                  id="create-username-input" 
                  class="form-input" 
                  placeholder="Enter your username..."
                  maxlength="30"
                  required
                  aria-describedby="username-help"
                >
                <small id="username-help" class="form-help">
                  2-30 characters, letters, numbers, and basic punctuation
                </small>
                <div id="username-error" class="form-error" aria-live="polite"></div>
                
                <div class="form-actions">
                  <button type="button" class="btn btn-secondary" id="cancel-create">
                    Cancel
                  </button>
                  <button type="submit" class="btn btn-primary" id="submit-username">
                    <span class="btn-text">Create Room</span>
                    <span class="btn-loader" style="display: none;">
                      <span class="spinner"></span> Creating...
                    </span>
                  </button>
                </div>
              </form>
            </div>
            
            <div id="room-code-step" class="step-content">
              <div class="step-header">
                <h3>🎉 Room Created Successfully!</h3>
                <p>Share this code with friends to invite them</p>
              </div>
              
              <div class="room-code-display">
                <label class="form-label">Room Code</label>
                <div class="room-code-container">
                  <span id="room-code-text" class="room-code">XXXXXX</span>
                  <button 
                    type="button" 
                    class="btn btn-icon" 
                    id="copy-room-code"
                    aria-label="Copy room code to clipboard"
                    title="Copy to clipboard"
                  >
                    📋
                  </button>
                </div>
                <small class="form-help">
                  Friends can join by entering this code
                </small>
              </div>
              
              <div class="host-info">
                <h4>As the host, you can:</h4>
                <ul>
                  <li>🎬 Control movie playback (play, pause, seek)</li>
                  <li>🎤 Manage voice chat</li>
                  <li>👥 See all participants</li>
                  <li>🗑️ End the room at any time</li>
                </ul>
              </div>
              
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="create-another">
                  Create Another Room
                </button>
                <button type="button" class="btn btn-primary" id="join-created-room">
                  Enter Room
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add to document
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('room-creation-modal');
  }

  setupEventListeners() {
    if (!this.modal) return;

    // Close modal handlers
    const closeBtn = this.modal.querySelector('#close-create-modal');
    const cancelBtn = this.modal.querySelector('#cancel-create');
    const overlay = this.modal;

    closeBtn?.addEventListener('click', this.hide);
    cancelBtn?.addEventListener('click', this.hide);
    
    // Close on overlay click (but not on modal content)
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.hide();
      }
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    // Username form submission
    const usernameForm = this.modal.querySelector('#username-form');
    usernameForm?.addEventListener('submit', this.handleUsernameSubmit);

    // Room code actions
    const copyBtn = this.modal.querySelector('#copy-room-code');
    const joinBtn = this.modal.querySelector('#join-created-room');
    const createAnotherBtn = this.modal.querySelector('#create-another');

    copyBtn?.addEventListener('click', this.handleCopyRoomCode);
    joinBtn?.addEventListener('click', this.handleJoinCreatedRoom);
    createAnotherBtn?.addEventListener('click', () => {
      this.showUsernameStep();
    });

    // Input validation
    const usernameInput = this.modal.querySelector('#create-username-input');
    usernameInput?.addEventListener('input', this.validateUsername.bind(this));
  }

  validateUsername(event) {
    const input = event.target;
    const username = input.value.trim();
    const errorDiv = document.getElementById('username-error');
    
    if (!errorDiv) return;

    if (username.length === 0) {
      errorDiv.textContent = '';
      return;
    }

    if (username.length < 2) {
      errorDiv.textContent = 'Username must be at least 2 characters';
      return;
    }

    if (username.length > 30) {
      errorDiv.textContent = 'Username must be 30 characters or less';
      return;
    }

    // Check for invalid characters
    const allowedPattern = /^[a-zA-Z0-9\s\-_\.]+$/;
    if (!allowedPattern.test(username)) {
      errorDiv.textContent = 'Username contains invalid characters';
      return;
    }

    // Check for reserved words
    const reservedPatterns = [
      /^(system|admin|host|server|bot)$/i,
      /^(moderator|mod|owner)$/i
    ];
    
    if (reservedPatterns.some(pattern => pattern.test(username))) {
      errorDiv.textContent = 'This username is reserved';
      return;
    }

    errorDiv.textContent = '';
  }

  async handleUsernameSubmit(event) {
    event.preventDefault();
    
    if (this.isCreating) return;

    const usernameInput = document.getElementById('create-username-input');
    const submitBtn = document.getElementById('submit-username');
    const errorDiv = document.getElementById('username-error');
    
    if (!usernameInput || !submitBtn || !errorDiv) return;

    const username = usernameInput.value.trim();
    
    // Validate username
    if (!username) {
      errorDiv.textContent = 'Username is required';
      usernameInput.focus();
      return;
    }

    // Show loading state
    this.isCreating = true;
    this.setButtonLoading(submitBtn, true);
    errorDiv.textContent = '';

    try {
      // Create room via WebSocket
      const result = await this.createRoom(username);
      
      if (result.success) {
        // Persist full room data so the app can render the host in the participant list
        this.createdRoom = {
          roomCode: result.roomCode,
          username,
          room: result.room,
          user: result.user,
          participants: result.user ? [result.user] : []
        };
        this.showRoomCodeStep(result.roomCode, username);
      } else {
        errorDiv.textContent = result.error || 'Failed to create room. Please try again.';
      }
    } catch (error) {
      console.error('Room creation error:', error);
      errorDiv.textContent = 'Connection error. Please check your connection and try again.';
    } finally {
      this.isCreating = false;
      this.setButtonLoading(submitBtn, false);
    }
  }

  async createRoom(username) {
    return new Promise((resolve) => {
      // Set up one-time listeners for room creation response
      const handleRoomCreated = (data) => {
        this.socketClient.off('room-created', handleRoomCreated);
        this.socketClient.off('create-room-error', handleCreateError);
        resolve({ success: true, roomCode: data.roomCode, room: data.room, user: data.user });
      };

      const handleCreateError = (data) => {
        this.socketClient.off('room-created', handleRoomCreated);
        this.socketClient.off('create-room-error', handleCreateError);
        resolve({ success: false, error: data.error });
      };

      // Listen for responses
      this.socketClient.on('room-created', handleRoomCreated);
      this.socketClient.on('create-room-error', handleCreateError);

      // Send create room request
      this.socketClient.emit('create-room', { username });

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socketClient.off('room-created', handleRoomCreated);
        this.socketClient.off('create-room-error', handleCreateError);
        resolve({ success: false, error: 'Request timeout. Please try again.' });
      }, 10000);
    });
  }

  showRoomCodeStep(roomCode, username) {
    const usernameStep = document.getElementById('username-step');
    const roomCodeStep = document.getElementById('room-code-step');
    const roomCodeText = document.getElementById('room-code-text');

    if (usernameStep && roomCodeStep && roomCodeText) {
      usernameStep.classList.remove('active');
      roomCodeStep.classList.add('active');
      roomCodeText.textContent = roomCode;
      
      // Store room data for joining (preserve previously captured room/user)
      this.createdRoom = { ...(this.createdRoom || {}), roomCode, username };
      
      // Announce to screen readers
      const announcement = document.getElementById('announcements');
      if (announcement) {
        announcement.textContent = `Room created successfully. Room code is ${roomCode}`;
      }
    }
  }

  showUsernameStep() {
    const usernameStep = document.getElementById('username-step');
    const roomCodeStep = document.getElementById('room-code-step');
    const usernameInput = document.getElementById('create-username-input');
    const errorDiv = document.getElementById('username-error');

    if (usernameStep && roomCodeStep) {
      roomCodeStep.classList.remove('active');
      usernameStep.classList.add('active');
      
      // Clear form
      if (usernameInput) {
        usernameInput.value = '';
        usernameInput.focus();
      }
      if (errorDiv) {
        errorDiv.textContent = '';
      }
    }
  }

  async handleCopyRoomCode() {
    const roomCodeText = document.getElementById('room-code-text');
    const copyBtn = document.getElementById('copy-room-code');
    
    if (!roomCodeText || !copyBtn) return;

    const roomCode = roomCodeText.textContent;
    
    try {
      await navigator.clipboard.writeText(roomCode);
      
      // Show success feedback
      copyBtn.textContent = '✅';
      copyBtn.setAttribute('title', 'Copied!');
      
      // Announce to screen readers
      const announcement = document.getElementById('announcements');
      if (announcement) {
        announcement.textContent = 'Room code copied to clipboard';
      }
      
      // Reset after 2 seconds
      setTimeout(() => {
        copyBtn.textContent = '📋';
        copyBtn.setAttribute('title', 'Copy to clipboard');
      }, 2000);
      
    } catch (error) {
      console.error('Failed to copy room code:', error);
      
      // Fallback - show room code in alert
      alert(`Room Code: ${roomCode}\n\nPlease copy this code manually.`);
    }
  }

  handleJoinCreatedRoom() {
    if (!this.createdRoom) return;
    
    // Hide modal and trigger room joining
    this.hide();
    
    if (this.onRoomCreated) {
      this.onRoomCreated(this.createdRoom);
    }
  }

  setButtonLoading(button, loading) {
    if (!button) return;
    
    const btnText = button.querySelector('.btn-text');
    const btnLoader = button.querySelector('.btn-loader');
    
    if (loading) {
      button.disabled = true;
      if (btnText) btnText.style.display = 'none';
      if (btnLoader) btnLoader.style.display = 'inline-flex';
    } else {
      button.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnLoader) btnLoader.style.display = 'none';
    }
  }

  // Cleanup method
  destroy() {
    this.hide();
    // Remove any remaining event listeners
    document.removeEventListener('keydown', this.handleEscKey);
    if (this.focusTimeoutId) {
      clearTimeout(this.focusTimeoutId);
      this.focusTimeoutId = null;
    }
  }
}
