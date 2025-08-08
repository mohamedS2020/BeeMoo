class User {
  constructor(socketId, username, roomCode = null) {
    this.socketId = socketId;
    this.username = username;
    this.roomCode = roomCode;
    this.isHost = false;
    this.micMuted = false;
    this.isConnected = true;
    this.joinedAt = new Date();
    this.lastActivity = new Date();
    
    // Connection state for reconnection handling
    this.connectionHistory = [{
      connectedAt: new Date(),
      socketId: socketId
    }];
  }

  /**
   * Update user's room assignment
   * @param {string} roomCode 
   * @param {boolean} isHost 
   */
  joinRoom(roomCode, isHost = false) {
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.updateActivity();
  }

  /**
   * Remove user from room
   */
  leaveRoom() {
    this.roomCode = null;
    this.isHost = false;
    this.updateActivity();
  }

  /**
   * Update microphone status
   * @param {boolean} muted 
   */
  setMicStatus(muted) {
    this.micMuted = muted;
    this.updateActivity();
  }

  /**
   * Mark user as disconnected
   */
  disconnect() {
    this.isConnected = false;
    this.disconnectedAt = new Date();
  }

  /**
   * Handle user reconnection with new socket ID
   * @param {string} newSocketId 
   */
  reconnect(newSocketId) {
    this.socketId = newSocketId;
    this.isConnected = true;
    delete this.disconnectedAt;
    
    // Track connection history for debugging/analytics
    this.connectionHistory.push({
      connectedAt: new Date(),
      socketId: newSocketId
    });
    
    this.updateActivity();
  }

  /**
   * Check if user has been disconnected for too long
   * @param {number} maxDisconnectedMinutes 
   * @returns {boolean}
   */
  isDisconnectedTooLong(maxDisconnectedMinutes = 5) {
    if (this.isConnected || !this.disconnectedAt) {
      return false;
    }
    
    const now = new Date();
    const threshold = maxDisconnectedMinutes * 60 * 1000;
    return (now - this.disconnectedAt) > threshold;
  }

  /**
   * Update last activity timestamp
   */
  updateActivity() {
    this.lastActivity = new Date();
  }

  /**
   * Get user info for room participants list
   * @returns {object}
   */
  getPublicInfo() {
    return {
      socketId: this.socketId,
      username: this.username,
      isHost: this.isHost,
      micMuted: this.micMuted,
      isConnected: this.isConnected,
      joinedAt: this.joinedAt
    };
  }

  /**
   * Get complete user info for admin/debugging
   * @returns {object}
   */
  getFullInfo() {
    return {
      socketId: this.socketId,
      username: this.username,
      roomCode: this.roomCode,
      isHost: this.isHost,
      micMuted: this.micMuted,
      isConnected: this.isConnected,
      joinedAt: this.joinedAt,
      lastActivity: this.lastActivity,
      disconnectedAt: this.disconnectedAt,
      connectionHistory: this.connectionHistory
    };
  }

  /**
   * Validate username format
   * @param {string} username 
   * @returns {object} Validation result
   */
  static validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, reason: 'Username is required' };
    }

    const trimmed = username.trim();
    
    if (trimmed.length === 0) {
      return { valid: false, reason: 'Username cannot be empty' };
    }

    if (trimmed.length > 30) {
      return { valid: false, reason: 'Username must be 30 characters or less' };
    }

    if (trimmed.length < 2) {
      return { valid: false, reason: 'Username must be at least 2 characters' };
    }

    // Basic sanitization - allow alphanumeric, spaces, and common punctuation
    const allowedPattern = /^[a-zA-Z0-9\s\-_\.]+$/;
    if (!allowedPattern.test(trimmed)) {
      return { valid: false, reason: 'Username contains invalid characters' };
    }

    // Prevent usernames that look like system messages
    const reservedPatterns = [
      /^(system|admin|host|server|bot)$/i,
      /^(moderator|mod|owner)$/i
    ];
    
    if (reservedPatterns.some(pattern => pattern.test(trimmed))) {
      return { valid: false, reason: 'Username is reserved' };
    }

    return { valid: true, username: trimmed };
  }

  /**
   * Create a new User with validated username
   * @param {string} socketId 
   * @param {string} username 
   * @param {string} roomCode 
   * @returns {object} Creation result
   */
  static create(socketId, username, roomCode = null) {
    const validation = User.validateUsername(username);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const user = new User(socketId, validation.username, roomCode);
    return { success: true, user };
  }
}

module.exports = User;
