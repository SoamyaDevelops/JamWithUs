/**
 * Visualizer Module
 * High-performance 60fps frequency spectrum and oscilloscope visualizer
 * Palette: Warm amber/studio gold with peak meter hold. Strictly no neon/purple.
 */

class AudioVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.analyser = null;
    this.dataArray = null;
    this.timeDomainArray = null;
    this.animationId = null;
    this.mode = 'bars'; // 'bars' | 'wave'
    this.peakValues = [];
    this.peakDecay = 0.96;
    this.isActive = false;

    this.handleResize = this.handleResize.bind(this);
    this.render = this.render.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.startIdleLoop();
  }

  handleResize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  attachAnalyser(analyserNode) {
    this.analyser = analyserNode;
    this.analyser.fftSize = 256;
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    this.timeDomainArray = new Uint8Array(bufferLength);
    this.peakValues = new Array(bufferLength).fill(0);
    this.isActive = true;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.render();
  }

  detach() {
    this.isActive = false;
    this.analyser = null;
    this.dataArray = null;
    this.startIdleLoop();
  }

  startIdleLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    let tick = 0;
    const drawIdle = () => {
      if (this.isActive) return;
      tick += 0.03;
      this.drawIdleState(tick);
      this.animationId = requestAnimationFrame(drawIdle);
    };
    drawIdle();
  }

  drawIdleState(tick) {
    const { ctx, width, height } = this;
    if (!width || !height) return;

    ctx.clearRect(0, 0, width, height);

    // Subtle horizontal resting baseline with gentle pulse
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)';
    ctx.lineWidth = 1.5;

    const centerY = height / 2;
    for (let x = 0; x < width; x += 4) {
      const y = centerY + Math.sin(x * 0.02 + tick) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  setMode(mode) {
    this.mode = mode;
  }

  render() {
    if (!this.isActive || !this.analyser) return;

    this.animationId = requestAnimationFrame(this.render);
    this.analyser.getByteFrequencyData(this.dataArray);
    this.analyser.getByteTimeDomainData(this.timeDomainArray);

    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    if (this.mode === 'wave') {
      this.drawOscilloscope();
    } else {
      this.drawFrequencyBars();
    }
  }

  drawFrequencyBars() {
    const { ctx, width, height, dataArray } = this;
    const totalBars = 48; // Crisp, balanced number of studio equalizer bands
    const barSpacing = 3;
    const barWidth = Math.max(2, (width - (totalBars - 1) * barSpacing) / totalBars);

    // Dynamic gradient for bars: Warm graphite to gold/amber
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#f59e0b');
    gradient.addColorStop(0.7, '#fbbf24');
    gradient.addColorStop(1, '#ffffff');

    for (let i = 0; i < totalBars; i++) {
      // Scale logarithmic-like bin selection so bass, mids, and treble are balanced
      const binIndex = Math.floor(Math.pow(i / totalBars, 1.4) * (dataArray.length * 0.85));
      const value = dataArray[binIndex] || 0;
      const barHeight = Math.max(2, (value / 255) * (height - 24));

      const x = i * (barWidth + barSpacing);
      const y = height - barHeight;

      // Draw bar
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      ctx.fill();

      // Peak meter with decay
      if (barHeight > (this.peakValues[i] || 0)) {
        this.peakValues[i] = barHeight;
      } else {
        this.peakValues[i] = (this.peakValues[i] || 0) * this.peakDecay;
      }

      // Draw peak dot/cap
      const peakY = height - this.peakValues[i] - 3;
      if (peakY < height - 6) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, peakY, barWidth, 2);
      }
    }
  }

  drawOscilloscope() {
    const { ctx, width, height, timeDomainArray } = this;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();

    const sliceWidth = width / timeDomainArray.length;
    let x = 0;

    for (let i = 0; i < timeDomainArray.length; i++) {
      const v = timeDomainArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }
}

window.AudioVisualizer = AudioVisualizer;
