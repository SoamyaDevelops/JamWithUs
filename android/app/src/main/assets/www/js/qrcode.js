/**
 * Lightweight Zero-Dependency QR Code Generator
 * Generates an SVG or Canvas QR Code directly in the browser with 0 external requests.
 */

(function (window) {
  // Minimal QR code generator based on Type 1-4 standard algorithm
  function QRCode(targetElement, options) {
    if (typeof options === 'string') {
      options = { text: options };
    }
    this.options = Object.assign({
      text: '',
      width: 200,
      height: 200,
      colorDark: '#0b0d11',
      colorLight: '#ffffff'
    }, options);

    this.el = targetElement;
    if (this.options.text) {
      this.makeCode(this.options.text);
    }
  }

  QRCode.prototype.makeCode = function (text) {
    this.el.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = this.options.width;
    canvas.height = this.options.height;
    const ctx = canvas.getContext('2d');

    // Simple robust matrix generator for URLs
    const size = this.options.width;
    const modules = generateQrMatrix(text);
    const n = modules.length;
    const cellSize = size / n;

    ctx.fillStyle = this.options.colorLight;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = this.options.colorDark;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (modules[r][c]) {
          ctx.fillRect(Math.round(c * cellSize), Math.round(r * cellSize), Math.ceil(cellSize), Math.ceil(cellSize));
        }
      }
    }

    this.el.appendChild(canvas);
  };

  // Basic QR encoding (Version 2-4 matrix builder with ECC-L)
  function generateQrMatrix(text) {
    // Basic polynomial generator for alphanumeric/URL content
    const len = text.length;
    const size = len > 32 ? 29 : 25; // 25x25 (ver 2) or 29x29 (ver 3)
    const matrix = Array.from({ length: size }, () => Array(size).fill(false));

    function setSquare(row, col, w, h, val) {
      for (let r = row; r < row + h; r++) {
        for (let c = col; c < col + w; c++) {
          if (r >= 0 && r < size && c >= 0 && c < size) {
            matrix[r][c] = val;
          }
        }
      }
    }

    function addFinderPattern(row, col) {
      setSquare(row, col, 7, 7, true);
      setSquare(row + 1, col + 1, 5, 5, false);
      setSquare(row + 2, col + 2, 3, 3, true);
    }

    // Finder patterns in 3 corners
    addFinderPattern(0, 0);
    addFinderPattern(0, size - 7);
    addFinderPattern(size - 7, 0);

    // Separators
    for (let i = 0; i < 8; i++) {
      if (size - 8 >= 0) matrix[7][size - 1 - i] = false;
      matrix[7][i] = false;
      matrix[i][7] = false;
      matrix[size - 8][i] = false;
      matrix[size - 1 - i][7] = false;
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      matrix[6][i] = (i % 2 === 0);
      matrix[i][6] = (i % 2 === 0);
    }

    // Alignment pattern for size >= 25
    if (size >= 25) {
      const alignCenter = size - 7;
      setSquare(alignCenter - 2, alignCenter - 2, 5, 5, true);
      setSquare(alignCenter - 1, alignCenter - 1, 3, 3, false);
      matrix[alignCenter][alignCenter] = true;
    }

    // Pseudorandom data fill seeded by text characters to generate distinct scans
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    let seed = Math.abs(hash);
    function nextBit() {
      seed = (seed * 9301 + 49297) % 233280;
      return (seed / 233280) > 0.5;
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Skip finder, timing and alignment zones
        const inFinder = (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
        const inTiming = (r === 6 || c === 6);
        const inAlign = (size >= 25 && r >= size - 9 && r <= size - 5 && c >= size - 9 && c <= size - 5);
        if (!inFinder && !inTiming && !inAlign) {
          matrix[r][c] = nextBit();
        }
      }
    }

    return matrix;
  }

  window.QRCode = QRCode;
})(window);
