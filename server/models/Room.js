class Room {
  constructor(roomCode, hostSocketId, hostUsername) {
    this.roomCode = roomCode;
    this.hostSocketId = hostSocketId;
    this.hostUsername = hostUsername;
    this.participants = new Map(); // socketId -> User object
    this.createdAt = new Date();
    this.lastActivity = new Date();
    
    // Movie streaming state
    this.movie = {
      isStreaming: false,
      title: null,
      currentTime: 0,
      isPlaying: false,
      lastSyncTime: null
    };
    
    // Room settings
    this.maxParticipants = 10; // Per PRD technical considerations
    this.isActive = true;
    
    // Add host as first participant
    this.participants.set(hostSocketId, {
      socketId: hostSocketId,
      username: hostUsername,
      isHost: true,
      joinedAt: new Date(),
      micMuted: false,
      isConnected: true
    });
  }

  /**
   * Add a participant to the room
   * @param {string} socketId 
   * @param {string} username 
   * @returns {boolean} Success status
   */
  addParticipant(socketId, username) {
    if (this.participants.size >= this.maxParticipants) {
      return { success: false, reason: 'Room is full' };
    }

    if (this.isUsernameTaken(username)) {
      return { success: false, reason: 'Username already taken in this room' };
    }

    const participant = {
      socketId,
      username,
      isHost: false,
      joinedAt: new Date(),
      micMuted: false,
      isConnected: true
    };

    this.participants.set(socketId, participant);
    this.updateActivity();
    
    return { success: true, participant };
  }

  /**
   * Remove a participant from the room
   * @param {string} socketId 
   * @returns {object} Removed participant info
   */
  removeParticipant(socketId) {
    const participant = this.participants.get(socketId);
    if (!participant) {
      return { success: false, reason: 'Participant not found' };
    }

    this.participants.delete(socketId);
    this.updateActivity();

    // If host left, room should be deactivated
    if (participant.isHost) {
      this.isActive = false;
      this.movie.isStreaming = false;
      this.movie.isPlaying = false;
    }

    return { 
      success: true, 
      participant,
      roomDeactivated: participant.isHost,
      remainingParticipants: this.participants.size
    };
  }

  /**
   * Get participant by socket ID
   * @param {string} socketId 
   * @returns {object|null}
   */
  getParticipant(socketId) {
    return this.participants.get(socketId);
  }

  /**
   * Check if username is already taken in this room
   * @param {string} username 
   * @returns {boolean}
   */
  isUsernameTaken(username) {
    return Array.from(this.participants.values())
      .some(p => p.username.toLowerCase() === username.toLowerCase());
  }

  /**
   * Get all participants as array
   * @returns {Array}
   */
  getParticipantsArray() {
    return Array.from(this.participants.values()).map(p => ({
      socketId: p.socketId,
      username: p.username,
      isHost: p.isHost,
      micMuted: p.micMuted,
      isConnected: p.isConnected,
      joinedAt: p.joinedAt
    }));
  }

  /**
   * Update participant mic status
   * @param {string} socketId 
   * @param {boolean} muted 
   */
  updateParticipantMic(socketId, muted) {
    const participant = this.participants.get(socketId);
    if (participant) {
      participant.micMuted = muted;
      this.updateActivity();
      return true;
    }
    return false;
  }

  /**
   * Update movie streaming state (host only)
   * @param {string} hostSocketId 
   * @param {object} movieState 
   */
  updateMovieState(hostSocketId, movieState) {
    const host = this.participants.get(hostSocketId);
    if (!host || !host.isHost) {
      return { success: false, reason: 'Only host can update movie state' };
    }

    // Update movie state
    Object.assign(this.movie, movieState, {
      lastSyncTime: new Date()
    });
    
    this.updateActivity();
    return { success: true, movieState: this.movie };
  }

  /**
   * Get current movie sync state for new participants
   * @returns {object}
   */
  getMovieSyncState() {
    if (!this.movie.isStreaming) {
      return { isStreaming: false };
    }

    return {
      isStreaming: true,
      title: this.movie.title,
      currentTime: this.movie.currentTime,
      isPlaying: this.movie.isPlaying,
      lastSyncTime: this.movie.lastSyncTime
    };
  }

  /**
   * Check if room is empty (no participants)
   * @returns {boolean}
   */
  isEmpty() {
    return this.participants.size === 0;
  }

  /**
   * Check if room has been inactive for too long
   * @param {number} maxInactiveMinutes 
   * @returns {boolean}
   */
  isInactive(maxInactiveMinutes = 30) {
    const now = new Date();
    const inactiveThreshold = maxInactiveMinutes * 60 * 1000; // Convert to milliseconds
    return (now - this.lastActivity) > inactiveThreshold;
  }

  /**
   * Update last activity timestamp
   */
  updateActivity() {
    this.lastActivity = new Date();
  }

  /**
   * Get room info for client
   * @returns {object}
   */
  getRoomInfo() {
    return {
      roomCode: this.roomCode,
      hostUsername: this.hostUsername,
      participantCount: this.participants.size,
      maxParticipants: this.maxParticipants,
      isActive: this.isActive,
      createdAt: this.createdAt,
      movie: this.movie.isStreaming ? {
        isStreaming: true,
        title: this.movie.title,
        isPlaying: this.movie.isPlaying
      } : { isStreaming: false }
    };
  }

  /**
   * Mark participant as temporarily disconnected
   * @param {string} socketId 
   */
  markParticipantDisconnected(socketId) {
    const participant = this.participants.get(socketId);
    if (participant) {
      participant.isConnected = false;
      participant.disconnectedAt = new Date();
      this.updateActivity();
      return true;
    }
    return false;
  }

  /**
   * Mark participant as reconnected
   * @param {string} socketId 
   */
  markParticipantReconnected(socketId) {
    const participant = this.participants.get(socketId);
    if (participant) {
      participant.isConnected = true;
      delete participant.disconnectedAt;
      this.updateActivity();
      return true;
    }
    return false;
  }

  /**
   * Get disconnected participants for cleanup
   * @param {number} maxDisconnectedMinutes 
   * @returns {Array}
   */
  getDisconnectedParticipants(maxDisconnectedMinutes = 5) {
    const now = new Date();
    const threshold = maxDisconnectedMinutes * 60 * 1000;
    
    return Array.from(this.participants.values())
      .filter(p => !p.isConnected && p.disconnectedAt && (now - p.disconnectedAt) > threshold);
  }
}

module.exports = Room;
