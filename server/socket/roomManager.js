const Room = require('../models/Room');
const User = require('../models/User');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Room
    this.users = new Map(); // socketId -> User
    this.roomCleanupInterval = null;
    
    // Start automatic cleanup
    this.startCleanupTimer();
  }

  /**
   * Generate a unique room code
   * @returns {string} 6-character room code
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
    } while (this.rooms.has(code) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error('Unable to generate unique room code');
    }

    return code;
  }

  /**
   * Create a new room
   * @param {string} hostSocketId 
   * @param {string} hostUsername 
   * @returns {object} Creation result
   */
  createRoom(hostSocketId, hostUsername) {
    try {
      // Validate username
      const userValidation = User.validateUsername(hostUsername);
      if (!userValidation.valid) {
        return { success: false, reason: userValidation.reason };
      }

      // Check if user is already in a room
      const existingUser = this.users.get(hostSocketId);
      if (existingUser && existingUser.roomCode) {
        return { success: false, reason: 'User is already in a room' };
      }

      // Generate room code
      const roomCode = this.generateRoomCode();

      // Create room
      const room = new Room(roomCode, hostSocketId, userValidation.username);
      this.rooms.set(roomCode, room);

      // Create/update user
      const userResult = User.create(hostSocketId, userValidation.username, roomCode);
      if (!userResult.success) {
        return userResult;
      }
      
      userResult.user.joinRoom(roomCode, true);
      this.users.set(hostSocketId, userResult.user);

      console.log(`🏠 Room created: ${roomCode} by ${userValidation.username} (${hostSocketId})`);

      return { 
        success: true, 
        roomCode, 
        room: room.getRoomInfo(),
        user: userResult.user.getPublicInfo()
      };
    } catch (error) {
      console.error('Error creating room:', error);
      return { success: false, reason: 'Failed to create room' };
    }
  }

  /**
   * Join an existing room
   * @param {string} socketId 
   * @param {string} username 
   * @param {string} roomCode 
   * @returns {object} Join result
   */
  joinRoom(socketId, username, roomCode) {
    try {
      // Validate inputs
      if (!roomCode || typeof roomCode !== 'string') {
        return { success: false, reason: 'Room code is required' };
      }

      const userValidation = User.validateUsername(username);
      if (!userValidation.valid) {
        return { success: false, reason: userValidation.reason };
      }

      // Check if room exists
      const room = this.rooms.get(roomCode.toUpperCase());
      if (!room) {
        return { success: false, reason: 'Room not found' };
      }

      if (!room.isActive) {
        return { success: false, reason: 'Room is no longer active' };
      }

      // Check if user is already in a room
      const existingUser = this.users.get(socketId);
      if (existingUser && existingUser.roomCode) {
        return { success: false, reason: 'User is already in a room' };
      }

      // Try to add participant to room
      const addResult = room.addParticipant(socketId, userValidation.username);
      if (!addResult.success) {
        return addResult;
      }

      // Create/update user
      const userResult = User.create(socketId, userValidation.username, roomCode.toUpperCase());
      if (!userResult.success) {
        return userResult;
      }
      
      userResult.user.joinRoom(roomCode.toUpperCase(), false);
      this.users.set(socketId, userResult.user);

      console.log(`👥 User ${userValidation.username} (${socketId}) joined room ${roomCode}`);

      return {
        success: true,
        roomCode: roomCode.toUpperCase(),
        room: room.getRoomInfo(),
        user: userResult.user.getPublicInfo(),
        participants: room.getParticipantsArray(),
        movieState: room.getMovieSyncState()
      };
    } catch (error) {
      console.error('Error joining room:', error);
      return { success: false, reason: 'Failed to join room' };
    }
  }

  /**
   * Leave a room
   * @param {string} socketId 
   * @returns {object} Leave result
   */
  leaveRoom(socketId) {
    try {
      const user = this.users.get(socketId);
      if (!user || !user.roomCode) {
        return { success: false, reason: 'User not in any room' };
      }

      const room = this.rooms.get(user.roomCode);
      if (!room) {
        // Clean up orphaned user
        this.users.delete(socketId);
        return { success: false, reason: 'Room not found' };
      }

      // Capture room code before modifying user
      const roomCode = user.roomCode;
      const userPublicInfo = user.getPublicInfo();
      
      // Remove from room
      const removeResult = room.removeParticipant(socketId);
      
      // Update user
      user.leaveRoom();
      this.users.delete(socketId);

      console.log(`👋 User ${user.username} (${socketId}) left room ${roomCode}`);

      // If room is now empty or host left, clean it up
      if (room.isEmpty() || removeResult.roomDeactivated) {
        this.deleteRoom(roomCode);
        console.log(`🗑️  Room ${roomCode} deleted (${removeResult.roomDeactivated ? 'host left' : 'empty'})`);
      }
      
      return {
        success: true,
        roomCode: roomCode,
        user: userPublicInfo,
        roomDeleted: room.isEmpty() || removeResult.roomDeactivated,
        remainingParticipants: removeResult.remainingParticipants
      };
    } catch (error) {
      console.error('Error leaving room:', error);
      return { success: false, reason: 'Failed to leave room' };
    }
  }

  /**
   * Handle user disconnection
   * @param {string} socketId 
   * @returns {object} Disconnection result
   */
  handleDisconnection(socketId) {
    try {
      const user = this.users.get(socketId);
      if (!user) {
        return { success: true, reason: 'User not tracked' };
      }

      if (!user.roomCode) {
        this.users.delete(socketId);
        return { success: true, reason: 'User not in room' };
      }

      const room = this.rooms.get(user.roomCode);
      if (!room) {
        this.users.delete(socketId);
        return { success: true, reason: 'Room not found' };
      }

      // Mark as disconnected instead of removing immediately
      user.disconnect();
      room.markParticipantDisconnected(socketId);

      console.log(`📴 User ${user.username} (${socketId}) disconnected from room ${user.roomCode}`);

      // If host disconnected, deactivate room but don't delete immediately
      // to allow for reconnection
      if (user.isHost) {
        room.isActive = false;
        room.movie.isStreaming = false;
        room.movie.isPlaying = false;
        console.log(`🎬 Room ${user.roomCode} movie stopped - host disconnected`);
      }

      return {
        success: true,
        roomCode: user.roomCode,
        user: user.getPublicInfo(),
        wasHost: user.isHost,
        roomDeactivated: user.isHost
      };
    } catch (error) {
      console.error('Error handling disconnection:', error);
      return { success: false, reason: 'Failed to handle disconnection' };
    }
  }

  /**
   * Get room by code
   * @param {string} roomCode 
   * @returns {Room|null}
   */
  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  /**
   * Get user by socket ID
   * @param {string} socketId 
   * @returns {User|null}
   */
  getUser(socketId) {
    return this.users.get(socketId);
  }

  /**
   * Update participant mic status
   * @param {string} socketId 
   * @param {boolean} muted 
   * @returns {object}
   */
  updateMicStatus(socketId, muted) {
    const user = this.users.get(socketId);
    if (!user || !user.roomCode) {
      return { success: false, reason: 'User not in room' };
    }

    const room = this.rooms.get(user.roomCode);
    if (!room) {
      return { success: false, reason: 'Room not found' };
    }

    user.setMicStatus(muted);
    room.updateParticipantMic(socketId, muted);

    return {
      success: true,
      roomCode: user.roomCode,
      user: user.getPublicInfo()
    };
  }

  /**
   * Update movie state (host only)
   * @param {string} socketId 
   * @param {object} movieState 
   * @returns {object}
   */
  updateMovieState(socketId, movieState) {
    const user = this.users.get(socketId);
    if (!user || !user.roomCode) {
      return { success: false, reason: 'User not in room' };
    }

    if (!user.isHost) {
      return { success: false, reason: 'Only host can control movie' };
    }

    const room = this.rooms.get(user.roomCode);
    if (!room) {
      return { success: false, reason: 'Room not found' };
    }

    const updateResult = room.updateMovieState(socketId, movieState);
    return {
      ...updateResult,
      roomCode: user.roomCode
    };
  }

  /**
   * Delete a room
   * @param {string} roomCode 
   */
  deleteRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room) {
      // Remove all users from this room
      for (const [socketId, user] of this.users.entries()) {
        if (user.roomCode === roomCode) {
          user.leaveRoom();
          this.users.delete(socketId);
        }
      }
      this.rooms.delete(roomCode);
    }
  }

  /**
   * Start automatic cleanup timer
   */
  startCleanupTimer() {
    // Run cleanup every 5 minutes
    this.roomCleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
      this.cleanupDisconnectedUsers();
    }, 5 * 60 * 1000);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer() {
    if (this.roomCleanupInterval) {
      clearInterval(this.roomCleanupInterval);
      this.roomCleanupInterval = null;
    }
  }

  /**
   * Clean up inactive rooms
   */
  cleanupInactiveRooms() {
    const roomsToDelete = [];
    
    for (const [roomCode, room] of this.rooms.entries()) {
      if (room.isEmpty() || room.isInactive(30)) { // 30 minutes inactive
        roomsToDelete.push(roomCode);
      }
    }

    roomsToDelete.forEach(roomCode => {
      console.log(`🧹 Cleaning up inactive room: ${roomCode}`);
      this.deleteRoom(roomCode);
    });

    if (roomsToDelete.length > 0) {
      console.log(`🧹 Cleaned up ${roomsToDelete.length} inactive rooms`);
    }
  }

  /**
   * Clean up disconnected users
   */
  cleanupDisconnectedUsers() {
    const usersToRemove = [];
    
    for (const [socketId, user] of this.users.entries()) {
      if (user.isDisconnectedTooLong(5)) { // 5 minutes disconnected
        usersToRemove.push(socketId);
      }
    }

    usersToRemove.forEach(socketId => {
      const user = this.users.get(socketId);
      console.log(`🧹 Cleaning up disconnected user: ${user.username} (${socketId})`);
      this.leaveRoom(socketId);
    });

    if (usersToRemove.length > 0) {
      console.log(`🧹 Cleaned up ${usersToRemove.length} disconnected users`);
    }
  }

  /**
   * Get server statistics
   * @returns {object}
   */
  getStats() {
    const activeRooms = Array.from(this.rooms.values()).filter(room => room.isActive);
    const totalParticipants = Array.from(this.users.values()).filter(user => user.isConnected).length;
    
    return {
      totalRooms: this.rooms.size,
      activeRooms: activeRooms.length,
      totalUsers: this.users.size,
      connectedUsers: totalParticipants,
      streamingRooms: activeRooms.filter(room => room.movie.isStreaming).length
    };
  }
}

module.exports = RoomManager;
