import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SocketClient } from '../js/utils/socketClient.js';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn().mockReturnValue({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    id: 'mock-socket-id'
  })
}));

// Import after mocking
const { io } = await import('socket.io-client');

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_SERVER_URL: 'http://localhost:3001'
  }
});

describe('SocketClient', () => {
  let socketClient;
  let mockSocket;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Get mock socket instance
    mockSocket = {
      on: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      id: 'mock-socket-id'
    };
    
    // Mock io to return our mock socket
    io.mockReturnValue(mockSocket);
    
    // Setup DOM element for connection status
    document.body.innerHTML = '<div class="connection-status"></div>';
    
    // Create new SocketClient instance
    socketClient = new SocketClient();
  });

  afterEach(() => {
    // Cleanup DOM
    document.body.innerHTML = '';
    
    // Reset socket client state
    if (socketClient) {
      socketClient.socket = null;
      socketClient.isConnected = false;
    }
  });

  describe('Constructor', () => {
    it('should initialize with correct default values', () => {
      expect(socketClient.socket).toBeNull();
      expect(socketClient.isConnected).toBe(false);
      expect(socketClient.serverUrl).toBe('http://localhost:3001');
    });

    it('should use default server URL when env var is not set', () => {
      // Mock empty env
      Object.defineProperty(import.meta, 'env', {
        value: {},
        configurable: true
      });
      
      const client = new SocketClient();
      expect(client.serverUrl).toBe('http://localhost:3001');
    });
  });

  describe('connect()', () => {
    it('should create socket connection when not connected', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      socketClient.connect();
      
      expect(io).toHaveBeenCalledWith('http://localhost:3001', {
        cors: {
          origin: "http://localhost:3000",
          methods: ["GET", "POST"]
        }
      });
      expect(consoleSpy).toHaveBeenCalledWith('🔌 Connecting to BeeMoo server...', 'http://localhost:3001');
      
      consoleSpy.mockRestore();
    });

    it('should not reconnect if already connected', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
      
      socketClient.connect();
      
      expect(io).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Socket already connected');
      
      consoleSpy.mockRestore();
    });

    it('should set up event listeners after creating socket', () => {
      const setupSpy = vi.spyOn(socketClient, 'setupEventListeners');
      
      socketClient.connect();
      
      expect(setupSpy).toHaveBeenCalled();
    });
  });

  describe('setupEventListeners()', () => {
    beforeEach(() => {
      socketClient.socket = mockSocket;
    });

    it('should register connect event listener', () => {
      socketClient.setupEventListeners();
      
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should register disconnect event listener', () => {
      socketClient.setupEventListeners();
      
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should register connect_error event listener', () => {
      socketClient.setupEventListeners();
      
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    it('should handle connect event correctly', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const updateStatusSpy = vi.spyOn(socketClient, 'updateConnectionStatus');
      
      socketClient.setupEventListeners();
      
      // Simulate connect event
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      
      expect(socketClient.isConnected).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('✅ Connected to BeeMoo server:', 'mock-socket-id');
      expect(updateStatusSpy).toHaveBeenCalledWith(true);
      
      consoleSpy.mockRestore();
    });

    it('should handle disconnect event correctly', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const updateStatusSpy = vi.spyOn(socketClient, 'updateConnectionStatus');
      
      socketClient.setupEventListeners();
      
      // Simulate disconnect event
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')[1];
      disconnectHandler();
      
      expect(socketClient.isConnected).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('❌ Disconnected from BeeMoo server');
      expect(updateStatusSpy).toHaveBeenCalledWith(false);
      
      consoleSpy.mockRestore();
    });

    it('should handle connection error correctly', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const updateStatusSpy = vi.spyOn(socketClient, 'updateConnectionStatus');
      const testError = new Error('Connection failed');
      
      socketClient.setupEventListeners();
      
      // Simulate connect_error event
      const errorHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect_error')[1];
      errorHandler(testError);
      
      expect(consoleSpy).toHaveBeenCalledWith('🚨 Connection error:', testError);
      expect(updateStatusSpy).toHaveBeenCalledWith(false);
      
      consoleSpy.mockRestore();
    });
  });

  describe('updateConnectionStatus()', () => {
    let statusElement;

    beforeEach(() => {
      statusElement = document.querySelector('.connection-status');
    });

    it('should update status element when connected', () => {
      socketClient.updateConnectionStatus(true);
      
      expect(statusElement.textContent).toBe('🟢 Connected');
      expect(statusElement.className).toBe('connection-status connected');
    });

    it('should update status element when disconnected', () => {
      socketClient.updateConnectionStatus(false);
      
      expect(statusElement.textContent).toBe('🔴 Disconnected');
      expect(statusElement.className).toBe('connection-status disconnected');
    });

    it('should handle missing status element gracefully', () => {
      document.body.innerHTML = '';
      
      // Should not throw error
      expect(() => {
        socketClient.updateConnectionStatus(true);
      }).not.toThrow();
    });
  });

  describe('disconnect()', () => {
    it('should disconnect socket when connected', () => {
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
      
      socketClient.disconnect();
      
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(socketClient.socket).toBeNull();
      expect(socketClient.isConnected).toBe(false);
    });

    it('should handle disconnect when no socket exists', () => {
      socketClient.socket = null;
      
      // Should not throw error
      expect(() => {
        socketClient.disconnect();
      }).not.toThrow();
    });
  });

  describe('emit()', () => {
    it('should emit event when connected', () => {
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
      
      const testData = { message: 'test' };
      socketClient.emit('test-event', testData);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('test-event', testData);
    });

    it('should warn when trying to emit while disconnected', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      socketClient.socket = null;
      socketClient.isConnected = false;
      
      socketClient.emit('test-event', {});
      
      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cannot emit - socket not connected');
      
      consoleSpy.mockRestore();
    });
  });

  describe('on()', () => {
    it('should register event listener when socket exists', () => {
      socketClient.socket = mockSocket;
      const callback = vi.fn();
      
      socketClient.on('test-event', callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('test-event', callback);
    });

    it('should handle registration when no socket exists', () => {
      socketClient.socket = null;
      const callback = vi.fn();
      
      // Should not throw error
      expect(() => {
        socketClient.on('test-event', callback);
      }).not.toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should complete full connection flow', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Connect
      socketClient.connect();
      
      // Simulate successful connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      
      expect(socketClient.isConnected).toBe(true);
      expect(io).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('✅ Connected to BeeMoo server:', 'mock-socket-id');
      
      // Test emit after connection
      socketClient.emit('ping', { message: 'test' });
      expect(mockSocket.emit).toHaveBeenCalledWith('ping', { message: 'test' });
      
      consoleSpy.mockRestore();
    });
  });
});
