const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebSocketServer } = require('ws');
const startTikTokLive = require('./tiktok');

console.log('Starting TikTok TTS server');

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

// Server-side TTS queue tracking
let serverTTSQueue = [];

// WebSocket clients for moderation interface
const moderationClients = new Set();

// WebSocket clients for streamer interface
const streamerClients = new Set();

let streamerSettings = {
    filter: 'everybody', // everybody, followers, gifters
    manualModeration: true,
    requirePeriod: true, // Whether comments need to start with a period
    commentCooldown: 5, // Cooldown in seconds between comments from the same user
    maxQueueSize: 5 // Maximum number of comments in queue before rejecting new ones
};

// Track user comment timestamps for spam protection
const userCommentTimestamps = new Map();

// TikTok Live connection management
let currentTikTokConnection = null;
let connectedUsername = null;

// WebSocket server for moderation and streamer interfaces
wss.on('connection', (ws, request) => {
    // Handle client identification
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'client_type') {
                if (data.clientType === 'moderation') {
                    console.log('New moderation client connected');
                    moderationClients.add(ws);
                    
                    // Send current queue immediately
                    ws.send(JSON.stringify({ type: 'queue_init', queue: unmoderated }));
                    
                    // Broadcast updated moderator count to streamers
                    broadcastModeratorCount();
                    
                } else if (data.clientType === 'streamer') {
                    console.log('New streamer client connected');
                    streamerClients.add(ws);
                    
                    // Reset server TTS queue when a new streamer connects to avoid stale data
                    if (streamerClients.size === 1) {
                        serverTTSQueue = [];
                    }
                    
                    // Send current settings immediately
                    ws.send(JSON.stringify({ type: 'settings_init', settings: streamerSettings }));
                    
                    // Send current moderator count immediately
                    const moderatorCount = Array.from(moderationClients).filter(ws => ws.readyState === 1).length;
                    ws.send(JSON.stringify({ type: 'moderator_count', count: moderatorCount }));
                    
                    // Send current moderation queue size immediately
                    ws.send(JSON.stringify({ type: 'moderation_queue_update', queueSize: unmoderated.length }));
                }
            } else if (data.type === 'update_settings' && streamerClients.has(ws)) {
                // Handle streamer settings updates
                const oldSettings = { ...streamerSettings };
                streamerSettings = { ...streamerSettings, ...data.settings };
                
                // Check if manual moderation was turned off
                if (oldSettings.manualModeration === true && streamerSettings.manualModeration === false) {
                    // Clear the moderation queue since comments would now go directly to TTS
                    unmoderated = [];
                    // Notify moderators that queue was cleared
                    broadcastToModerators({ type: 'queue_update', queue: unmoderated });
                    // Notify streamers about moderation queue size change
                    broadcastToStreamers({ type: 'moderation_queue_update', queueSize: unmoderated.length });
                }
                
                // Broadcast settings to all streamer clients
                broadcastToStreamers({ type: 'settings_update', settings: streamerSettings });
            } else if (data.type === 'tts_queue_update' && streamerClients.has(ws)) {
                // Handle TTS queue updates from streamer clients
                if (data.action === 'add' && data.comment) {
                    addToServerTTSQueue(data.comment);
                } else if (data.action === 'remove' && data.commentId) {
                    removeFromServerTTSQueue(data.commentId);
                } else if (data.action === 'clear') {
                    serverTTSQueue = [];
                }
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        if (moderationClients.has(ws)) {
            moderationClients.delete(ws);
            
            // Broadcast updated moderator count to streamers
            broadcastModeratorCount();
        } else if (streamerClients.has(ws)) {
            streamerClients.delete(ws);
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

// Helper to check if user is in comment cooldown
function isUserInCooldown(username) {
    if (!username) return false;
    
    const lastCommentTime = userCommentTimestamps.get(username);
    if (!lastCommentTime) return false;
    
    const now = Date.now();
    const cooldownMs = streamerSettings.commentCooldown * 1000;
    
    return (now - lastCommentTime) < cooldownMs;
}

// Helper to update user comment timestamp
function updateUserCommentTime(username) {
    if (username) {
        userCommentTimestamps.set(username, Date.now());
    }
}

// Helper to check if queue is full (considers both moderation and TTS queues)
function isQueueFull() {
    const moderationQueueSize = unmoderated.length;
    const ttsQueueSize = serverTTSQueue.length;
    const totalQueueSize = moderationQueueSize + ttsQueueSize;
    return totalQueueSize >= streamerSettings.maxQueueSize;
}

// Helper to add comment to server TTS queue
function addToServerTTSQueue(comment) {
    if (serverTTSQueue.length >= streamerSettings.maxQueueSize) {
        return false; // Queue is full
    }
    serverTTSQueue.push(comment);
    return true;
}

// Helper to remove comment from server TTS queue
function removeFromServerTTSQueue(commentId) {
    const index = serverTTSQueue.findIndex(c => c.id === commentId);
    if (index !== -1) {
        const removedComment = serverTTSQueue.splice(index, 1)[0];
        return true;
    }
    return false;
}

// Socket.IO for main live viewer
io.on('connection', (socket) => {
    // Send current connection status
    socket.emit('connection-status', {
        isConnected: currentTikTokConnection !== null,
        username: connectedUsername
    });

    socket.on('start-live', (connectionData) => {
        // Handle both old string format and new object format for backwards compatibility
        const username = typeof connectionData === 'string' ? connectionData : connectionData.username;
        const sessionId = typeof connectionData === 'object' ? connectionData.sessionId : undefined;
                
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
            console.log(`Connecting to TikTok Live: @${username}`);
            currentTikTokConnection = startTikTokLive(username, sessionId, (viewerData) => {
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
                        // Check if queue is full before processing
                        if (isQueueFull()) {
                            return; // Reject the comment if queue is full
                        }
                        
                        // Check spam protection
                        const username = viewerData.username || 'anonymous';
                        if (isUserInCooldown(username)) {
                            return;
                        }
                        
                        // Remove the leading period if present and required
                        const textToSanitize = streamerSettings.requirePeriod && commentText.startsWith('.') ? 
                            commentText.substring(1) : 
                            commentText;
                        
                        const sanitizedText = sanitizeComment(textToSanitize);
                        
                        // Check if comment is empty after sanitization
                        if (!sanitizedText || sanitizedText.trim().length === 0) {
                            return;
                        }
                        
                        // Update user comment timestamp to start cooldown
                        updateUserCommentTime(username);
                        
                        const comment = {
                            id: Date.now() + Math.random(), // Ensure uniqueness
                            text: sanitizedText,
                            username: username,
                            isFollower: viewerData.isFollower || false,
                            hasSentGift: viewerData.hasSentGift || false
                        };
                        
                        if (streamerSettings.manualModeration) {
                            // Send to moderation queue for manual approval
                            unmoderated.push(comment);
                            broadcastToModerators({ type: 'new_comment', comment });
                            // Notify streamers about moderation queue size change
                            broadcastToStreamers({ type: 'moderation_queue_update', queueSize: unmoderated.length });
                        } else {
                            // Send directly to TTS (bypass moderation)
                            // Check if TTS queue would be full after adding this comment
                            if (serverTTSQueue.length >= streamerSettings.maxQueueSize) {
                            } else {
                                // Send to TTS - the client will handle adding to server queue via tts_queue_update
                                broadcastToStreamers({ type: 'tts', comment: comment });
                            }
                        }
                    }
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
        if (currentTikTokConnection) {
            try {
                console.log(`Disconnecting from TikTok Live: @${connectedUsername}`);
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
    if (index === -1) {
        return res.status(404).json({ error: 'Comment not found' });
    }

    const approvedComment = unmoderated.splice(index, 1)[0];
    approved.push(approvedComment);

    // Check if TTS queue would be full after adding this comment
    if (serverTTSQueue.length >= streamerSettings.maxQueueSize) {
        // TTS queue is full, but still remove from moderation queue
        broadcastToModerators({ type: 'queue_update', queue: unmoderated });
        // Notify streamers about moderation queue size change
        broadcastToStreamers({ type: 'moderation_queue_update', queueSize: unmoderated.length });
        res.json({ message: 'Comment approved but TTS queue is full', comment: approvedComment, queueFull: true });
    } else {
        // Send to TTS - the client will handle adding to server queue via tts_queue_update
        broadcastToStreamers({ type: 'tts', comment: approvedComment });
        broadcastToModerators({ type: 'queue_update', queue: unmoderated });
        // Notify streamers about moderation queue size change
        broadcastToStreamers({ type: 'moderation_queue_update', queueSize: unmoderated.length });
        res.json({ message: 'Comment approved and added to TTS queue', comment: approvedComment });
    }
});

// Deny comment
app.post('/deny', (req, res) => {
    const { id } = req.body;
    const index = unmoderated.findIndex(c => c.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Comment not found' });
    }

    const deniedComment = unmoderated.splice(index, 1)[0];

    broadcastToModerators({ type: 'denied', comment: deniedComment });
    broadcastToModerators({ type: 'queue_update', queue: unmoderated });
    // Notify streamers about moderation queue size change
    broadcastToStreamers({ type: 'moderation_queue_update', queueSize: unmoderated.length });

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
        serverTTSQueue: serverTTSQueue,
        settings: streamerSettings,
        moderationClients: moderationClients.size,
        streamerClients: streamerClients.size,
        totalQueueSize: unmoderated.length + serverTTSQueue.length,
        queueSizeLimit: streamerSettings.maxQueueSize
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
    return
});
