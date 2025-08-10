const { Server } = require('socket.io');
const { createServer } = require('http');
const { io: Client } = require('socket.io-client');
const SocketHandlers = require('../socket/socketHandlers');
const RoomManager = require('../socket/roomManager');

describe('SocketHandlers', () => {
  let httpServer;
  let io;
  let socketHandlers;
  let clientSocket;
  let serverSocket;

  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    socketHandlers = new SocketHandlers(io);
    
    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = Client(`http://localhost:${port}`);
      
      io.on('connection', (socket) => {
        serverSocket = socket;
        socketHandlers.handleConnection(socket);
      });
      
      clientSocket.on('connect', done);
    });
  });

  afterAll((done) => {
    io.close();
    clientSocket.disconnect();
    httpServer.close(done);
  });

  beforeEach(() => {
    // Reset room manager state
    socketHandlers.roomManager = new RoomManager();
  });

  describe('Connection Handling', () => {
    test('should emit connected event on connection', (done) => {
      clientSocket.on('connected', (data) => {
        expect(data.socketId).toBe(clientSocket.id);
        expect(data.serverInfo.service).toBe('BeeMoo Server');
        expect(data.serverInfo.features).toContain('rooms');
        expect(data.serverInfo.features).toContain('voice');
        expect(data.serverInfo.features).toContain('movies');
        expect(data.serverInfo.features).toContain('chat');
        done();
      });
    });

    test('should handle ping/pong correctly', (done) => {
      clientSocket.emit('ping', { message: 'test ping' });
      
      clientSocket.on('pong', (data) => {
        expect(data.message).toBe('Pong from BeeMoo server!');
        expect(data.originalData.message).toBe('test ping');
        expect(typeof data.timestamp).toBe('number');
        done();
      });
    });
  });

  describe('Room Creation', () => {
    test('should create room successfully with valid username', (done) => {
      clientSocket.emit('create-room', { username: 'TestUser' });
      
      clientSocket.on('room-created', (data) => {
        expect(data.roomCode).toHaveLength(6);
        expect(data.room.hostUsername).toBe('TestUser');
        expect(data.user.username).toBe('TestUser');
        expect(data.user.isHost).toBe(true);
        done();
      });
    });

    test('should reject room creation without username', (done) => {
      clientSocket.emit('create-room', {});
      
      clientSocket.on('create-room-error', (data) => {
        expect(data.error).toContain('Username is required');
        done();
      });
    });

    test('should reject room creation with invalid username', (done) => {
      clientSocket.emit('create-room', { username: '' });
      
      clientSocket.on('create-room-error', (data) => {
        expect(data.error).toContain('Username');
        done();
      });
    });

    test('should reject room creation with reserved username', (done) => {
      clientSocket.emit('create-room', { username: 'admin' });
      
      clientSocket.on('create-room-error', (data) => {
        expect(data.error).toContain('reserved');
        done();
      });
    });
  });

  describe('Room Validation', () => {
    test('should validate existing room', (done) => {
      // First create a room
      clientSocket.emit('create-room', { username: 'Host' });
      
      clientSocket.on('room-created', (data) => {
        const roomCode = data.roomCode;
        
        // Then validate it
        clientSocket.emit('validate-room', { roomCode });
        
        clientSocket.on('room-exists', (data) => {
          expect(data.room.roomCode).toBe(roomCode);
          expect(data.room.hostUsername).toBe('Host');
          done();
        });
      });
    });

    test('should reject validation of non-existent room', (done) => {
      clientSocket.emit('validate-room', { roomCode: 'INVALID' });
      
      clientSocket.on('room-not-found', (data) => {
        expect(data.error).toContain('Room not found');
        done();
      });
    });

    test('should reject validation without room code', (done) => {
      clientSocket.emit('validate-room', {});
      
      clientSocket.on('room-not-found', (data) => {
        expect(data.error).toContain('Room code is required');
        done();
      });
    });
  });

  describe('Room Joining', () => {
    let roomCode;

    beforeEach((done) => {
      // Create a room first
      clientSocket.emit('create-room', { username: 'Host' });
      
      clientSocket.on('room-created', (data) => {
        roomCode = data.roomCode;
        done();
      });
    });

    test('should join room successfully', (done) => {
      const secondClient = Client(`http://localhost:${httpServer.address().port}`);
      
      secondClient.on('connect', () => {
        secondClient.emit('join-room', { roomCode, username: 'Participant' });
        
        secondClient.on('room-joined', (data) => {
          expect(data.roomCode).toBe(roomCode);
          expect(data.user.username).toBe('Participant');
          expect(data.user.isHost).toBe(false);
          expect(data.participants).toHaveLength(2);
          
          secondClient.disconnect();
          done();
        });
      });
    });

    test('should notify existing participants when someone joins', (done) => {
      const secondClient = Client(`http://localhost:${httpServer.address().port}`);
      
      // Host should receive participant-joined event
      clientSocket.on('participant-joined', (data) => {
        expect(data.participant.username).toBe('Participant');
        expect(data.participants).toHaveLength(2);
        
        secondClient.disconnect();
        done();
      });
      
      secondClient.on('connect', () => {
        secondClient.emit('join-room', { roomCode, username: 'Participant' });
      });
    });

    test('should reject joining non-existent room', (done) => {
      clientSocket.emit('join-room', { roomCode: 'INVALID', username: 'Test' });
      
      clientSocket.on('join-room-error', (data) => {
        expect(data.error).toContain('Room not found');
        done();
      });
    });

    test('should reject joining without required fields', (done) => {
      clientSocket.emit('join-room', { username: 'Test' });
      
      clientSocket.on('join-room-error', (data) => {
        expect(data.error).toContain('Room code and username are required');
        done();
      });
    });

    test('should reject duplicate username in same room', (done) => {
      clientSocket.emit('join-room', { roomCode, username: 'Host' });
      
      clientSocket.on('join-room-error', (data) => {
        expect(data.error).toContain('already taken');
        done();
      });
    });
  });

  describe('Room Leaving', () => {
    let roomCode;
    let secondClient;

    beforeEach((done) => {
      // Create room and add participant
      clientSocket.emit('create-room', { username: 'Host' });
      
      clientSocket.on('room-created', (data) => {
        roomCode = data.roomCode;
        
        secondClient = Client(`http://localhost:${httpServer.address().port}`);
        secondClient.on('connect', () => {
          secondClient.emit('join-room', { roomCode, username: 'Participant' });
          secondClient.on('room-joined', () => done());
        });
      });
    });

    afterEach(() => {
      if (secondClient) {
        secondClient.disconnect();
      }
    });

    test('should handle participant leaving', (done) => {
      secondClient.emit('leave-room');
      
      secondClient.on('room-left', (data) => {
        expect(data.roomCode).toBe(roomCode);
        expect(data.user.username).toBe('Participant');
        done();
      });
    });

    test('should notify remaining participants when someone leaves', (done) => {
      clientSocket.on('participant-left', (data) => {
        expect(data.participant.username).toBe('Participant');
        expect(data.participants).toHaveLength(1);
        done();
      });
      
      secondClient.emit('leave-room');
    });

    test('should delete room when host leaves', (done) => {
      secondClient.on('room-deleted', (data) => {
        expect(data.roomCode).toBe(roomCode);
        expect(data.reason).toContain('Host left');
        done();
      });
      
      clientSocket.emit('leave-room');
    });
  });

  describe('Microphone Control', () => {
    beforeEach((done) => {
      clientSocket.emit('create-room', { username: 'Host' });
      clientSocket.on('room-created', () => done());
    });

    test('should update mic status successfully', (done) => {
      clientSocket.emit('mic-toggle', { muted: true });
      
      clientSocket.on('mic-updated', (data) => {
        expect(data.user.micMuted).toBe(true);
        expect(data.muted).toBe(true);
        done();
      });
    });

    test('should broadcast mic updates to other participants', (done) => {
      const secondClient = Client(`http://localhost:${httpServer.address().port}`);
      
      secondClient.on('connect', () => {
        secondClient.emit('join-room', { roomCode: 'test', username: 'Participant' });
        
        secondClient.on('participant-mic-updated', (data) => {
          expect(data.participant.micMuted).toBe(true);
          secondClient.disconnect();
          done();
        });
        
        // Host toggles mic after participant joins
        setTimeout(() => {
          clientSocket.emit('mic-toggle', { muted: true });
        }, 100);
      });
      
      // Use a known room code for this test
      socketHandlers.roomManager.createRoom(clientSocket.id, 'Host');
      const room = Array.from(socketHandlers.roomManager.rooms.values())[0];
      secondClient.on('room-joined', () => {
        clientSocket.emit('mic-toggle', { muted: true });
      });
    });

    test('should reject invalid mic toggle data', (done) => {
      clientSocket.emit('mic-toggle', { muted: 'invalid' });
      
      clientSocket.on('mic-toggle-error', (data) => {
        expect(data.error).toContain('Invalid muted status');
        done();
      });
    });

    test('should reject mic toggle from user not in room', (done) => {
      const newClient = Client(`http://localhost:${httpServer.address().port}`);
      
      newClient.on('connect', () => {
        newClient.emit('mic-toggle', { muted: true });
        
        newClient.on('mic-toggle-error', (data) => {
          expect(data.error).toContain('not in room');
          newClient.disconnect();
          done();
        });
      });
    });
  });

  describe('Movie Control', () => {
    beforeEach((done) => {
      clientSocket.emit('create-room', { username: 'Host' });
      clientSocket.on('room-created', () => done());
    });

    test('should allow host to start streaming', (done) => {
      clientSocket.emit('movie-control', {
        action: 'start-streaming',
        movieState: { title: 'Test Movie' }
      });
      
      clientSocket.on('movie-sync', (data) => {
        expect(data.action).toBe('start-streaming');
        expect(data.movieState.isStreaming).toBe(true);
        expect(data.movieState.title).toBe('Test Movie');
        expect(data.movieState.currentTime).toBe(0);
        expect(data.movieState.isPlaying).toBe(false);
        done();
      });
    });

    test('should allow host to play movie', (done) => {
      clientSocket.emit('movie-control', {
        action: 'play',
        movieState: { currentTime: 30 }
      });
      
      clientSocket.on('movie-sync', (data) => {
        expect(data.action).toBe('play');
        expect(data.movieState.isPlaying).toBe(true);
        expect(data.movieState.currentTime).toBe(30);
        done();
      });
    });

    test('should allow host to pause movie', (done) => {
      clientSocket.emit('movie-control', {
        action: 'pause',
        movieState: { currentTime: 45 }
      });
      
      clientSocket.on('movie-sync', (data) => {
        expect(data.action).toBe('pause');
        expect(data.movieState.isPlaying).toBe(false);
        expect(data.movieState.currentTime).toBe(45);
        done();
      });
    });

    test('should allow host to seek', (done) => {
      clientSocket.emit('movie-control', {
        action: 'seek',
        movieState: { currentTime: 120 }
      });
      
      clientSocket.on('movie-sync', (data) => {
        expect(data.action).toBe('seek');
        expect(data.movieState.currentTime).toBe(120);
        done();
      });
    });

    test('should allow host to stop streaming', (done) => {
      clientSocket.emit('movie-control', {
        action: 'stop-streaming'
      });
      
      clientSocket.on('movie-sync', (data) => {
        expect(data.action).toBe('stop-streaming');
        expect(data.movieState.isStreaming).toBe(false);
        expect(data.movieState.title).toBe(null);
        expect(data.movieState.currentTime).toBe(0);
        expect(data.movieState.isPlaying).toBe(false);
        done();
      });
    });

    test('should reject movie control without action', (done) => {
      clientSocket.emit('movie-control', { movieState: { title: 'Test' } });
      
      clientSocket.on('movie-control-error', (data) => {
        expect(data.error).toContain('Action is required');
        done();
      });
    });

    test('should reject invalid movie control action', (done) => {
      clientSocket.emit('movie-control', { action: 'invalid-action' });
      
      clientSocket.on('movie-control-error', (data) => {
        expect(data.error).toContain('Invalid action');
        done();
      });
    });

    test('should reject movie control from non-host', (done) => {
      const secondClient = Client(`http://localhost:${httpServer.address().port}`);
      
      // First get the room code
      clientSocket.on('room-created', (data) => {
        const roomCode = data.roomCode;
        
        secondClient.on('connect', () => {
          secondClient.emit('join-room', { roomCode, username: 'Participant' });
          
          secondClient.on('room-joined', () => {
            secondClient.emit('movie-control', { action: 'play' });
            
            secondClient.on('movie-control-error', (data) => {
              expect(data.error).toContain('Only host can control movie');
              secondClient.disconnect();
              done();
            });
          });
        });
      });
    });
  });

  describe('Chat Messages', () => {
    beforeEach((done) => {
      clientSocket.emit('create-room', { username: 'Host' });
      clientSocket.on('room-created', () => done());
    });

    test('should send chat message successfully', (done) => {
      const message = 'Hello everyone!';
      
      clientSocket.emit('chat-message', { message });
      
      clientSocket.on('chat-message', (data) => {
        expect(data.username).toBe('Host');
        expect(data.message).toBe(message);
        expect(data.isHost).toBe(true);
        expect(data.id).toBeDefined();
        expect(data.timestamp).toBeDefined();
        done();
      });
    });

    test('should reject empty chat message', (done) => {
      clientSocket.emit('chat-message', { message: '   ' });
      
      clientSocket.on('chat-error', (data) => {
        expect(data.error).toContain('cannot be empty');
        done();
      });
    });

    test('should reject too long chat message', (done) => {
      const longMessage = 'a'.repeat(501);
      
      clientSocket.emit('chat-message', { message: longMessage });
      
      clientSocket.on('chat-error', (data) => {
        expect(data.error).toContain('too long');
        done();
      });
    });

    test('should reject chat from user not in room', (done) => {
      const newClient = Client(`http://localhost:${httpServer.address().port}`);
      
      newClient.on('connect', () => {
        newClient.emit('chat-message', { message: 'Hello' });
        
        newClient.on('chat-error', (data) => {
          expect(data.error).toContain('not in room');
          newClient.disconnect();
          done();
        });
      });
    });
  });

  describe('WebRTC Signaling', () => {
    let roomCode;
    let secondClient;

    beforeEach((done) => {
      clientSocket.emit('create-room', { username: 'Host' });
      
      clientSocket.on('room-created', (data) => {
        roomCode = data.roomCode;
        
        secondClient = Client(`http://localhost:${httpServer.address().port}`);
        secondClient.on('connect', () => {
          secondClient.emit('join-room', { roomCode, username: 'Participant' });
          secondClient.on('room-joined', () => done());
        });
      });
    });

    afterEach(() => {
      if (secondClient) {
        secondClient.disconnect();
      }
    });

    test('should relay WebRTC offer', (done) => {
      const sdpOffer = { type: 'offer', sdp: 'test-sdp-offer' };
      
      secondClient.on('webrtc-offer', (data) => {
        expect(data.from).toBe(clientSocket.id);
        expect(data.sdp).toEqual(sdpOffer);
        done();
      });
      
      clientSocket.emit('webrtc-offer', { sdp: sdpOffer });
    });

    test('should relay WebRTC answer', (done) => {
      const sdpAnswer = { type: 'answer', sdp: 'test-sdp-answer' };
      
      clientSocket.on('webrtc-answer', (data) => {
        expect(data.from).toBe(secondClient.id);
        expect(data.sdp).toEqual(sdpAnswer);
        done();
      });
      
      secondClient.emit('webrtc-answer', { sdp: sdpAnswer });
    });

    test('should relay ICE candidates', (done) => {
      const iceCandidate = { 
        candidate: 'candidate:test', 
        sdpMLineIndex: 0,
        sdpMid: '0'
      };
      
      secondClient.on('webrtc-ice-candidate', (data) => {
        expect(data.from).toBe(clientSocket.id);
        expect(data.candidate).toEqual(iceCandidate);
        done();
      });
      
      clientSocket.emit('webrtc-ice-candidate', { candidate: iceCandidate });
    });

    test('should relay to specific peer when target specified', (done) => {
      const sdpOffer = { type: 'offer', sdp: 'targeted-offer' };
      
      secondClient.on('webrtc-offer', (data) => {
        expect(data.from).toBe(clientSocket.id);
        expect(data.sdp).toEqual(sdpOffer);
        done();
      });
      
      clientSocket.emit('webrtc-offer', { 
        to: secondClient.id, 
        sdp: sdpOffer 
      });
    });
  });

  describe('Disconnection Handling', () => {
    test('should handle host disconnection', (done) => {
      const secondClient = Client(`http://localhost:${httpServer.address().port}`);
      let roomCode;
      
      clientSocket.emit('create-room', { username: 'Host' });
      
      clientSocket.on('room-created', (data) => {
        roomCode = data.roomCode;
        
        secondClient.on('connect', () => {
          secondClient.emit('join-room', { roomCode, username: 'Participant' });
          
          secondClient.on('room-joined', () => {
            // Listen for host disconnection event
            secondClient.on('host-disconnected', (data) => {
              expect(data.roomCode).toBe(roomCode);
              expect(data.message).toContain('Host has disconnected');
              expect(data.canReconnect).toBe(true);
              expect(data.timeoutMinutes).toBe(5);
              
              secondClient.disconnect();
              done();
            });
            
            // Disconnect the host
            clientSocket.disconnect();
          });
        });
      });
    });

    test('should handle regular participant disconnection', (done) => {
      const secondClient = Client(`http://localhost:${httpServer.address().port}`);
      let roomCode;
      
      clientSocket.emit('create-room', { username: 'Host' });
      
      clientSocket.on('room-created', (data) => {
        roomCode = data.roomCode;
        
        secondClient.on('connect', () => {
          secondClient.emit('join-room', { roomCode, username: 'Participant' });
          
          secondClient.on('room-joined', () => {
            // Listen for participant disconnection
            clientSocket.on('participant-disconnected', (data) => {
              expect(data.participant.username).toBe('Participant');
              done();
            });
            
            // Disconnect the participant
            secondClient.disconnect();
          });
        });
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should provide accurate statistics', () => {
      const stats = socketHandlers.getStats();
      
      expect(typeof stats.totalRooms).toBe('number');
      expect(typeof stats.activeRooms).toBe('number');
      expect(typeof stats.totalUsers).toBe('number');
      expect(typeof stats.connectedUsers).toBe('number');
      expect(typeof stats.streamingRooms).toBe('number');
      
      expect(stats.activeRooms).toBeLessThanOrEqual(stats.totalRooms);
      expect(stats.connectedUsers).toBeLessThanOrEqual(stats.totalUsers);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed create-room data', (done) => {
      clientSocket.emit('create-room', null);
      
      clientSocket.on('create-room-error', (data) => {
        expect(data.error).toContain('Username is required');
        done();
      });
    });

    test('should handle malformed join-room data', (done) => {
      clientSocket.emit('join-room', null);
      
      clientSocket.on('join-room-error', (data) => {
        expect(data.error).toBeDefined();
        done();
      });
    });

    test('should handle malformed chat message', (done) => {
      clientSocket.emit('chat-message', null);
      
      clientSocket.on('chat-error', (data) => {
        expect(data.error).toContain('Message is required');
        done();
      });
    });
  });
});
