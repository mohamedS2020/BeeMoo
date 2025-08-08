const RoomManager = require('../socket/roomManager');
const Room = require('../models/Room');
const User = require('../models/User');

describe('RoomManager', () => {
  let roomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  afterEach(() => {
    // Stop cleanup timer to prevent test interference
    roomManager.stopCleanupTimer();
  });

  describe('Room Code Generation', () => {
    test('should generate unique room codes', () => {
      const code1 = roomManager.generateRoomCode();
      const code2 = roomManager.generateRoomCode();
      
      expect(code1).toHaveLength(6);
      expect(code2).toHaveLength(6);
      expect(code1).not.toBe(code2);
      expect(code1).toMatch(/^[A-Z0-9]{6}$/);
    });
  });

  describe('Room Creation', () => {
    test('should create room successfully with valid username', () => {
      const result = roomManager.createRoom('socket1', 'TestUser');
      
      expect(result.success).toBe(true);
      expect(result.roomCode).toHaveLength(6);
      expect(result.room.hostUsername).toBe('TestUser');
      expect(result.user.isHost).toBe(true);
    });

    test('should reject invalid usernames', () => {
      const result = roomManager.createRoom('socket1', '');
      
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Username');
    });

    test('should prevent user from creating multiple rooms', () => {
      roomManager.createRoom('socket1', 'TestUser');
      const result = roomManager.createRoom('socket1', 'TestUser2');
      
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already in a room');
    });
  });

  describe('Room Joining', () => {
    test('should join existing room successfully', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      const joinResult = roomManager.joinRoom('socket2', 'Bob', createResult.roomCode);
      
      expect(joinResult.success).toBe(true);
      expect(joinResult.roomCode).toBe(createResult.roomCode);
      expect(joinResult.participants).toHaveLength(2);
    });

    test('should reject joining non-existent room', () => {
      const result = roomManager.joinRoom('socket1', 'TestUser', 'INVALID');
      
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Room not found');
    });

    test('should reject duplicate usernames in same room', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      const joinResult = roomManager.joinRoom('socket2', 'Alice', createResult.roomCode);
      
      expect(joinResult.success).toBe(false);
      expect(joinResult.reason).toContain('already taken');
    });
  });

  describe('Room Management', () => {
    test('should handle participant leaving', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      roomManager.joinRoom('socket2', 'Bob', createResult.roomCode);
      
      const leaveResult = roomManager.leaveRoom('socket2');
      
      expect(leaveResult.success).toBe(true);
      expect(leaveResult.roomDeleted).toBe(false);
      
      const room = roomManager.getRoom(createResult.roomCode);
      expect(room.participants.size).toBe(1);
    });

    test('should delete room when host leaves', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      roomManager.joinRoom('socket2', 'Bob', createResult.roomCode);
      
      const leaveResult = roomManager.leaveRoom('socket1'); // Host leaves
      
      expect(leaveResult.success).toBe(true);
      expect(leaveResult.roomDeleted).toBe(true);
      
      const room = roomManager.getRoom(createResult.roomCode);
      expect(room).toBeUndefined();
    });
  });

  describe('Microphone Status', () => {
    test('should update mic status successfully', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      const updateResult = roomManager.updateMicStatus('socket1', true);
      
      expect(updateResult.success).toBe(true);
      expect(updateResult.user.micMuted).toBe(true);
    });

    test('should reject mic update for non-room user', () => {
      const result = roomManager.updateMicStatus('socket1', true);
      
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not in room');
    });
  });

  describe('Movie Control', () => {
    test('should allow host to update movie state', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      const movieState = { isStreaming: true, title: 'Test Movie' };
      
      const updateResult = roomManager.updateMovieState('socket1', movieState);
      
      expect(updateResult.success).toBe(true);
      expect(updateResult.movieState.isStreaming).toBe(true);
      expect(updateResult.movieState.title).toBe('Test Movie');
    });

    test('should reject movie control from non-host', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      roomManager.joinRoom('socket2', 'Bob', createResult.roomCode);
      
      const movieState = { isStreaming: true, title: 'Test Movie' };
      const updateResult = roomManager.updateMovieState('socket2', movieState);
      
      expect(updateResult.success).toBe(false);
      expect(updateResult.reason).toContain('Only host');
    });
  });

  describe('Disconnection Handling', () => {
    test('should handle host disconnection', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      roomManager.joinRoom('socket2', 'Bob', createResult.roomCode);
      
      const disconnectResult = roomManager.handleDisconnection('socket1');
      
      expect(disconnectResult.success).toBe(true);
      expect(disconnectResult.wasHost).toBe(true);
      expect(disconnectResult.roomDeactivated).toBe(true);
      
      const room = roomManager.getRoom(createResult.roomCode);
      expect(room.isActive).toBe(false);
    });

    test('should handle participant disconnection', () => {
      const createResult = roomManager.createRoom('socket1', 'Alice');
      roomManager.joinRoom('socket2', 'Bob', createResult.roomCode);
      
      const disconnectResult = roomManager.handleDisconnection('socket2');
      
      expect(disconnectResult.success).toBe(true);
      expect(disconnectResult.wasHost).toBe(false);
      expect(disconnectResult.roomDeactivated).toBe(false);
    });
  });

  describe('Statistics', () => {
    test('should provide accurate statistics', () => {
      roomManager.createRoom('socket1', 'Alice');
      const createResult2 = roomManager.createRoom('socket2', 'Bob');
      roomManager.joinRoom('socket3', 'Charlie', createResult2.roomCode);
      
      const stats = roomManager.getStats();
      
      expect(stats.totalRooms).toBe(2);
      expect(stats.activeRooms).toBe(2);
      expect(stats.totalUsers).toBe(3);
      expect(stats.connectedUsers).toBe(3);
    });
  });
});

describe('Room Model', () => {
  let room;

  beforeEach(() => {
    room = new Room('TEST01', 'socket1', 'Alice');
  });

  test('should initialize with correct values', () => {
    expect(room.roomCode).toBe('TEST01');
    expect(room.hostSocketId).toBe('socket1');
    expect(room.hostUsername).toBe('Alice');
    expect(room.participants.size).toBe(1);
    expect(room.isActive).toBe(true);
  });

  test('should add participants correctly', () => {
    const result = room.addParticipant('socket2', 'Bob');
    
    expect(result.success).toBe(true);
    expect(room.participants.size).toBe(2);
    expect(room.getParticipant('socket2').username).toBe('Bob');
  });

  test('should reject duplicate usernames', () => {
    const result = room.addParticipant('socket2', 'Alice');
    
    expect(result.success).toBe(false);
    expect(result.reason).toContain('already taken');
  });
});

describe('User Model', () => {
  test('should validate usernames correctly', () => {
    expect(User.validateUsername('ValidUser').valid).toBe(true);
    expect(User.validateUsername('').valid).toBe(false);
    expect(User.validateUsername('a').valid).toBe(false);
    expect(User.validateUsername('x'.repeat(31)).valid).toBe(false);
    expect(User.validateUsername('admin').valid).toBe(false);
  });

  test('should create user with validated username', () => {
    const result = User.create('socket1', 'ValidUser');
    
    expect(result.success).toBe(true);
    expect(result.user.username).toBe('ValidUser');
    expect(result.user.socketId).toBe('socket1');
  });
});
