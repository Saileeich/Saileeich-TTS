// Streamer TTS Dashboard
class StreamerTTSDashboard {
    constructor() {
        this.socket = null;
        this.ttsQueue = [];
        this.currentUtterance = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentIndex = 0;
        
        // TTS Settings
        this.volume = 0.8;
        this.rate = 1.0;
        this.selectedVoice = null;
        
        // Moderation Settings
        this.manualModerationEnabled = true;
        this.requirePeriod = true;
        this.commentCooldown = 5; // seconds
        this.maxQueueSize = 5; // maximum number of comments in queue
        this.moderatorCount = 0;
        this.moderationQueueSize = 0; // track moderation queue size
        
        // Elements
        this.elements = {};
        
        this.init();
    }

    init() {
        this.cacheElements();
        this.connectWebSocket();
        this.setupTTSControls();
        this.setupFilterControls();
        this.setupVoices();
        this.updateModerationStatusText();
        this.updatePeriodStatusText();
        this.updateFilterDescriptions();
        this.updateModeratorCounter();
        this.updateModerationCounter();
        this.updateUI();
    }

    cacheElements() {
        this.elements = {
            connectionStatus: document.getElementById('connection-status'),
            queueCount: document.getElementById('queue-count'),
            moderationCount: document.getElementById('moderation-count'),
            moderatorCount: document.getElementById('moderator-count'),
            playPauseBtn: document.getElementById('play-pause-btn'),
            skipBtn: document.getElementById('skip-btn'),
            clearQueueBtn: document.getElementById('clear-queue-btn'),
            volumeSlider: document.getElementById('volume-slider'),
            volumeDisplay: document.getElementById('volume-display'),
            speedSlider: document.getElementById('speed-slider'),
            speedDisplay: document.getElementById('speed-display'),
            voiceSelect: document.getElementById('voice-select'),
            currentComment: document.getElementById('current-comment'),
            queueList: document.getElementById('tts-queue-list'),
            emptyQueue: document.getElementById('empty-queue'),
            manualModerationToggle: document.getElementById('manual-moderation-toggle'),
            moderationStatusText: document.getElementById('moderation-status-text'),
            periodRequirementToggle: document.getElementById('period-requirement-toggle'),
            periodStatusText: document.getElementById('period-status-text'),
            cooldownInput: document.getElementById('cooldown-input'),
            maxQueueSizeInput: document.getElementById('max-queue-size-input')
        };
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        this.socket = new WebSocket(`${protocol}//${host}/ws`);

        this.socket.onopen = () => {
            this.elements.connectionStatus.textContent = 'Connected';
            this.elements.connectionStatus.className = 'status-indicator connected';
            
            // Send identification message
            this.socket.send(JSON.stringify({ type: 'client_type', clientType: 'streamer' }));
        };

        this.socket.onclose = () => {
            this.elements.connectionStatus.textContent = 'Disconnected';
            this.elements.connectionStatus.className = 'status-indicator disconnected';
            
            // Attempt to reconnect after 3 seconds
            setTimeout(() => {
                this.connectWebSocket();
            }, 3000);
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.elements.connectionStatus.textContent = 'Error';
            this.elements.connectionStatus.className = 'status-indicator disconnected';
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'tts':
                this.addToTTSQueue(data.comment);
                break;
            case 'settings_init':
            case 'settings_update':
                this.updateFilterSettings(data.settings);
                break;
            case 'moderator_count':
                this.moderatorCount = data.count;
                this.updateModeratorCounter();
                break;
            case 'moderation_queue_update':
                this.moderationQueueSize = data.queueSize || 0;
                this.updateModerationCounter();
                break;
        }
    }

    addToTTSQueue(comment) {
        // Check if queue is full before adding
        if (this.ttsQueue.length >= this.maxQueueSize) {
            return; // Don't add to queue if it's full
        }
        
        this.ttsQueue.push({
            id: comment.id || Date.now(),
            username: comment.username || 'anonymous',
            text: comment.text,
            timestamp: new Date()
        });

        // Notify server about queue addition
        this.notifyServerTTSQueueUpdate('add', comment);

        this.updateQueueDisplay();
        this.updateQueueCounter();

        // Auto-start if enabled and nothing is currently playing
        if (!this.isPlaying && !this.isPaused) {
            this.startQueue();
        }
    }

    setupTTSControls() {
        // Play/Pause button
        this.elements.playPauseBtn.addEventListener('click', () => {
            if (!this.isPlaying && !this.isPaused) {
                this.startQueue();
            } else if (this.isPlaying) {
                this.pauseQueue();
            } else if (this.isPaused) {
                this.resumeQueue();
            }
        });

        // Skip button
        this.elements.skipBtn.addEventListener('click', () => {
            this.skipCurrent();
        });

        // Clear queue button
        this.elements.clearQueueBtn.addEventListener('click', () => {
            this.clearQueue();
        });

        // Volume control
        this.elements.volumeSlider.addEventListener('input', (e) => {
            this.volume = parseFloat(e.target.value);
            this.elements.volumeDisplay.textContent = `${Math.round(this.volume * 100)}%`;
            if (this.currentUtterance) {
                this.currentUtterance.volume = this.volume;
            }
        });

        // Speed control
        this.elements.speedSlider.addEventListener('input', (e) => {
            this.rate = parseFloat(e.target.value);
            this.elements.speedDisplay.textContent = `${this.rate}x`;
            if (this.currentUtterance) {
                this.currentUtterance.rate = this.rate;
            }
        });

        // Voice selection
        this.elements.voiceSelect.addEventListener('change', (e) => {
            const voices = speechSynthesis.getVoices();
            this.selectedVoice = voices.find(voice => voice.name === e.target.value) || null;
        });
    }

    setupFilterControls() {
        // Manual moderation toggle
        this.elements.manualModerationToggle.addEventListener('change', (e) => {
            this.manualModerationEnabled = e.target.checked;
            this.updateModerationSettings();
        });
        
        // Period requirement toggle
        this.elements.periodRequirementToggle.addEventListener('change', (e) => {
            this.requirePeriod = e.target.checked;
            this.updatePeriodSettings();
        });
        
        // Comment cooldown input
        this.elements.cooldownInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            if (!isNaN(value) && value >= 1 && value <= 300) {
                this.commentCooldown = value;
                this.updateCooldownSettings();
            }
        });
        
        // Also handle when user finishes editing (blur event)
        this.elements.cooldownInput.addEventListener('blur', (e) => {
            const value = parseInt(e.target.value);
            if (isNaN(value) || value < 1 || value > 300) {
                // Reset to current valid value if invalid
                e.target.value = this.commentCooldown;
            }
        });
        
        // Max queue size input
        this.elements.maxQueueSizeInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            if (!isNaN(value) && value >= 1 && value <= 100) {
                this.maxQueueSize = value;
                this.updateMaxQueueSizeSettings();
            }
        });
        
        // Also handle when user finishes editing (blur event)
        this.elements.maxQueueSizeInput.addEventListener('blur', (e) => {
            const value = parseInt(e.target.value);
            if (isNaN(value) || value < 1 || value > 100) {
                // Reset to current valid value if invalid
                e.target.value = this.maxQueueSize;
            }
        });
        
        // Filter radio buttons
        const filterRadios = document.querySelectorAll('input[name="comment-filter"]');
        filterRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.updateFilter(e.target.value);
                }
            });
        });
    }

    updateFilter(filterValue) {
        // Send filter update to server
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'update_settings',
                settings: { 
                    filter: filterValue,
                    manualModeration: this.manualModerationEnabled,
                    requirePeriod: this.requirePeriod,
                    commentCooldown: this.commentCooldown,
                    maxQueueSize: this.maxQueueSize
                }
            }));
        }
    }

    updateModerationSettings() {
        // Send moderation update to server
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const currentFilter = document.querySelector('input[name="comment-filter"]:checked')?.value || 'everybody';
            this.socket.send(JSON.stringify({
                type: 'update_settings',
                settings: { 
                    filter: currentFilter,
                    manualModeration: this.manualModerationEnabled,
                    requirePeriod: this.requirePeriod,
                    commentCooldown: this.commentCooldown,
                    maxQueueSize: this.maxQueueSize
                }
            }));
        }

        // Update moderation status text
        this.updateModerationStatusText();
        
        // Update filter descriptions
        this.updateFilterDescriptions();
    }

    updateFilterSettings(settings) {
        // Update radio button selection
        const filterRadio = document.querySelector(`input[value="${settings.filter}"]`);
        if (filterRadio) {
            filterRadio.checked = true;
        }

        // Update manual moderation toggle if provided
        if (settings.manualModeration !== undefined) {
            this.manualModerationEnabled = settings.manualModeration;
            this.elements.manualModerationToggle.checked = settings.manualModeration;
            this.updateModerationStatusText();
        }

        // Update period requirement toggle if provided
        if (settings.requirePeriod !== undefined) {
            this.requirePeriod = settings.requirePeriod;
            this.elements.periodRequirementToggle.checked = settings.requirePeriod;
            this.updatePeriodStatusText();
        }

        // Update comment cooldown if provided and different from current input value
        if (settings.commentCooldown !== undefined) {
            this.commentCooldown = settings.commentCooldown;
            // Only update input if it's not currently focused and the value is different
            if (document.activeElement !== this.elements.cooldownInput && 
                parseInt(this.elements.cooldownInput.value) !== settings.commentCooldown) {
                this.elements.cooldownInput.value = settings.commentCooldown;
            }
        }

        // Update max queue size if provided and different from current input value
        if (settings.maxQueueSize !== undefined) {
            this.maxQueueSize = settings.maxQueueSize;
            // Only update input if it's not currently focused and the value is different
            if (document.activeElement !== this.elements.maxQueueSizeInput && 
                parseInt(this.elements.maxQueueSizeInput.value) !== settings.maxQueueSize) {
                this.elements.maxQueueSizeInput.value = settings.maxQueueSize;
            }
        }

        // Update status text
        this.updateFilterDescriptions();
    }

    updateModerationStatusText() {
        const statusText = this.manualModerationEnabled 
            ? 'Comments require moderator approval'
            : 'Comments go directly to TTS after filtering';
        this.elements.moderationStatusText.textContent = statusText;
    }

    updateFilterDescriptions() {
        const descriptions = document.querySelectorAll('.filter-desc');
        const moderationText = this.manualModerationEnabled ? 'go to moderation' : 'go directly to TTS';
        
        descriptions.forEach((desc, index) => {
            switch (index) {
                case 0: // Everybody
                    desc.textContent = `All comments ${moderationText}`;
                    break;
                case 1: // Followers
                    desc.textContent = `Only followers' comments ${moderationText}`;
                    break;
                case 2: // Gifters
                    desc.textContent = `Only gifters' comments ${moderationText}`;
                    break;
            }
        });
    }

    updatePeriodSettings() {
        // Send period update to server
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const currentFilter = document.querySelector('input[name="comment-filter"]:checked')?.value || 'everybody';
            this.socket.send(JSON.stringify({
                type: 'update_settings',
                settings: { 
                    filter: currentFilter,
                    manualModeration: this.manualModerationEnabled,
                    requirePeriod: this.requirePeriod,
                    commentCooldown: this.commentCooldown,
                    maxQueueSize: this.maxQueueSize
                }
            }));
        }

        // Update period status text
        this.updatePeriodStatusText();
    }

    updateCooldownSettings() {
        // Send cooldown update to server
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const currentFilter = document.querySelector('input[name="comment-filter"]:checked')?.value || 'everybody';
            this.socket.send(JSON.stringify({
                type: 'update_settings',
                settings: { 
                    filter: currentFilter,
                    manualModeration: this.manualModerationEnabled,
                    requirePeriod: this.requirePeriod,
                    commentCooldown: this.commentCooldown,
                    maxQueueSize: this.maxQueueSize
                }
            }));
        }
    }

    updateMaxQueueSizeSettings() {
        // Send max queue size update to server
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const currentFilter = document.querySelector('input[name="comment-filter"]:checked')?.value || 'everybody';
            this.socket.send(JSON.stringify({
                type: 'update_settings',
                settings: { 
                    filter: currentFilter,
                    manualModeration: this.manualModerationEnabled,
                    requirePeriod: this.requirePeriod,
                    commentCooldown: this.commentCooldown,
                    maxQueueSize: this.maxQueueSize
                }
            }));
        }
    }

    notifyServerTTSQueueUpdate(action, comment = null, commentId = null) {
        // Send TTS queue update to server for tracking
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const updateData = {
                type: 'tts_queue_update',
                action: action // 'add', 'remove', 'clear'
            };
            
            if (comment) {
                updateData.comment = comment;
            }
            if (commentId) {
                updateData.commentId = commentId;
            }
            
            this.socket.send(JSON.stringify(updateData));
        }
    }

    updatePeriodStatusText() {
        const statusText = this.requirePeriod 
            ? 'Comments must start with "."'
            : 'All comments are accepted';
        this.elements.periodStatusText.textContent = statusText;
    }

    setupVoices() {
        const loadVoices = () => {
            const voices = speechSynthesis.getVoices();
            this.elements.voiceSelect.innerHTML = '<option value="">Default Voice</option>';

            voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.name;
                option.textContent = `${voice.name} (${voice.lang})`;
                this.elements.voiceSelect.appendChild(option);
            });

            this.selectedVoice = voices[0];
            this.elements.voiceSelect.value = voices[0].name;
        };

        if (speechSynthesis.getVoices().length > 0) {
            loadVoices();
        } else {
            speechSynthesis.addEventListener('voiceschanged', loadVoices);
        }
    }

    startQueue() {
        if (this.ttsQueue.length === 0) return;
        
        this.isPlaying = true;
        this.isPaused = false;
        this.playNextInQueue();
        this.updateUI();
    }

    pauseQueue() {
        this.isPaused = true;
        this.isPlaying = false;
        
        if (this.currentUtterance) {
            speechSynthesis.pause();
        }
        
        this.updateUI();
    }

    resumeQueue() {
        this.isPaused = false;
        this.isPlaying = true;
        
        speechSynthesis.resume();
        this.updateUI();
    }

    stopQueue() {
        this.isPlaying = false;
        this.isPaused = false;
        speechSynthesis.cancel();
        this.currentUtterance = null;
        this.updateCurrentDisplay();
        this.updateUI();
    }

    skipCurrent() {
        if (this.currentUtterance) {
            speechSynthesis.cancel();
            // The onend event will handle playing the next item
        }
    }

    clearQueue() {
        this.stopQueue();
        this.ttsQueue = [];
        this.currentIndex = 0;
        
        // Notify server about queue clear
        this.notifyServerTTSQueueUpdate('clear');
        
        this.updateQueueDisplay();
        this.updateQueueCounter();
    }

    playNextInQueue() {
        if (this.currentIndex >= this.ttsQueue.length) {
            // Queue finished
            this.isPlaying = false;
            this.isPaused = false;
            this.currentIndex = 0;
            this.updateCurrentDisplay();
            this.updateUI();
            return;
        }

        const comment = this.ttsQueue[this.currentIndex];
        this.speakComment(comment);
    }

    speakComment(comment) {
        // Update current display
        this.updateCurrentDisplay(comment);
        
        // Update queue display to show which item is playing
        this.updateQueueDisplay();

        // Create speech synthesis utterance
        const utterance = new SpeechSynthesisUtterance(comment.text);
        utterance.volume = this.volume;
        utterance.rate = this.rate;
        utterance.pitch = 1.0;

        if (this.selectedVoice) {
            utterance.voice = this.selectedVoice;
        }

        utterance.onend = () => {
            this.currentUtterance = null;
            
            // Get the comment that was just completed before removing it
            const completedComment = this.ttsQueue[this.currentIndex];
            
            // Remove completed comment from queue
            this.ttsQueue.splice(this.currentIndex, 1);
            
            // Notify server about queue removal
            if (completedComment) {
                this.notifyServerTTSQueueUpdate('remove', null, completedComment.id);
            }
            
            this.updateQueueCounter();
            this.updateQueueDisplay();
            
            // Continue with next comment if auto-play is enabled
            if (this.isPlaying) {
                // Don't increment index since we removed the item
                setTimeout(() => {
                    this.playNextInQueue();
                }, 500); // Small delay between comments
            } else {
                this.stopQueue();
            }
        };

        utterance.onerror = (error) => {
            console.error('TTS error:', error);
            this.currentUtterance = null;
            
            // Skip to next comment on error
            if (this.isPlaying) {
                // Get the comment that errored before removing it
                const erroredComment = this.ttsQueue[this.currentIndex];
                
                this.ttsQueue.splice(this.currentIndex, 1);
                
                // Notify server about queue removal
                if (erroredComment) {
                    this.notifyServerTTSQueueUpdate('remove', null, erroredComment.id);
                }
                
                this.updateQueueCounter();
                this.updateQueueDisplay();
                setTimeout(() => {
                    this.playNextInQueue();
                }, 500);
            } else {
                this.stopQueue();
            }
        };

        this.currentUtterance = utterance;
        speechSynthesis.speak(utterance);
    }

    updateCurrentDisplay(comment = null) {
        const usernameEl = this.elements.currentComment.querySelector('.comment-username');
        const textEl = this.elements.currentComment.querySelector('.comment-text');
        
        if (comment) {
            usernameEl.textContent = `@${comment.username}`;
            textEl.textContent = comment.text;
        } else {
            usernameEl.textContent = '@nobody';
            textEl.textContent = 'Nothing is currently being spoken';
        }
    }

    updateQueueDisplay() {
        const queueList = this.elements.queueList;
        const emptyQueue = this.elements.emptyQueue;
        
        queueList.innerHTML = '';
        
        if (this.ttsQueue.length === 0) {
            emptyQueue.style.display = 'block';
            return;
        }
        
        emptyQueue.style.display = 'none';
        
        this.ttsQueue.forEach((comment, index) => {
            const li = document.createElement('li');
            li.className = 'queue-item';
            li.id = `queue-item-${comment.id}`;
            
            if (index === this.currentIndex && this.isPlaying) {
                li.classList.add('playing');
            }

            li.innerHTML = `
                <div class="queue-item-content">
                    <div class="queue-item-username">@${comment.username}</div>
                    <div class="queue-item-text">${comment.text}</div>
                </div>
            `;
            
            queueList.appendChild(li);
        });
    }

    removeFromQueue(index) {
        if (index === this.currentIndex && this.isPlaying) {
            this.skipCurrent();
        } else {
            // Get the comment that will be removed
            const removedComment = this.ttsQueue[index];
            
            this.ttsQueue.splice(index, 1);
            
            // Notify server about queue removal
            if (removedComment) {
                this.notifyServerTTSQueueUpdate('remove', null, removedComment.id);
            }
            
            if (index < this.currentIndex) {
                this.currentIndex--;
            }
            this.updateQueueDisplay();
            this.updateQueueCounter();
        }
    }

    updateQueueCounter() {
        const ttsQueueSize = this.ttsQueue.length;
        const totalQueueSize = ttsQueueSize + this.moderationQueueSize;
        const maxSize = this.maxQueueSize;
        
        this.elements.queueCount.textContent = `Total Queue: ${totalQueueSize}/${maxSize}`;
        
        // Add visual warning when total queue is getting full
        if (totalQueueSize >= maxSize) {
            this.elements.queueCount.classList.add('queue-full');
            this.elements.queueCount.classList.remove('queue-warning');
        } else if (totalQueueSize >= maxSize * 0.8) {
            this.elements.queueCount.classList.add('queue-warning');
            this.elements.queueCount.classList.remove('queue-full');
        } else {
            this.elements.queueCount.classList.remove('queue-warning', 'queue-full');
        }
    }

    updateModerationCounter() {
        this.elements.moderationCount.textContent = `Moderation: ${this.moderationQueueSize}`;
        
        // Add visual indicator when there are pending comments
        if (this.moderationQueueSize > 0) {
            this.elements.moderationCount.classList.add('has-pending');
        } else {
            this.elements.moderationCount.classList.remove('has-pending');
        }
        
        // Update the total queue counter since moderation queue size changed
        this.updateQueueCounter();
    }

    updateModeratorCounter() {
        this.elements.moderatorCount.textContent = `Moderators: ${this.moderatorCount}`;
        
        // Update visual state based on moderator count
        if (this.moderatorCount === 0) {
            this.elements.moderatorCount.classList.add('no-moderators');
        } else {
            this.elements.moderatorCount.classList.remove('no-moderators');
        }
    }

    updateUI() {
        const hasQueue = this.ttsQueue.length > 0;
        
        // Update play/pause button
        if (!this.isPlaying && !this.isPaused) {
            this.elements.playPauseBtn.textContent = 'Start Queue';
            this.elements.playPauseBtn.disabled = !hasQueue;
        } else if (this.isPlaying) {
            this.elements.playPauseBtn.textContent = 'Pause Queue';
            this.elements.playPauseBtn.disabled = false;
        } else if (this.isPaused) {
            this.elements.playPauseBtn.textContent = 'Resume Queue';
            this.elements.playPauseBtn.disabled = false;
        }
        
        // Update skip button
        this.elements.skipBtn.disabled = !this.isPlaying;
    }
}

// Check if Web Speech API is supported
if ('speechSynthesis' in window) {
    // Initialize the streamer TTS dashboard when the page loads
    let streamerTTS;
    document.addEventListener('DOMContentLoaded', () => {
        streamerTTS = new StreamerTTSDashboard();
        // Make it globally accessible for queue item actions
        window.streamerTTS = streamerTTS;
    });
} else {
    alert('Your browser does not support Text-to-Speech. Please use a modern browser like Chrome, Firefox, or Edge.');
}
