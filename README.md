# BeeMoo

🎬 **Movie Party Meetings Platform**

A lightweight, browser-based platform that enables friends and family to host synchronized movie watching sessions with integrated voice and text communication.

## Project Structure

```
BeeMoo/
├── server/                 # Backend Node.js server
│   ├── server.js          # Express server with Socket.io
│   ├── package.json       # Backend dependencies
│   └── node_modules/      # Backend packages
├── client/                # Frontend Vite application  
│   ├── index.html         # Main HTML entry point
│   ├── js/                # JavaScript modules (ES6+)
│   │   ├── main.js        # Application entry point
│   │   └── app.js         # Main application class
│   ├── package.json       # Frontend dependencies
│   ├── vite.config.js     # Vite build configuration
│   └── node_modules/      # Frontend packages
├── tasks/                 # Project documentation
│   ├── prd-movie-party-meetings.md    # Product requirements
│   └── tasks-prd-movie-party-meetings.md  # Implementation tasks
├── package.json           # Root project coordinator
└── README.md              # This file
```

## Quick Start

### Install All Dependencies
```bash
npm run install:all
```

### Development (Both Server & Client)
```bash
npm run dev
```
This starts both the backend server (port 3001) and frontend dev server (port 3000) simultaneously.

### Individual Commands

#### Backend Server
```bash
# Development with hot reload
npm run server:dev

# Production
npm run server:start

# Tests
npm run server:test
```

#### Frontend Client
```bash
# Development server
npm run client:dev

# Build for production
npm run client:build

# Preview production build
npm run client:preview

# Tests
npm run client:test
```

## Technology Stack

- **Backend**: Node.js + Express + Socket.io + Jest
- **Frontend**: Vite + ES Modules + Vitest + PWA capabilities
- **Real-time**: WebRTC (voice) + WebSockets (signaling)
- **Development**: Concurrently + Nodemon + Hot reload + CORS
- **Styling**: Responsive CSS Grid + Dark theme + Accessibility features
- **Mobile**: Progressive Web App + Touch-friendly interface

## Development Workflow

1. Run `npm run install:all` to install all dependencies
2. Run `npm run dev` to start both servers
3. Open http://localhost:3000 for the frontend
4. Backend API available at http://localhost:3001

## Features (In Development)

- ✅ Account-free room creation and joining
- ✅ Real-time voice communication  
- ✅ Synchronized movie streaming with chunked upload
- ✅ Frame-perfect playback synchronization
- ✅ Mobile browser support
- ✅ Individual audio and fullscreen controls