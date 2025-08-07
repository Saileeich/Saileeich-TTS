const { TikTokLiveConnection } = require('tiktok-live-connector');

const gifters = new Set();

function startTikTokLive(username, sessionId, onComment) {
    // Handle backward compatibility - if sessionId is a function, it's the old callback parameter
    if (typeof sessionId === 'function') {
        onComment = sessionId;
        sessionId = undefined;
    }
    
    // Create connection options
    const connectionOptions = { };
    
    // Add session ID if provided
    if (sessionId && sessionId.trim()) {
        connectionOptions.sessionId = sessionId.trim();
        console.log(`Using session ID for improved connection reliability`);
    }
    
    const connection = new TikTokLiveConnection(username, connectionOptions);

    connection.connect().then(() => {
        console.log(`Connected to ${username}'s TikTok Live`);
    }).catch(err => {
        console.error('Failed to connect:', err);
        throw err; // Re-throw so caller can handle
    });

    connection.on('chat', (msg) => {
        const user = msg.user || {};
        const followInfo = user.followInfo || {};

        const viewerData = {
            username: user.uniqueId || '(unknown)',
            nickname: user.nickname || '',
            comment: msg.comment || '',
            isFollower: followInfo.following === true,
            hasSentGift: gifters.has(user.uniqueId)
        };

        onComment(viewerData);
    });

    connection.on('gift', (msg) => {
        const user = msg.user || {};
        if (user.uniqueId) {
            gifters.add(user.uniqueId);
            console.log(`${user.uniqueId} sent a gift`);
        }
    });

    connection.on('disconnected', () => {
        console.warn('Disconnected from TikTok Live');
    });

    connection.on('error', (err) => {
        console.error('TikTok Live error:', err);
    });

    // Return the connection object so it can be managed
    return connection;
}

module.exports = startTikTokLive;
