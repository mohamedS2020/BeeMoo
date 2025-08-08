import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from '../js/app.js';

// Mock the SocketClient
vi.mock('../js/utils/socketClient.js', () => {
  return {
    SocketClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: false,
      emit: vi.fn(),
      on: vi.fn()
    }))
  };
});

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: true,
    VITE_SERVER_URL: 'http://localhost:3001'
  }
});

describe('App Class', () => {
  let app;
  let mockAppElement;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = '<div id="app"></div>';
    mockAppElement = document.getElementById('app');
    
    // Create new App instance
    app = new App();
  });

  afterEach(() => {
    // Cleanup DOM
    document.body.innerHTML = '';
    
    // Reset app state
    if (app) {
      app.initialized = false;
    }
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(app.appElement).toBe(mockAppElement);
      expect(app.initialized).toBe(false);
      expect(app.socketClient).toBeDefined();
    });

    it('should handle missing app element gracefully', () => {
      document.body.innerHTML = '';
      const appWithoutElement = new App();
      expect(appWithoutElement.appElement).toBeNull();
    });
  });

  describe('init()', () => {
    it('should initialize the app correctly', () => {
      const renderSpy = vi.spyOn(app, 'render');
      const setupEventListenersSpy = vi.spyOn(app, 'setupEventListeners');
      const connectToServerSpy = vi.spyOn(app, 'connectToServer');

      app.init();

      expect(renderSpy).toHaveBeenCalled();
      expect(setupEventListenersSpy).toHaveBeenCalled();
      expect(connectToServerSpy).toHaveBeenCalled();
      expect(app.initialized).toBe(true);
    });

    it('should not initialize twice', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      app.init();
      app.init(); // Second call
      
      expect(consoleSpy).toHaveBeenCalledWith('App already initialized');
      expect(app.initialized).toBe(true);
      
      consoleSpy.mockRestore();
    });

    it('should log successful initialization', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      app.init();
      
      expect(consoleSpy).toHaveBeenCalledWith('✅ BeeMoo app initialized successfully');
      
      consoleSpy.mockRestore();
    });
  });

  describe('render()', () => {
    it('should render the app correctly', () => {
      app.render();
      
      expect(mockAppElement.innerHTML).toContain('🎬 BeeMoo');
      expect(mockAppElement.innerHTML).toContain('Movie Party Meetings Platform');
    });

    it('should show development info when in dev mode', () => {
      app.render();
      
      expect(mockAppElement.innerHTML).toContain('Development Mode');
      expect(mockAppElement.innerHTML).toContain('🛠️ Development Tools');
    });

    it('should include status grid', () => {
      app.render();
      
      expect(mockAppElement.innerHTML).toContain('status-grid');
      expect(mockAppElement.innerHTML).toContain('✅ Frontend');
      expect(mockAppElement.innerHTML).toContain('✅ Backend');
      expect(mockAppElement.innerHTML).toContain('✅ CORS');
      expect(mockAppElement.innerHTML).toContain('✅ WebSocket');
    });

    it('should handle missing app element', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      app.appElement = null;
      
      app.render();
      
      expect(consoleSpy).toHaveBeenCalledWith('App element not found');
      
      consoleSpy.mockRestore();
    });

    it('should include semantic HTML structure', () => {
      app.render();
      
      expect(mockAppElement.innerHTML).toContain('role="banner"');
      expect(mockAppElement.innerHTML).toContain('role="main"');
      expect(mockAppElement.innerHTML).toContain('id="main-content"');
      expect(mockAppElement.innerHTML).toContain('aria-label="System Status Overview"');
    });
  });

  describe('connectToServer()', () => {
    it('should call socket client connect method', () => {
      const connectSpy = vi.spyOn(app.socketClient, 'connect');
      
      app.connectToServer();
      
      expect(connectSpy).toHaveBeenCalled();
    });
  });

  describe('setupEventListeners()', () => {
    it('should set up ping test with delay', (done) => {
      const emitSpy = vi.spyOn(app.socketClient, 'emit');
      app.socketClient.isConnected = true;
      
      app.setupEventListeners();
      
      // Check if ping is sent after timeout
      setTimeout(() => {
        expect(emitSpy).toHaveBeenCalledWith('ping', { message: 'Hello from BeeMoo client!' });
        done();
      }, 2100); // Slightly more than the 2000ms timeout
    });

    it('should not send ping if not connected', (done) => {
      const emitSpy = vi.spyOn(app.socketClient, 'emit');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      app.socketClient.isConnected = false;
      
      app.setupEventListeners();
      
      setTimeout(() => {
        expect(emitSpy).not.toHaveBeenCalled();
        expect(consoleSpy).not.toHaveBeenCalledWith('🏓 Testing WebSocket connection...');
        
        consoleSpy.mockRestore();
        done();
      }, 2100);
    });
  });

  describe('Static Methods', () => {
    it('should return correct version', () => {
      expect(App.getVersion()).toBe('1.0.0');
    });
  });

  describe('Integration', () => {
    it('should work with full initialization flow', () => {
      app.init();
      
      expect(app.initialized).toBe(true);
      expect(mockAppElement.innerHTML).toContain('🎬 BeeMoo');
      expect(app.socketClient.connect).toHaveBeenCalled();
    });
  });
});
