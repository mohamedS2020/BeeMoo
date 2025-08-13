// BeeMoo - WebSocket Client Utility
// Handles connection to backend Socket.io server

import { io } from 'socket.io-client';

export class SocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    // Use VITE_API_URL from .env for backend URL
    this.serverUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
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
      }
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log('✅ Connected to BeeMoo server:', this.socket.id);
      this.updateConnectionStatus(true);
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      console.log('❌ Disconnected from BeeMoo server');
      this.updateConnectionStatus(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('🚨 Connection error:', error);
      this.updateConnectionStatus(false);
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
