// Load environment variables
require('dotenv').config();

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
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '2gb' }));
app.use(express.urlencoded({ limit: '2gb', extended: true }));

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

// Analytics endpoints
app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await socketHandlers.analytics.getCurrentStats();
    res.json({
      status: 'OK',
      service: 'BeeMoo Analytics',
      timestamp: new Date().toISOString(),
      analytics: analytics
    });
  } catch (error) {
    console.error('Analytics API error:', error);
    res.status(500).json({
      status: 'Error',
      message: 'Failed to retrieve analytics'
    });
  }
});

// Manual report generation endpoint (for testing)
app.post('/api/analytics/report/:type', async (req, res) => {
  try {
    const { type } = req.params;
    
    if (!['weekly', 'monthly', 'test'].includes(type)) {
      return res.status(400).json({
        status: 'Error',
        message: 'Invalid report type. Use: weekly, monthly, or test'
      });
    }
    
    await socketHandlers.analytics.generateManualReport(type);
    
    res.json({
      status: 'OK',
      message: `${type} report generation initiated`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Manual report error:', error);
    res.status(500).json({
      status: 'Error',
      message: 'Failed to generate report'
    });
  }
});

// Get analytics configuration (for debugging)
app.get('/api/analytics/config', (req, res) => {
  res.json({
    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
    emailUser: process.env.EMAIL_USER || 'Not configured',
    reportEmail: process.env.REPORT_EMAIL || 'Not configured',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
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

const PORT = process.env.PORT || 3000;

const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`BeeMoo Server running on http://${HOST}:${PORT}`);
});

module.exports = { app, server, io };
