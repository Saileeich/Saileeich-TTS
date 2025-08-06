class ModerationInterface {
    constructor() {
        this.socket = null;
        this.init();
    }

    init() {
        this.connectWebSocket();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        this.socket = new WebSocket(`${protocol}//${host}/ws?path=moderation`);

        const statusElement = document.getElementById('status');

        this.socket.onopen = () => {
            console.log('Connected to moderation WebSocket');
            statusElement.textContent = 'Connected';
            statusElement.className = 'connected';
            
            // Send identification message
            this.socket.send(JSON.stringify({ type: 'client_type', clientType: 'moderation' }));
        };

        this.socket.onclose = () => {
            console.log('Disconnected from moderation WebSocket');
            statusElement.textContent = 'Disconnected';
            statusElement.className = 'disconnected';
            
            // Attempt to reconnect after 3 seconds
            setTimeout(() => {
                this.connectWebSocket();
            }, 3000);
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            statusElement.textContent = 'Connection Error';
            statusElement.className = 'disconnected';
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'queue_init':
            case 'queue_update':
                this.renderQueue(data.queue);
                break;
            case 'new_comment':
                this.addCommentToQueue(data.comment);
                break;
            case 'approved':
            case 'denied':
                this.removeCommentFromQueue(data.comment.id);
                break;
        }
    }

    renderQueue(queue) {
        const queueElement = document.getElementById('queue');
        const noCommentsElement = document.getElementById('no-comments');
        
        queueElement.innerHTML = '';
        
        if (queue.length === 0) {
            noCommentsElement.style.display = 'block';
        } else {
            noCommentsElement.style.display = 'none';
            queue.forEach(comment => this.createCommentElement(comment));
        }
    }

    addCommentToQueue(comment) {
        const noCommentsElement = document.getElementById('no-comments');
        noCommentsElement.style.display = 'none';
        this.createCommentElement(comment);
    }

    createCommentElement(comment) {
        const queueElement = document.getElementById('queue');
        const li = document.createElement('li');
        li.className = 'comment-item';
        li.id = `comment-${comment.id}`;

        // Add special styling for followers and gifters
        if (comment.isFollower) {
            li.classList.add('follower');
        }
        if (comment.hasSentGift) {
            li.classList.add('gifter');
        }

        const username = document.createElement('div');
        username.className = 'username';
        if (comment.isFollower) username.classList.add('follower');
        if (comment.hasSentGift) username.classList.add('gifter');
        username.textContent = `@${comment.username || 'anonymous'}`;

        const commentText = document.createElement('p');
        commentText.className = 'comment-text';
        commentText.textContent = comment.text;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'approve-btn';
        approveBtn.textContent = 'Approve';
        approveBtn.onclick = () => this.approveComment(comment.id);

        const denyBtn = document.createElement('button');
        denyBtn.className = 'deny-btn';
        denyBtn.textContent = 'Deny';
        denyBtn.onclick = () => this.denyComment(comment.id);

        buttonContainer.appendChild(approveBtn);
        buttonContainer.appendChild(denyBtn);
        li.appendChild(username);
        li.appendChild(commentText);
        li.appendChild(buttonContainer);
        
        queueElement.appendChild(li);
    }

    removeCommentFromQueue(commentId) {
        const element = document.getElementById(`comment-${commentId}`);
        if (element) {
            element.remove();
        }
        
        // Show "no comments" message if queue is empty
        const queueElement = document.getElementById('queue');
        const noCommentsElement = document.getElementById('no-comments');
        if (queueElement.children.length === 0) {
            noCommentsElement.style.display = 'block';
        }
    }

    async approveComment(commentId) {
        try {
            const response = await fetch('/approve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id: commentId })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Comment approved:', result);
        } catch (error) {
            console.error('Error approving comment:', error);
            alert('Failed to approve comment. Please try again.');
        }
    }

    async denyComment(commentId) {
        try {
            const response = await fetch('/deny', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id: commentId })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Comment denied:', result);
        } catch (error) {
            console.error('Error denying comment:', error);
            alert('Failed to deny comment. Please try again.');
        }
    }
}

// Initialize the moderation interface when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ModerationInterface();
});
