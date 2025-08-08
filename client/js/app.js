// BeeMoo - Main Application Class
// Demonstrates modern ES6+ class syntax and modules

import { SocketClient } from './utils/socketClient.js';
import { RoomCreation } from './components/RoomCreation.js';

export class App {
  constructor() {
    this.appElement = document.getElementById('app');
    this.socketClient = new SocketClient();
    this.initialized = false;
    this.currentView = 'landing'; // 'landing', 'room'
    this.currentRoom = null;
    
    // Initialize components
    this.roomCreation = new RoomCreation(
      this.socketClient, 
      (roomData) => this.handleRoomCreated(roomData)
    );
  }

  init() {
    if (this.initialized) {
      console.warn('App already initialized');
      return;
    }

    this.render();
    this.setupEventListeners();
    this.connectToServer();
    this.initialized = true;
    
    console.log('✅ BeeMoo app initialized successfully');
  }

  render() {
    if (!this.appElement) {
      console.error('App element not found');
      return;
    }

    const isDev = import.meta.env.DEV;

    this.appElement.innerHTML = `
      <div class="beemoo-app">
        <header role="banner" class="main-header">
          <div class="header-content">
            <h1 class="logo">🎬 BeeMoo</h1>
            <p class="tagline">Movie Party Meetings Platform</p>
            ${isDev ? `<div class="dev-info" role="status">
              <small>Development Mode</small>
              <div class="connection-status">🔄 Connecting...</div>
            </div>` : ''}
          </div>
        </header>

        <main id="main-content" role="main" class="landing-main">
          <section class="hero-section" aria-labelledby="hero-title">
            <h2 id="hero-title" class="hero-title">Join or Create a Movie Party</h2>
            <p class="hero-description">
              Watch movies together with friends! Create a room to host, or join an existing room with a code.
            </p>
          </section>

          <section class="action-section" aria-label="Room Actions">
            <div class="action-container">
              <div class="action-card create-room-card">
                <div class="card-icon">🏠</div>
                <h3>Create Room</h3>
                <p>Start a new movie party and invite friends to join</p>
                <button 
                  id="create-room-btn" 
                  class="btn btn-primary btn-large"
                  aria-describedby="create-room-help"
                >
                  Create New Room
                </button>
                <small id="create-room-help" class="help-text">
                  You'll be the host and control movie playback
                </small>
              </div>

              <div class="action-card join-room-card">
                <div class="card-icon">🚪</div>
                <h3>Join Room</h3>
                <p>Enter a room code to join an existing movie party</p>
                <button 
                  id="join-room-btn" 
                  class="btn btn-secondary btn-large"
                  aria-describedby="join-room-help"
                >
                  Join Existing Room
                </button>
                <small id="join-room-help" class="help-text">
                  Get the room code from your host
                </small>
              </div>
            </div>
          </section>

          <section class="features-section" aria-labelledby="features-title">
            <h3 id="features-title" class="features-title">What You Can Do</h3>
            <div class="features-grid">
              <div class="feature-item">
                <span class="feature-icon">🎬</span>
                <h4>Watch Together</h4>
                <p>Stream movies from your device with perfect sync</p>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🎤</span>
                <h4>Voice Chat</h4>
                <p>Talk with friends during the movie</p>
              </div>
              <div class="feature-item">
                <span class="feature-icon">💬</span>
                <h4>Text Chat</h4>
                <p>Send messages without interrupting</p>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📱</span>
                <h4>Mobile Ready</h4>
                <p>Works perfectly on any device</p>
              </div>
            </div>
          </section>

          ${isDev ? `
          <section class="dev-status" aria-label="Development Status">
            <details>
              <summary>🛠️ Development Info</summary>
              <div class="dev-grid">
                <div class="dev-item">
                  <strong>Frontend:</strong> Vite + HMR (Port 3000)
                </div>
                <div class="dev-item">
                  <strong>Backend:</strong> Express + Socket.io (Port 3001)
                </div>
                <div class="dev-item">
                  <strong>WebSocket:</strong> <span class="connection-status">Connecting...</span>
                </div>
                <div class="dev-item">
                  <strong>CORS:</strong> Configured for development
                </div>
              </div>
            </details>
          </section>` : ''}
        </main>

        <footer role="contentinfo" class="main-footer">
          <p>&copy; 2025 BeeMoo - Movie Party Meetings Platform</p>
        </footer>
      </div>
    `;
  }

  connectToServer() {
    // Connect to the WebSocket server
    this.socketClient.connect();
  }

  setupEventListeners() {
    // Set up room action buttons
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');

    if (createRoomBtn) {
      createRoomBtn.addEventListener('click', () => this.handleCreateRoom());
    }

    if (joinRoomBtn) {
      joinRoomBtn.addEventListener('click', () => this.handleJoinRoom());
    }

    // Test WebSocket connection with a simple ping
    setTimeout(() => {
      if (this.socketClient.isConnected) {
        console.log('🏓 Testing WebSocket connection...');
        this.socketClient.emit('ping', { message: 'Hello from BeeMoo client!' });
      }
    }, 2000);
  }

  handleCreateRoom() {
    console.log('🏠 Create room clicked');
    
    // Show room creation modal
    this.roomCreation.show();
  }

  handleJoinRoom() {
    // TODO: This will be implemented in Task 3.3
    console.log('🚪 Join room clicked - will implement in Task 3.3');
    alert('Join Room functionality will be implemented in Task 3.3');
  }

  handleRoomCreated(roomData) {
    console.log('🎉 Room created successfully:', roomData);
    
    // Store current room data
    this.currentRoom = roomData;
    
    // TODO: Navigate to room view (will be implemented in later tasks)
    // For now, show a success message
    alert(`Room created! Room code: ${roomData.roomCode}\n\nRoom view will be implemented in upcoming tasks.`);
  }

  // Utility method for future use
  static getVersion() {
    return '1.0.0';
  }
}
