const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebSocketServer } = require('ws');
const startTikTokLive = require('./tiktok');

// Array of phrases to remove from comments
const bannedPhrases = ['europe itch', 'gabe itch', 'pho q'];

function sanitizeComment(comment) {
    if (!comment || typeof comment !== 'string') return '';
    
    let sanitized = comment;
    
    bannedPhrases.forEach(phrase => {
        const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        sanitized = sanitized.replace(regex, '');
    });
    
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s]/g, '');
    
    return sanitized.replace(/\s+/g, ' ').trim();
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const wss = new WebSocketServer({ 
    server, 
    path: '/ws'
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Comment queues for moderation system
let unmoderated = [];
let approved = [];

// WebSocket clients for moderation interface
const moderationClients = new Set();

// WebSocket clients for streamer interface
const streamerClients = new Set();

let streamerSettings = {
    filter: 'everybody', // everybody, followers, gifters
    manualModeration: true,
    requirePeriod: true // Whether comments need to start with a period
};

// TikTok Live connection management
let currentTikTokConnection = null;
let connectedUsername = null;

// WebSocket server for moderation and streamer interfaces
wss.on('connection', (ws, request) => {
    console.log('New WebSocket connection received');
    
    // Handle client identification
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'client_type') {
                if (data.clientType === 'moderation') {
                    moderationClients.add(ws);
                    console.log('Moderation WebSocket client connected');
                    
                    // Send current queue immediately
                    ws.send(JSON.stringify({ type: 'queue_init', queue: unmoderated }));
                    
                    // Broadcast updated moderator count to streamers
                    broadcastModeratorCount();
                    
                } else if (data.clientType === 'streamer') {
                    streamerClients.add(ws);
                    console.log('Streamer WebSocket client connected');
                    
                    // Send current settings immediately
                    ws.send(JSON.stringify({ type: 'settings_init', settings: streamerSettings }));
                    
                    // Send current moderator count immediately
                    const moderatorCount = Array.from(moderationClients).filter(ws => ws.readyState === 1).length;
                    ws.send(JSON.stringify({ type: 'moderator_count', count: moderatorCount }));
                }
            } else if (data.type === 'update_settings' && streamerClients.has(ws)) {
                // Handle streamer settings updates
                streamerSettings = { ...streamerSettings, ...data.settings };
                console.log('Updated streamer settings:', streamerSettings);
                
                // Broadcast settings to all streamer clients
                broadcastToStreamers({ type: 'settings_update', settings: streamerSettings });
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        if (moderationClients.has(ws)) {
            moderationClients.delete(ws);
            console.log('Moderation client disconnected');
            
            // Broadcast updated moderator count to streamers
            broadcastModeratorCount();
        } else if (streamerClients.has(ws)) {
            streamerClients.delete(ws);
            console.log('Streamer client disconnected');
        }
    });
});

// Helper to broadcast to moderation clients
function broadcastToModerators(data) {
    const msg = JSON.stringify(data);
    moderationClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

// Helper to broadcast to streamer clients
function broadcastToStreamers(data) {
    const msg = JSON.stringify(data);
    streamerClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

// Helper to broadcast moderator count to streamers
function broadcastModeratorCount() {
    const count = Array.from(moderationClients).filter(ws => ws.readyState === 1).length;
    broadcastToStreamers({ type: 'moderator_count', count });
}

// Helper to check if comment passes filter
function passesFilter(viewerData) {
    switch (streamerSettings.filter) {
        case 'followers':
            return viewerData.isFollower === true;
        case 'gifters':
            return viewerData.hasSentGift === true;
        case 'everybody':
        default:
            return true;
    }
}

// Socket.IO for main live viewer
io.on('connection', (socket) => {
    console.log('Live viewer client connected');

    // Send current connection status
    socket.emit('connection-status', {
        isConnected: currentTikTokConnection !== null,
        username: connectedUsername
    });

    socket.on('start-live', (connectionData) => {
        // Handle both old string format and new object format for backwards compatibility
        const username = typeof connectionData === 'string' ? connectionData : connectionData.username;
        const sessionId = typeof connectionData === 'object' ? connectionData.sessionId : undefined;
        
        console.log(`Request to start TikTok Live listener for ${username}${sessionId ? ' with session ID' : ''}`);
        
        // Check if already connected to someone else
        if (currentTikTokConnection && connectedUsername !== username) {
            socket.emit('connection-error', {
                error: `Already connected to @${connectedUsername}. Disconnect first to connect to a different user.`
            });
            return;
        }

        // If already connected to the same user, just send status
        if (currentTikTokConnection && connectedUsername === username) {
            socket.emit('connection-status', {
                isConnected: true,
                username: connectedUsername
            });
            return;
        }

        // Start new connection
        try {
            currentTikTokConnection = startTikTokLive(username, sessionId, (viewerData) => {
                console.log('Received viewer data:', viewerData);
                
                // Send to all live viewer clients
                io.emit('viewer-data', viewerData);
                
                // Add comment to moderation queue if it exists and passes filter
                // Also check if period is required and present
                if (viewerData.comment && viewerData.comment.trim()) {
                    const commentText = viewerData.comment.trim();
                    const shouldProcess = streamerSettings.requirePeriod ? 
                        commentText.startsWith('.') : 
                        true;
                    
                    if (shouldProcess && passesFilter(viewerData)) {
                        console.log('Processing comment from:', viewerData.username);
                        console.log('Comment text:', viewerData.comment);
                        console.log('Passes filter:', passesFilter(viewerData));
                        console.log('Current filter setting:', streamerSettings.filter);
                        console.log('Manual moderation enabled:', streamerSettings.manualModeration);
                        console.log('Require period:', streamerSettings.requirePeriod);
                        
                        // Remove the leading period if present and required
                        const textToSanitize = streamerSettings.requirePeriod && commentText.startsWith('.') ? 
                            commentText.substring(1) : 
                            commentText;
                        
                        const sanitizedText = sanitizeComment(textToSanitize);
                        
                        // Check if comment is empty after sanitization
                        if (!sanitizedText || sanitizedText.trim().length === 0) {
                            console.log('Comment is empty after sanitization, skipping:', viewerData.comment);
                            return;
                        }
                        
                        const comment = {
                            id: Date.now() + Math.random(), // Ensure uniqueness
                            text: sanitizedText,
                            username: viewerData.username || 'anonymous',
                            isFollower: viewerData.isFollower || false,
                            hasSentGift: viewerData.hasSentGift || false
                        };
                        
                        if (streamerSettings.manualModeration) {
                            // Send to moderation queue for manual approval
                            console.log('Adding comment to moderation queue:', comment);
                            unmoderated.push(comment);
                            broadcastToModerators({ type: 'new_comment', comment });
                        } else {
                            // Send directly to TTS (bypass moderation)
                            console.log('Sending comment directly to TTS (moderation bypassed):', comment);
                            broadcastToStreamers({ type: 'tts', comment: comment });
                        }
                    } else {
                        console.log('Comment filtered out due to settings');
                    }
                } else {
                    console.log('No comment or empty comment, skipping');
                }
            });

            connectedUsername = username;
            
            // Notify all clients about successful connection
            io.emit('connection-status', {
                isConnected: true,
                username: connectedUsername
            });
            
        } catch (error) {
            console.error('Failed to connect to TikTok Live:', error);
            socket.emit('connection-error', {
                error: `Failed to connect to @${username}. Please try again.`
            });
        }
    });

    socket.on('disconnect-live', () => {
        console.log('Request to disconnect from TikTok Live');
        
        if (currentTikTokConnection) {
            try {
                // Disconnect from TikTok Live
                if (typeof currentTikTokConnection.disconnect === 'function') {
                    currentTikTokConnection.disconnect();
                }
                currentTikTokConnection = null;
                connectedUsername = null;
                
                // Notify all clients about disconnection
                io.emit('connection-status', {
                    isConnected: false,
                    username: null
                });
                
                console.log('Successfully disconnected from TikTok Live');
                
            } catch (error) {
                console.error('Error disconnecting from TikTok Live:', error);
            }
        } else {
            socket.emit('connection-error', {
                error: 'No active TikTok Live connection to disconnect.'
            });
        }
    });

    socket.on('get-connection-status', () => {
        socket.emit('connection-status', {
            isConnected: currentTikTokConnection !== null,
            username: connectedUsername
        });
    });
});

// API Routes for moderation system

// Approve comment
app.post('/approve', (req, res) => {
    const { id } = req.body;
    const index = unmoderated.findIndex(c => c.id === id);
    if (index === -1) return res.status(404).json({ error: 'Comment not found' });

    const approvedComment = unmoderated.splice(index, 1)[0];
    approved.push(approvedComment);

    // Broadcast TTS event and queue update
    broadcastToStreamers({ type: 'tts', comment: approvedComment });
    broadcastToModerators({ type: 'queue_update', queue: unmoderated });

    res.json({ message: 'Comment approved', comment: approvedComment });
});

// Deny comment
app.post('/deny', (req, res) => {
    const { id } = req.body;
    const index = unmoderated.findIndex(c => c.id === id);
    if (index === -1) return res.status(404).json({ error: 'Comment not found' });

    const deniedComment = unmoderated.splice(index, 1)[0];

    broadcastToModerators({ type: 'denied', comment: deniedComment });
    broadcastToModerators({ type: 'queue_update', queue: unmoderated });

    res.json({ message: 'Comment denied', comment: deniedComment });
});

// Get approved comments (for external TTS if needed)
app.get('/approved', (req, res) => {
    res.json({ comments: approved });
});

// Debug route to get current state
app.get('/debug', (req, res) => {
    res.json({
        unmoderated: unmoderated,
        approved: approved,
        settings: streamerSettings,
        moderationClients: moderationClients.size,
        streamerClients: streamerClients.size
    });
});

// Serve static files for moderation and streamer interfaces
app.get('/moderation', (req, res) => {
    res.sendFile(__dirname + '/public/moderation.html');
});

app.get('/streamer', (req, res) => {
    res.sendFile(__dirname + '/public/streamer.html');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Moderation interface available at http://localhost:${PORT}/moderation`);
    console.log(`Streamer interface available at http://localhost:${PORT}/streamer`);
});
