// BeeMoo - Main Application Entry Point
// Modern ES Module Structure

import { App } from './app.js';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

// Initialize the BeeMoo application
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎬 BeeMoo - Movie Party Meetings Platform');
  
  // Initialize Vercel Analytics
  inject();
  
  // Initialize Vercel Speed Insights
  injectSpeedInsights();
  
  // Initialize the main application
  const app = new App();
  app.init();
  
  // Add volume testing to global scope for console debugging
  window.BeeMooVolumeTest = {
    boostMic: (level = 3.0) => {
      const roomView = app.roomView;
      if (roomView) {
        return roomView.testMicrophoneVolume(level);
      }
      console.warn('⚠️ No active room');
    },
    adjustLevels: (micVolume = 1.5, movieVolume = 0.6) => {
      const roomView = app.roomView;
      if (roomView) {
        return roomView.testAudioLevels(micVolume, movieVolume);
      }
      console.warn('⚠️ No active room');
    },
    testParticipantVolume: (volume = 0.5) => {
      const roomView = app.roomView;
      if (roomView && roomView.videoPlayer) {
        console.log(`🔊 Testing participant volume: ${Math.round(volume * 100)}%`);
        roomView.videoPlayer.setVolume(volume);
        
        // Report current state
        setTimeout(() => {
          const ve = roomView.videoPlayer.videoElement;
          console.log(`📊 Participant volume test result:`, {
            playerVolume: Math.round(roomView.videoPlayer.volume * 100),
            elementVolume: Math.round(ve.volume * 100),
            muted: ve.muted,
            isWebRTC: ve.getAttribute('data-webrtc') === 'true',
            hasStream: !!ve.srcObject,
            audioTracks: ve.srcObject?.getAudioTracks().length || 0
          });
        }, 100);
      } else {
        console.warn('⚠️ No video player available');
      }
    }
  };
  
  console.log('🎚️ Volume testing available:');
  console.log('  - BeeMooVolumeTest.boostMic(level) - Host microphone boost');
  console.log('  - BeeMooVolumeTest.adjustLevels(mic, movie) - Host audio mix (default: mic=1.5, movie=0.6)');
  console.log('  - BeeMooVolumeTest.testParticipantVolume(0.5) - Participant volume control test');
});

// Export for testing purposes
export { App };
