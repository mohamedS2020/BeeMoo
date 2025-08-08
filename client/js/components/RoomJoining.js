// BeeMoo - Room Joining Component
// Handles the flow for joining an existing movie party room

export class RoomJoining {
  constructor(socketClient, onRoomJoined) {
    this.socketClient = socketClient;
    this.onRoomJoined = onRoomJoined;
    this.isVisible = false;
    this.isJoining = false;
    this.isValidatingCode = false;
    this.modal = null;
    this.currentRoomCode = null;
    
    // Bind methods
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.handleRoomCodeSubmit = this.handleRoomCodeSubmit.bind(this);
    this.handleUsernameSubmit = this.handleUsernameSubmit.bind(this);
    this.handleJoinRoom = this.handleJoinRoom.bind(this);
  }

  show() {
    if (this.isVisible) return;
    
    this.isVisible = true;
    this.render();
    this.setupEventListeners();
    
    // Focus on room code input
    setTimeout(() => {
      const roomCodeInput = document.getElementById('join-room-code-input');
      if (roomCodeInput) {
        roomCodeInput.focus();
      }
    }, 100);
  }

  hide() {
    if (!this.isVisible) return;
    
    this.isVisible = false;
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    
    // Reset state
    this.currentRoomCode = null;
    this.isJoining = false;
    this.isValidatingCode = false;
  }

  render() {
    // Create modal HTML
    const modalHTML = `
      <div class="modal-overlay" id="room-joining-modal">
        <div class="modal-content" role="dialog" aria-labelledby="join-room-title" aria-modal="true">
          <div class="modal-header">
            <h2 id="join-room-title">🚪 Join Room</h2>
            <button class="modal-close" aria-label="Close" id="close-join-modal">&times;</button>
          </div>
          
          <div class="modal-body">
            <div id="room-code-step" class="step-content active">
              <div class="step-header">
                <h3>Enter Room Code</h3>
                <p>Enter the 6-character code shared by the host</p>
              </div>
              
              <form id="room-code-form" class="form-group">
                <label for="join-room-code-input" class="form-label">Room Code</label>
                <input 
                  type="text" 
                  id="join-room-code-input" 
                  class="form-input room-code-input" 
                  placeholder="Enter room code..."
                  maxlength="6"
                  required
                  aria-describedby="room-code-help"
                  autocomplete="off"
                  spellcheck="false"
                >
                <small id="room-code-help" class="form-help">
                  6-character code (letters and numbers)
                </small>
                <div id="room-code-error" class="form-error" aria-live="polite"></div>
                
                <div class="form-actions">
                  <button type="button" class="btn btn-secondary" id="cancel-join">
                    Cancel
                  </button>
                  <button type="submit" class="btn btn-primary" id="validate-room-code">
                    <span class="btn-text">Continue</span>
                    <span class="btn-loader" style="display: none;">
                      <span class="spinner"></span> Checking...
                    </span>
                  </button>
                </div>
              </form>
            </div>
            
            <div id="username-step" class="step-content">
              <div class="step-header">
                <h3>Choose Your Username</h3>
                <p>Join room <span id="display-room-code" class="room-code-inline">######</span></p>
              </div>
              
              <form id="join-username-form" class="form-group">
                <label for="join-username-input" class="form-label">Username</label>
                <input 
                  type="text" 
                  id="join-username-input" 
                  class="form-input" 
                  placeholder="Enter your username..."
                  maxlength="30"
                  required
                  aria-describedby="join-username-help"
                >
                <small id="join-username-help" class="form-help">
                  2-30 characters, letters, numbers, and basic punctuation
                </small>
                <div id="join-username-error" class="form-error" aria-live="polite"></div>
                
                <div class="form-actions">
                  <button type="button" class="btn btn-secondary" id="back-to-code">
                    ← Back
                  </button>
                  <button type="submit" class="btn btn-primary" id="submit-join">
                    <span class="btn-text">Join Room</span>
                    <span class="btn-loader" style="display: none;">
                      <span class="spinner"></span> Joining...
                    </span>
                  </button>
                </div>
              </form>
            </div>
            
            <div id="success-step" class="step-content">
              <div class="step-header">
                <h3>🎉 Successfully Joined!</h3>
                <p>Welcome to room <span id="success-room-code" class="room-code-inline">######</span></p>
              </div>
              
              <div class="join-success-info">
                <h4>You're now connected:</h4>
                <ul>
                  <li>🎬 Watch movies synced with the host</li>
                  <li>🎤 Join voice chat with other participants</li>
                  <li>💬 Send messages in the room chat</li>
                  <li>🔊 Control your personal audio settings</li>
                </ul>
              </div>
              
              <div class="form-actions">
                <button type="button" class="btn btn-primary" id="enter-joined-room">
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
    this.modal = document.getElementById('room-joining-modal');
  }

  setupEventListeners() {
    if (!this.modal) return;

    // Close modal handlers
    const closeBtn = this.modal.querySelector('#close-join-modal');
    const cancelBtn = this.modal.querySelector('#cancel-join');
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

    // Form submissions
    const roomCodeForm = this.modal.querySelector('#room-code-form');
    const usernameForm = this.modal.querySelector('#join-username-form');

    roomCodeForm?.addEventListener('submit', this.handleRoomCodeSubmit);
    usernameForm?.addEventListener('submit', this.handleUsernameSubmit);

    // Navigation buttons
    const backBtn = this.modal.querySelector('#back-to-code');
    const enterRoomBtn = this.modal.querySelector('#enter-joined-room');

    backBtn?.addEventListener('click', () => this.showRoomCodeStep());
    enterRoomBtn?.addEventListener('click', this.handleJoinRoom);

    // Input validation and formatting
    const roomCodeInput = this.modal.querySelector('#join-room-code-input');
    const usernameInput = this.modal.querySelector('#join-username-input');

    roomCodeInput?.addEventListener('input', this.formatRoomCode.bind(this));
    roomCodeInput?.addEventListener('input', this.validateRoomCodeInput.bind(this));
    usernameInput?.addEventListener('input', this.validateUsername.bind(this));
  }

  formatRoomCode(event) {
    const input = event.target;
    let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Limit to 6 characters
    if (value.length > 6) {
      value = value.substring(0, 6);
    }
    
    input.value = value;
  }

  validateRoomCodeInput(event) {
    const input = event.target;
    const roomCode = input.value.trim();
    const errorDiv = document.getElementById('room-code-error');
    
    if (!errorDiv) return;

    if (roomCode.length === 0) {
      errorDiv.textContent = '';
      return;
    }

    if (roomCode.length < 6) {
      errorDiv.textContent = 'Room code must be 6 characters';
      return;
    }

    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
      errorDiv.textContent = 'Room code can only contain letters and numbers';
      return;
    }

    errorDiv.textContent = '';
  }

  validateUsername(event) {
    const input = event.target;
    const username = input.value.trim();
    const errorDiv = document.getElementById('join-username-error');
    
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

  async handleRoomCodeSubmit(event) {
    event.preventDefault();
    
    if (this.isValidatingCode) return;

    const roomCodeInput = document.getElementById('join-room-code-input');
    const validateBtn = document.getElementById('validate-room-code');
    const errorDiv = document.getElementById('room-code-error');
    
    if (!roomCodeInput || !validateBtn || !errorDiv) return;

    const roomCode = roomCodeInput.value.trim().toUpperCase();
    
    // Validate room code
    if (!roomCode) {
      errorDiv.textContent = 'Room code is required';
      roomCodeInput.focus();
      return;
    }

    if (roomCode.length !== 6) {
      errorDiv.textContent = 'Room code must be 6 characters';
      roomCodeInput.focus();
      return;
    }

    // Show loading state
    this.isValidatingCode = true;
    this.setButtonLoading(validateBtn, true);
    errorDiv.textContent = '';

    try {
      // Validate room code via WebSocket
      const result = await this.validateRoomCode(roomCode);
      
      if (result.success) {
        this.currentRoomCode = roomCode;
        this.showUsernameStep(roomCode);
      } else {
        errorDiv.textContent = result.error || 'Room not found. Please check the code and try again.';
      }
    } catch (error) {
      console.error('Room validation error:', error);
      errorDiv.textContent = 'Connection error. Please check your connection and try again.';
    } finally {
      this.isValidatingCode = false;
      this.setButtonLoading(validateBtn, false);
    }
  }

  async validateRoomCode(roomCode) {
    return new Promise((resolve) => {
      // Set up one-time listeners for room validation response
      const handleRoomExists = (data) => {
        this.socketClient.off('room-exists', handleRoomExists);
        this.socketClient.off('room-not-found', handleRoomNotFound);
        resolve({ success: true, room: data.room });
      };

      const handleRoomNotFound = (data) => {
        this.socketClient.off('room-exists', handleRoomExists);
        this.socketClient.off('room-not-found', handleRoomNotFound);
        resolve({ success: false, error: data.error });
      };

      // Listen for responses
      this.socketClient.on('room-exists', handleRoomExists);
      this.socketClient.on('room-not-found', handleRoomNotFound);

      // Send validate room request
      this.socketClient.emit('validate-room', { roomCode });

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socketClient.off('room-exists', handleRoomExists);
        this.socketClient.off('room-not-found', handleRoomNotFound);
        resolve({ success: false, error: 'Request timeout. Please try again.' });
      }, 10000);
    });
  }

  async handleUsernameSubmit(event) {
    event.preventDefault();
    
    if (this.isJoining) return;

    const usernameInput = document.getElementById('join-username-input');
    const submitBtn = document.getElementById('submit-join');
    const errorDiv = document.getElementById('join-username-error');
    
    if (!usernameInput || !submitBtn || !errorDiv || !this.currentRoomCode) return;

    const username = usernameInput.value.trim();
    
    // Validate username
    if (!username) {
      errorDiv.textContent = 'Username is required';
      usernameInput.focus();
      return;
    }

    // Show loading state
    this.isJoining = true;
    this.setButtonLoading(submitBtn, true);
    errorDiv.textContent = '';

    try {
      // Join room via WebSocket
      const result = await this.joinRoom(this.currentRoomCode, username);
      
      if (result.success) {
        this.showSuccessStep(this.currentRoomCode, username, result.room);
      } else {
        errorDiv.textContent = result.error || 'Failed to join room. Please try again.';
      }
    } catch (error) {
      console.error('Room joining error:', error);
      errorDiv.textContent = 'Connection error. Please check your connection and try again.';
    } finally {
      this.isJoining = false;
      this.setButtonLoading(submitBtn, false);
    }
  }

  async joinRoom(roomCode, username) {
    return new Promise((resolve) => {
      // Set up one-time listeners for join room response
      const handleJoinSuccess = (data) => {
        this.socketClient.off('room-joined', handleJoinSuccess);
        this.socketClient.off('join-room-error', handleJoinError);
        resolve({ success: true, room: data.room, user: data.user });
      };

      const handleJoinError = (data) => {
        this.socketClient.off('room-joined', handleJoinSuccess);
        this.socketClient.off('join-room-error', handleJoinError);
        resolve({ success: false, error: data.error });
      };

      // Listen for responses
      this.socketClient.on('room-joined', handleJoinSuccess);
      this.socketClient.on('join-room-error', handleJoinError);

      // Send join room request
      this.socketClient.emit('join-room', { roomCode, username });

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socketClient.off('room-joined', handleJoinSuccess);
        this.socketClient.off('join-room-error', handleJoinError);
        resolve({ success: false, error: 'Request timeout. Please try again.' });
      }, 10000);
    });
  }

  showRoomCodeStep() {
    const roomCodeStep = document.getElementById('room-code-step');
    const usernameStep = document.getElementById('username-step');
    const roomCodeInput = document.getElementById('join-room-code-input');
    const errorDiv = document.getElementById('room-code-error');

    if (roomCodeStep && usernameStep) {
      usernameStep.classList.remove('active');
      roomCodeStep.classList.add('active');
      
      // Clear form and focus
      if (roomCodeInput) {
        roomCodeInput.focus();
      }
      if (errorDiv) {
        errorDiv.textContent = '';
      }
    }
  }

  showUsernameStep(roomCode) {
    const roomCodeStep = document.getElementById('room-code-step');
    const usernameStep = document.getElementById('username-step');
    const usernameInput = document.getElementById('join-username-input');
    const displayRoomCode = document.getElementById('display-room-code');
    const errorDiv = document.getElementById('join-username-error');

    if (roomCodeStep && usernameStep) {
      roomCodeStep.classList.remove('active');
      usernameStep.classList.add('active');
      
      // Update display and focus
      if (displayRoomCode) {
        displayRoomCode.textContent = roomCode;
      }
      if (usernameInput) {
        usernameInput.value = '';
        usernameInput.focus();
      }
      if (errorDiv) {
        errorDiv.textContent = '';
      }
      
      // Announce to screen readers
      const announcement = document.getElementById('announcements');
      if (announcement) {
        announcement.textContent = `Room ${roomCode} found. Please enter your username.`;
      }
    }
  }

  showSuccessStep(roomCode, username, roomData) {
    const usernameStep = document.getElementById('username-step');
    const successStep = document.getElementById('success-step');
    const successRoomCode = document.getElementById('success-room-code');

    if (usernameStep && successStep) {
      usernameStep.classList.remove('active');
      successStep.classList.add('active');
      
      // Update display
      if (successRoomCode) {
        successRoomCode.textContent = roomCode;
      }
      
      // Store join data for room entry
      this.joinedRoom = { roomCode, username, room: roomData };
      
      // Announce to screen readers
      const announcement = document.getElementById('announcements');
      if (announcement) {
        announcement.textContent = `Successfully joined room ${roomCode}`;
      }
    }
  }

  handleJoinRoom() {
    if (!this.joinedRoom) return;
    
    // Hide modal and trigger room joining
    this.hide();
    
    if (this.onRoomJoined) {
      this.onRoomJoined(this.joinedRoom);
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
  }
}
