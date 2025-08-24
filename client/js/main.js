// BeeMoo - Main Application Entry Point
// Modern ES Module Structure

import { App } from './app.js';

// Initialize the BeeMoo application
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎬 BeeMoo - Movie Party Meetings Platform');
  
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
    adjustLevels: (micVolume = 2.5, movieVolume = 0.15) => {
      const roomView = app.roomView;
      if (roomView) {
        return roomView.testAudioLevels(micVolume, movieVolume);
      }
      console.warn('⚠️ No active room');
    }
  };
  
  console.log('🎚️ Volume testing available: BeeMooVolumeTest.boostMic(level) and BeeMooVolumeTest.adjustLevels(mic, movie)');
});

// Export for testing purposes
export { App };
