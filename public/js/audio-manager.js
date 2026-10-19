/**
 * AudioManager Module
 * Pure digital music capture, Web Audio pipeline, and Opus Hi-Fi optimization.
 * Strictly NO microphone input. Zero voice processing artifacts.
 */

class AudioManager {
  constructor() {
    this.audioCtx = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.compressorNode = null;
    this.analyserNode = null;
    this.destNode = null;

    this.currentStream = null;
    this.localAudioElement = null; // Used for local file playback
    this.isCapturing = false;
    this.sourceType = 'none'; // 'display' | 'file' | 'remote'
    this.bitrate = 320000; // 320 kbps studio default
  }

  async initAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({
        latencyHint: 'interactive',
        sampleRate: 48000
      });

      // Master gain node
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      // Transparent soft-peak limiter to prevent distortion on loud music
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.setValueAtTime(-1.0, this.audioCtx.currentTime);
      this.compressorNode.knee.setValueAtTime(6.0, this.audioCtx.currentTime);
      this.compressorNode.ratio.setValueAtTime(20.0, this.audioCtx.currentTime);
      this.compressorNode.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
      this.compressorNode.release.setValueAtTime(0.15, this.audioCtx.currentTime);

      // Real-time visualizer analyser
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // WebRTC stream destination
      this.destNode = this.audioCtx.createMediaStreamDestination();

      // Connect graph: Source -> Gain -> Limiter -> Analyser -> Destination
      this.gainNode.connect(this.compressorNode);
      this.compressorNode.connect(this.analyserNode);
      this.analyserNode.connect(this.destNode);
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Captures pure system/app audio from Chrome Tab or Window.
   * Disables all mic processing (no echo cancellation, noise suppression, AGC).
   * Strips out video tracks immediately.
   */
  async captureAppAudio() {
    await this.initAudioContext();
    this.cleanupSource();

    try {
      // Prompt user to pick music tab/app
      // - selfBrowserSurface: 'exclude' prevents capturing the jamming app itself
      // - systemAudio: 'exclude' prevents capturing system sounds or notification dings
      // - displaySurface: 'browser' directs user to select specific music tab
      const captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 64 },
          height: { ideal: 64 },
          frameRate: { ideal: 5 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48000,
          suppressLocalAudioPlayback: false
        },
        selfBrowserSurface: 'exclude',
        systemAudio: 'exclude',
        surfaceSwitching: 'include'
      });

      const audioTracks = captureStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        captureStream.getTracks().forEach(t => t.stop());
        throw new Error('NO_AUDIO_SHARED');
      }

      // Immediately stop all video tracks - no video or screen is shared or transmitted
      captureStream.getVideoTracks().forEach(track => {
        track.stop();
        captureStream.removeTrack(track);
      });

      const audioTrack = audioTracks[0];
      audioTrack.onended = () => {
        if (this.onSourceEnded) this.onSourceEnded();
      };

      // Connect ONLY to Web Audio graph for WebRTC broadcast and Visualizer
      // CRITICAL: Do NOT connect to this.audioCtx.destination!
      // The host is already listening to the music app directly.
      // Connecting to destination causes double-sound / severe echo for the host.
      this.sourceNode = this.audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      this.sourceNode.connect(this.gainNode);

      this.currentStream = this.destNode.stream;
      this.sourceType = 'display';
      this.isCapturing = true;

      return {
        stream: this.currentStream,
        trackLabel: audioTrack.label || 'Music App Audio'
      };
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('USER_CANCELLED');
      }
      throw err;
    }
  }

  /**
   * Streams a local audio file (MP3, WAV, FLAC, etc.) directly into WebRTC
   */
  async playLocalAudioFile(file) {
    await this.initAudioContext();
    this.cleanupSource();

    return new Promise((resolve, reject) => {
      const fileUrl = URL.createObjectURL(file);
      const audioEl = new Audio();
      audioEl.src = fileUrl;
      audioEl.crossOrigin = 'anonymous';
      audioEl.loop = true;

      audioEl.oncanplay = () => {
        audioEl.play().catch(reject);

        this.sourceNode = this.audioCtx.createMediaElementSource(audioEl);
        this.sourceNode.connect(this.gainNode);

        // Also connect to local output so host hears their music
        this.compressorNode.connect(this.audioCtx.destination);

        this.localAudioElement = audioEl;
        this.currentStream = this.destNode.stream;
        this.sourceType = 'file';
        this.isCapturing = true;

        resolve({
          stream: this.currentStream,
          fileName: file.name
        });
      };

      audioEl.onerror = () => {
        reject(new Error('INVALID_AUDIO_FILE'));
      };
    });
  }

  /**
   * Generates a warm, rhythmic melodic synth progression directly in Web Audio
   * Perfect for instant 1-click testing of sound quality, stereo imaging, and visualizer.
   */
  async playBuiltinDemoTrack() {
    await this.initAudioContext();
    this.cleanupSource();

    const masterDemoGain = this.audioCtx.createGain();
    masterDemoGain.gain.value = 0.6;
    masterDemoGain.connect(this.gainNode);

    // Also connect to local speakers for monitoring
    this.compressorNode.connect(this.audioCtx.destination);

    // Warm chord progression (Fmaj7 - Em7 - Dm7 - Cmaj7)
    const chords = [
      [174.61, 220.00, 261.63, 329.63], // Fmaj7 (F3, A3, C4, E4)
      [164.81, 196.00, 246.94, 293.66], // Em7 (E3, G3, B3, D4)
      [146.83, 174.61, 220.00, 261.63], // Dm7 (D3, F3, A3, C4)
      [130.81, 164.81, 196.00, 246.94]  // Cmaj7 (C3, E3, G3, B3)
    ];

    let chordIndex = 0;
    let step = 0;
    const tempo = 92;
    const stepDuration = 60 / tempo / 2; // Eighth note duration (~326ms)

    const scheduleStep = () => {
      if (!this.demoTrackActive) return;

      const now = this.audioCtx.currentTime;
      const currentChord = chords[chordIndex];

      // Bass note on beats 1 and 3
      if (step === 0 || step === 4) {
        const bassOsc = this.audioCtx.createOscillator();
        const bassGain = this.audioCtx.createGain();
        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(currentChord[0] / 2, now);

        bassGain.gain.setValueAtTime(0.5, now);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 2);

        bassOsc.connect(bassGain);
        bassGain.connect(masterDemoGain);

        bassOsc.start(now);
        bassOsc.stop(now + stepDuration * 2);
      }

      // Warm stereo pad arpeggio
      const noteFreq = currentChord[step % currentChord.length];
      const padOsc = this.audioCtx.createOscillator();
      const padGain = this.audioCtx.createGain();
      const panner = this.audioCtx.createStereoPanner ? this.audioCtx.createStereoPanner() : null;

      padOsc.type = 'sine';
      padOsc.frequency.setValueAtTime(noteFreq, now);

      if (panner) {
        // Subtle stereo panning for spacious soundstage
        panner.pan.setValueAtTime(Math.sin(step * 1.5) * 0.7, now);
        padOsc.connect(panner);
        panner.connect(padGain);
      } else {
        padOsc.connect(padGain);
      }

      padGain.gain.setValueAtTime(0.001, now);
      padGain.gain.linearRampToValueAtTime(0.2, now + 0.04);
      padGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 1.8);

      padGain.connect(masterDemoGain);
      padOsc.start(now);
      padOsc.stop(now + stepDuration * 1.8);

      // Hi-hat tick every 2 steps
      if (step % 2 === 0) {
        const bufSize = this.audioCtx.sampleRate * 0.04;
        const noiseBuffer = this.audioCtx.createBuffer(1, bufSize, this.audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.audioCtx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;

        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(7000, now);

        const hatGain = this.audioCtx.createGain();
        hatGain.gain.setValueAtTime(step === 2 || step === 6 ? 0.08 : 0.04, now);
        hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        whiteNoise.connect(filter);
        filter.connect(hatGain);
        hatGain.connect(masterDemoGain);

        whiteNoise.start(now);
      }

      step++;
      if (step >= 8) {
        step = 0;
        chordIndex = (chordIndex + 1) % chords.length;
      }
    };

    this.demoTrackActive = true;
    this.demoInterval = setInterval(scheduleStep, stepDuration * 1000);
    scheduleStep();

    this.sourceNode = masterDemoGain;
    this.currentStream = this.destNode.stream;
    this.sourceType = 'synth';
    this.isCapturing = true;

    return {
      stream: this.currentStream,
      trackLabel: 'Studio Melodic Demo (Lo-Fi Hi-Fi Synth)'
    };
  }

  /**
   * For Listeners: Attach incoming WebRTC remote audio stream
   */
  async attachRemoteAudioStream(mediaStream, audioElement) {
    await this.initAudioContext();
    this.cleanupSource();

    this.currentStream = mediaStream;
    this.sourceType = 'remote';
    this.isCapturing = true;

    if (audioElement) {
      audioElement.srcObject = mediaStream;
      audioElement.autoplay = true;
      audioElement.playsInline = true;

      // Pipe to Web Audio for local boost, limiting, and visualizer
      try {
        this.sourceNode = this.audioCtx.createMediaStreamSource(mediaStream);
        this.sourceNode.connect(this.gainNode);
        this.compressorNode.connect(this.audioCtx.destination);
      } catch (e) {
        console.warn('Direct media stream source routing fallback:', e);
      }

      // Handle autoplay promise
      try {
        await audioElement.play();
      } catch (err) {
        console.warn('Autoplay prevented. User interaction required.', err);
        return { needsUserGesture: true };
      }
    }

    return { needsUserGesture: false };
  }

  setVolume(fraction) {
    // Range 0.0 to 1.5 (with soft limiter protecting headroom)
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(fraction, this.audioCtx.currentTime);
    }
  }

  setBitrate(bitrateBps) {
    this.bitrate = bitrateBps;
  }

  cleanupSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
    if (this.compressorNode && this.audioCtx) {
      try {
        this.compressorNode.disconnect(this.audioCtx.destination);
      } catch (e) {}
    }
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
    this.demoTrackActive = false;

    if (this.localAudioElement) {
      this.localAudioElement.pause();
      this.localAudioElement.src = '';
      this.localAudioElement = null;
    }
    this.isCapturing = false;
    this.sourceType = 'none';
  }

  /**
   * Optimizes WebRTC Session Description Protocol (SDP) for Opus Hi-Fi Music:
   * - stereo=1: Full stereo soundstage
   * - sprop-stereo=1: Signal stereo capabilities
   * - maxaveragebitrate: Configurable high bitrate (e.g. 320000 bps)
   * - useinbandfec=1: Forward Error Correction for zero stutter on weak Wi-Fi/4G
   * - minptime=10: 10ms low latency frames
   */
  optimizeOpusSdp(sdp, bitrate = this.bitrate) {
    const lines = sdp.split('\r\n');
    let opusPayloadType = null;

    // Find Opus payload type
    for (const line of lines) {
      if (line.startsWith('a=rtpmap:') && line.toLowerCase().includes('opus/48000')) {
        const parts = line.split(' ');
        opusPayloadType = parts[0].split(':')[1];
        break;
      }
    }

    if (!opusPayloadType) return sdp;

    const fmtpPrefix = `a=fmtp:${opusPayloadType} `;
    let fmtpFound = false;

    const modifiedLines = lines.map(line => {
      if (line.startsWith(fmtpPrefix)) {
        fmtpFound = true;
        // Inject studio music parameters
        let params = line.substring(fmtpPrefix.length);
        const desiredParams = {
          'stereo': '1',
          'sprop-stereo': '1',
          'maxaveragebitrate': bitrate.toString(),
          'useinbandfec': '1',
          'cbr': '0',
          'minptime': '10'
        };

        const currentPairs = params.split(';').map(p => p.trim()).filter(Boolean);
        const map = new Map();
        currentPairs.forEach(p => {
          const [k, v] = p.split('=');
          if (k) map.set(k.trim(), v ? v.trim() : '');
        });

        // Set or override desired parameters
        for (const [k, v] of Object.entries(desiredParams)) {
          map.set(k, v);
        }

        const newParamStr = Array.from(map.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join(';');

        return `${fmtpPrefix}${newParamStr}`;
      }
      return line;
    });

    if (!fmtpFound) {
      // Append fmtp line right after rtpmap
      const idx = modifiedLines.findIndex(l => l.startsWith(`a=rtpmap:${opusPayloadType}`));
      if (idx !== -1) {
        modifiedLines.splice(idx + 1, 0, `${fmtpPrefix}stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate};useinbandfec=1;cbr=0;minptime=10`);
      }
    }

    return modifiedLines.join('\r\n');
  }
}

window.AudioManager = AudioManager;
