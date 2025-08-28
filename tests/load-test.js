#!/usr/bin/env node

// BeeMoo Load Test - Simulate Multiple Users
// Run this to test room capacity and functionality

const io = require('socket.io-client');

class LoadTester {
  constructor(serverUrl, roomCode) {
    this.serverUrl = serverUrl;
    this.roomCode = roomCode;
    this.users = [];
    this.testResults = {
      totalUsers: 0,
      connectedUsers: 0,
      joinedUsers: 0,
      errors: [],
      startTime: null,
      endTime: null
    };
  }

  async runTest(userCount = 10) {
    console.log(`🧪 Starting load test with ${userCount} users`);
    console.log(`🌐 Server: ${this.serverUrl}`);
    console.log(`🏠 Room: ${this.roomCode}`);
    console.log('━'.repeat(50));

    this.testResults.startTime = Date.now();
    this.testResults.totalUsers = userCount;

    // Create first user as host to create room
    const host = await this.createHost();
    if (!host.success) {
      console.error('❌ Failed to create host:', host.error);
      return this.testResults;
    }

    // Wait a bit for room to be established
    await this.delay(1000);

    // Create remaining users as participants
    const participantPromises = [];
    for (let i = 2; i <= userCount; i++) {
      participantPromises.push(this.createParticipant(i));
      await this.delay(100); // Stagger connections
    }

    // Wait for all participants to connect
    const participants = await Promise.allSettled(participantPromises);
    
    // Analyze results
    participants.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        this.testResults.joinedUsers++;
      } else {
        this.testResults.errors.push(`User ${index + 2}: ${result.reason || result.value?.error}`);
      }
    });

    this.testResults.endTime = Date.now();
    
    // Wait a bit to observe the room
    console.log('\n⏱️  Observing room for 10 seconds...');
    await this.delay(10000);

    // Test some functionality
    await this.testFunctionality();

    // Cleanup
    await this.cleanup();

    return this.printResults();
  }

  async createHost() {
    return new Promise((resolve) => {
      const username = 'Host_User';
      console.log(`👑 Creating host: ${username}`);

      const socket = io(this.serverUrl, {
        transports: ['websocket', 'polling']
      });

      const user = {
        socket,
        username,
        isHost: true,
        connected: false,
        joinedRoom: false
      };

      socket.on('connect', () => {
        console.log(`✅ Host connected: ${socket.id}`);
        user.connected = true;
        this.testResults.connectedUsers++;

        // Create room
        socket.emit('create-room', { username });
      });

      socket.on('room-created', (data) => {
        console.log(`🏠 Room created: ${data.roomCode}`);
        user.joinedRoom = true;
        this.testResults.joinedUsers++;
        this.roomCode = data.roomCode;
        this.users.push(user);
        resolve({ success: true, roomCode: data.roomCode });
      });

      socket.on('create-room-error', (error) => {
        console.error(`❌ Host creation failed:`, error);
        resolve({ success: false, error: error.error });
      });

      socket.on('disconnect', () => {
        console.log(`📴 Host disconnected`);
        user.connected = false;
      });

      socket.on('connect_error', (error) => {
        console.error(`🚨 Host connection error:`, error);
        resolve({ success: false, error: error.message });
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!user.joinedRoom) {
          resolve({ success: false, error: 'Host creation timeout' });
        }
      }, 10000);
    });
  }

  async createParticipant(userNumber) {
    return new Promise((resolve) => {
      const username = `User_${userNumber}`;
      console.log(`👤 Creating participant: ${username}`);

      const socket = io(this.serverUrl, {
        transports: ['websocket', 'polling']
      });

      const user = {
        socket,
        username,
        isHost: false,
        connected: false,
        joinedRoom: false
      };

      socket.on('connect', () => {
        console.log(`✅ ${username} connected: ${socket.id}`);
        user.connected = true;
        this.testResults.connectedUsers++;

        // Join room
        socket.emit('join-room', { 
          roomCode: this.roomCode, 
          username 
        });
      });

      socket.on('room-joined', (data) => {
        console.log(`🎉 ${username} joined room - Participants: ${data.participants.length}`);
        user.joinedRoom = true;
        this.users.push(user);
        resolve({ success: true });
      });

      socket.on('join-room-error', (error) => {
        console.error(`❌ ${username} join failed:`, error);
        resolve({ success: false, error: error.error });
      });

      socket.on('participant-joined', (data) => {
        const newUserName = data.user?.username || data.username || 'Unknown';
        console.log(`📢 ${username} sees new participant: ${newUserName}`);
      });

      socket.on('disconnect', () => {
        console.log(`📴 ${username} disconnected`);
        user.connected = false;
      });

      socket.on('connect_error', (error) => {
        console.error(`🚨 ${username} connection error:`, error);
        resolve({ success: false, error: error.message });
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!user.joinedRoom) {
          resolve({ success: false, error: `${username} join timeout` });
        }
      }, 15000);
    });
  }

  async testFunctionality() {
    console.log('\n🧪 Testing room functionality...');
    
    if (this.users.length === 0) {
      console.log('⚠️  No users to test with');
      return;
    }

    // Test mic muting
    const testUser = this.users[1] || this.users[0];
    if (testUser && testUser.socket) {
      console.log(`🎤 Testing mic mute with ${testUser.username}`);
      testUser.socket.emit('toggle-mic', { muted: true });
      
      await this.delay(1000);
      
      testUser.socket.emit('toggle-mic', { muted: false });
    }

    // Test room info request
    if (this.users[0] && this.users[0].socket) {
      console.log('📊 Testing room info request');
      this.users[0].socket.emit('get-room-info');
    }

    await this.delay(2000);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up connections...');
    
    for (const user of this.users) {
      if (user.socket && user.socket.connected) {
        user.socket.disconnect();
      }
    }
    
    await this.delay(1000);
  }

  printResults() {
    const duration = this.testResults.endTime - this.testResults.startTime;
    
    console.log('\n' + '━'.repeat(50));
    console.log('📊 LOAD TEST RESULTS');
    console.log('━'.repeat(50));
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`👥 Total Users: ${this.testResults.totalUsers}`);
    console.log(`🔌 Connected: ${this.testResults.connectedUsers}`);
    console.log(`🏠 Joined Room: ${this.testResults.joinedUsers}`);
    console.log(`✅ Success Rate: ${((this.testResults.joinedUsers / this.testResults.totalUsers) * 100).toFixed(1)}%`);
    
    if (this.testResults.errors.length > 0) {
      console.log(`\n❌ Errors (${this.testResults.errors.length}):`);
      this.testResults.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
    
    console.log('\n🎯 Performance Assessment:');
    if (this.testResults.joinedUsers === this.testResults.totalUsers) {
      console.log('🟢 EXCELLENT: All users successfully joined');
    } else if (this.testResults.joinedUsers >= this.testResults.totalUsers * 0.8) {
      console.log('🟡 GOOD: Most users joined successfully');
    } else {
      console.log('🔴 NEEDS ATTENTION: Many users failed to join');
    }
    
    console.log('━'.repeat(50));
    
    return this.testResults;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
async function main() {
  const serverUrl = process.argv[2] || 'http://localhost:3001';
  const userCount = parseInt(process.argv[3]) || 10;
  
  console.log('🎬 BeeMoo Load Tester');
  console.log(`🎯 Target: ${userCount} users on ${serverUrl}`);
  
  const tester = new LoadTester(serverUrl);
  const results = await tester.runTest(userCount);
  
  process.exit(results.joinedUsers === results.totalUsers ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = LoadTester;
