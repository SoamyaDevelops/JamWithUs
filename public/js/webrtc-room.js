/**
 * WebRTC Room & Multi-Peer Mesh Manager
 * Zero-cost WebRTC streaming via free public STUN servers and WebSocket signaling.
 * Supports 1 Host broadcasting studio audio to multiple Listeners simultaneously.
 */

class WebRtcRoom {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.ws = null;
    this.roomCode = null;
    this.peerId = null;
    this.isHost = false;
    this.hostId = null;

    // Map of peerId -> { pc, dc, statsInterval, candidateQueue }
    this.peers = new Map();

    // Free STUN servers (zero cost)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ],
      iceCandidatePoolSize: 4
    };

    // Event callbacks
    this.onRoomCreated = null;
    this.onRoomJoined = null;
    this.onPeerListChanged = null;
    this.onRemoteStream = null;
    this.onError = null;
    this.onStatsUpdate = null;
    this.onHostDisconnected = null;
  }

  connectSignaling() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onmessage = (event) => {
        this.handleSignalingMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log('Signaling WebSocket closed');
      };
    });
  }

  sendSignal(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  async createRoom(preferredCode = '') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connectSignaling();
    }
    this.sendSignal({
      type: 'create_room',
      roomCode: preferredCode
    });
  }

  async joinRoom(code, peerName) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connectSignaling();
    }
    this.sendSignal({
      type: 'join_room',
      roomCode: code.toUpperCase(),
      peerName: peerName || 'Listener'
    });
  }

  async handleSignalingMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    switch (msg.type) {
      case 'room_created': {
        this.roomCode = msg.roomCode;
        this.peerId = msg.peerId;
        this.isHost = true;
        if (this.onRoomCreated) this.onRoomCreated(msg.roomCode, msg.peerId);
        break;
      }

      case 'room_joined': {
        this.roomCode = msg.roomCode;
        this.peerId = msg.peerId;
        this.hostId = msg.hostId;
        this.isHost = false;
        if (this.onRoomJoined) this.onRoomJoined(msg.roomCode, msg.peerId, msg.peerCount);
        // Listener sets up peer connection and waits for Host's offer
        this.setupListenerPeerConnection(msg.hostId);
        break;
      }

      case 'peer_joined': {
        // Host gets notified a new listener arrived: initiate WebRTC Offer
        if (this.isHost) {
          await this.initiateHostPeerConnection(msg.peerId, msg.peerName);
          if (this.onPeerListChanged) {
            this.onPeerListChanged(this.getPeerListSummary());
          }
        }
        break;
      }

      case 'peer_left': {
        this.closePeer(msg.peerId);
        if (this.onPeerListChanged) {
          this.onPeerListChanged(this.getPeerListSummary());
        }
        break;
      }

      case 'host_disconnected': {
        if (this.onHostDisconnected) {
          this.onHostDisconnected(msg.message);
        }
        this.cleanup();
        break;
      }

      case 'signal': {
        await this.handleWebRtcSignal(msg.fromId, msg.signalData);
        break;
      }

      case 'error': {
        if (this.onError) {
          this.onError(msg.message, msg.code);
        }
        break;
      }
    }
  }

  /* =========================================================================
     HOST LOGIC: Create PeerConnection per listener and send audio stream
     ========================================================================= */
  async initiateHostPeerConnection(listenerId, listenerName) {
    const pc = new RTCPeerConnection(this.rtcConfig);
    const candidateQueue = [];

    // Create DataChannel for latency/ping measurement
    const dc = pc.createDataChannel('jam_meta', { ordered: true });
    this.setupDataChannel(dc, listenerId);

    const peerRecord = {
      pc,
      dc,
      name: listenerName,
      candidateQueue,
      stats: { rtt: 0, bitrate: 0 },
      isRemoteDescriptionSet: false
    };
    this.peers.set(listenerId, peerRecord);

    // Add audio track if audio is already active
    if (this.audioManager.currentStream) {
      const audioTrack = this.audioManager.currentStream.getAudioTracks()[0];
      if (audioTrack) {
        pc.addTrack(audioTrack, this.audioManager.currentStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'signal',
          targetId: listenerId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.closePeer(listenerId);
      }
      if (this.onPeerListChanged) {
        this.onPeerListChanged(this.getPeerListSummary());
      }
    };

    // Create offer
    try {
      const offer = await pc.createOffer();
      // Inject studio high-fidelity Opus parameters into SDP
      const highFiSdp = this.audioManager.optimizeOpusSdp(offer.sdp);
      const modifiedOffer = new RTCSessionDescription({
        type: 'offer',
        sdp: highFiSdp
      });

      await pc.setLocalDescription(modifiedOffer);

      this.sendSignal({
        type: 'signal',
        targetId: listenerId,
        signalData: { sdp: modifiedOffer }
      });
    } catch (err) {
      console.error('Failed to create host offer:', err);
    }

    this.startStatsMonitor(listenerId);
  }

  /* =========================================================================
     LISTENER LOGIC: Receive Offer from host and answer back
     ========================================================================= */
  setupListenerPeerConnection(hostId) {
    const pc = new RTCPeerConnection(this.rtcConfig);
    const candidateQueue = [];

    const peerRecord = {
      pc,
      dc: null,
      name: 'Host',
      candidateQueue,
      stats: { rtt: 0, bitrate: 0 },
      isRemoteDescriptionSet: false
    };
    this.peers.set(hostId, peerRecord);

    pc.ondatachannel = (event) => {
      peerRecord.dc = event.channel;
      this.setupDataChannel(event.channel, hostId);
    };

    // Receive Host's audio track
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        if (this.onRemoteStream) {
          this.onRemoteStream(event.streams[0]);
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'signal',
          targetId: hostId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    this.startStatsMonitor(hostId);
  }

  /* =========================================================================
     SIGNAL DISPATCHING & ICE HANDLING
     ========================================================================= */
  async handleWebRtcSignal(fromId, signalData) {
    let peer = this.peers.get(fromId);
    if (!peer) {
      // In case peer is host and listener just started
      if (!this.isHost && fromId === this.hostId) {
        this.setupListenerPeerConnection(fromId);
        peer = this.peers.get(fromId);
      } else {
        return;
      }
    }

    const { pc } = peer;

    if (signalData.sdp) {
      const description = new RTCSessionDescription(signalData.sdp);

      if (description.type === 'offer') {
        // Listener sets remote offer and answers
        await pc.setRemoteDescription(description);
        peer.isRemoteDescriptionSet = true;
        this.flushIceCandidateQueue(peer);

        const answer = await pc.createAnswer();
        const highFiAnswerSdp = this.audioManager.optimizeOpusSdp(answer.sdp);
        const modifiedAnswer = new RTCSessionDescription({
          type: 'answer',
          sdp: highFiAnswerSdp
        });

        await pc.setLocalDescription(modifiedAnswer);

        this.sendSignal({
          type: 'signal',
          targetId: fromId,
          signalData: { sdp: modifiedAnswer }
        });
      } else if (description.type === 'answer') {
        // Host sets remote answer
        await pc.setRemoteDescription(description);
        peer.isRemoteDescriptionSet = true;
        this.flushIceCandidateQueue(peer);
      }
    } else if (signalData.candidate) {
      const candidate = new RTCIceCandidate(signalData.candidate);
      if (peer.isRemoteDescriptionSet) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          console.warn('Error adding ice candidate:', e);
        }
      } else {
        peer.candidateQueue.push(candidate);
      }
    }
  }

  async flushIceCandidateQueue(peer) {
    while (peer.candidateQueue.length > 0) {
      const cand = peer.candidateQueue.shift();
      try {
        await peer.pc.addIceCandidate(cand);
      } catch (e) {
        console.warn('Failed to add queued candidate:', e);
      }
    }
  }

  // When host changes audio source, update tracks for all connected listeners
  broadcastAudioTrack(audioStream) {
    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack) return;

    for (const [, peer] of this.peers) {
      const senders = peer.pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender) {
        audioSender.replaceTrack(audioTrack);
      } else {
        peer.pc.addTrack(audioTrack, audioStream);
      }
    }
  }

  /* =========================================================================
     LATENCY & BITRATE MONITORING
     ========================================================================= */
  setupDataChannel(dc, peerId) {
    dc.onopen = () => {
      // Start ping loop for microsecond latency measurement
      dc.pingInterval = setInterval(() => {
        if (dc.readyState === 'open') {
          dc.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        }
      }, 2000);
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ping') {
          dc.send(JSON.stringify({ type: 'pong', t: msg.t }));
        } else if (msg.type === 'pong') {
          const rtt = Date.now() - msg.t;
          const peer = this.peers.get(peerId);
          if (peer) {
            peer.stats.rtt = Math.round(rtt / 2); // One-way trip estimate
            if (this.onStatsUpdate) this.onStatsUpdate(peer.stats);
          }
        }
      } catch (e) {}
    };

    dc.onclose = () => {
      if (dc.pingInterval) clearInterval(dc.pingInterval);
    };
  }

  startStatsMonitor(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    let lastBytes = 0;
    let lastTime = Date.now();

    peer.statsInterval = setInterval(async () => {
      if (!peer.pc || peer.pc.connectionState === 'closed') {
        clearInterval(peer.statsInterval);
        return;
      }

      try {
        const stats = await peer.pc.getStats();
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            const now = Date.now();
            const timeDelta = (now - lastTime) / 1000;
            const bytes = report.bytesReceived || 0;
            if (timeDelta > 0 && lastBytes > 0) {
              const bitrateKbps = Math.round(((bytes - lastBytes) * 8) / (timeDelta * 1000));
              peer.stats.bitrate = bitrateKbps;
            }
            lastBytes = bytes;
            lastTime = now;
            peer.stats.packetsLost = report.packetsLost || 0;
            if (this.onStatsUpdate) this.onStatsUpdate(peer.stats);
          }
        });
      } catch (e) {}
    }, 2500);
  }

  getPeerListSummary() {
    const list = [];
    for (const [id, peer] of this.peers) {
      list.push({
        id,
        name: peer.name || 'Connected Peer',
        state: peer.pc ? peer.pc.connectionState : 'unknown',
        rtt: peer.stats.rtt || 0
      });
    }
    return list;
  }

  closePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      if (peer.statsInterval) clearInterval(peer.statsInterval);
      if (peer.dc && peer.dc.pingInterval) clearInterval(peer.dc.pingInterval);
      if (peer.pc) peer.pc.close();
      this.peers.delete(peerId);
    }
  }

  cleanup() {
    for (const [id] of this.peers) {
      this.closePeer(id);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.roomCode = null;
    this.peerId = null;
    this.isHost = false;
  }
}

window.WebRtcRoom = WebRtcRoom;
