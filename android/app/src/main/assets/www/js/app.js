/**
 * JamStream - Main Application Controller
 * Handles UI flows, room lifecycle, inputs, visualizer, audio stream routing
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Core Subsystems
  const audioManager = new AudioManager();
  const webrtcRoom = new WebRtcRoom(audioManager);

  // DOM Elements
  const viewLanding = document.getElementById('viewLanding');
  const viewRoom = document.getElementById('viewRoom');

  // Landing Elements
  const btnCreateRoom = document.getElementById('btnCreateRoom');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const inputDigits = [
    document.getElementById('digit1'),
    document.getElementById('digit2'),
    document.getElementById('digit3'),
    document.getElementById('digit4')
  ];
  const listenerNameInput = document.getElementById('listenerName');

  // Active Room Header Elements
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const btnCopyCode = document.getElementById('btnCopyCode');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnShowQr = document.getElementById('btnShowQr');
  const btnLeaveRoom = document.getElementById('btnLeaveRoom');
  const liveIndicator = document.getElementById('liveIndicator');
  const roleBadge = document.getElementById('roleBadge');
  const peerCountBadge = document.getElementById('peerCountBadge');

  // Audio Stage Elements
  const canvasElement = document.getElementById('audioVisualizer');
  const visualizerIdle = document.getElementById('visualizerIdle');
  const audioSourceBadge = document.getElementById('audioSourceBadge');
  const vTagSource = document.getElementById('vTagSource');
  const vTagBitrate = document.getElementById('vTagBitrate');
  const remoteAudioEl = document.getElementById('remoteAudio');

  // Controls Elements
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeReadout = document.getElementById('volumeReadout');
  const btnToggleMute = document.getElementById('btnToggleMute');
  const btnChangeSource = document.getElementById('btnChangeSource');
  const selectQuality = document.getElementById('selectQuality');
  const btnVisualizerMode = document.getElementById('btnVisualizerMode');
  const hostControlGroup = document.getElementById('hostControlGroup');
  const audioUnlockNotice = document.getElementById('audioUnlockNotice');
  const btnUnlockAudio = document.getElementById('btnUnlockAudio');

  // Panels & Diagnostics
  const peerListEl = document.getElementById('peerList');
  const statLatency = document.getElementById('statLatency');
  const statBitrate = document.getElementById('statBitrate');
  const statLoss = document.getElementById('statLoss');
  const statChannels = document.getElementById('statChannels');

  // Modals & Popups
  const modalSourceSelect = document.getElementById('modalSourceSelect');
  const btnCloseSourceModal = document.getElementById('btnCloseSourceModal');
  const optShareApp = document.getElementById('optShareApp');
  const optDemoSynth = document.getElementById('optDemoSynth');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  const modalQr = document.getElementById('modalQr');
  const btnCloseQrModal = document.getElementById('btnCloseQrModal');
  const qrContainer = document.getElementById('qrContainer');
  const toastContainer = document.getElementById('toastContainer');

  // Initialize Visualizer
  const visualizer = new AudioVisualizer(canvasElement);

  // State
  let isMuted = false;
  let previousVolume = 1.0;
  let isHostRole = false;

  // =========================================================================
  // TOAST NOTIFICATIONS
  // =========================================================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // 4-DIGIT CODE INPUT HANDLING
  // =========================================================================
  inputDigits.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.toUpperCase();
      e.target.value = val;

      if (val.length === 1 && index < 3) {
        inputDigits[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputDigits[index - 1].focus();
      }
      if (e.key === 'Enter') {
        btnJoinRoom.click();
      }
    });

    // Paste handling: e.g. user pastes "8K2P" into any box
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase();
      if (!text) return;
      const cleanChars = text.replace(/[^A-Z0-9]/g, '').slice(0, 4);
      for (let i = 0; i < 4; i++) {
        if (cleanChars[i]) {
          inputDigits[i].value = cleanChars[i];
        }
      }
      if (cleanChars.length >= 4) {
        inputDigits[3].focus();
      }
    });
  });

  function getEnteredCode() {
    return inputDigits.map(i => i.value.trim().toUpperCase()).join('');
  }

  function setEnteredCode(codeStr) {
    const chars = codeStr.toUpperCase().slice(0, 4);
    for (let i = 0; i < 4; i++) {
      inputDigits[i].value = chars[i] || '';
    }
  }

  // Check URL query param for instant room invite: ?room=XXXX
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam && roomParam.length === 4) {
    setEnteredCode(roomParam);
    showToast(`Room code ${roomParam.toUpperCase()} detected from link`, 'info');
  }

  // =========================================================================
  // ROOM CREATION & JOINING
  // =========================================================================
  btnCreateRoom.addEventListener('click', async () => {
    btnCreateRoom.disabled = true;
    btnCreateRoom.innerText = 'Creating Room...';

    try {
      await webrtcRoom.createRoom();
    } catch (err) {
      showToast('Could not connect to signaling server. Is the server running?', 'error');
      btnCreateRoom.disabled = false;
      btnCreateRoom.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Create Jam Room`;
    }
  });

  btnJoinRoom.addEventListener('click', async () => {
    const code = getEnteredCode();
    if (code.length < 4) {
      showToast('Please enter all 4 characters of the room code.', 'error');
      const firstEmpty = inputDigits.find(i => !i.value.trim());
      if (firstEmpty) firstEmpty.focus();
      return;
    }

    const name = listenerNameInput.value.trim() || 'Listener';
    btnJoinRoom.disabled = true;
    btnJoinRoom.innerText = 'Connecting...';

    try {
      await webrtcRoom.joinRoom(code, name);
    } catch (err) {
      showToast('Connection failed. Please check the room code.', 'error');
      btnJoinRoom.disabled = false;
      btnJoinRoom.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Connect & Listen`;
    }
  });

  // =========================================================================
  // WEBRTC EVENT LISTENERS
  // =========================================================================
  webrtcRoom.onRoomCreated = (code, peerId) => {
    isHostRole = true;
    switchToRoomView(code, true);
    showToast(`Room created! Code: ${code}`, 'success');

    // Prompt host to pick music audio source immediately
    openSourceModal();
  };

  webrtcRoom.onRoomJoined = (code, peerId, count) => {
    isHostRole = false;
    switchToRoomView(code, false);
    showToast(`Connected to room ${code}! Waiting for music...`, 'success');
  };

  webrtcRoom.onRemoteStream = async (stream) => {
    showToast('Receiving pure music stream from host!', 'success');
    const result = await audioManager.attachRemoteAudioStream(stream, remoteAudioEl);
    
    // Attach visualizer
    if (audioManager.analyserNode) {
      visualizer.attachAnalyser(audioManager.analyserNode);
      visualizerIdle.classList.add('hidden');
    }

    audioSourceBadge.innerText = 'Live Studio Stream';
    vTagSource.innerText = 'Source: Remote Music App';
    liveIndicator.classList.add('active');

    if (result && result.needsUserGesture) {
      audioUnlockNotice.classList.remove('hidden');
    }
  };

  webrtcRoom.onPeerListChanged = (peerList) => {
    renderPeerList(peerList);
  };

  webrtcRoom.onError = (message) => {
    showToast(message, 'error');
    btnJoinRoom.disabled = false;
    btnJoinRoom.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Connect & Listen`;
  };

  webrtcRoom.onStatsUpdate = (stats) => {
    if (stats.rtt !== undefined) {
      statLatency.innerText = `${stats.rtt} ms`;
      statLatency.className = stats.rtt < 80 ? 'stat-value good' : 'stat-value';
    }
    if (stats.bitrate !== undefined && stats.bitrate > 0) {
      statBitrate.innerText = `${stats.bitrate} kbps`;
      vTagBitrate.innerText = `Opus: ${stats.bitrate} kbps`;
    }
    if (stats.packetsLost !== undefined) {
      statLoss.innerText = `${stats.packetsLost}`;
    }
  };

  webrtcRoom.onHostDisconnected = (msg) => {
    showToast(msg || 'Host has ended the jam session.', 'error');
    setTimeout(() => {
      leaveCurrentRoom();
    }, 1500);
  };

  // =========================================================================
  // VIEW SWITCHING
  // =========================================================================
  function switchToRoomView(code, isHost) {
    viewLanding.classList.add('hidden');
    viewRoom.classList.remove('hidden');

    roomCodeDisplay.innerText = code;
    roleBadge.innerText = isHost ? 'HOST' : 'LISTENER';
    roleBadge.className = isHost ? 'peer-tag host' : 'peer-tag';

    if (isHost) {
      hostControlGroup.classList.remove('hidden');
      renderPeerList([]);
    } else {
      hostControlGroup.classList.add('hidden');
      renderPeerList([{ name: 'Host Streamer', id: 'host', state: 'connected' }]);
    }

    // Update URL query string without reloading page (only on http/https)
    if (window.location.protocol !== 'file:') {
      const newUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
      window.history.pushState({ path: newUrl }, '', newUrl);
    }

    // Initial canvas sizing
    visualizer.handleResize();
  }

  function leaveCurrentRoom() {
    webrtcRoom.cleanup();
    audioManager.cleanupSource();
    visualizer.detach();

    viewRoom.classList.add('hidden');
    viewLanding.classList.remove('hidden');

    // Reset buttons
    btnCreateRoom.disabled = false;
    btnCreateRoom.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Create Jam Room`;
    btnJoinRoom.disabled = false;
    btnJoinRoom.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Connect & Listen`;

    audioSourceBadge.innerText = 'No Source Active';
    visualizerIdle.classList.remove('hidden');
    liveIndicator.classList.remove('active');
    audioUnlockNotice.classList.add('hidden');

    // Remove room param from URL (only on http/https)
    if (window.location.protocol !== 'file:') {
      window.history.pushState({}, '', window.location.pathname);
    }
    showToast('Left jam room', 'info');
  }

  btnLeaveRoom.addEventListener('click', leaveCurrentRoom);

  // =========================================================================
  // AUDIO SOURCE SELECTION (FOR HOST)
  // =========================================================================
  function openSourceModal() {
    modalSourceSelect.classList.add('active');
  }

  function closeSourceModal() {
    modalSourceSelect.classList.remove('active');
  }

  btnChangeSource.addEventListener('click', openSourceModal);
  btnCloseSourceModal.addEventListener('click', closeSourceModal);

  // OPTION 1: Stream from Music App / Chrome Tab
  optShareApp.addEventListener('click', async () => {
    closeSourceModal();
    try {
      showToast('Select your Music App tab/window and ensure "Share audio" is checked', 'info');
      const result = await audioManager.captureAppAudio();

      // Broadcast audio track to all listeners
      webrtcRoom.broadcastAudioTrack(result.stream);

      // Attach visualizer
      visualizer.attachAnalyser(audioManager.analyserNode);
      visualizerIdle.classList.add('hidden');
      liveIndicator.classList.add('active');

      audioSourceBadge.innerText = 'App Audio Streaming';
      vTagSource.innerText = `Source: ${result.trackLabel}`;
      showToast(`Streaming pure sound from: ${result.trackLabel}`, 'success');

      audioManager.onSourceEnded = () => {
        showToast('App audio sharing stopped.', 'info');
        audioSourceBadge.innerText = 'Audio Paused';
        visualizerIdle.classList.remove('hidden');
        liveIndicator.classList.remove('active');
      };
    } catch (err) {
      if (err.message === 'NO_AUDIO_SHARED') {
        showToast('No audio detected! Make sure you checked "Also share audio" in the browser sharing popup.', 'error');
      } else if (err.message !== 'USER_CANCELLED') {
        showToast(`Could not capture audio: ${err.message}`, 'error');
      }
    }
  });

  // OPTION 2: Local Audio File
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleAudioFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleAudioFile(e.target.files[0]);
    }
  });

  async function handleAudioFile(file) {
    closeSourceModal();
    try {
      showToast(`Loading high-res audio: ${file.name}...`, 'info');
      const result = await audioManager.playLocalAudioFile(file);

      // Broadcast to listeners
      webrtcRoom.broadcastAudioTrack(result.stream);

      // Attach visualizer
      visualizer.attachAnalyser(audioManager.analyserNode);
      visualizerIdle.classList.add('hidden');
      liveIndicator.classList.add('active');

      audioSourceBadge.innerText = 'High-Res File Playing';
      vTagSource.innerText = `File: ${result.fileName}`;
      showToast(`Playing and broadcasting: ${result.fileName}`, 'success');
    } catch (err) {
      showToast(`Failed to play audio file: ${err.message}`, 'error');
    }
  }

  // OPTION 3: Studio Synth Demo Track
  if (optDemoSynth) {
    optDemoSynth.addEventListener('click', async () => {
      closeSourceModal();
      try {
        showToast('Starting Studio Melodic Demo Synth...', 'info');
        const result = await audioManager.playBuiltinDemoTrack();

        webrtcRoom.broadcastAudioTrack(result.stream);
        visualizer.attachAnalyser(audioManager.analyserNode);
        visualizerIdle.classList.add('hidden');
        liveIndicator.classList.add('active');

        audioSourceBadge.innerText = 'Demo Synth Playing';
        vTagSource.innerText = 'Source: Studio Melodic Synth';
        showToast('Demo beat is playing! Real-time sound & visualizer active.', 'success');
      } catch (err) {
        showToast(`Failed to start demo track: ${err.message}`, 'error');
      }
    });
  }

  // =========================================================================
  // VOLUME & AUDIO CONTROLS
  // =========================================================================
  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    audioManager.setVolume(val);
    volumeReadout.innerText = `${Math.round(val * 100)}%`;
    if (val === 0) {
      isMuted = true;
      btnToggleMute.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
    } else {
      isMuted = false;
      btnToggleMute.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;
    }
  });

  btnToggleMute.addEventListener('click', () => {
    if (isMuted) {
      const restore = previousVolume || 1.0;
      volumeSlider.value = restore;
      audioManager.setVolume(restore);
      volumeReadout.innerText = `${Math.round(restore * 100)}%`;
      isMuted = false;
    } else {
      previousVolume = parseFloat(volumeSlider.value);
      volumeSlider.value = 0;
      audioManager.setVolume(0);
      volumeReadout.innerText = '0%';
      isMuted = true;
    }
    volumeSlider.dispatchEvent(new Event('input'));
  });

  // Audio Quality Preset Selection
  selectQuality.addEventListener('change', (e) => {
    const bps = parseInt(e.target.value, 10);
    audioManager.setBitrate(bps);
    showToast(`Bitrate set to ${Math.round(bps / 1000)} kbps`, 'info');
  });

  // Visualizer Mode Toggle
  btnVisualizerMode.addEventListener('click', () => {
    const newMode = visualizer.mode === 'bars' ? 'wave' : 'bars';
    visualizer.setMode(newMode);
    btnVisualizerMode.innerText = newMode === 'bars' ? 'Bars' : 'Waveform';
  });

  // Listener Autoplay Unlock
  btnUnlockAudio.addEventListener('click', async () => {
    await audioManager.initAudioContext();
    if (remoteAudioEl) {
      remoteAudioEl.play().then(() => {
        audioUnlockNotice.classList.add('hidden');
        showToast('Audio unlocked!', 'success');
      }).catch(err => {
        showToast('Playback error: ' + err.message, 'error');
      });
    }
  });

  // =========================================================================
  // ROOM CODE & LINK SHARING
  // =========================================================================
  btnCopyCode.addEventListener('click', () => {
    const code = roomCodeDisplay.innerText;
    navigator.clipboard.writeText(code).then(() => {
      showToast(`Room code ${code} copied to clipboard!`, 'success');
    });
  });

  btnCopyLink.addEventListener('click', () => {
    const origin = (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null')
      ? 'http://10.174.154.88:3000'
      : window.location.origin;
    const shareUrl = `${origin}?room=${webrtcRoom.roomCode}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Invite link copied! Send it to your friends.', 'success');
    });
  });

  // QR Code Modal
  btnShowQr.addEventListener('click', () => {
    const origin = (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null')
      ? 'http://10.174.154.88:3000'
      : window.location.origin;
    const shareUrl = `${origin}?room=${webrtcRoom.roomCode}`;
    modalQr.classList.add('active');
    new QRCode(qrContainer, {
      text: shareUrl,
      width: 200,
      height: 200,
      colorDark: '#0b0d11',
      colorLight: '#ffffff'
    });
  });

  btnCloseQrModal.addEventListener('click', () => {
    modalQr.classList.remove('active');
  });

  // Close modals on clicking backdrop
  [modalSourceSelect, modalQr].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });

  // =========================================================================
  // PEER LIST RENDERING
  // =========================================================================
  function renderPeerList(peers) {
    peerListEl.innerHTML = '';
    const totalCount = peers.length + 1; // including self
    peerCountBadge.innerText = `${totalCount} connected`;

    // Render self first
    const selfItem = document.createElement('li');
    selfItem.className = 'peer-item';
    selfItem.innerHTML = `
      <div class="peer-info">
        <div class="peer-avatar">${isHostRole ? 'H' : 'L'}</div>
        <div>
          <div style="font-weight: 600;">You (${isHostRole ? 'Host' : 'Listener'})</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">Current Device</div>
        </div>
      </div>
      <span class="peer-tag ${isHostRole ? 'host' : ''}">${isHostRole ? 'Broadcasting' : 'Listening'}</span>
    `;
    peerListEl.appendChild(selfItem);

    // Render connected peers
    peers.forEach(peer => {
      const item = document.createElement('li');
      item.className = 'peer-item';
      const initial = (peer.name || 'P')[0].toUpperCase();
      const rttText = peer.rtt ? `${peer.rtt}ms` : 'Active';

      item.innerHTML = `
        <div class="peer-info">
          <div class="peer-avatar">${initial}</div>
          <div>
            <div style="font-weight: 600;">${peer.name}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${rttText} latency</div>
          </div>
        </div>
        <span class="peer-tag">${peer.state || 'Connected'}</span>
      `;
      peerListEl.appendChild(item);
    });
  }
});
