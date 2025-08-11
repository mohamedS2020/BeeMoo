// BeeMoo - Frame-Perfect Synchronization Utility
// Handles precision timing coordination for synchronized movie playback

export class SynchronizationManager {
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.serverTimeOffset = 0; // Difference between server and client time
    this.networkLatency = 0; // Round-trip time to server
    this.clockSyncSamples = [];
    this.maxSamples = 10; // Keep last 10 samples for averaging
    this.syncPrecision = 50; // Target sync precision in milliseconds
    this.isCalibrating = false;
    this.calibrationInterval = null;
    
    // Frame-perfect sync data
    this.lastSyncTime = 0;
    this.driftTolerance = 100; // Max drift before correction in ms
    this.syncHistory = [];
    
    this.setupSyncEventListeners();
    this.startClockCalibration();
  }

  /**
   * Setup event listeners for sync-related messages
   */
  setupSyncEventListeners() {
    this.socketClient.on('time-sync-response', (data) => {
      this.handleTimeSyncResponse(data);
    });
    
    this.socketClient.on('precision-sync', (data) => {
      this.handlePrecisionSync(data);
    });
  }

  /**
   * Start continuous clock calibration with server
   */
  startClockCalibration() {
    // Initial calibration
    this.calibrateServerTime();
    
    // Recalibrate every 30 seconds to maintain accuracy
    this.calibrationInterval = setInterval(() => {
      this.calibrateServerTime();
    }, 30000);
    
    console.log('🕐 Started clock calibration with server');
  }

  /**
   * Measure network latency and calculate server time offset
   */
  async calibrateServerTime() {
    if (this.isCalibrating) return;
    
    this.isCalibrating = true;
    
    try {
      const samples = [];
      
      // Take multiple samples for accuracy
      for (let i = 0; i < 5; i++) {
        const sample = await this.measureLatency();
        if (sample) {
          samples.push(sample);
        }
        // Small delay between samples
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (samples.length > 0) {
        this.processSyncSamples(samples);
      }
    } catch (error) {
      console.error('❌ Clock calibration failed:', error);
    } finally {
      this.isCalibrating = false;
    }
  }

  /**
   * Measure network latency using ping/pong
   */
  measureLatency() {
    return new Promise((resolve) => {
      const startTime = performance.now();
      const clientTimestamp = Date.now();
      
      // Set up one-time listener for response
      const responseHandler = (data) => {
        const endTime = performance.now();
        const roundTripTime = endTime - startTime;
        
        resolve({
          roundTripTime,
          clientSendTime: clientTimestamp,
          serverTime: data.serverTime,
          clientReceiveTime: Date.now()
        });
        
        this.socketClient.off('time-sync-response', responseHandler);
      };
      
      // Timeout handler
      const timeout = setTimeout(() => {
        this.socketClient.off('time-sync-response', responseHandler);
        console.warn('⚠️ Time sync request timed out');
        resolve(null);
      }, 2000);
      
      this.socketClient.on('time-sync-response', (data) => {
        clearTimeout(timeout);
        responseHandler(data);
      });
      
      // Send time sync request
      this.socketClient.emit('time-sync-request', {
        clientTime: clientTimestamp
      });
    });
  }

  /**
   * Process sync samples and calculate accurate time offset
   */
  processSyncSamples(samples) {
    // Add samples to history
    this.clockSyncSamples.push(...samples);
    
    // Keep only recent samples
    if (this.clockSyncSamples.length > this.maxSamples) {
      this.clockSyncSamples = this.clockSyncSamples.slice(-this.maxSamples);
    }
    
    // Calculate median latency (more robust than average)
    const latencies = this.clockSyncSamples.map(s => s.roundTripTime).sort((a, b) => a - b);
    this.networkLatency = latencies[Math.floor(latencies.length / 2)];
    
    // Calculate server time offset using the sample with lowest latency
    const bestSample = this.clockSyncSamples.reduce((best, current) => 
      current.roundTripTime < best.roundTripTime ? current : best
    );
    
    // Server time offset = server_time - (client_time + latency/2)
    const estimatedLatency = bestSample.roundTripTime / 2;
    this.serverTimeOffset = bestSample.serverTime - (bestSample.clientSendTime + estimatedLatency);
    
    console.log(`🕐 Clock sync updated: latency=${this.networkLatency.toFixed(1)}ms, offset=${this.serverTimeOffset.toFixed(1)}ms`);
    
    this.emitSyncStats();
  }

  /**
   * Get current server time with compensation
   */
  getServerTime() {
    return Date.now() + this.serverTimeOffset;
  }

  /**
   * Calculate precision sync timing for video playback
   */
  calculatePrecisionSync(hostAction, hostTime, targetTime) {
    const currentServerTime = this.getServerTime();
    const timeSinceAction = currentServerTime - hostTime;
    const compensatedTargetTime = targetTime + timeSinceAction;
    const latencyCompensation = this.networkLatency / 2;
    
    return {
      targetTime: compensatedTargetTime,
      latencyCompensation,
      timeDrift: timeSinceAction,
      serverTime: currentServerTime,
      syncAccuracy: Math.abs(timeSinceAction)
    };
  }

  /**
   * Perform frame-perfect sync for video playback
   */
  async performFramePerfectSync(videoElement, action, movieState) {
    if (!videoElement || !movieState) return false;
    
    const syncData = this.calculatePrecisionSync(
      action,
      movieState.timestamp || this.getServerTime(),
      movieState.currentTime || 0
    );
    
    console.log(`🎯 Frame-perfect sync: ${action}`, {
      targetTime: syncData.targetTime,
      drift: syncData.timeDrift,
      accuracy: syncData.syncAccuracy
    });
    
    try {
      switch (action) {
        case 'play':
          return await this.syncPlay(videoElement, syncData, movieState);
          
        case 'pause':
          return this.syncPause(videoElement, syncData);
          
        case 'seek':
          return await this.syncSeek(videoElement, syncData, movieState);
          
        default:
          console.warn('Unknown sync action:', action);
          return false;
      }
    } catch (error) {
      console.error('❌ Frame-perfect sync failed:', error);
      return false;
    }
  }

  /**
   * Sync video play with precise timing
   */
  async syncPlay(videoElement, syncData, movieState) {
    // Set precise time position
    if (Math.abs(videoElement.currentTime - syncData.targetTime) > 0.1) {
      videoElement.currentTime = syncData.targetTime;
    }
    
    // Calculate when to start playing for perfect sync
    const playDelay = Math.max(0, syncData.latencyCompensation - syncData.timeDrift);
    
    if (playDelay > 5) { // Only delay if significant
      await new Promise(resolve => setTimeout(resolve, playDelay));
    }
    
    await videoElement.play();
    
    this.recordSyncEvent('play', syncData);
    return true;
  }

  /**
   * Sync video pause with precise timing
   */
  syncPause(videoElement, syncData) {
    videoElement.pause();
    
    // Fine-tune the pause position
    if (Math.abs(videoElement.currentTime - syncData.targetTime) > 0.1) {
      videoElement.currentTime = syncData.targetTime;
    }
    
    this.recordSyncEvent('pause', syncData);
    return true;
  }

  /**
   * Sync video seek with precise timing
   */
  async syncSeek(videoElement, syncData, movieState) {
    const targetTime = movieState.currentTime || syncData.targetTime;
    
    videoElement.currentTime = targetTime;
    
    // Wait for seek to complete
    return new Promise((resolve) => {
      const onSeeked = () => {
        videoElement.removeEventListener('seeked', onSeeked);
        this.recordSyncEvent('seek', syncData);
        resolve(true);
      };
      
      videoElement.addEventListener('seeked', onSeeked);
      
      // Timeout after 1 second
      setTimeout(() => {
        videoElement.removeEventListener('seeked', onSeeked);
        resolve(false);
      }, 1000);
    });
  }

  /**
   * Record sync event for drift analysis
   */
  recordSyncEvent(action, syncData) {
    this.syncHistory.push({
      action,
      timestamp: Date.now(),
      accuracy: syncData.syncAccuracy,
      drift: syncData.timeDrift,
      latency: this.networkLatency
    });
    
    // Keep last 50 sync events
    if (this.syncHistory.length > 50) {
      this.syncHistory = this.syncHistory.slice(-50);
    }
    
    this.lastSyncTime = Date.now();
  }

  /**
   * Detect and report sync drift
   */
  detectSyncDrift() {
    if (this.syncHistory.length < 3) return null;
    
    const recentSyncs = this.syncHistory.slice(-5);
    const avgDrift = recentSyncs.reduce((sum, sync) => sum + Math.abs(sync.drift), 0) / recentSyncs.length;
    const avgAccuracy = recentSyncs.reduce((sum, sync) => sum + sync.accuracy, 0) / recentSyncs.length;
    
    const needsCorrection = avgDrift > this.driftTolerance;
    
    return {
      averageDrift: avgDrift,
      averageAccuracy: avgAccuracy,
      needsCorrection,
      quality: avgAccuracy < 50 ? 'excellent' : avgAccuracy < 100 ? 'good' : 'fair'
    };
  }

  /**
   * Get synchronization statistics
   */
  getSyncStats() {
    const drift = this.detectSyncDrift();
    
    return {
      networkLatency: this.networkLatency,
      serverTimeOffset: this.serverTimeOffset,
      syncPrecision: this.syncPrecision,
      syncHistory: this.syncHistory.length,
      drift: drift,
      lastSyncTime: this.lastSyncTime,
      isCalibrated: this.clockSyncSamples.length > 0
    };
  }

  /**
   * Emit sync statistics to UI
   */
  emitSyncStats() {
    const stats = this.getSyncStats();
    
    // Dispatch custom event for UI updates
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sync-stats-updated', { 
        detail: stats 
      }));
    }
  }

  /**
   * Handle time sync response from server
   */
  handleTimeSyncResponse(data) {
    // This is handled in measureLatency()
    console.log('🕐 Time sync response received');
  }

  /**
   * Handle precision sync commands from server
   */
  handlePrecisionSync(data) {
    console.log('🎯 Precision sync command received:', data);
    
    // This would be used for advanced server-initiated sync
    // Implementation depends on specific requirements
  }

  /**
   * Cleanup and stop calibration
   */
  destroy() {
    if (this.calibrationInterval) {
      clearInterval(this.calibrationInterval);
      this.calibrationInterval = null;
    }
    
    this.clockSyncSamples = [];
    this.syncHistory = [];
    
    console.log('🕐 Synchronization manager destroyed');
  }
}
