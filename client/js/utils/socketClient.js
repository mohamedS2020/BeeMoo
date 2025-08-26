// BeeMoo - WebSocket Client Utility
// Handles connection to backend Socket.io server

import { io } from 'socket.io-client';

export class SocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
    this.reconnectTimeout = null;
    this.isReconnecting = false;
    this.sessionData = null;
    
    // Use VITE_API_URL from .env for backend URL
    this.serverUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    
    // Load session data on initialization
    this.loadSessionData();
  }

  connect() {
    if (this.socket && this.isConnected) {
      console.warn('Socket already connected');
      return;
    }

    console.log('🔌 Connecting to BeeMoo server...', this.serverUrl);
    
    this.socket = io(this.serverUrl, {
      cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
      },
      forceNew: true,
      timeout: 5000,
      autoConnect: true
    });

    this.setupEventListeners();
    this.setupSessionSaveListeners();
  }

  setupEventListeners() {
    this.socket.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      console.log('✅ Connected to BeeMoo server:', this.socket.id);
      this.updateConnectionStatus(true);
      
      // Attempt session recovery if we have session data
      this.attemptSessionRecovery();
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log('❌ Disconnected from BeeMoo server:', reason);
      this.updateConnectionStatus(false);
      
      // Only attempt reconnection for certain disconnect reasons
      if (this.shouldAttemptReconnection(reason)) {
        this.handleDisconnection();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('🚨 Connection error:', error);
      this.updateConnectionStatus(false);
      this.handleConnectionError();
    });

    // Session recovery responses
    this.socket.on('session-recovered', (data) => {
      console.log('✅ Session recovered successfully:', data);
      this.handleSessionRecovered(data);
    });

    this.socket.on('session-recovery-failed', (error) => {
      console.warn('⚠️ Session recovery failed:', error);
      this.handleSessionRecoveryFailed();
    });
  }

  setupSessionSaveListeners() {
    // Save session data when rooms are joined/created
    this.socket.on('room-created', (data) => {
      console.log('💾 Room created event received:', data);
      console.log('💾 Saving session data for room creation');
      this.saveSessionData(data.roomCode, data.user.username, true);
    });

    this.socket.on('room-joined', (data) => {
      console.log('💾 Room joined event received:', data);
      console.log('💾 Saving session data for room join');
      this.saveSessionData(data.roomCode, data.user.username, data.user.isHost || false);
    });
  }

  updateConnectionStatus(connected) {
    // Update UI to show connection status
    const statusElement = document.querySelector('.connection-status');
    if (statusElement) {
      statusElement.textContent = connected ? '🟢 Connected' : '🔴 Disconnected';
      statusElement.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
    }
  }

  /**
   * Save session data for recovery
   */
  saveSessionData(roomCode, username, isHost) {
    console.log('💾 saveSessionData called with:', { roomCode, username, isHost });
    
    this.sessionData = {
      roomCode,
      username,
      isHost,
      timestamp: Date.now(),
      socketId: this.socket?.id
    };
    
    localStorage.setItem('beemoo-session-recovery', JSON.stringify(this.sessionData));
    console.log('💾 Session data saved for recovery:', this.sessionData);
  }

  /**
   * Load session data from storage
   */
  loadSessionData() {
    try {
      const saved = localStorage.getItem('beemoo-session-recovery');
      if (saved) {
        this.sessionData = JSON.parse(saved);
        // Check if session is not too old (30 minutes)
        const thirtyMinutes = 30 * 60 * 1000;
        if (Date.now() - this.sessionData.timestamp > thirtyMinutes) {
          this.clearSessionData();
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to load session data:', error);
      this.clearSessionData();
    }
  }

  /**
   * Clear session data
   */
  clearSessionData() {
    this.sessionData = null;
    localStorage.removeItem('beemoo-session-recovery');
  }

  /**
   * Check if we should attempt reconnection
   */
  shouldAttemptReconnection(reason) {
    // Don't reconnect on intentional disconnects or server shutdown
    const noReconnectReasons = ['io server disconnect', 'io client disconnect'];
    return !noReconnectReasons.includes(reason);
  }

  /**
   * Handle disconnection with reconnection logic
   */
  handleDisconnection() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 10000);
    
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts} in ${delay}ms...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      
      if (this.socket) {
        this.socket.disconnect();
      }
      
      this.connect();
    }, delay);
  }

  /**
   * Handle connection errors
   */
  handleConnectionError() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.handleDisconnection();
    } else {
      console.error('❌ Maximum reconnection attempts reached');
      this.handleReconnectionFailed();
    }
  }

  /**
   * Attempt to recover previous session
   */
  attemptSessionRecovery() {
    if (!this.sessionData) {
      console.log('🔍 No session data found for recovery');
      return;
    }

    console.log('🔄 Attempting session recovery...', this.sessionData);
    console.log('🔍 Session data details:', {
      roomCode: this.sessionData.roomCode,
      username: this.sessionData.username,
      isHost: this.sessionData.isHost,
      timestamp: this.sessionData.timestamp,
      socketId: this.sessionData.socketId
    });
    
    this.emit('recover-session', {
      roomCode: this.sessionData.roomCode,
      username: this.sessionData.username,
      isHost: this.sessionData.isHost,
      previousSocketId: this.sessionData.socketId
    });
  }

  /**
   * Handle successful session recovery
   */
  handleSessionRecovered(data) {
    // Update session data with new socket ID
    if (this.sessionData) {
      this.sessionData.socketId = this.socket.id;
      this.sessionData.timestamp = Date.now();
      this.saveSessionData(
        this.sessionData.roomCode,
        this.sessionData.username,
        this.sessionData.isHost
      );
    }

    // Notify the application about successful recovery
    if (window.beemooApp && window.beemooApp.handleSessionRecovered) {
      window.beemooApp.handleSessionRecovered(data);
    }
  }

  /**
   * Handle failed session recovery
   */
  handleSessionRecoveryFailed() {
    this.clearSessionData();
    
    // Redirect to landing page if recovery fails
    if (window.beemooApp && window.beemooApp.handleSessionRecoveryFailed) {
      window.beemooApp.handleSessionRecoveryFailed();
    }
  }

  /**
   * Handle complete reconnection failure
   */
  handleReconnectionFailed() {
    this.clearSessionData();
    
    // Notify user and redirect to landing page
    if (window.beemooApp && window.beemooApp.handleReconnectionFailed) {
      window.beemooApp.handleReconnectionFailed();
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  // Emit event to server
  emit(event, data) {
    if (this.socket && this.isConnected) {
      this.socket.emit(event, data);
    } else {
      console.warn('Cannot emit - socket not connected');
    }
  }

  // Listen for event from server
  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  // Remove event listener
  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }
}
