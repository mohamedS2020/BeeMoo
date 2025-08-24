// BeeMoo - WebRTC Utilities
// Handles microphone permission, device enumeration, and video streaming

export class WebRTCUtils {
  static getAudioConstraints(options = {}) {
    const {
      echoCancellation = true,
      noiseSuppression = true,
      autoGainControl = true,
      deviceId = undefined
    } = options;
    const constraints = {
      audio: {
        echoCancellation,
        noiseSuppression,
        autoGainControl
      },
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
      
      console.log('🎙️🔊 Creating combined audio stream to solve WebRTC limitation');
      
      // Create Web Audio API context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
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
      
      // Set volumes (microphone should be prominent for voice clarity)
      micGain.gain.value = 2.0;  // BOOST microphone volume (200%)
      movieGain.gain.value = 0.2; // REDUCE movie audio volume (20%)
      
      // Create destination for combined audio
      const destination = audioContext.createMediaStreamDestination();
      
      // Connect audio sources to combined output
      micSource.connect(micGain);
      micGain.connect(destination);
      
      if (movieSource) {
        movieSource.connect(movieGain);
        movieGain.connect(destination);
        console.log('🔊 Movie audio connected to mixer');
      } else {
        console.log('🔇 No movie audio available - microphone only');
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
      
      console.log('✅ Combined stream created:', {
        videoTracks: combinedStream.getVideoTracks().length,
        audioTracks: combinedStream.getAudioTracks().length,
        micVolume: `${micGain.gain.value * 100}%`,
        movieVolume: `${movieGain.gain.value * 100}%`,
        totalTracks: combinedStream.getTracks().length
      });
      
      return { 
        success: true, 
        stream: combinedStream,
        audioContext,
        micGain,
        movieGain,
        cleanup: () => {
          console.log('🧹 Cleaning up audio context');
          try {
            audioContext.close();
          } catch (error) {
            console.warn('⚠️ Error closing audio context:', error);
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
    const { micVolume = 2.0, movieVolume = 0.2 } = options;
    
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
}
