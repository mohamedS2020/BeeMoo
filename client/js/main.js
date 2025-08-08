// BeeMoo - Main Application Entry Point
// Modern ES Module Structure

import { App } from './app.js';

// Initialize the BeeMoo application
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎬 BeeMoo - Movie Party Meetings Platform');
  
  // Initialize the main application
  const app = new App();
  app.init();
});

// Export for testing purposes
export { App };
