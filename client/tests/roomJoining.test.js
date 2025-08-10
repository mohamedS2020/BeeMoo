import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomJoining } from '../js/components/RoomJoining.js';

// Mock socket client
const mockSocketClient = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
};

describe('RoomJoining Component', () => {
  let roomJoining;
  let mockCallback;

  beforeEach(() => {
    // Clean up DOM
    document.body.innerHTML = '<div id="announcements" class="sr-only"></div>';
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Create component
    mockCallback = vi.fn();
    roomJoining = new RoomJoining(mockSocketClient, mockCallback);
  });

  afterEach(() => {
    // Clean up component
    if (roomJoining) {
      roomJoining.destroy();
    }
    
    // Clean up DOM
    document.body.innerHTML = '';
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(roomJoining.socketClient).toBe(mockSocketClient);
      expect(roomJoining.onRoomJoined).toBe(mockCallback);
      expect(roomJoining.isVisible).toBe(false);
      expect(roomJoining.isJoining).toBe(false);
      expect(roomJoining.isValidatingCode).toBe(false);
      expect(roomJoining.modal).toBe(null);
      expect(roomJoining.currentRoomCode).toBe(null);
    });

    it('should bind methods correctly', () => {
      expect(typeof roomJoining.show).toBe('function');
      expect(typeof roomJoining.hide).toBe('function');
      expect(typeof roomJoining.handleRoomCodeSubmit).toBe('function');
      expect(typeof roomJoining.handleUsernameSubmit).toBe('function');
      expect(typeof roomJoining.handleJoinRoom).toBe('function');
    });
  });

  describe('show()', () => {
    it('should show the modal and set visibility', () => {
      roomJoining.show();
      
      expect(roomJoining.isVisible).toBe(true);
      expect(document.getElementById('room-joining-modal')).toBeDefined();
    });

    it('should not show modal if already visible', () => {
      roomJoining.isVisible = true;
      const renderSpy = vi.spyOn(roomJoining, 'render').mockImplementation(() => {});
      
      roomJoining.show();
      
      expect(renderSpy).not.toHaveBeenCalled();
      renderSpy.mockRestore();
    });

    it('should focus on room code input after showing', async () => {
      roomJoining.show();
      
      // Wait for focus timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const roomCodeInput = document.getElementById('join-room-code-input');
      expect(roomCodeInput).toBeDefined();
    });

    it('should render all three steps initially', () => {
      roomJoining.show();
      
      expect(document.getElementById('room-code-step')).toBeDefined();
      expect(document.getElementById('username-step')).toBeDefined();
      expect(document.getElementById('success-step')).toBeDefined();
      
      // Only room code step should be active initially
      expect(document.getElementById('room-code-step').classList.contains('active')).toBe(true);
      expect(document.getElementById('username-step').classList.contains('active')).toBe(false);
      expect(document.getElementById('success-step').classList.contains('active')).toBe(false);
    });
  });

  describe('hide()', () => {
    it('should hide modal and reset all state', () => {
      roomJoining.show();
      roomJoining.currentRoomCode = 'TEST01';
      roomJoining.isJoining = true;
      roomJoining.isValidatingCode = true;
      
      roomJoining.hide();
      
      expect(roomJoining.isVisible).toBe(false);
      expect(roomJoining.modal).toBe(null);
      expect(roomJoining.currentRoomCode).toBe(null);
      expect(roomJoining.isJoining).toBe(false);
      expect(roomJoining.isValidatingCode).toBe(false);
      expect(document.getElementById('room-joining-modal')).toBe(null);
    });

    it('should not error if modal not visible', () => {
      expect(() => roomJoining.hide()).not.toThrow();
    });
  });

  describe('formatRoomCode()', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should convert to uppercase', () => {
      const mockEvent = {
        target: { value: 'abc123' }
      };
      
      roomJoining.formatRoomCode(mockEvent);
      
      expect(mockEvent.target.value).toBe('ABC123');
    });

    it('should remove invalid characters', () => {
      const mockEvent = {
        target: { value: 'a@b#c$1%2^3' }
      };
      
      roomJoining.formatRoomCode(mockEvent);
      
      expect(mockEvent.target.value).toBe('ABC123');
    });

    it('should limit to 6 characters', () => {
      const mockEvent = {
        target: { value: 'ABCDEFGHIJK' }
      };
      
      roomJoining.formatRoomCode(mockEvent);
      
      expect(mockEvent.target.value).toBe('ABCDEF');
    });
  });

  describe('validateRoomCodeInput()', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should accept valid room codes', () => {
      const mockEvent = {
        target: { value: 'ABC123' }
      };
      
      roomJoining.validateRoomCodeInput(mockEvent);
      
      const errorDiv = document.getElementById('room-code-error');
      expect(errorDiv.textContent).toBe('');
    });

    it('should reject room codes that are too short', () => {
      const mockEvent = {
        target: { value: 'ABC12' }
      };
      
      roomJoining.validateRoomCodeInput(mockEvent);
      
      const errorDiv = document.getElementById('room-code-error');
      expect(errorDiv.textContent).toContain('must be 6 characters');
    });

    it('should reject room codes with invalid characters', () => {
      const mockEvent = {
        target: { value: 'ABC@#$' }
      };
      
      roomJoining.validateRoomCodeInput(mockEvent);
      
      const errorDiv = document.getElementById('room-code-error');
      expect(errorDiv.textContent).toContain('can only contain letters and numbers');
    });

    it('should clear error for empty input', () => {
      const mockEvent = {
        target: { value: '' }
      };
      
      roomJoining.validateRoomCodeInput(mockEvent);
      
      const errorDiv = document.getElementById('room-code-error');
      expect(errorDiv.textContent).toBe('');
    });
  });

  describe('validateUsername()', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should accept valid usernames', () => {
      const mockEvent = {
        target: { value: 'ValidUser123' }
      };
      
      roomJoining.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('join-username-error');
      expect(errorDiv.textContent).toBe('');
    });

    it('should reject usernames that are too short', () => {
      const mockEvent = {
        target: { value: 'a' }
      };
      
      roomJoining.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('join-username-error');
      expect(errorDiv.textContent).toContain('at least 2 characters');
    });

    it('should reject usernames that are too long', () => {
      const mockEvent = {
        target: { value: 'a'.repeat(31) }
      };
      
      roomJoining.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('join-username-error');
      expect(errorDiv.textContent).toContain('30 characters or less');
    });

    it('should reject usernames with invalid characters', () => {
      const mockEvent = {
        target: { value: 'user@domain.com' }
      };
      
      roomJoining.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('join-username-error');
      expect(errorDiv.textContent).toContain('invalid characters');
    });

    it('should reject reserved usernames', () => {
      const mockEvent = {
        target: { value: 'admin' }
      };
      
      roomJoining.validateUsername(mockEvent);
      
      const errorDiv = document.getElementById('join-username-error');
      expect(errorDiv.textContent).toContain('reserved');
    });
  });

  describe('handleRoomCodeSubmit()', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should prevent submission if room code is empty', () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const roomCodeInput = document.getElementById('join-room-code-input');
      roomCodeInput.value = '';
      
      roomJoining.handleRoomCodeSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      const errorDiv = document.getElementById('room-code-error');
      expect(errorDiv.textContent).toContain('required');
    });

    it('should prevent submission if room code is too short', () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const roomCodeInput = document.getElementById('join-room-code-input');
      roomCodeInput.value = 'ABC12';
      
      roomJoining.handleRoomCodeSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      const errorDiv = document.getElementById('room-code-error');
      expect(errorDiv.textContent).toContain('must be 6 characters');
    });

    it('should not submit if already validating', () => {
      roomJoining.isValidatingCode = true;
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      roomJoining.handleRoomCodeSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockSocketClient.emit).not.toHaveBeenCalled();
    });

    it('should call validateRoomCode with valid room code', async () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const roomCodeInput = document.getElementById('join-room-code-input');
      roomCodeInput.value = 'TEST01';
      
      // Mock validateRoomCode to return success
      const validateSpy = vi.spyOn(roomJoining, 'validateRoomCode').mockResolvedValue({
        success: true
      });
      
      await roomJoining.handleRoomCodeSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(validateSpy).toHaveBeenCalledWith('TEST01');
      
      validateSpy.mockRestore();
    });
  });

  describe('validateRoomCode()', () => {
    it('should emit validate-room event and handle response', async () => {
      const roomCode = 'TEST01';
      
      // Set up socket to respond immediately
      mockSocketClient.on.mockImplementation((event, callback) => {
        if (event === 'room-exists') {
          setTimeout(() => {
            callback({ room: { roomCode: 'TEST01', hostUsername: 'Host' } });
          }, 10);
        }
      });
      
      const promise = roomJoining.validateRoomCode(roomCode);
      
      expect(mockSocketClient.on).toHaveBeenCalledWith('room-exists', expect.any(Function));
      expect(mockSocketClient.on).toHaveBeenCalledWith('room-not-found', expect.any(Function));
      expect(mockSocketClient.emit).toHaveBeenCalledWith('validate-room', { roomCode });
      
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.room.roomCode).toBe('TEST01');
    });

    it('should handle room not found error', async () => {
      const roomCode = 'INVALID';
      
      // Set up socket to respond with error
      mockSocketClient.on.mockImplementation((event, callback) => {
        if (event === 'room-not-found') {
          setTimeout(() => {
            callback({ error: 'Room not found' });
          }, 10);
        }
      });
      
      const result = await roomJoining.validateRoomCode(roomCode);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Room not found');
    });

    it('should handle timeout', async () => {
      const roomCode = 'TIMEOUT';
      
      // Don't set up any socket response (will timeout)
      mockSocketClient.on.mockImplementation(() => {});
      
      const result = await roomJoining.validateRoomCode(roomCode);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('handleUsernameSubmit()', () => {
    beforeEach(() => {
      roomJoining.show();
      roomJoining.currentRoomCode = 'TEST01';
      roomJoining.showUsernameStep('TEST01');
    });

    it('should prevent submission if username is empty', () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const usernameInput = document.getElementById('join-username-input');
      usernameInput.value = '';
      
      roomJoining.handleUsernameSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      const errorDiv = document.getElementById('join-username-error');
      expect(errorDiv.textContent).toContain('required');
    });

    it('should not submit if already joining', () => {
      roomJoining.isJoining = true;
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      roomJoining.handleUsernameSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockSocketClient.emit).not.toHaveBeenCalled();
    });

    it('should call joinRoom with valid username', async () => {
      const mockEvent = {
        preventDefault: vi.fn()
      };
      
      const usernameInput = document.getElementById('join-username-input');
      usernameInput.value = 'TestUser';
      
      // Mock joinRoom to return success
      const joinSpy = vi.spyOn(roomJoining, 'joinRoom').mockResolvedValue({
        success: true,
        room: {},
        participants: []
      });
      
      await roomJoining.handleUsernameSubmit(mockEvent);
      
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(joinSpy).toHaveBeenCalledWith('TEST01', 'TestUser');
      
      joinSpy.mockRestore();
    });
  });

  describe('joinRoom()', () => {
    it('should emit join-room event and handle response', async () => {
      const roomCode = 'TEST01';
      const username = 'TestUser';
      
      // Set up socket to respond immediately
      mockSocketClient.on.mockImplementation((event, callback) => {
        if (event === 'room-joined') {
          setTimeout(() => {
            callback({ 
              room: { roomCode }, 
              user: { username, isHost: false },
              participants: []
            });
          }, 10);
        }
      });
      
      const promise = roomJoining.joinRoom(roomCode, username);
      
      expect(mockSocketClient.on).toHaveBeenCalledWith('room-joined', expect.any(Function));
      expect(mockSocketClient.on).toHaveBeenCalledWith('join-room-error', expect.any(Function));
      expect(mockSocketClient.emit).toHaveBeenCalledWith('join-room', { roomCode, username });
      
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.room.roomCode).toBe(roomCode);
      expect(result.user.username).toBe(username);
    });

    it('should handle join room error', async () => {
      const roomCode = 'TEST01';
      const username = 'TestUser';
      
      // Set up socket to respond with error
      mockSocketClient.on.mockImplementation((event, callback) => {
        if (event === 'join-room-error') {
          setTimeout(() => {
            callback({ error: 'Username already taken' });
          }, 10);
        }
      });
      
      const result = await roomJoining.joinRoom(roomCode, username);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Username already taken');
    });
  });

  describe('Step Navigation', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should show username step with correct room code', () => {
      const roomCode = 'TEST01';
      
      roomJoining.showUsernameStep(roomCode);
      
      const displayRoomCode = document.getElementById('display-room-code');
      expect(displayRoomCode.textContent).toBe(roomCode);
      
      const usernameStep = document.getElementById('username-step');
      expect(usernameStep.classList.contains('active')).toBe(true);
      
      const roomCodeStep = document.getElementById('room-code-step');
      expect(roomCodeStep.classList.contains('active')).toBe(false);
    });

    it('should navigate back to room code step', () => {
      roomJoining.showUsernameStep('TEST01');
      expect(document.getElementById('username-step').classList.contains('active')).toBe(true);
      
      roomJoining.showRoomCodeStep();
      
      expect(document.getElementById('room-code-step').classList.contains('active')).toBe(true);
      expect(document.getElementById('username-step').classList.contains('active')).toBe(false);
    });

    it('should show success step with join data', () => {
      const roomCode = 'TEST01';
      const username = 'TestUser';
      const roomData = { hostUsername: 'Host' };
      const participants = [{ username: 'Host' }, { username: 'TestUser' }];
      
      roomJoining.showSuccessStep(roomCode, username, roomData, participants);
      
      const successRoomCode = document.getElementById('success-room-code');
      expect(successRoomCode.textContent).toBe(roomCode);
      
      const successStep = document.getElementById('success-step');
      expect(successStep.classList.contains('active')).toBe(true);
      
      expect(roomJoining.joinedRoom).toEqual({
        roomCode, 
        username, 
        room: roomData, 
        participants
      });
    });
  });

  describe('handleJoinRoom()', () => {
    it('should hide modal and trigger callback', () => {
      const joinedRoom = {
        roomCode: 'TEST01',
        username: 'TestUser',
        room: {},
        participants: []
      };
      
      roomJoining.joinedRoom = joinedRoom;
      const hideSpy = vi.spyOn(roomJoining, 'hide').mockImplementation(() => {});
      
      roomJoining.handleJoinRoom();
      
      expect(hideSpy).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(joinedRoom);
      
      hideSpy.mockRestore();
    });

    it('should not trigger callback if no joined room data', () => {
      roomJoining.joinedRoom = null;
      
      roomJoining.handleJoinRoom();
      
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('Button Loading States', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should set button loading state correctly', () => {
      const button = document.createElement('button');
      button.innerHTML = '<span class="btn-text">Test</span><span class="btn-loader">Loading...</span>';
      document.body.appendChild(button);
      
      roomJoining.setButtonLoading(button, true);
      
      expect(button.disabled).toBe(true);
      expect(button.querySelector('.btn-text').style.display).toBe('none');
      expect(button.querySelector('.btn-loader').style.display).toBe('inline-flex');
      
      roomJoining.setButtonLoading(button, false);
      
      expect(button.disabled).toBe(false);
      expect(button.querySelector('.btn-text').style.display).toBe('inline');
      expect(button.querySelector('.btn-loader').style.display).toBe('none');
    });
  });

  describe('Event Listeners', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should set up close button listeners', () => {
      const closeBtn = document.getElementById('close-join-modal');
      const cancelBtn = document.getElementById('cancel-join');
      
      expect(closeBtn).toBeDefined();
      expect(cancelBtn).toBeDefined();
      
      const hideSpy = vi.spyOn(roomJoining, 'hide').mockImplementation(() => {});
      
      closeBtn.click();
      expect(hideSpy).toHaveBeenCalledTimes(1);
      
      cancelBtn.click();
      expect(hideSpy).toHaveBeenCalledTimes(2);
      
      hideSpy.mockRestore();
    });

    it('should close on overlay click', () => {
      const modal = document.getElementById('room-joining-modal');
      const hideSpy = vi.spyOn(roomJoining, 'hide').mockImplementation(() => {});
      
      // Simulate click on overlay (target is the modal itself)
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modal });
      modal.dispatchEvent(event);
      
      expect(hideSpy).toHaveBeenCalled();
      
      hideSpy.mockRestore();
    });

    it('should not close on content click', () => {
      const modalContent = document.querySelector('.modal-content');
      const hideSpy = vi.spyOn(roomJoining, 'hide').mockImplementation(() => {});
      
      // Simulate click on modal content
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modalContent });
      modalContent.dispatchEvent(event);
      
      expect(hideSpy).not.toHaveBeenCalled();
      
      hideSpy.mockRestore();
    });

    it('should close on ESC key', () => {
      const hideSpy = vi.spyOn(roomJoining, 'hide').mockImplementation(() => {});
      
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      
      expect(hideSpy).toHaveBeenCalled();
      
      hideSpy.mockRestore();
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      roomJoining.show();
    });

    it('should announce room found to screen readers', () => {
      const announcement = document.getElementById('announcements');
      roomJoining.showUsernameStep('TEST01');
      
      expect(announcement.textContent).toContain('Room TEST01 found');
    });

    it('should announce successful join to screen readers', () => {
      const announcement = document.getElementById('announcements');
      roomJoining.showSuccessStep('TEST01', 'TestUser', {}, []);
      
      expect(announcement.textContent).toContain('Successfully joined room TEST01');
    });

    it('should have proper ARIA attributes', () => {
      const modal = document.querySelector('.modal-content');
      expect(modal.getAttribute('role')).toBe('dialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(modal.getAttribute('aria-labelledby')).toBe('join-room-title');
    });
  });

  describe('Integration Flow', () => {
    it('should complete full join flow', async () => {
      // Step 1: Show modal
      roomJoining.show();
      expect(roomJoining.isVisible).toBe(true);
      
      // Step 2: Enter room code
      const roomCodeInput = document.getElementById('join-room-code-input');
      roomCodeInput.value = 'TEST01';
      
      // Mock room validation
      const validateSpy = vi.spyOn(roomJoining, 'validateRoomCode').mockResolvedValue({
        success: true,
        room: { roomCode: 'TEST01' }
      });
      
      const roomCodeForm = document.getElementById('room-code-form');
      const event = new Event('submit');
      await roomCodeForm.dispatchEvent(event);
      
      // Step 3: Enter username
      const usernameInput = document.getElementById('join-username-input');
      usernameInput.value = 'TestUser';
      
      // Mock room joining
      const joinSpy = vi.spyOn(roomJoining, 'joinRoom').mockResolvedValue({
        success: true,
        room: { roomCode: 'TEST01' },
        user: { username: 'TestUser' },
        participants: []
      });
      
      // Step 4: Complete join
      expect(roomJoining.currentRoomCode).toBe('TEST01');
      
      validateSpy.mockRestore();
      joinSpy.mockRestore();
    });
  });
});