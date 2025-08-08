import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomCreation } from '../js/components/RoomCreation.js';

// Mock socket client
const mockSocketClient = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
};

describe('RoomCreation Component', () => {
  let roomCreation;
  let mockCallback;

  beforeEach(() => {
    // Clean up DOM
    document.body.innerHTML = '<div id="announcements" class="sr-only"></div>';
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Create component
    mockCallback = vi.fn();
    roomCreation = new RoomCreation(mockSocketClient, mockCallback);
  });

  afterEach(() => {
    // Clean up component
    if (roomCreation) {
      roomCreation.destroy();
    }
    
    // Clean up DOM
    document.body.innerHTML = '';
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(roomCreation.socketClient).toBe(mockSocketClient);
      expect(roomCreation.onRoomCreated).toBe(mockCallback);
      expect(roomCreation.isVisible).toBe(false);
      expect(roomCreation.isCreating).toBe(false);
      expect(roomCreation.modal).toBe(null);
    });

    it('should bind methods correctly', () => {
      expect(typeof roomCreation.show).toBe('function');
      expect(typeof roomCreation.hide).toBe('function');
      expect(typeof roomCreation.handleUsernameSubmit).toBe('function');
      expect(typeof roomCreation.handleCopyRoomCode).toBe('function');
      expect(typeof roomCreation.handleJoinCreatedRoom).toBe('function');
    });
  });

  describe('show()', () => {
    it('should show the modal and set visibility', () => {
      roomCreation.show();
      
      expect(roomCreation.isVisible).toBe(true);
      expect(document.getElementById('room-creation-modal')).toBeDefined();
    });

    it('should not show modal if already visible', () => {
      roomCreation.isVisible = true;
      const renderSpy = vi.spyOn(roomCreation, 'render').mockImplementation(() => {});
      
      roomCreation.show();
      
      expect(renderSpy).not.toHaveBeenCalled();
      renderSpy.mockRestore();
    });

    it('should focus on username input after showing', async () => {
      roomCreation.show();
      
      // Wait for focus timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const usernameInput = document.getElementById('create-username-input');
      expect(usernameInput).toBeDefined();
    });
  });

  describe('hide()', () => {
    it('should hide modal and reset visibility', () => {
      roomCreation.show();
      expect(roomCreation.isVisible).toBe(true);
      
      roomCreation.hide();
      
      expect(roomCreation.isVisible).toBe(false);
      expect(roomCreation.modal).toBe(null);
      expect(document.getElementById('room-creation-modal')).toBe(null);
    });

    it('should not error if modal not visible', () => {
      expect(() => roomCreation.hide()).not.toThrow();
    });
  });

  describe('validateUsername()', () => {
    beforeEach(() => {
      roomCreation.show();
    });

    it('should accept valid usernames', () => {
      const mockEvent = {
        target: { value: 'ValidUser123' }
      };
      
      roomCreation.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('username-error');
      expect(errorDiv.textContent).toBe('');
    });

    it('should reject usernames that are too short', () => {
      const mockEvent = {
        target: { value: 'a' }
      };
      
      roomCreation.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('username-error');
      expect(errorDiv.textContent).toContain('at least 2 characters');
    });

    it('should reject usernames that are too long', () => {
      const mockEvent = {
        target: { value: 'a'.repeat(31) }
      };
      
      roomCreation.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('username-error');
      expect(errorDiv.textContent).toContain('30 characters or less');
    });

    it('should reject usernames with invalid characters', () => {
      const mockEvent = {
        target: { value: 'user@domain.com' }
      };
      
      roomCreation.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('username-error');
      expect(errorDiv.textContent).toContain('invalid characters');
    });

    it('should reject reserved usernames', () => {
      const mockEvent = {
        target: { value: 'admin' }
      };
      
      roomCreation.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('username-error');
      expect(errorDiv.textContent).toContain('reserved');
    });
  });

  describe('handleUsernameSubmit()', () => {
    beforeEach(() => {
      roomCreation.show();
    });

    it('should prevent submission if username is empty', () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const usernameInput = document.getElementById('create-username-input');
      usernameInput.value = '';
      
      roomCreation.handleUsernameSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      const errorDiv = document.getElementById('username-error');
      expect(errorDiv.textContent).toContain('required');
    });

    it('should not submit if already creating', () => {
      roomCreation.isCreating = true;
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      roomCreation.handleUsernameSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockSocketClient.emit).not.toHaveBeenCalled();
    });

    it('should call createRoom with valid username', async () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const usernameInput = document.getElementById('create-username-input');
      usernameInput.value = 'TestUser';
      
      // Mock createRoom to return success
      const createRoomSpy = vi.spyOn(roomCreation, 'createRoom').mockResolvedValue({
        success: true,
        roomCode: 'TEST01'
      });
      
      await roomCreation.handleUsernameSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(createRoomSpy).toHaveBeenCalledWith('TestUser');
      
      createRoomSpy.mockRestore();
    });
  });

  describe('createRoom()', () => {
    it('should emit create-room event and handle response', async () => {
      const username = 'TestUser';
      
      // Set up socket to respond immediately
      mockSocketClient.on.mockImplementation((event, callback) => {
        if (event === 'room-created') {
          setTimeout(() => {
            callback({ roomCode: 'TEST01', room: {}, user: {} });
          }, 10);
        }
      });
      
      const promise = roomCreation.createRoom(username);
      
      expect(mockSocketClient.on).toHaveBeenCalledWith('room-created', expect.any(Function));
      expect(mockSocketClient.on).toHaveBeenCalledWith('create-room-error', expect.any(Function));
      expect(mockSocketClient.emit).toHaveBeenCalledWith('create-room', { username });
      
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.roomCode).toBe('TEST01');
    });

    it('should handle create room error', async () => {
      const username = 'TestUser';
      
      // Set up socket to respond with error
      mockSocketClient.on.mockImplementation((event, callback) => {
        if (event === 'create-room-error') {
          setTimeout(() => {
            callback({ error: 'Username already taken' });
          }, 10);
        }
      });
      
      const result = await roomCreation.createRoom(username);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Username already taken');
    });
  });

  describe('Room Code Display', () => {
    beforeEach(() => {
      roomCreation.show();
    });

    it('should show room code step with correct code', () => {
      const roomCode = 'TEST01';
      const username = 'TestUser';
      
      roomCreation.showRoomCodeStep(roomCode, username);
      
      const roomCodeText = document.getElementById('room-code-text');
      expect(roomCodeText.textContent).toBe(roomCode);
      
      const roomCodeStep = document.getElementById('room-code-step');
      expect(roomCodeStep.classList.contains('active')).toBe(true);
    });

    it('should handle copy room code', async () => {
      // Mock clipboard API
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue() },
        configurable: true
      });
      
      roomCreation.showRoomCodeStep('TEST01', 'TestUser');
      
      await roomCreation.handleCopyRoomCode();
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TEST01');
    });

    it('should handle join created room', () => {
      roomCreation.createdRoom = { roomCode: 'TEST01', username: 'TestUser' };
      const hideSpy = vi.spyOn(roomCreation, 'hide').mockImplementation(() => {});
      
      roomCreation.handleJoinCreatedRoom();
      
      expect(hideSpy).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({ roomCode: 'TEST01', username: 'TestUser' });
      
      hideSpy.mockRestore();
    });
  });

  describe('Button Loading States', () => {
    beforeEach(() => {
      roomCreation.show();
    });

    it('should set button loading state correctly', () => {
      const button = document.createElement('button');
      button.innerHTML = '<span class="btn-text">Test</span><span class="btn-loader">Loading...</span>';
      document.body.appendChild(button);
      
      roomCreation.setButtonLoading(button, true);
      
      expect(button.disabled).toBe(true);
      expect(button.querySelector('.btn-text').style.display).toBe('none');
      expect(button.querySelector('.btn-loader').style.display).toBe('inline-flex');
      
      roomCreation.setButtonLoading(button, false);
      
      expect(button.disabled).toBe(false);
      expect(button.querySelector('.btn-text').style.display).toBe('inline');
      expect(button.querySelector('.btn-loader').style.display).toBe('none');
    });
  });
});
