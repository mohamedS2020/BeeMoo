// BeeMoo - WebRTC Utilities
// Handles microphone permission, device enumeration, and video streaming

export class WebRTCUtils {
  static getAudioConstraints(options = {}) {
    const {
      echoCancellation = true,
      noiseSuppression = true,
      autoGainControl = true,
      deviceId = undefined,
      highQuality = false
    } = options;
    
    // Enhanced voice chat constraints for crystal clear audio
    const audioConfig = {
      echoCancellation: true,           // Essential for preventing echo
      noiseSuppression: true,           // Remove background noise
      autoGainControl: true,            // Automatic volume adjustment
      googEchoCancellation: true,       // Google's enhanced echo cancellation
      googNoiseSuppression: true,       // Google's enhanced noise suppression
      googAutoGainControl: true,        // Google's enhanced auto gain
      googHighpassFilter: true,         // Remove low-frequency noise
      googTypingNoiseDetection: true,   // Detect and suppress typing sounds
      googAudioMirroring: false,        // Disable audio mirroring
      googDucking: false               // Disable audio ducking
    };
    
    if (highQuality) {
      // Additional high-quality settings for crystal clear voice
      audioConfig.sampleRate = 48000;  // High sample rate for clarity
      audioConfig.channelCount = 1;    // Mono for voice (better compression)
      audioConfig.latency = 0.01;      // 10ms latency for real-time feel
      audioConfig.googNoiseSuppression2 = true; // Enhanced noise suppression
    }
    
    const constraints = {
      audio: audioConfig,
      video: false
    };
    
    if (deviceId) {
      constraints.audio.deviceId = { exact: deviceId };
    }
    
    return constraints;
  }

  /**
   * Get video constraints for host streaming (canvas-based movie streaming)
   */
  static getVideoStreamConstraints(options = {}) {
    const {
      width = 1280,
      height = 720,
      frameRate = 30,
      bitrate = 2500000, // 2.5 Mbps
      quality = 'high'
    } = options;

    // Quality presets for adaptive streaming
    const qualityPresets = {
      low: { width: 640, height: 360, frameRate: 24, bitrate: 800000 },
      medium: { width: 854, height: 480, frameRate: 30, bitrate: 1500000 },
      high: { width: 1280, height: 720, frameRate: 30, bitrate: 2500000 },
      ultra: { width: 1920, height: 1080, frameRate: 30, bitrate: 4000000 }
    };

    const preset = qualityPresets[quality] || qualityPresets.high;
    
    return {
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate }
      },
      audio: false // Video stream doesn't need audio (we have separate audio track)
    };
  }

  /**
   * Create media stream from video element for WebRTC streaming
   */
  static createVideoStreamFromElement(videoElement, options = {}) {
    try {
      if (!videoElement || typeof videoElement.captureStream !== 'function') {
        throw new Error('Video element does not support captureStream');
      }

      const { frameRate = 30, quality = 'high', includeMovieAudio = false } = options;
      
      console.log('🎥 Capturing stream from video element:', {
        currentSrc: videoElement.currentSrc,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        readyState: videoElement.readyState,
        includeMovieAudio
      });
      
      // Capture stream from video element (includes both video and audio by default)
      const originalStream = videoElement.captureStream(frameRate);
      
      if (!originalStream) {
        throw new Error('Failed to capture stream from video element');
      }

      const videoTracks = originalStream.getVideoTracks();
      const audioTracks = originalStream.getAudioTracks();
      
      if (videoTracks.length === 0) {
        throw new Error('No video tracks in captured stream');
      }

      if (includeMovieAudio) {
        // Return stream with BOTH video and movie audio
        console.log(`🎥🔊 Created stream with video AND movie audio:`, {
          videoTracks: videoTracks.length,
          audioTracks: audioTracks.length
        });
        
        // Log track details
        videoTracks.forEach((track, i) => {
          console.log(`🎥 Video track ${i}:`, {
            id: track.id,
            label: track.label || 'video-track',
            enabled: track.enabled,
            readyState: track.readyState,
            settings: track.getSettings?.()
          });
        });

        audioTracks.forEach((track, i) => {
          // Label movie audio tracks for identification
          Object.defineProperty(track, 'label', {
            value: 'movie-audio',
            writable: false,
            configurable: true
          });
          
          console.log(`🔊 Movie audio track ${i}:`, {
            id: track.id,
            label: track.label,
            enabled: track.enabled,
            readyState: track.readyState,
            settings: track.getSettings?.()
          });
        });

        return { 
          success: true, 
          stream: originalStream, 
          error: null,
          tracks: {
            video: videoTracks.length,
            audio: audioTracks.length
          }
        };
      } else {
        // Create a new stream with ONLY video tracks (legacy behavior)
        const videoOnlyStream = new MediaStream();
        
        videoTracks.forEach(track => {
          videoOnlyStream.addTrack(track);
        });
        
        console.log(`🎥 Created VIDEO-ONLY stream with ${videoTracks.length} video tracks (audio excluded)`);
        
        // Log video track details only
        videoTracks.forEach((track, i) => {
          console.log(`🎥 Video track ${i}:`, {
            id: track.id,
            label: track.label,
            enabled: track.enabled,
            readyState: track.readyState,
            settings: track.getSettings?.()
          });
        });

        return { 
          success: true, 
          stream: videoOnlyStream, 
          error: null,
          tracks: {
            video: videoTracks.length,
            audio: 0
          }
        };
      }
      
    } catch (error) {
      console.error('❌ Failed to create video stream:', error);
      return { success: false, stream: null, error };
    }
  }

  /**
   * Check browser support for required WebRTC features
   */
  static checkWebRTCSupport() {
    const support = {
      webrtc: !!window.RTCPeerConnection,
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      captureStream: !!(HTMLVideoElement.prototype.captureStream || HTMLVideoElement.prototype.mozCaptureStream),
      mediaRecorder: !!window.MediaRecorder,
      supported: false
    };

    support.supported = support.webrtc && support.mediaDevices && support.captureStream;
    
    return support;
  }

  /**
   * Get optimal video encoding parameters based on connection quality
   */
  static getVideoEncodingParams(quality = 'high', connectionSpeed = 'fast') {
    const baseParams = {
      low: { maxBitrate: 500000, scaleResolutionDownBy: 4 },
      medium: { maxBitrate: 1000000, scaleResolutionDownBy: 2 },
      high: { maxBitrate: 2500000, scaleResolutionDownBy: 1 },
      ultra: { maxBitrate: 4000000, scaleResolutionDownBy: 1 }
    };

    // Adjust based on connection speed
    const speedMultiplier = {
      slow: 0.5,
      medium: 0.75,
      fast: 1.0,
      excellent: 1.25
    };

    const params = baseParams[quality] || baseParams.high;
    const multiplier = speedMultiplier[connectionSpeed] || 1.0;

    return {
      maxBitrate: Math.round(params.maxBitrate * multiplier),
      scaleResolutionDownBy: params.scaleResolutionDownBy,
      degradationPreference: connectionSpeed === 'slow' ? 'maintain-framerate' : 'maintain-resolution'
    };
  }
  static async requestMicrophonePermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // Immediately stop tracks; we only need permission at this phase
      stream.getTracks().forEach(t => t.stop());
      return { granted: true };
    } catch (error) {
      return { granted: false, error };
    }
  }

  static async listAudioInputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput').map(d => ({
        deviceId: d.deviceId,
        label: d.label || 'Microphone',
        groupId: d.groupId || undefined
      }));
      return { success: true, devices: inputs };
    } catch (error) {
      return { success: false, error };
    }
  }

  /**
   * SOLUTION: Create combined audio stream (microphone + movie audio)
   * This solves the WebRTC limitation of only supporting one audio track per peer
   */
  static async createCombinedAudioVideoStream(videoElement, microphoneStream, options = {}) {
    try {
      const { frameRate = 30 } = options;
      
      console.log('🎙️🔊 Creating ENHANCED combined audio stream for crystal clear voice');
      
      // Create Web Audio API context with optimal settings for voice chat
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',    // Optimize for low latency (real-time feel)
        sampleRate: 48000             // High quality sample rate
      });
      
      // Optimize audio context for real-time processing
      if (audioContext.audioWorklet) {
        console.log('🎚️ Using AudioWorklet for optimal voice processing performance');
      }
      
      // Capture video stream (with movie audio)
      const videoStream = videoElement.captureStream(frameRate);
      const videoTrack = videoStream.getVideoTracks()[0];
      const movieAudioTrack = videoStream.getAudioTracks()[0];
      
      // Get microphone audio track
      const micTrack = microphoneStream.getAudioTracks()[0];
      
      if (!videoTrack) {
        throw new Error('No video track available from video element');
      }
      
      if (!micTrack) {
        throw new Error('No microphone track available');
      }
      
      console.log('🎙️ Microphone track:', { id: micTrack.id, label: micTrack.label });
      if (movieAudioTrack) {
        console.log('🔊 Movie audio track:', { id: movieAudioTrack.id, label: movieAudioTrack.label });
      }
      
      // Create audio sources
      const micSource = audioContext.createMediaStreamSource(microphoneStream);
      const movieSource = movieAudioTrack ? 
        audioContext.createMediaStreamSource(new MediaStream([movieAudioTrack])) : null;
      
      // Create gain nodes for volume control
      const micGain = audioContext.createGain();
      const movieGain = audioContext.createGain();
      
      // Create dynamic range compressor for voice clarity
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-24, audioContext.currentTime);  // Compress above -24dB
      compressor.knee.setValueAtTime(30, audioContext.currentTime);        // Soft knee
      compressor.ratio.setValueAtTime(12, audioContext.currentTime);       // 12:1 compression ratio
      compressor.attack.setValueAtTime(0.003, audioContext.currentTime);   // 3ms attack
      compressor.release.setValueAtTime(0.25, audioContext.currentTime);   // 250ms release
      
      // Create high-pass filter to remove low-frequency noise
      const highPassFilter = audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.setValueAtTime(85, audioContext.currentTime); // Remove below 85Hz
      highPassFilter.Q.setValueAtTime(0.7, audioContext.currentTime);
      
      // Set optimized volumes for balanced movie party experience
      micGain.gain.value = 1.5;  // Host voice clear but natural (150%)
      movieGain.gain.value = 0.6; // Movie audio clearly audible (60%)
      
      // Create destination for combined audio
      const destination = audioContext.createMediaStreamDestination();
      
      // Connect microphone audio with voice enhancement processing chain
      micSource
        .connect(micGain)           // Volume control
        .connect(highPassFilter)    // Remove low-frequency noise
        .connect(compressor)        // Dynamic compression for clarity
        .connect(destination);      // Final output
      
      // Connect movie audio directly (no processing needed)
      if (movieSource) {
        movieSource.connect(movieGain).connect(destination);
        console.log('🔊 Movie audio connected to mixer (enhanced processing)');
      } else {
        console.log('🔇 No movie audio available - microphone only (enhanced processing)');
      }
      
      // Create final combined stream with video + mixed audio
      const combinedStream = new MediaStream();
      combinedStream.addTrack(videoTrack); // Add video track
      
      // Add the SINGLE combined audio track
      const combinedAudioTrack = destination.stream.getAudioTracks()[0];
      if (combinedAudioTrack) {
        // Label the combined track
        Object.defineProperty(combinedAudioTrack, 'label', {
          value: 'combined-audio',
          writable: false
        });
        combinedStream.addTrack(combinedAudioTrack);
        console.log('🎙️🔊 Combined audio track created:', combinedAudioTrack.id);
      }
      
      console.log('✅ Enhanced combined stream created:', {
        videoTracks: combinedStream.getVideoTracks().length,
        audioTracks: combinedStream.getAudioTracks().length,
        micVolume: `${micGain.gain.value * 100}% (enhanced with compression & filtering)`,
        movieVolume: `${movieGain.gain.value * 100}%`,
        totalTracks: combinedStream.getTracks().length,
        audioEnhancement: 'Compressor + High-pass filter + Optimized gain'
      });
      
      return { 
        success: true, 
        stream: combinedStream,
        audioContext,
        micGain,
        movieGain,
        compressor,
        highPassFilter,
        cleanup: () => {
          console.log('🧹 Cleaning up enhanced audio context');
          try {
            // Disconnect all nodes properly
            micSource.disconnect();
            if (movieSource) movieSource.disconnect();
            micGain.disconnect();
            movieGain.disconnect();
            compressor.disconnect();
            highPassFilter.disconnect();
            destination.disconnect();
            
            // Close audio context
            audioContext.close();
            console.log('✅ Enhanced audio context cleaned up');
          } catch (error) {
            console.warn('⚠️ Error cleaning up enhanced audio context:', error);
          }
        }
      };
      
    } catch (error) {
      console.error('❌ Failed to create combined audio/video stream:', error);
      return { success: false, stream: null, error };
    }
  }

  /**
   * Adjust volume levels in combined audio stream
   */
  static adjustCombinedAudioLevels(micGain, movieGain, options = {}) {
    const { micVolume = 1.5, movieVolume = 0.6 } = options;
    
    if (micGain) {
      micGain.gain.value = micVolume;
      console.log(`🎙️ Microphone volume set to: ${micVolume * 100}%`);
    }
    
    if (movieGain) {
      movieGain.gain.value = movieVolume;
      console.log(`🔊 Movie audio volume set to: ${movieVolume * 100}%`);
    }
  }

  /**
   * Boost microphone volume even more if needed
   */
  static boostMicrophoneVolume(micGain, level = 3.0) {
    if (micGain) {
      micGain.gain.value = level;
      console.log(`🔊 BOOSTED microphone volume to: ${level * 100}%`);
    }
  }

  /**
   * Mobile background optimization - keep audio streams active
   */
  static optimizeForMobileBackground() {
    // Force audio context to stay active
    if (window.AudioContext || window.webkitAudioContext) {
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(audio => {
        // Ensure audio elements don't pause in background
        audio.addEventListener('pause', () => {
          if (document.hidden) {
            console.log('📱 Resuming audio for background mode');
            audio.play().catch(() => {});
          }
        });

        // Keep audio playing with minimal volume if needed
        if (audio.volume > 0) {
          audio.setAttribute('data-original-volume', audio.volume);
        }
      });
    }
  }

  /**
   * Keep WebRTC audio tracks active during background
   */
  static maintainWebRTCAudio() {
    // Find all active audio tracks and ensure they stay enabled
    const audioTracks = [];
    
    // Check all RTCPeerConnections for audio tracks
    if (window.RTCPeerConnection) {
      // Get all peer connections (if accessible)
      document.querySelectorAll('audio').forEach(audio => {
        if (audio.srcObject instanceof MediaStream) {
          const tracks = audio.srcObject.getAudioTracks();
          audioTracks.push(...tracks);
        }
      });

      // Ensure all audio tracks remain enabled
      audioTracks.forEach(track => {
        if (track.readyState === 'live') {
          track.enabled = true;
          console.log('📱 Maintaining audio track:', track.label);
        }
      });
    }

    return audioTracks.length;
  }

  /**
   * Get mobile-optimized audio constraints for background use
   */
  static getMobileOptimizedAudioConstraints() {
    return {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Mobile-specific optimizations
        sampleRate: 16000,      // Lower sample rate for better background performance
        channelCount: 1,        // Mono audio
        latency: 0.02,          // Slightly higher latency for stability
        // Enhanced background support
        googEchoCancellation: true,
        googNoiseSuppression: true,
        googAutoGainControl: true,
        googHighpassFilter: true,
        // Disable features that might cause issues in background
        googDucking: false,
        googAudioMirroring: false
      },
      video: false
    };
  }
}
