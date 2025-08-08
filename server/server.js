const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Enhanced CORS configuration for development
const corsOptions = {
  origin: NODE_ENV === 'development' ? [CLIENT_URL, 'http://localhost:3000'] : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

const io = new Server(server, {
  cors: {
    origin: NODE_ENV === 'development' ? CLIENT_URL : false,
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

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'BeeMoo Server' });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);
  
  // Development ping handler
  socket.on('ping', (data) => {
    console.log('🏓 Ping received:', data);
    socket.emit('pong', { message: 'Pong from BeeMoo server!', timestamp: Date.now() });
  });
  
  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`BeeMoo Server running on port ${PORT}`);
});

module.exports = { app, server, io };
