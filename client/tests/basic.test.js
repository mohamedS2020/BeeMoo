import { describe, it, expect } from 'vitest';

describe('Basic Client Tests', () => {
  it('should have DOM environment', () => {
    expect(document).toBeDefined();
    expect(window).toBeDefined();
  });

  it('should have import.meta.env configured', () => {
    expect(import.meta.env).toBeDefined();
    expect(import.meta.env.DEV).toBe(true);
  });

  it('should be able to create DOM elements', () => {
    const div = document.createElement('div');
    div.id = 'test';
    document.body.appendChild(div);
    
    const found = document.getElementById('test');
    expect(found).toBeDefined();
    expect(found.id).toBe('test');
  });

  it('should handle CSS classes', () => {
    const element = document.createElement('div');
    element.className = 'test-class';
    
    expect(element.className).toBe('test-class');
  });
});
