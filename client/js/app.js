// BeeMoo - Main Application Class
// Demonstrates modern ES6+ class syntax and modules

import { SocketClient } from './utils/socketClient.js';

export class App {
  constructor() {
    this.appElement = document.getElementById('app');
    this.socketClient = new SocketClient();
    this.initialized = false;
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
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

    this.appElement.innerHTML = `
      <div class="beemoo-app">
        <header role="banner">
          <h1>🎬 BeeMoo</h1>
          <p>Movie Party Meetings Platform</p>
          ${isDev ? `<div class="dev-info" role="status">
            <small>Development Mode</small>
            <div class="connection-status">🔄 Connecting...</div>
          </div>` : ''}
        </header>
        <main id="main-content" role="main">
          <section class="status-grid" aria-label="System Status Overview">
            <div class="status-item">
              <h3>✅ Frontend</h3>
              <p>Vite + Hot Module Replacement</p>
              <small>Port 3000</small>
            </div>
            <div class="status-item">
              <h3>✅ Backend</h3>
              <p>Express + Socket.io + Nodemon</p>
              <small>Port 3001</small>
            </div>
            <div class="status-item">
              <h3>✅ CORS</h3>
              <p>Cross-origin configured</p>
              <small>Development ready</small>
            </div>
            <div class="status-item">
              <h3>✅ WebSocket</h3>
              <p>Real-time communication</p>
              <small class="connection-status">Connecting...</small>
            </div>
          </section>
          ${isDev ? `
          <section class="dev-tools" aria-label="Development Information">
            <h3>🛠️ Development Tools</h3>
            <p><strong>Server:</strong> ${serverUrl}</p>
            <p><strong>Hot Reload:</strong> File changes auto-refresh</p>
            <p><strong>Proxy:</strong> API calls routed to backend</p>
            <p><strong>Source Maps:</strong> Enabled for debugging</p>
          </section>` : ''}
        </main>
        <footer role="contentinfo" class="sr-only">
          <p>BeeMoo - Movie Party Meetings Platform</p>
        </footer>
      </div>
    `;
  }

  connectToServer() {
    // Connect to the WebSocket server
    this.socketClient.connect();
  }

  setupEventListeners() {
    // Test WebSocket connection with a simple ping
    setTimeout(() => {
      if (this.socketClient.isConnected) {
        console.log('🏓 Testing WebSocket connection...');
        this.socketClient.emit('ping', { message: 'Hello from BeeMoo client!' });
      }
    }, 2000);
  }

  // Utility method for future use
  static getVersion() {
    return '1.0.0';
  }
}
