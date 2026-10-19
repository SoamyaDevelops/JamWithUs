const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rooms state
// rooms[roomCode] = { hostWs, hostId, listeners: Map<peerId, { ws, name }> }
const rooms = new Map();

// Generate random 4-character code (mix of A-Z and 0-9, avoiding ambiguous characters like 0/O and 1/I)
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateRoomCode() {
  let attempts = 0;
  while (attempts < 1000) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
    if (!rooms.has(code)) {
      return code;
    }
    attempts++;
  }
  // Fallback to 5 chars if collision is high
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generatePeerId() {
  return 'peer_' + Math.random().toString(36).substring(2, 10);
}

wss.on('connection', (ws) => {
  let clientRoom = null;
  let clientPeerId = null;
  let isHost = false;

  const send = (msg) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    switch (data.type) {
      case 'create_room': {
        const roomCode = (data.roomCode && data.roomCode.trim().length === 4)
          ? data.roomCode.trim().toUpperCase()
          : generateRoomCode();

        if (rooms.has(roomCode)) {
          // If code already taken, regenerate
          const newCode = generateRoomCode();
          setupHost(newCode);
        } else {
          setupHost(roomCode);
        }

        function setupHost(code) {
          clientRoom = code;
          clientPeerId = 'host_' + Math.random().toString(36).substring(2, 8);
          isHost = true;

          rooms.set(code, {
            hostWs: ws,
            hostId: clientPeerId,
            listeners: new Map(),
            createdAt: Date.now()
          });

          send({
            type: 'room_created',
            roomCode: code,
            peerId: clientPeerId,
            isHost: true
          });
        }
        break;
      }

      case 'join_room': {
        const roomCode = (data.roomCode || '').trim().toUpperCase();
        const room = rooms.get(roomCode);

        if (!room) {
          send({
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: `Room "${roomCode}" not found. Verify the code or ask the host.`
          });
          return;
        }

        clientRoom = roomCode;
        clientPeerId = generatePeerId();
        isHost = false;
        const peerName = data.peerName || 'Listener ' + (room.listeners.size + 1);

        room.listeners.set(clientPeerId, {
          ws,
          name: peerName
        });

        // Confirm to listener
        send({
          type: 'room_joined',
          roomCode,
          peerId: clientPeerId,
          hostId: room.hostId,
          peerCount: room.listeners.size
        });

        // Notify host about new listener so host initiates WebRTC peer connection
        if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
          room.hostWs.send(JSON.stringify({
            type: 'peer_joined',
            peerId: clientPeerId,
            peerName,
            peerCount: room.listeners.size
          }));
        }
        break;
      }

      case 'signal': {
        // Forward signaling message between Host and specific Listener
        const { targetId, signalData } = data;
        const room = rooms.get(clientRoom);
        if (!room) return;

        if (isHost) {
          // Host sending signal to a specific listener
          const listener = room.listeners.get(targetId);
          if (listener && listener.ws.readyState === WebSocket.OPEN) {
            listener.ws.send(JSON.stringify({
              type: 'signal',
              fromId: clientPeerId,
              signalData
            }));
          }
        } else {
          // Listener sending signal back to host
          if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
            room.hostWs.send(JSON.stringify({
              type: 'signal',
              fromId: clientPeerId,
              signalData
            }));
          }
        }
        break;
      }

      case 'broadcast_chat': {
        // Optional quick text reaction / chat without interfering with audio
        const room = rooms.get(clientRoom);
        if (!room) return;

        const broadcastMsg = JSON.stringify({
          type: 'chat_message',
          sender: data.sender || (isHost ? 'Host' : 'Listener'),
          text: data.text,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
          room.hostWs.send(broadcastMsg);
        }
        for (const [, listener] of room.listeners) {
          if (listener.ws.readyState === WebSocket.OPEN) {
            listener.ws.send(broadcastMsg);
          }
        }
        break;
      }

      case 'ping': {
        send({ type: 'pong', timestamp: data.timestamp });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!clientRoom) return;
    const room = rooms.get(clientRoom);
    if (!room) return;

    if (isHost) {
      // Host disconnected: Notify all listeners and close room
      for (const [, listener] of room.listeners) {
        if (listener.ws.readyState === WebSocket.OPEN) {
          listener.ws.send(JSON.stringify({
            type: 'host_disconnected',
            message: 'Host has closed or left the room.'
          }));
        }
      }
      rooms.delete(clientRoom);
    } else {
      // Listener disconnected: Remove and notify host
      room.listeners.delete(clientPeerId);
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
        room.hostWs.send(JSON.stringify({
          type: 'peer_left',
          peerId: clientPeerId,
          peerCount: room.listeners.size
        }));
      }
    }
  });
});

// Helper to get local network IP address
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIpAddresses();
  console.log(`\n======================================================`);
  console.log(`  🎵 JAMSTREAM - Studio Audio Jamming Server Running   `);
  console.log(`======================================================`);
  console.log(`  Local:   http://localhost:${PORT}`);
  if (localIps.length > 0) {
    localIps.forEach(ip => {
      console.log(`  Network: http://${ip}:${PORT} (Share with phones/laptops on same WiFi)`);
    });
  }
  console.log(`======================================================\n`);
});
