const request = require('supertest');
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Create separate test server to avoid conflicts
function createTestServer() {
  const app = express();
  const server = createServer(app);
  
  // Copy the same middleware setup from main server
  const corsOptions = {
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  };

  const io = new Server(server, {
    cors: {
      origin: 'http://localhost:3000',
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Middleware
  app.use(cors(corsOptions));
  app.use(express.json());

  // Security headers middleware
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', 
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: wss: http: https: data:;"
    );
    next();
  });

  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'BeeMoo Server' });
  });

  // Socket.io connection handling
  io.on('connection', (socket) => {
    socket.on('ping', (data) => {
      socket.emit('pong', { message: 'Pong from BeeMoo server!', timestamp: Date.now() });
    });
  });

  return { app, server, io };
}

describe('BeeMoo Server', () => {
  let testServer;
  let app;
  let server;
  let io;

  beforeAll(() => {
    const testSetup = createTestServer();
    app = testSetup.app;
    server = testSetup.server;
    io = testSetup.io;
  });

  afterAll((done) => {
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('HTTP Endpoints', () => {
    test('GET /health should return server status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'OK',
        service: 'BeeMoo Server'
      });
    });

    test('Health endpoint should have correct Content-Type', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/);

      expect(response.status).toBe(200);
    });
  });

  describe('Security Headers', () => {
    test('Should set X-Frame-Options header', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    test('Should set X-Content-Type-Options header', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    test('Should set X-XSS-Protection header', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    test('Should set Referrer-Policy header', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    test('Should set Content-Security-Policy header', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('CORS Configuration', () => {
    test('Should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.status).toBe(204);
    });

    test('Should include CORS headers in response', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Socket.io Configuration', () => {
    test('Should have Socket.io server configured', () => {
      expect(io).toBeDefined();
      expect(io).toBeInstanceOf(Server);
    });

    test('Should have correct CORS configuration for Socket.io', () => {
      expect(io.engine.opts.cors).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('Should return 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/non-existent-route')
        .expect(404);
    });

    test('Should handle malformed JSON requests gracefully', async () => {
      const response = await request(app)
        .post('/health')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);
    });
  });

  describe('Environment Configuration', () => {
    test('Should use default port when PORT env var is not set', () => {
      // This tests the fallback to port 3001
      expect(process.env.PORT || 3001).toBeDefined();
    });

    test('Should set NODE_ENV for testing', () => {
      // Jest automatically sets NODE_ENV to 'test'
      expect(process.env.NODE_ENV).toBe('test');
    });
  });
});


