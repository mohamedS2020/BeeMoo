// Jest setup file for server tests

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3002';
process.env.CLIENT_URL = 'http://localhost:3000';

// Suppress console logs during tests (optional)
// console.log = jest.fn();
// console.warn = jest.fn();
// console.error = jest.fn();

// Global test timeout
jest.setTimeout(10000);

// Clean up any lingering connections
afterAll(async () => {
  // Wait a bit for any async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});
