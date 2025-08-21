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

      const { frameRate = 30, quality = 'high', includeAudio = true } = options;
      
      console.log('🎥 Capturing stream from video element:', {
        currentSrc: videoElement.currentSrc,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        muted: videoElement.muted,
        volume: videoElement.volume,
        readyState: videoElement.readyState
      });
      
      // Ensure video element is not muted for audio capture
      const originalMuted = videoElement.muted;
      if (includeAudio) {
        videoElement.muted = false;
      }
      
      // Capture stream from video element (includes both video and audio by default)
      const stream = videoElement.captureStream(frameRate);
      
      // Restore original muted state
      videoElement.muted = originalMuted;
      
      if (!stream) {
        throw new Error('Failed to capture stream from video element');
      }

      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      
      console.log(`🎥 Created stream with ${videoTracks.length} video tracks and ${audioTracks.length} audio tracks`);
      
      if (videoTracks.length === 0) {
        throw new Error('No video tracks in captured stream');
      }

      // Log track details
      videoTracks.forEach((track, i) => {
        console.log(`🎥 Video track ${i}:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          settings: track.getSettings?.()
        });
      });

      audioTracks.forEach((track, i) => {
        console.log(`🔊 Audio track ${i}:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          settings: track.getSettings?.()
        });
      });

      return { success: true, stream, error: null };
      
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
}
