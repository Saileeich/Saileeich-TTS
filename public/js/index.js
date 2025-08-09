const socket = io();

let isConnected = false;
let connectedUsername = null;

function startLive() {
    const username = document.getElementById('username').value.trim();
    const sessionId = document.getElementById('sessionId').value.trim();
    
    if (username) {
        const connectionData = { username };
        if (sessionId) {
            connectionData.sessionId = sessionId;
        }
        socket.emit('start-live', connectionData);
        log(`Connecting to @${username}...`);
    }
}

function disconnectLive() {
    socket.emit('disconnect-live');
    log(`Disconnecting from live...`);
}

function updateConnectionStatus(status) {
    isConnected = status.isConnected;
    connectedUsername = status.username;
    
    const statusElement = document.getElementById('statusText');
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const usernameInput = document.getElementById('username');
    const sessionIdInput = document.getElementById('sessionId');
    
    if (isConnected) {
        statusElement.textContent = `Connected to @${connectedUsername}`;
        statusElement.className = 'connected';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'inline-block';
        usernameInput.disabled = true;
        sessionIdInput.disabled = true;
        usernameInput.value = connectedUsername;
    } else {
        statusElement.textContent = 'Not connected';
        statusElement.className = 'disconnected';
        connectBtn.style.display = 'inline-block';
        disconnectBtn.style.display = 'none';
        usernameInput.disabled = false;
        sessionIdInput.disabled = false;
        usernameInput.value = '';
    }
}

function log(message) {
    const logDiv = document.getElementById('log');
    const div = document.createElement('div');
    div.textContent = new Date().toLocaleTimeString() + ' - ' + message;
    logDiv.prepend(div);
}

// Socket event handlers
socket.on('viewer-data', (data) => {
    const { username, comment, isFollower, hasSentGift } = data;
    log(`@${username}: ${comment} | Follower: ${isFollower} | Gifted: ${hasSentGift}`);
});

socket.on('connection-status', (status) => {
    updateConnectionStatus(status);
    if (status.isConnected) {
        log(`Successfully connected to @${status.username}`);
    } else {
        log(`Disconnected from live`);
    }
});

socket.on('connection-error', (error) => {
    log(`Error: ${error.error}`);
});

// Request current connection status when page loads
socket.on('connect', () => {
    socket.emit('get-connection-status');
});
