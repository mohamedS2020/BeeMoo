const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// CORS configuration for all environments
const corsOptions = {
  origin: CLIENT_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS Protection (for older browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy (basic for now)
  if (NODE_ENV === 'development') {
    // More permissive CSP for development
    res.setHeader('Content-Security-Policy', 
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: wss: http: https: data:;"
    );
  } else {
    // Stricter CSP for production
    res.setHeader('Content-Security-Policy', 
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:;"
    );
  }
  
  next();
});

// Development logging middleware
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Initialize Socket.io handlers
const SocketHandlers = require('./socket/socketHandlers');
const socketHandlers = new SocketHandlers(io);

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'BeeMoo Server' });
});

// Server statistics endpoint (for monitoring/debugging)
app.get('/api/stats', (req, res) => {
  const stats = socketHandlers.getStats();
  res.json({
    status: 'OK',
    service: 'BeeMoo Server',
    timestamp: new Date().toISOString(),
    stats: stats
  });
});

// Socket.io connection handling
io.on('connection', socketHandlers.handleConnection);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down BeeMoo server...');
  socketHandlers.shutdown();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down BeeMoo server...');
  socketHandlers.shutdown();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`BeeMoo Server running on port ${PORT}`);
});

module.exports = { app, server, io };
