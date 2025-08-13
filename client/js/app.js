// BeeMoo - Main Application Class
// Demonstrates modern ES6+ class syntax and modules

import { SocketClient } from './utils/socketClient.js';
import { RoomCreation } from './components/RoomCreation.js';
import { RoomJoining } from './components/RoomJoining.js';
import { RoomView } from './components/RoomView.js';

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
    this.roomJoining = new RoomJoining(
      this.socketClient,
      (roomData) => this.handleRoomJoined(roomData)
    );
    this.roomView = new RoomView(this.socketClient);
  }

  init() {
    if (this.initialized) {
      console.warn('App already initialized');
      return;
    }

    // Check for persisted room session
    const session = this.getPersistedRoomSession();
    if (session && session.roomCode && session.username) {
      // Try to auto-rejoin room
      this.connectToServer();
      this.socketClient.on('room-joined', (roomData) => {
        this.currentRoom = roomData;
        this.navigateToRoom(roomData);
      });
      this.socketClient.on('join-room-error', (err) => {
        this.clearRoomSession();
        this.render();
      });
      // Emit join-room after socket connects
      this.socketClient.on('connect', () => {
        this.socketClient.emit('join-room', {
          roomCode: session.roomCode,
          username: session.username
        });
      });
      // Show loading UI
      this.renderLoading('Rejoining room...');
      this.initialized = true;
      return;
    }

    this.render();
    this.setupEventListeners();
    this.connectToServer();
    this.initialized = true;
    
    console.log('✅ BeeMoo app initialized successfully');
  }

  getPersistedRoomSession() {
    try {
      return JSON.parse(localStorage.getItem('beemoo-room-session'));
    } catch { return null; }
  }

  renderLoading(msg) {
    if (!this.appElement) return;
    this.appElement.innerHTML = `<div class="beemoo-app"><div class="loading-overlay" style="display:flex;align-items:center;justify-content:center;height:100vh;"><div class="loading-content"><div class="loading-spinner"></div><div class="loading-text">${msg || 'Loading...'}</div></div></div></div>`;
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
            <div class="brand-row">
              <h1 class="logo">🎬 BeeMoo</h1>
              <button id="nav-toggle" class="nav-toggle" aria-label="Open menu" aria-controls="main-nav" aria-expanded="false">
                <span class="nav-toggle-bar" aria-hidden="true"></span>
                <span class="sr-only">Menu</span>
              </button>
            </div>
            <p class="tagline">Movie Party Meetings Platform</p>
            ${isDev ? `<div class="dev-info" role="status">
              <small>Development Mode</small>
              <div class="connection-status">🔄 Connecting...</div>
            </div>` : ''}
          </div>
          <nav id="main-nav" class="main-nav" aria-label="Primary">
            <ul>
              <li><a href="#" id="nav-create">Create Room</a></li>
              <li><a href="#" id="nav-join">Join Room</a></li>
              <li><a href="#features" id="nav-features">Features</a></li>
            </ul>
          </nav>
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

    // Mobile nav toggle
    const navToggle = document.getElementById('nav-toggle');
    const mainHeader = document.querySelector('.main-header');
    const mainNav = document.getElementById('main-nav');

    if (navToggle && mainHeader && mainNav) {
      const closeNav = () => {
        mainHeader.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      };
      const openNav = () => {
        mainHeader.classList.add('nav-open');
        navToggle.setAttribute('aria-expanded', 'true');
      };
      const toggleNav = () => {
        if (mainHeader.classList.contains('nav-open')) {
          closeNav();
        } else {
          openNav();
        }
      };
      navToggle.addEventListener('click', (e) => {
        e.preventDefault();
        toggleNav();
      });
      // Close on ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeNav();
      });
      // Close on link click
      mainNav.addEventListener('click', (e) => {
        const target = e.target;
        if (target.tagName === 'A') {
          closeNav();
        }
      });
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
    console.log('🚪 Join room clicked');
    
    // Show room joining modal
    this.roomJoining.show();
  }

  handleRoomCreated(roomData) {
    console.log('🎉 Room created successfully:', roomData);
    this.currentRoom = roomData;
    this.persistRoomSession(roomData);
    this.navigateToRoom(roomData);
  }

  handleRoomJoined(roomData) {
    console.log('🎉 Room joined successfully:', roomData);
    this.currentRoom = roomData;
    this.persistRoomSession(roomData);
    this.navigateToRoom(roomData);
  }

  persistRoomSession(roomData) {
    // Save minimal info for auto-rejoin
    try {
      const session = {
        roomCode: roomData.roomCode,
        username: roomData.user?.username,
        isHost: !!roomData.user?.isHost
      };
      localStorage.setItem('beemoo-room-session', JSON.stringify(session));
    } catch {}
  }

  clearRoomSession() {
    try { localStorage.removeItem('beemoo-room-session'); } catch {}
  }

  navigateToRoom(roomData) {
    this.currentView = 'room';
    // Render a minimal shell for room
    if (this.appElement) {
      this.appElement.innerHTML = '';
      const container = document.createElement('div');
      this.appElement.appendChild(container);
      const initialParticipants = Array.isArray(roomData.participants) && roomData.participants.length > 0
        ? roomData.participants
        : (roomData.user ? [roomData.user] : []);
      
      // Listen for leave room event from RoomView
      container.addEventListener('roomview:leave-room', (e) => {
        console.log('🚪 Leave room event received:', e.detail);
        this.handleLeaveRoom(e.detail);
      });
      
      this.roomView.mount(container, {
        roomCode: roomData.roomCode,
        room: roomData.room,
        user: roomData.user,
        participants: initialParticipants,
      });
    }
  }

  /**
   * Handle room leave and navigate back to landing
   */
  handleLeaveRoom(leaveData) {
    console.log('🏠 Handling leave room - returning to landing page');
    
    // Clear current room data
    this.currentRoom = null;
    this.currentView = 'landing';
    
    // Clear any persisted session
    this.clearRoomSession();
    
    // Reconnect socket for fresh state (but don't auto-join anything)
    this.socketClient.disconnect();
    setTimeout(() => {
      this.socketClient.connect();
    }, 500);
    
    // Re-render landing page
    this.render();
    this.setupEventListeners();
    
    console.log('✅ Successfully returned to landing page');
  }

  // Utility method for future use
  static getVersion() {
    return '1.0.0';
  }
}
