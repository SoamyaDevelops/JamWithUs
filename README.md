# 🎵 JamStream - High-Fidelity Studio Audio Jamming

A real-time music jamming application designed for streaming **pure, digital music output** from your favorite music apps (Spotify, YouTube Music, Apple Music, SoundCloud, VLC) or high-res audio files to friends with **zero microphone leakage, zero voice compression, and ultra-low latency**.

---

## ✨ Key Highlights

- **Pure Music Audio Only (Zero Mic)**:
  - Captures raw digital sound directly from the music app / browser tab.
  - Microphone access is completely bypassed—no background room noise, breathing, or voice filter artifacts.
- **Top-Notch Sound Quality (Even on Low Internet)**:
  - Fullband 48 kHz true 2-channel stereo.
  - Opus codec optimized for music with **Inband Forward Error Correction (FEC)**, protecting against packet loss and jitter on weak Wi-Fi or mobile data.
  - Configurable bitrate presets: **Studio Ultra (320 kbps)**, **Balanced (192 kbps)**, or **Eco Mode (96 kbps + FEC)**.
  - Transparent soft-knee audio limiter prevents digital distortion and clipping.
- **4-Digit Room Codes**:
  - Automatically generates a clean 4-character code (mix of `A-Z` and `0-9`, excluding visually ambiguous characters like `0/O` and `1/I`).
  - Listeners can connect by typing the 4-digit code, clicking a 1-click invite link, or scanning the built-in QR code on phones.
  - Multiple listeners can connect to the same host simultaneously.
- **Studio Hi-Fi Aesthetic (No Neon, No Purple)**:
  - Refined studio console aesthetic: matte graphite/slate surfaces, warm brass & amber accents, crisp monospace indicators, and a responsive 60fps canvas visualizer.
- **100% Free**:
  - Uses peer-to-peer WebRTC with free public STUN servers (`stun.l.google.com:19302`).
  - Zero paid API keys, zero cloud subscriptions, zero third-party service fees.

---

## 🚀 Quick Start Guide

### 1. Start the Server
Make sure Node.js is installed, then run:

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The console will show your local and network URLs:
```
  🎵 JAMSTREAM - Studio Audio Jamming Server Running   
  Local:   http://localhost:3000
  Network: http://192.168.1.X:3000 (Share with devices on same WiFi)
```

---

## 🎧 How to Use

### For the Host (Streaming Music):
1. Open `http://localhost:3000` (or your network IP) in Chrome, Edge, Brave, or Opera.
2. Click **"Create Jam Room"**. A 4-digit code will be generated (e.g. `8K2P`).
3. Select your audio source:
   - **Music App / Tab**: Select your music player tab (e.g., Spotify Web, YouTube Music) or window.
     > 💡 **Important**: When the browser prompt opens, ensure the **"Also share audio"** checkbox in the bottom left is checked!
   - **High-Res Audio File**: Drag & drop any FLAC, MP3, WAV, or AAC track directly into the browser.
   - **Studio Demo Beat**: Click the built-in synthesized chord progression for instant testing.
4. Share the 4-digit code, the invite link, or the QR code with friends!

### For Listeners (Tuning In):
1. Open the app on your computer or smartphone.
2. Enter the host's 4-digit code (e.g. `8K2P`) and click **"Connect & Listen"** (or simply click an invite link).
3. The stream connects instantly with sub-second synchronization and real-time visualizer.

---

## 🌐 100% Free Cloud Deployment Options

To jam with friends anywhere across the globe for free:

### Option A: Render (Free Tier)
1. Push this folder to a GitHub repository.
2. Go to [render.com](https://render.com) and create a **New Web Service**.
3. Select your repository:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Deploy! Your app is now live with free HTTPS and WebSockets.

### Option B: Glitch / Railway (Free)
1. Import from GitHub or drag-and-drop the project files.
2. It will automatically detect `package.json` and start the server.

---

## 🛠️ Technical Architecture

- **Signaling**: Lightweight Node.js WebSocket server (`server.js`) managing room lifecycles and WebRTC ICE/SDP handshakes.
- **Audio Pipeline**: Web Audio API (`AudioContext` @ 48kHz) with `GainNode`, `DynamicsCompressorNode`, and `AnalyserNode`.
- **Media Stream**: Captures pure tab/app audio using `getDisplayMedia`, instantly terminating and discarding all video tracks to conserve 100% of bandwidth for lossless audio.
- **SDP Munging**: Injects `stereo=1;sprop-stereo=1;maxaveragebitrate=320000;useinbandfec=1;cbr=0;minptime=10` into the WebRTC session descriptions.
- **Visualizer**: Pure HTML5 Canvas 60fps frequency spectrum and oscilloscope rendered without external frameworks.
