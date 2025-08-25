const { createCanvas, registerFont } = require('canvas');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 12;
const CAPTCHA_LENGTH = 8;
const CHAR_SET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

function generateCode(len = CAPTCHA_LENGTH) {
  return Array.from(crypto.randomFillSync(new Uint32Array(len)))
    .map(x => CHAR_SET[x % CHAR_SET.length])
    .join("");
}

// Generate complex noise patterns
function addComplexNoise(ctx, width, height) {
  // Perlin-like noise using sine waves
  for (let x = 0; x < width; x += 2) {
    for (let y = 0; y < height; y += 2) {
      const noise = Math.sin(x * 0.02) * Math.cos(y * 0.03) * 
                   Math.sin((x + y) * 0.01) * 127 + 128;
      ctx.fillStyle = `rgba(${Math.floor(noise)}, ${Math.floor(noise)}, ${Math.floor(noise)}, 0.05)`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
}

// Add interference lines with varying properties
function addInterferenceLines(ctx, width, height) {
  // Horizontal interference lines
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    const y = rand(0, height);
    ctx.moveTo(0, y);
    for (let x = 0; x < width; x += 5) {
      ctx.lineTo(x, y + Math.sin(x * 0.1) * rand(2, 8));
    }
    ctx.strokeStyle = `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.4)`;
    ctx.lineWidth = rand(1, 3);
    ctx.stroke();
  }
  
  // Vertical interference lines
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    const x = rand(0, width);
    ctx.moveTo(x, 0);
    for (let y = 0; y < height; y += 5) {
      ctx.lineTo(x + Math.cos(y * 0.1) * rand(2, 6), y);
    }
    ctx.strokeStyle = `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.3)`;
    ctx.lineWidth = rand(1, 2);
    ctx.stroke();
  }
}

// Add decoy characters
function addDecoyCharacters(ctx, width, height, realCode) {
  const decoyChars = "0O1lI";
  const numDecoys = randInt(3, 6);
  
  for (let i = 0; i < numDecoys; i++) {
    const char = decoyChars[randInt(0, decoyChars.length - 1)];
    const x = rand(0, width);
    const y = rand(0, height);
    
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand(-0.5, 0.5));
    ctx.scale(rand(0.3, 0.7), rand(0.3, 0.7));
    ctx.fillStyle = `rgba(${randInt(100,200)}, ${randInt(100,200)}, ${randInt(100,200)}, 0.15)`;
    ctx.font = "bold 24px Courier New";
    ctx.fillText(char, 0, 0);
    ctx.restore();
  }
}

// Add geometric shapes as distractors
function addGeometricShapes(ctx, width, height) {
  // Circles
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(rand(0, width), rand(0, height), rand(3, 12), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.2)`;
    ctx.lineWidth = rand(1, 3);
    ctx.stroke();
  }
  
  // Rectangles
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(rand(0, width), rand(0, height));
    ctx.rotate(rand(0, Math.PI * 2));
    ctx.strokeStyle = `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.15)`;
    ctx.lineWidth = rand(1, 2);
    ctx.strokeRect(0, 0, rand(5, 20), rand(5, 20));
    ctx.restore();
  }
}

// Add gradient overlays
function addGradientOverlays(ctx, width, height) {
  // Random gradient overlay
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.08)`);
  gradient.addColorStop(0.5, `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.03)`);
  gradient.addColorStop(1, `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.08)`);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

// Enhanced character rendering with multiple distortions
function renderCharacter(ctx, char, x, y, index, totalChars) {
  const fonts = [
    "bold 38px Courier New",
    "bold 36px monospace", 
    "bold 40px serif",
    "bold 37px Georgia"
  ];
  
  ctx.save();
  
  // Multiple transformations
  ctx.translate(x, y);
  ctx.rotate(rand(-0.4, 0.4)); // Increased rotation range
  ctx.scale(rand(0.7, 1.3), rand(0.5, 1.6)); // More aggressive scaling
  
  // Character-specific positioning variation
  const wave = Math.sin(index * 0.8 + Date.now() / 1000) * 8;
  const bounce = Math.cos(index * 1.2 + Date.now() / 800) * 6;
  ctx.translate(wave, bounce);
  
  // Font variation
  ctx.font = fonts[index % fonts.length];
  ctx.textBaseline = "middle";
  
  // Complex color generation
  const hue = (index * 60 + rand(0, 60)) % 360;
  const sat = rand(40, 80);
  const light = rand(5, 25);
  ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  
  // Enhanced shadow effects
  ctx.shadowColor = `rgba(${randInt(0,100)}, ${randInt(0,100)}, ${randInt(0,100)}, 0.4)`;
  ctx.shadowBlur = rand(3, 8);
  ctx.shadowOffsetX = rand(-3, 3);
  ctx.shadowOffsetY = rand(-3, 3);
  
  // Draw character multiple times with slight offsets for thickness
  for (let i = 0; i < 2; i++) {
    ctx.fillText(char, rand(-0.5, 0.5), rand(-0.5, 0.5));
  }
  
  ctx.restore();
}

async function generateCaptchaImage() {
  const code = generateCode();
  const hashedCode = await bcrypt.hash(code, SALT_ROUNDS);
  
  const width = 280; // Increased width
  const height = 120; // Increased height
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Complex background with multiple gradients
  const bgGradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width/2);
  bgGradient.addColorStop(0, '#fefefe');
  bgGradient.addColorStop(0.5, '#f8f8f8');
  bgGradient.addColorStop(1, '#f0f0f0');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);
  
  // Layer 1: Complex noise
  addComplexNoise(ctx, width, height);
  
  // Layer 2: Random dots (enhanced)
  for (let i = 0; i < 400; i++) {
    ctx.beginPath();
    ctx.arc(rand(0, width), rand(0, height), rand(0.3, 2.5), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, ${rand(0.1, 0.4)})`;
    ctx.fill();
  }
  
  // Layer 3: Interference lines
  addInterferenceLines(ctx, width, height);
  
  // Layer 4: Geometric shapes
  addGeometricShapes(ctx, width, height);
  
  // Layer 5: Gradient overlays
  addGradientOverlays(ctx, width, height);
  
  // Layer 6: Decoy characters (before real characters)
  addDecoyCharacters(ctx, width, height, code);
  
  // Layer 7: Real characters with enhanced rendering
  const charSpacing = (width - 60) / code.length;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const baseX = 30 + i * charSpacing + rand(-8, 8);
    const baseY = height / 2 + rand(-10, 10);
    
    renderCharacter(ctx, char, baseX, baseY, i, code.length);
  }
  
  // Layer 8: Final interference patterns
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(rand(0, width), rand(0, height));
    for (let j = 0; j < 20; j++) {
      ctx.lineTo(rand(0, width), rand(0, height));
    }
    ctx.strokeStyle = `rgba(${randInt(0,255)}, ${randInt(0,255)}, ${randInt(0,255)}, 0.15)`;
    ctx.lineWidth = rand(0.5, 2);
    ctx.stroke();
  }
  
  // Layer 9: Pixel-level distortion
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    // Add slight random variations to RGB values
    if (Math.random() < 0.02) {
      data[i] = Math.min(255, data[i] + randInt(-20, 20));     // R
      data[i + 1] = Math.min(255, data[i + 1] + randInt(-20, 20)); // G
      data[i + 2] = Math.min(255, data[i + 2] + randInt(-20, 20)); // B
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  const buffer = canvas.toBuffer('image/png');
  
  return {
    imageBuffer: buffer,
    imageBase64: buffer.toString('base64'),
    hashedCode,
    // Additional security metadata
    timestamp: Date.now(),
    complexity: 'maximum'
  };
}

async function verifyCaptcha(userInput, hashedCode) {
  return await bcrypt.compare(userInput, hashedCode);
}

// Additional security: Generate challenge-response pairs
function generateChallengeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Rate limiting helper (implement with Redis or similar in production)
function createRateLimitKey(ip, userAgent) {
  return crypto.createHash('sha256')
    .update(ip + userAgent + Date.now().toString())
    .digest('hex');
}

module.exports = { 
  generateCaptchaImage, 
  verifyCaptcha,
  generateChallengeToken,
  createRateLimitKey
};