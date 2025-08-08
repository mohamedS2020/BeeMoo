// Vitest setup file for client tests

import { vi } from 'vitest';

// Mock global objects that might not be available in test environment
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock fetch if needed
global.fetch = vi.fn();

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock console methods to reduce noise in tests (optional)
// console.log = vi.fn();
// console.warn = vi.fn();
// console.error = vi.fn();

// Setup import.meta.env mock
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: true,
    VITE_SERVER_URL: 'http://localhost:3001',
    VITE_SOCKET_URL: 'http://localhost:3001',
    VITE_DEV_MODE: 'true',
    VITE_ENABLE_DEBUG: 'true'
  },
  configurable: true
});

// Clean up after each test
afterEach(() => {
  // Clear all mocks
  vi.clearAllMocks();
  
  // Reset DOM
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
