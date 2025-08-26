const RoomManager = require('./roomManager');

class SocketHandlers {
  constructor(io) {
    this.io = io;
    this.roomManager = new RoomManager();
    
    // Bind methods to preserve 'this' context
    this.handleConnection = this.handleConnection.bind(this);
    this.handleCreateRoom = this.handleCreateRoom.bind(this);
    this.handleJoinRoom = this.handleJoinRoom.bind(this);
    this.handleLeaveRoom = this.handleLeaveRoom.bind(this);
    this.handleMicToggle = this.handleMicToggle.bind(this);
    this.handleMovieControl = this.handleMovieControl.bind(this);
    this.handleChatMessage = this.handleChatMessage.bind(this);
    this.handleDisconnection = this.handleDisconnection.bind(this);
    this.handlePing = this.handlePing.bind(this);
  }

  /**
   * Handle new socket connection
   * @param {Socket} socket 
   */
  handleConnection(socket) {
    console.log(`🔌 User connected: ${socket.id}`);

    // Register event handlers
    socket.on('create-room', (data) => this.handleCreateRoom(socket, data));
    socket.on('validate-room', (data) => this.handleValidateRoom(socket, data));
    socket.on('join-room', (data) => this.handleJoinRoom(socket, data));
    socket.on('leave-room', () => this.handleLeaveRoom(socket));
    socket.on('mic-toggle', (data) => this.handleMicToggle(socket, data));
    socket.on('movie-control', (data) => this.handleMovieControl(socket, data));
    socket.on('chat-message', (data) => this.handleChatMessage(socket, data));
    // WebRTC signaling
    socket.on('webrtc-offer', (data) => this.handleWebRTCOffer(socket, data));
    socket.on('webrtc-answer', (data) => this.handleWebRTCAnswer(socket, data));
    socket.on('webrtc-ice-candidate', (data) => this.handleWebRTCIceCandidate(socket, data));
    socket.on('ping', (data) => this.handlePing(socket, data));
    socket.on('time-sync-request', (data) => this.handleTimeSyncRequest(socket, data));
    // Subtitle events
    socket.on('share-subtitles', (data) => this.handleShareSubtitles(socket, data));
    socket.on('allow-individual-subtitles', (data) => this.handleAllowIndividualSubtitles(socket, data));
    socket.on('disconnect', () => this.handleDisconnection(socket));

    // Send connection confirmation
    socket.emit('connected', { 
      socketId: socket.id, 
      timestamp: new Date().toISOString(),
      serverInfo: {
        service: 'BeeMoo Server',
        features: ['rooms', 'voice', 'movies', 'chat']
      }
    });
  }

  /**
   * Validate room existence
   * @param {Socket} socket
   * @param {object} data
   */
  handleValidateRoom(socket, data) {
    try {
      const { roomCode } = data || {};
      if (!roomCode || typeof roomCode !== 'string') {
        socket.emit('room-not-found', { error: 'Room code is required' });
        return;
      }

      const room = this.roomManager.getRoom(roomCode.toUpperCase());
      if (room && room.isActive) {
        socket.emit('room-exists', { room: room.getRoomInfo() });
      } else {
        socket.emit('room-not-found', { error: 'Room not found' });
      }
    } catch (error) {
      console.error('Error in handleValidateRoom:', error);
      socket.emit('room-not-found', { error: 'Internal server error' });
    }
  }

  /**
   * Handle room creation request
   * @param {Socket} socket 
   * @param {object} data 
   */
  handleCreateRoom(socket, data) {
    try {
      const { username } = data;
      
      if (!username) {
        socket.emit('create-room-error', { error: 'Username is required' });
        return;
      }

      const result = this.roomManager.createRoom(socket.id, username);
      
      if (result.success) {
        // Join socket to room for broadcasting
        socket.join(result.roomCode);
        
        socket.emit('room-created', {
          roomCode: result.roomCode,
          room: result.room,
          user: result.user
        });

        console.log(`✅ Room ${result.roomCode} created successfully`);
      } else {
        socket.emit('create-room-error', { error: result.reason });
      }
    } catch (error) {
      console.error('Error in handleCreateRoom:', error);
      socket.emit('create-room-error', { error: 'Internal server error' });
    }
  }

  /**
   * Handle room join request
   * @param {Socket} socket 
   * @param {object} data 
   */
  handleJoinRoom(socket, data) {
    try {
      const { roomCode, username } = data;
      
      if (!roomCode || !username) {
        socket.emit('join-room-error', { error: 'Room code and username are required' });
        return;
      }

      const result = this.roomManager.joinRoom(socket.id, username, roomCode);
      
      if (result.success) {
        // Join socket to room for broadcasting
        socket.join(result.roomCode);
        
        // Notify the joining user
        socket.emit('room-joined', {
          roomCode: result.roomCode,
          room: result.room,
          user: result.user,
          participants: result.participants,
          movieState: result.movieState
        });

        // Notify other participants in the room
        socket.to(result.roomCode).emit('participant-joined', {
          participant: result.user,
          participants: result.participants,
          roomInfo: result.room
        });

        console.log(`✅ User ${username} joined room ${result.roomCode}`);
      } else {
        socket.emit('join-room-error', { error: result.reason });
      }
    } catch (error) {
      console.error('Error in handleJoinRoom:', error);
      socket.emit('join-room-error', { error: 'Internal server error' });
    }
  }

  /**
   * Handle leave room request
   * @param {Socket} socket 
   */
  handleLeaveRoom(socket) {
    try {
      const result = this.roomManager.leaveRoom(socket.id);
      
      if (result.success) {
        // Leave the socket room
        socket.leave(result.roomCode);
        
        // Notify the leaving user
        socket.emit('room-left', {
          roomCode: result.roomCode,
          user: result.user
        });

        // Notify remaining participants if room still exists
        if (!result.roomDeleted) {
          const room = this.roomManager.getRoom(result.roomCode);
          if (room) {
            socket.to(result.roomCode).emit('participant-left', {
              participant: result.user,
              participants: room.getParticipantsArray(),
              roomInfo: room.getRoomInfo()
            });
          }
        } else {
          // Notify all remaining participants that room was deleted
          socket.to(result.roomCode).emit('room-deleted', {
            roomCode: result.roomCode,
            reason: 'Host left the room'
          });
        }

        console.log(`✅ User left room ${result.roomCode}`);
      } else {
        socket.emit('leave-room-error', { error: result.reason });
      }
    } catch (error) {
      console.error('Error in handleLeaveRoom:', error);
      socket.emit('leave-room-error', { error: 'Internal server error' });
    }
  }

  /**
   * Handle microphone toggle
   * @param {Socket} socket 
   * @param {object} data 
   */
  handleMicToggle(socket, data) {
    try {
      const { muted } = data;
      
      if (typeof muted !== 'boolean') {
        socket.emit('mic-toggle-error', { error: 'Invalid muted status' });
        return;
      }

      const result = this.roomManager.updateMicStatus(socket.id, muted);
      
      if (result.success) {
        // Notify the user
        socket.emit('mic-updated', {
          user: result.user,
          muted: muted
        });

        // Notify other participants in the room
        const room = this.roomManager.getRoom(result.roomCode);
        if (room) {
          socket.to(result.roomCode).emit('participant-mic-updated', {
            participant: result.user,
            participants: room.getParticipantsArray()
          });
        }

        console.log(`🎤 User ${result.user.username} ${muted ? 'muted' : 'unmuted'} mic`);
      } else {
        socket.emit('mic-toggle-error', { error: result.reason });
      }
    } catch (error) {
      console.error('Error in handleMicToggle:', error);
      socket.emit('mic-toggle-error', { error: 'Internal server error' });
    }
  }

  /**
   * Handle movie control commands (host only)
   * @param {Socket} socket 
   * @param {object} data 
   */
  handleMovieControl(socket, data) {
    try {
      const { action, movieState } = data;
      
      if (!action) {
        socket.emit('movie-control-error', { error: 'Action is required' });
        return;
      }

      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.isHost) {
        socket.emit('movie-control-error', { error: 'Only host can control movie' });
        return;
      }

      let updateData = {};
      
      switch (action) {
        case 'start-streaming':
          updateData = {
            isStreaming: true,
            title: movieState?.title || 'Unknown Movie',
            currentTime: 0,
            isPlaying: false
          };
          break;
          
        case 'play':
          updateData = {
            isPlaying: true,
            currentTime: movieState?.currentTime || 0
          };
          break;
          
        case 'pause':
          updateData = {
            isPlaying: false,
            currentTime: movieState?.currentTime || 0
          };
          break;
          
        case 'seek':
          updateData = {
            currentTime: movieState?.currentTime || 0,
            // Keep current playing state
          };
          break;
          
        case 'stop-streaming':
          updateData = {
            isStreaming: false,
            title: null,
            currentTime: 0,
            isPlaying: false
          };
          break;
          
        case 'sync':
          // Sync action doesn't change state, just re-broadcasts current state
          updateData = {
            currentTime: movieState?.currentTime || 0,
            // Keep all other current state unchanged
          };
          break;
          
        default:
          socket.emit('movie-control-error', { error: 'Invalid action' });
          return;
      }

      const result = this.roomManager.updateMovieState(socket.id, updateData);
      
      if (result.success) {
        // Notify all participants in the room about movie state change with precision timing
        const precisionTimestamp = Date.now();
        this.io.to(result.roomCode).emit('movie-sync', {
          action: action,
          movieState: {
            ...result.movieState,
            timestamp: precisionTimestamp, // High-precision timestamp for sync
            serverTime: precisionTimestamp // Duplicate for clarity
          },
          timestamp: new Date().toISOString(), // Human-readable timestamp
          precisionTimestamp: precisionTimestamp // Millisecond precision
        });

        console.log(`🎬 Movie ${action} in room ${result.roomCode} by ${user.username}`);
      } else {
        socket.emit('movie-control-error', { error: result.reason });
      }
    } catch (error) {
      console.error('Error in handleMovieControl:', error);
      socket.emit('movie-control-error', { error: 'Internal server error' });
    }
  }

  /**
   * Handle chat message
   * @param {Socket} socket 
   * @param {object} data 
   */
  handleChatMessage(socket, data) {
    try {
      const { message } = data;
      
      if (!message || typeof message !== 'string') {
        socket.emit('chat-error', { error: 'Message is required' });
        return;
      }

      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.roomCode) {
        socket.emit('chat-error', { error: 'User not in room' });
        return;
      }

      // Basic message validation and sanitization
      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        socket.emit('chat-error', { error: 'Message cannot be empty' });
        return;
      }

      if (trimmedMessage.length > 500) {
        socket.emit('chat-error', { error: 'Message too long (max 500 characters)' });
        return;
      }

      const chatMessage = {
        id: `${Date.now()}-${socket.id}`,
        username: user.username,
        message: trimmedMessage,
        timestamp: new Date().toISOString(),
        isHost: user.isHost
      };

      // Broadcast to all participants in the room
      this.io.to(user.roomCode).emit('chat-message', chatMessage);

      console.log(`💬 Chat message in room ${user.roomCode} from ${user.username}: ${trimmedMessage}`);
    } catch (error) {
      console.error('Error in handleChatMessage:', error);
      socket.emit('chat-error', { error: 'Internal server error' });
    }
  }

  /**
   * Handle ping for connection testing
   * @param {Socket} socket 
   * @param {object} data 
   */
  handlePing(socket, data) {
    console.log('🏓 Ping received:', data);
    socket.emit('pong', { 
      message: 'Pong from BeeMoo server!', 
      timestamp: Date.now(),
      originalData: data
    });
  }

  /**
   * Handle time synchronization request for frame-perfect sync
   * @param {Socket} socket 
   * @param {object} data 
   */
  handleTimeSyncRequest(socket, data) {
    try {
      const serverTime = Date.now();
      const { clientTime } = data || {};
      
      // Respond immediately with server timestamp
      socket.emit('time-sync-response', {
        serverTime: serverTime,
        clientTime: clientTime,
        requestId: data.requestId || null
      });
      
      // Optional: Log for debugging (can be removed in production)
      // console.log('🕐 Time sync request processed');
    } catch (error) {
      console.error('Error in handleTimeSyncRequest:', error);
    }
  }

  /**
   * WebRTC: forward SDP offer within room
   */
  handleWebRTCOffer(socket, data) {
    try {
      const { to, sdp } = data || {};
      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.roomCode) return;
      if (to) {
        // Target a specific peer
        this.io.to(to).emit('webrtc-offer', { from: socket.id, sdp });
      } else {
        // Broadcast to room except sender
        socket.to(user.roomCode).emit('webrtc-offer', { from: socket.id, sdp });
      }
    } catch (e) {
      console.error('Error in handleWebRTCOffer:', e);
    }
  }

  /**
   * WebRTC: forward SDP answer within room
   */
  handleWebRTCAnswer(socket, data) {
    try {
      const { to, sdp } = data || {};
      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.roomCode) return;
      if (to) {
        this.io.to(to).emit('webrtc-answer', { from: socket.id, sdp });
      } else {
        socket.to(user.roomCode).emit('webrtc-answer', { from: socket.id, sdp });
      }
    } catch (e) {
      console.error('Error in handleWebRTCAnswer:', e);
    }
  }

  /**
   * WebRTC: forward ICE candidate within room
   */
  handleWebRTCIceCandidate(socket, data) {
    try {
      const { to, candidate } = data || {};
      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.roomCode) return;
      if (to) {
        this.io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
      } else {
        socket.to(user.roomCode).emit('webrtc-ice-candidate', { from: socket.id, candidate });
      }
    } catch (e) {
      console.error('Error in handleWebRTCIceCandidate:', e);
    }
  }

  /**
   * Handle socket disconnection
   * @param {Socket} socket 
   */
  handleDisconnection(socket) {
    try {
      const result = this.roomManager.handleDisconnection(socket.id);
      
      if (result.success && result.roomCode) {
        const room = this.roomManager.getRoom(result.roomCode);
        
        if (result.wasHost && result.roomDeactivated) {
          // Host disconnected - notify all participants
          socket.to(result.roomCode).emit('host-disconnected', {
            roomCode: result.roomCode,
            message: 'Host has disconnected. Movie streaming has stopped.',
            canReconnect: true,
            timeoutMinutes: 5
          });
        } else if (room) {
          // Regular participant disconnected
          socket.to(result.roomCode).emit('participant-disconnected', {
            participant: result.user,
            participants: room.getParticipantsArray(),
            roomInfo: room.getRoomInfo()
          });
        }
      }

      console.log(`❌ User disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Error in handleDisconnection:', error);
    }
  }

  /**
   * Get server statistics
   * @returns {object}
   */
  getStats() {
    return this.roomManager.getStats();
  }

  /**
   * Handle subtitle sharing from host to participants
   * @param {Socket} socket 
   * @param {Object} data 
   */
  handleShareSubtitles(socket, data) {
    console.log('📥 Received share-subtitles event from:', socket.id, 'with data:', {
      mode: data?.mode,
      hasSubtitles: !!data?.subtitles,
      subtitleCount: data?.subtitles?.count
    });
    
    try {
      // Get user first, then room by roomCode
      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.roomCode) {
        console.error('❌ Share subtitles failed: User not in room');
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      const room = this.roomManager.getRoom(user.roomCode);
      if (!room) {
        console.error('❌ Share subtitles failed: Room not found');
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Verify sender is host
      console.log('🔍 Host verification:', {
        roomHost: room.hostSocketId,
        socketId: socket.id,
        isMatch: room.hostSocketId === socket.id,
        roomData: {
          id: room.roomCode,
          participants: room.participants?.size || 0
        }
      });
      
      if (room.hostSocketId !== socket.id) {
        console.error('❌ Share subtitles failed: Not host');
        socket.emit('error', { message: 'Only host can share subtitles' });
        return;
      }

      // Validate subtitle data
      if (!data || !data.subtitles) {
        socket.emit('error', { message: 'Invalid subtitle data' });
        return;
      }

      console.log(`📤 Host sharing subtitles in room ${user.roomCode}:`, {
        mode: data.mode,
        subtitleCount: data.subtitles.count || 0,
        participantCount: room.participants.length
      });

      console.log(`🔍 Socket room info:`, {
        hostSocketId: socket.id,
        roomCode: user.roomCode,
        hostInRoom: socket.rooms.has(user.roomCode),
        socketRooms: Array.from(socket.rooms)
      });

      // Broadcast subtitles to all participants
      console.log(`📡 Broadcasting subtitle-shared to room: ${user.roomCode}`);
      socket.to(user.roomCode).emit('subtitle-shared', {
        mode: data.mode,
        subtitles: data.subtitles,
        settings: data.settings,
        timestamp: data.timestamp,
        hostId: socket.id
      });

      // Confirm to host
      socket.emit('subtitle-share-confirmed', {
        success: true,
        participantCount: room.participants.length
      });

    } catch (error) {
      console.error('❌ Error sharing subtitles:', error);
      socket.emit('error', { message: 'Failed to share subtitles' });
    }
  }

  /**
   * Handle host allowing individual subtitle uploads
   * @param {Socket} socket 
   * @param {Object} data 
   */
  handleAllowIndividualSubtitles(socket, data) {
    try {
      // Get user first, then room by roomCode  
      const user = this.roomManager.getUser(socket.id);
      if (!user || !user.roomCode) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      const room = this.roomManager.getRoom(user.roomCode);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Verify sender is host
      if (room.hostSocketId !== socket.id) {
        socket.emit('error', { message: 'Only host can manage subtitle permissions' });
        return;
      }

      console.log(`🔓 Host allowing individual subtitles in room ${user.roomCode}`);

      // Notify all participants they can upload individual subtitles
      socket.to(user.roomCode).emit('subtitle-individual-allowed', {
        allowed: data.allowed,
        hostId: socket.id,
        timestamp: new Date().toISOString()
      });

      // Confirm to host
      socket.emit('subtitle-permission-confirmed', {
        success: true,
        participantCount: room.participants.length
      });

    } catch (error) {
      console.error('❌ Error managing subtitle permissions:', error);
      socket.emit('error', { message: 'Failed to manage subtitle permissions' });
    }
  }

  /**
   * Shutdown cleanup
   */
  shutdown() {
    if (this.roomManager) {
      this.roomManager.stopCleanupTimer();
    }
  }
}

module.exports = SocketHandlers;
