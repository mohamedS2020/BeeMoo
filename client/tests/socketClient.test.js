import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock socket.io-client before importing SocketClient
const mockSocket = {
  id: 'test-socket-id',
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn()
};

const mockIo = vi.fn(() => mockSocket);

vi.mock('socket.io-client', () => ({
  io: mockIo
}));

// Import SocketClient after mocking
import { SocketClient } from '../js/utils/socketClient.js';

describe('SocketClient', () => {
  let socketClient;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create new instance
    socketClient = new SocketClient();
    
    // Mock DOM elements for connection status
    document.body.innerHTML = '<div class="connection-status">🔄 Connecting...</div>';
  });

  afterEach(() => {
    if (socketClient) {
      socketClient.disconnect();
    }
    document.body.innerHTML = '';
  });

  describe('Constructor', () => {
    it('should initialize with correct default properties', () => {
      expect(socketClient.socket).toBe(null);
      expect(socketClient.isConnected).toBe(false);
      expect(socketClient.serverUrl).toBe('http://localhost:3001');
    });

    it('should use custom server URL from environment', () => {
      // Mock import.meta.env
      const originalEnv = import.meta.env;
      import.meta.env = {
        ...originalEnv,
        VITE_SERVER_URL: 'http://custom-server:8080'
      };
      
      const customSocketClient = new SocketClient();
      expect(customSocketClient.serverUrl).toBe('http://custom-server:8080');
      
      // Restore original env
      import.meta.env = originalEnv;
    });
  });

  describe('connect()', () => {
    it('should establish socket connection with correct configuration', () => {
      socketClient.connect();
      
      expect(mockIo).toHaveBeenCalledWith('http://localhost:3001', {
        cors: {
          origin: 'http://localhost:3000',
          methods: ['GET', 'POST']
        }
      });
      
      expect(socketClient.socket).toBe(mockSocket);
    });

    it('should set up event listeners on connection', () => {
      socketClient.connect();
      
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    it('should not reconnect if already connected', () => {
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      socketClient.connect();
      
      expect(consoleSpy).toHaveBeenCalledWith('Socket already connected');
      expect(mockIo).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle connect event correctly', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const updateStatusSpy = vi.spyOn(socketClient, 'updateConnectionStatus');
      
      socketClient.connect();
      
      // Simulate connect event
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      
      expect(socketClient.isConnected).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('✅ Connected to BeeMoo server:', 'test-socket-id');
      expect(updateStatusSpy).toHaveBeenCalledWith(true);
      
      consoleSpy.mockRestore();
      updateStatusSpy.mockRestore();
    });

    it('should handle disconnect event correctly', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const updateStatusSpy = vi.spyOn(socketClient, 'updateConnectionStatus');
      
      socketClient.connect();
      socketClient.isConnected = true;
      
      // Simulate disconnect event
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')[1];
      disconnectHandler();
      
      expect(socketClient.isConnected).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('❌ Disconnected from BeeMoo server');
      expect(updateStatusSpy).toHaveBeenCalledWith(false);
      
      consoleSpy.mockRestore();
      updateStatusSpy.mockRestore();
    });

    it('should handle connection error correctly', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const updateStatusSpy = vi.spyOn(socketClient, 'updateConnectionStatus');
      
      socketClient.connect();
      
      const error = new Error('Connection failed');
      const errorHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect_error')[1];
      errorHandler(error);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith('🚨 Connection error:', error);
      expect(updateStatusSpy).toHaveBeenCalledWith(false);
      
      consoleErrorSpy.mockRestore();
      updateStatusSpy.mockRestore();
    });
  });

  describe('disconnect()', () => {
    it('should disconnect socket and reset state', () => {
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
      
      socketClient.disconnect();
      
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(socketClient.socket).toBe(null);
      expect(socketClient.isConnected).toBe(false);
    });

    it('should handle disconnect when no socket exists', () => {
      socketClient.socket = null;
      
      expect(() => socketClient.disconnect()).not.toThrow();
      expect(socketClient.isConnected).toBe(false);
    });
  });

  describe('emit()', () => {
    beforeEach(() => {
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
    });

    it('should emit event when connected', () => {
      const eventData = { message: 'test' };
      
      socketClient.emit('test-event', eventData);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('test-event', eventData);
    });

    it('should warn when trying to emit without connection', () => {
      socketClient.isConnected = false;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      socketClient.emit('test-event', { data: 'test' });
      
      expect(consoleSpy).toHaveBeenCalledWith('Cannot emit - socket not connected');
      expect(mockSocket.emit).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should warn when socket is null', () => {
      socketClient.socket = null;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      socketClient.emit('test-event', { data: 'test' });
      
      expect(consoleSpy).toHaveBeenCalledWith('Cannot emit - socket not connected');
      expect(mockSocket.emit).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle emit with no data', () => {
      socketClient.emit('ping');
      
      expect(mockSocket.emit).toHaveBeenCalledWith('ping', undefined);
    });
  });

  describe('on()', () => {
    beforeEach(() => {
      socketClient.socket = mockSocket;
    });

    it('should register event listener when socket exists', () => {
      const callback = vi.fn();
      
      socketClient.on('test-event', callback);
      
      expect(mockSocket.on).toHaveBeenCalledWith('test-event', callback);
    });

    it('should not register listener when socket is null', () => {
      socketClient.socket = null;
      const callback = vi.fn();
      
      socketClient.on('test-event', callback);
      
      expect(mockSocket.on).not.toHaveBeenCalled();
    });
  });

  describe('off()', () => {
    beforeEach(() => {
      socketClient.socket = mockSocket;
    });

    it('should remove event listener when socket exists', () => {
      const callback = vi.fn();
      
      socketClient.off('test-event', callback);
      
      expect(mockSocket.off).toHaveBeenCalledWith('test-event', callback);
    });

    it('should not remove listener when socket is null', () => {
      socketClient.socket = null;
      const callback = vi.fn();
      
      socketClient.off('test-event', callback);
      
      expect(mockSocket.off).not.toHaveBeenCalled();
    });
  });

  describe('updateConnectionStatus()', () => {
    it('should update status element when connected', () => {
      const statusElement = document.querySelector('.connection-status');
      
      socketClient.updateConnectionStatus(true);
      
      expect(statusElement.textContent).toBe('🟢 Connected');
      expect(statusElement.className).toBe('connection-status connected');
    });

    it('should update status element when disconnected', () => {
      const statusElement = document.querySelector('.connection-status');
      
      socketClient.updateConnectionStatus(false);
      
      expect(statusElement.textContent).toBe('🔴 Disconnected');
      expect(statusElement.className).toBe('connection-status disconnected');
    });

    it('should handle missing status element gracefully', () => {
      document.body.innerHTML = '';
      
      expect(() => socketClient.updateConnectionStatus(true)).not.toThrow();
      expect(() => socketClient.updateConnectionStatus(false)).not.toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete connection lifecycle', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Initial state
      expect(socketClient.isConnected).toBe(false);
      expect(socketClient.socket).toBe(null);
      
      // Connect
      socketClient.connect();
      expect(socketClient.socket).toBe(mockSocket);
      
      // Simulate successful connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      expect(socketClient.isConnected).toBe(true);
      
      // Test emit/on functionality
      const testCallback = vi.fn();
      socketClient.on('test-event', testCallback);
      socketClient.emit('test-message', { data: 'hello' });
      
      expect(mockSocket.on).toHaveBeenCalledWith('test-event', testCallback);
      expect(mockSocket.emit).toHaveBeenCalledWith('test-message', { data: 'hello' });
      
      // Disconnect
      socketClient.disconnect();
      expect(socketClient.isConnected).toBe(false);
      expect(socketClient.socket).toBe(null);
      
      consoleSpy.mockRestore();
    });

    it('should handle connection failure scenario', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      socketClient.connect();
      
      // Simulate connection error
      const error = new Error('Server unavailable');
      const errorHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect_error')[1];
      errorHandler(error);
      
      expect(socketClient.isConnected).toBe(false);
      
      // Try to emit - should warn
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      socketClient.emit('test', {});
      expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot emit - socket not connected');
      
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should handle reconnection scenario', () => {
      socketClient.connect();
      
      // Simulate initial connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      expect(socketClient.isConnected).toBe(true);
      
      // Simulate disconnection
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')[1];
      disconnectHandler();
      expect(socketClient.isConnected).toBe(false);
      
      // Simulate reconnection
      connectHandler();
      expect(socketClient.isConnected).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle socket.io connection failures gracefully', () => {
      const error = new Error('Socket.io failed to load');
      mockIo.mockImplementationOnce(() => {
        throw error;
      });
      
      expect(() => socketClient.connect()).toThrow(error);
    });

    it('should handle malformed server URLs', () => {
      socketClient.serverUrl = 'invalid-url';
      
      // Should not throw, but socket.io will handle the invalid URL
      expect(() => socketClient.connect()).not.toThrow();
    });

    it('should handle null/undefined event data', () => {
      socketClient.socket = mockSocket;
      socketClient.isConnected = true;
      
      expect(() => socketClient.emit('test', null)).not.toThrow();
      expect(() => socketClient.emit('test', undefined)).not.toThrow();
      expect(() => socketClient.on('test', null)).not.toThrow();
      expect(() => socketClient.off('test', null)).not.toThrow();
    });
  });

  describe('Environment Configuration', () => {
    it('should handle missing environment variables', () => {
      const originalEnv = import.meta.env;
      import.meta.env = {};
      
      const newClient = new SocketClient();
      expect(newClient.serverUrl).toBe('http://localhost:3001');
      
      import.meta.env = originalEnv;
    });

    it('should handle different environment configurations', () => {
      const testCases = [
        { env: 'http://production-server.com', expected: 'http://production-server.com' },
        { env: 'https://secure-server.com:8443', expected: 'https://secure-server.com:8443' },
        { env: '', expected: 'http://localhost:3001' },
        { env: null, expected: 'http://localhost:3001' }
      ];
      
      testCases.forEach(({ env, expected }) => {
        const originalEnv = import.meta.env;
        import.meta.env = { VITE_SERVER_URL: env };
        
        const client = new SocketClient();
        expect(client.serverUrl).toBe(expected);
        
        import.meta.env = originalEnv;
      });
    });
  });
});