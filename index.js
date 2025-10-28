// =========================
// CORTEX IA - INDEX.JS (Fixed & Complete)
// =========================
require('dotenv').config();

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
const express = require('express');

// ========== CONFIGURACIÓN ==========
let OWNER_NUMBER = process.env.OWNER_NUMBER || '573223698554';
let OWNER_CHAT_ID = process.env.OWNER_WHATSAPP_ID || `${OWNER_NUMBER}@c.us`;

const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/TU_LINK_AQUI/review';
const TIMEZONE = process.env.TZ || 'America/Bogota';
const PORT = process.env.PORT || 3000;
const QR_TIMEOUT = 60000; // 60 seconds timeout for QR code generation

// ======== RUTAS DE CARPETAS/ARCHIVOS ========
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');

const BOOKINGS_FILE = path.join(DATA_DIR, 'user_bookings.json');
const RESERVAS_FILE = path.join(DATA_DIR, 'demo_reservas.json');
const SCHEDULED_MESSAGES_FILE = path.join(DATA_DIR, 'scheduled_messages.json');
const BARBERIA_BASE_PATH = path.join(PROMPTS_DIR, 'barberia_base.txt');
const VENTAS_PROMPT_PATH = path.join(PROMPTS_DIR, 'ventas.txt');

// Cliente de OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== 🛡️ ANTI-BAN: HUMAN-LIKE DELAYS ==========
const MIN_RESPONSE_DELAY = 2000;
const MAX_RESPONSE_DELAY = 5000;

function humanDelay() {
  const delay = Math.floor(Math.random() * (MAX_RESPONSE_DELAY - MIN_RESPONSE_DELAY + 1)) + MIN_RESPONSE_DELAY;
  console.log(`[🕒 ANTI-BAN] Waiting ${(delay/1000).toFixed(1)}s before responding...`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function sendWithTyping(chat, message) {
  try {
    await chat.sendStateTyping();
    await humanDelay();
    await chat.sendMessage(message);
    await chat.clearState();
  } catch (error) {
    console.log('[⚠️ ANTI-BAN] Typing state failed, using simple delay');
    await humanDelay();
    await chat.sendMessage(message);
  }
}

// ========== 🔥 CONFIGURACIÓN PUPPETEER MEJORADA ==========
const PUPPETEER_CONFIG = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-web-security',
    '--disable-features=site-per-process',
    '--allow-insecure-localhost',
    '--window-size=1280,720'
  ],
  ignoreHTTPSErrors: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
};

// console.log('🔧 Puppeteer Config:', {
//   executablePath: PUPPETEER_CONFIG.executablePath,
//   env: {
//     PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
//     CHROME_BIN: process.env.CHROME_BIN,
//     CHROMIUM_PATH: process.env.CHROMIUM_PATH
//   }
// });

// ========== WHATSAPP CLIENT (CON MANEJO DE ERRORES) ==========
let client = null;
let latestQR = null;
let clientStatus = 'initializing';
let clientInitialized = false;
let initializationPromise = null;
let qrGenerationTime = null;

// ========== CLEANUP FUNCTION FOR STALE LOCKS ==========
async function cleanupStaleLocks() {
  try {
    const sessionDir = path.join(DATA_DIR, 'session', 'session-cortex-ai-bot');
    const lockFile = path.join(sessionDir, 'SingletonLock');
    const socketFile = path.join(sessionDir, 'SingletonSocket');
    
    // Check and remove SingletonLock
    try {
      await fs.access(lockFile);
      await fs.unlink(lockFile);
      console.log('🧹 Removed stale SingletonLock file');
    } catch (err) {
      // File doesn't exist, which is fine
    }
    
    // Check and remove SingletonSocket
    try {
      await fs.access(socketFile);
      await fs.unlink(socketFile);
      console.log('🧹 Removed stale SingletonSocket file');
    } catch (err) {
      // File doesn't exist, which is fine
    }
  } catch (error) {
    console.log('⚠️ Could not clean lock files:', error.message);
  }
}


async function initializeWhatsAppClient() {
  if (initializationPromise) {
    console.log('⏳ Waiting for existing initialization...');
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      console.log('🚀 Starting WhatsApp client initialization...');
      // Clean up any stale lock files before starting
      await cleanupStaleLocks();
      clientStatus = 'initializing';

      client = new Client({
        authStrategy: new LocalAuth({ 
          dataPath: path.join(DATA_DIR, 'session'),
          clientId: 'cortex-ai-bot'
        }),
        puppeteer: PUPPETEER_CONFIG,
        qrTimeoutMs: QR_TIMEOUT,
        authTimeoutMs: 60000,
        restartOnAuthFail: true,
        qrMaxRetries: 5
      });

      // Set up event handlers
      client.on('qr', (qr) => {
        console.log('📱 New QR Code received');
        latestQR = qr;
        clientStatus = 'qr_ready';
        qrGenerationTime = Date.now();
      });

      client.on('ready', () => {
        console.log('✅ Client ready');
        clientStatus = 'ready';
        latestQR = null;
        clientInitialized = true;
      });

      client.on('auth_failure', (msg) => {
        console.error('❌ Auth failure:', msg);
        clientStatus = 'error';
        latestQR = null;
      });

      client.on('disconnected', (reason) => {
        console.log('❌ Client disconnected:', reason);
        clientStatus = 'disconnected';
        clientInitialized = false;
        latestQR = null;
        
        // Auto reconnect after delay
        setTimeout(() => {
          console.log('🔄 Attempting reconnection...');
          initializeWhatsAppClient().catch(console.error);
        }, 5000);
      });

      // Initialize with timeout
      await Promise.race([
        client.initialize(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Initialization timeout')), 30000)
        )
      ]);


      return true;
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      clientStatus = 'error';
      
      // Clean up locks on error
      await cleanupStaleLocks().catch(() => {});
      
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

// ========== EXPRESS SERVER ==========
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cortex AI Bot Status</title>
      <meta http-equiv="refresh" content="5">
      <style>
        body {
          font-family: monospace;
          background: #0a0a0a;
          color: #00ff00;
          padding: 20px;
          text-align: center;
        }
        .status {
          font-size: 24px;
          margin: 20px;
          padding: 20px;
          border: 2px solid #00ff00;
          border-radius: 10px;
          display: inline-block;
        }
        .error { border-color: #ff0000; color: #ff0000; }
        .warning { border-color: #ffaa00; color: #ffaa00; }
      </style>
    </head>
    <body>
      <h1>🤖 CORTEX AI BOT</h1>
      <div class="status ${clientStatus === 'error' ? 'error' : clientStatus === 'ready' ? '' : 'warning'}">
        Status: ${clientStatus.toUpperCase()}
      </div>
      <p>🌐 <a href="/qr" style="color: #00ff00;">Ver QR Code</a></p>
      <p><small>Actualiza automáticamente cada 5 segundos</small></p>
    </body>
    </html>
  `);
});

// Update the QR endpoint with better error handling
app.get('/qr', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    
    try {
        // Check if client is initializing
        if (clientStatus === 'initializing') {
            return res.send(`
                <!DOCTYPE html><html><head>
                    <title>Iniciando...</title>
                    <meta http-equiv="refresh" content="5">
                    <style>
                        body { 
                            font-family: monospace;
                            background: #000;
                            color: #0f0;
                            text-align: center;
                            padding: 20px;
                        }
                    </style>
                </head><body>
                    <h2>⏳ Iniciando cliente...</h2>
                    <p>Por favor espera...</p>
                    <p>Actualizando en 5 segundos...</p>
                </body></html>
            `);
        }

        // Try to initialize if not ready
        if (!clientInitialized) {
            try {
                await initializeWhatsAppClient();
            } catch (error) {
                console.error('Failed to initialize client:', error);
                return res.status(500).send(`
                    <!DOCTYPE html><html><head>
                        <title>Error</title>
                        <meta http-equiv="refresh" content="5">
                        <style>
                            body { 
                                font-family: monospace;
                                background: #000;
                                color: #ff0000;
                                text-align: center;
                                padding: 20px;
                            }
                        </style>
                    </head><body>
                        <h2>❌ Error de inicialización</h2>
                        <p>${error.message}</p>
                        <p>Reintentando en 5 segundos...</p>
                    </body></html>
                `);
            }
        }

        // Check QR timeout
        if (qrGenerationTime && Date.now() - qrGenerationTime > QR_TIMEOUT) {
            latestQR = null;
            clientStatus = 'timeout';
            // Try to reinitialize
            initializeWhatsAppClient().catch(console.error);
        }

        if (!latestQR || clientStatus === 'ready' || clientStatus === 'error' || clientStatus === 'timeout') {
            const status = {
                ready: '✅ Cliente conectado',
                error: '❌ Error de conexión - Reintentando...',
                timeout: '⏰ QR expirado - Generando nuevo...',
                initializing: '⏳ Iniciando cliente...',
                disconnected: '🔌 Desconectado - Reconectando...'
            }[clientStatus] || '⏳ Generando QR...';

            return res.send(`
                <!DOCTYPE html><html><head>
                    <title>Cortex AI Bot - Estado</title>
                    <meta http-equiv="refresh" content="5">
                    <style>
                        body { 
                            font-family: monospace; 
                            background: #000; 
                            color: #0f0; 
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            min-height: 100vh;
                            margin: 0;
                            padding: 20px;
                            text-align: center;
                        }
                        .status-box {
                            background: rgba(0,255,0,0.1);
                            padding: 20px 40px;
                            border-radius: 10px;
                            border: 1px solid #0f0;
                            max-width: 500px;
                        }
                        .error { color: #ff0000; border-color: #ff0000; background: rgba(255,0,0,0.1); }
                        .warning { color: #ffaa00; border-color: #ffaa00; background: rgba(255,170,0,0.1); }
                        .retry-btn {
                            background: #1a1a1a;
                            color: #0f0;
                            border: 1px solid #0f0;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            margin-top: 15px;
                        }
                        .retry-btn:hover { background: #2a2a2a; }
                    </style>
                </head><body>
                    <div class="status-box ${clientStatus === 'error' ? 'error' : clientStatus === 'timeout' ? 'warning' : ''}">
                        <h2>${status}</h2>
                        <p>Estado: ${clientStatus}</p>
                        <p>Última actualización: ${new Date().toLocaleTimeString()}</p>
                        ${clientStatus === 'error' || clientStatus === 'timeout' ? 
                            '<button class="retry-btn" onclick="window.location.reload()">Reintentar</button>' : 
                            '<p>Actualizando automáticamente...</p>'}
                    </div>
                </body>
            </html>
            `);
        }

        const qrSVG = await QRCode.toString(latestQR, { 
            type: 'svg',
            width: 400,
            margin: 4,
            color: {
                dark: '#000',
                light: '#fff'
            }
        });

        // Return the QR code page
        return res.send(`
            <!DOCTYPE html><html><head>
                <title>Cortex AI Bot - Escanea QR</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta http-equiv="refresh" content="60">
                <style>
                    body {
                        font-family: system-ui, -apple-system, sans-serif;
                        background: #1a1a1a;
                        color: #fff;
                        margin: 0;
                        padding: 20px;
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                    }
                    .container { max-width: 500px; }
                    h1 { color: #00ff00; margin-bottom: 30px; }
                    .qr-box {
                        background: white;
                        padding: 20px;
                        border-radius: 15px;
                        display: inline-block;
                        margin: 20px auto;
                        box-shadow: 0 0 50px rgba(0,255,0,0.2);
                    }
                    .instructions {
                        background: rgba(255,255,255,0.1);
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                        text-align: left;
                    }
                    .warning {
                        background: rgba(255,180,0,0.2);
                        border-left: 4px solid #ffb400;
                        padding: 15px;
                        margin-top: 15px;
                        text-align: left;
                    }
                </style>
            </head><body>
                <div class="container">
                    <h1>📱 CORTEX AI BOT</h1>
                    <div class="qr-box">${qrSVG}</div>
                    <div class="instructions">
                        <strong>📋 Para conectar:</strong>
                        <ol>
                            <li>Abre WhatsApp en tu celular</li>
                            <li>Toca Menú (⋮) → Dispositivos vinculados</li>
                            <li>Selecciona "Vincular dispositivo"</li>
                            <li>Apunta la cámara al código QR</li>
                        </ol>
                    </div>
                    <div class="warning">
                        <strong>⚠️ Importante:</strong><br>
                        Este código QR expira en 60 segundos.<br>
                        Si expira, refresca la página para generar uno nuevo.
                    </div>
                </div>
            </body></html>
        `);

    } catch (error) {
        console.error('Error en /qr:', error);
        return res.status(500).send(`
            <!DOCTYPE html><html><head>
                <title>Error</title>
                <meta http-equiv="refresh" content="5">
                <style>
                    body { 
                        font-family: monospace; 
                        background: #000; 
                        color: #ff0000; 
                        padding: 20px; 
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                    .error-box {
                        background: rgba(255,0,0,0.1);
                        padding: 20px;
                        border-radius: 10px;
                        border: 1px solid #ff0000;
                        max-width: 500px;
                    }
                    a { color: #00ff00; }
                </style>
            </head><body>
                <div class="error-box">
                    <h1>❌ Error</h1>
                    <p>${error.message}</p>
                    <p>Reintentando en 5 segundos...</p>
                    <p><a href="/qr">Reintentar ahora</a></p>
                </div>
            </body></html>
        `);
    }
});

app.get('/health', (req, res) => {
  res.json({
    status: clientStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.listen(PORT, async () => {
  console.log(`✅ HTTP server running on port ${PORT}`);
  try {
    await initializeWhatsAppClient();
  } catch (error) {
    console.error('❌ Initial client initialization failed:', error);
  }
});

// ========== HELPERS FS (CON MEJOR MANEJO DE ERRORES) ==========
async function ensureDir(p) {
  try {
    await fs.access(p);
  } catch {
    await fs.mkdir(p, { recursive: true });
    console.log(`✅ Directorio creado: ${p}`);
  }
}

async function initDataFiles() {
  try {
    await ensureDir(DATA_DIR);
    await ensureDir(PROMPTS_DIR);
    await ensureDir(path.join(DATA_DIR, 'session'));
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    for (const [file, def] of [
      [BOOKINGS_FILE, []],
      [RESERVAS_FILE, {}],
      [SCHEDULED_MESSAGES_FILE, []]
    ]) {
      try {
        await fs.access(file);
        const content = await fs.readFile(file, 'utf8');
        JSON.parse(content);
        console.log(`✅ Archivo válido: ${path.basename(file)}`);
      } catch {
        await fs.writeFile(file, JSON.stringify(def, null, 2));
        console.log(`✅ Creado: ${path.basename(file)}`);
      }
    }

    if (!fssync.existsSync(BARBERIA_BASE_PATH)) {
      const defaultBarberiaConfig = {
        servicios: {
          "corte clásico": { precio: 25000, min: 40, emoji: "✂️" },
          "barba": { precio: 20000, min: 30, emoji: "🧔" }
        },
        horario: { lun_vie: "9:00-20:00", sab: "9:00-20:00", dom: "Cerrado" },
        negocio: { nombre: "Barbería Demo", direccion: "Calle Principal #123", telefono: "300-123-4567" },
        pagos: ["Efectivo", "Nequi", "Bancolombia"],
        faqs: [],
        upsell: "",
        system_prompt: "Eres el asistente de una barbería. Agenda citas de forma eficiente."
      };
      await fs.writeFile(BARBERIA_BASE_PATH, JSON.stringify(defaultBarberiaConfig, null, 2));
      console.log('✅ Creado barberia_base.txt con configuración por defecto');
    }

    if (!fssync.existsSync(VENTAS_PROMPT_PATH)) {
      await fs.writeFile(VENTAS_PROMPT_PATH, 'Eres Cortex IA, asistente de ventas. Guía a los usuarios a probar /start test.');
      console.log('✅ Creado ventas.txt con prompt por defecto');
    }

    console.log('✅ Todos los archivos de datos inicializados correctamente');
  } catch (error) {
    console.error('❌ Error CRÍTICO inicializando archivos:', error);
    throw error;
  }
}

// ========== LECTURA/ESCRITURA JSON ==========
async function readJson(file, fallback) {
  try { 
    const content = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(content);
    
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      console.warn(`⚠️ ${file} no es un array, usando fallback`);
      return fallback;
    }
    if (typeof fallback === 'object' && !Array.isArray(fallback) && Array.isArray(parsed)) {
      console.warn(`⚠️ ${file} no es un objeto, usando fallback`);
      return fallback;
    }
    
    return parsed;
  }
  catch (e) { 
    console.warn(`⚠️ Error leyendo ${file}: ${e.message}, usando fallback`);
    return fallback; 
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ========== PROMPTS / CONFIG ==========
let BARBERIA_CONFIG = null;
let VENTAS_PROMPT = '';

function parseFirstJsonBlock(text) {
  try { return JSON.parse(text); } catch (_) {}
  const s = text.indexOf('{'); 
  if (s === -1) return null;
  let depth = 0;
  for (let i = s; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++; 
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(s, i + 1)); } 
        catch { return null; }
      }
    }
  }
  return null;
}

async function cargarConfigBarberia() {
  try {
    console.log(`📖 Cargando: ${BARBERIA_BASE_PATH}`);
    const raw = await fs.readFile(BARBERIA_BASE_PATH, 'utf8');
    const parsed = parseFirstJsonBlock(raw);
    
    if (!parsed || typeof parsed !== 'object') {
      console.error('❌ barberia_base.txt no tiene JSON válido. Usando fallback.');
      BARBERIA_CONFIG = { 
        servicios: {}, 
        horario: {}, 
        negocio: {}, 
        pagos: [], 
        faqs: [], 
        upsell: "", 
        system_prompt: "" 
      };
    } else {
      BARBERIA_CONFIG = parsed;
      BARBERIA_CONFIG.negocio = BARBERIA_CONFIG.negocio || {};
      BARBERIA_CONFIG.horario = BARBERIA_CONFIG.horario || {};
      BARBERIA_CONFIG.servicios = BARBERIA_CONFIG.servicios || {};
      BARBERIA_CONFIG.pagos = BARBERIA_CONFIG.pagos || [];
      BARBERIA_CONFIG.faqs = BARBERIA_CONFIG.faqs || [];
      BARBERIA_CONFIG.upsell = BARBERIA_CONFIG.upsell || "";
      BARBERIA_CONFIG.system_prompt = BARBERIA_CONFIG.system_prompt || "";
      
      console.log(`✅ Barbería config cargada (${Object.keys(BARBERIA_CONFIG.servicios).length} servicios)`);
    }
  } catch (e) {
    console.error('❌ Error cargando barberia_base.txt:', e.message);
    BARBERIA_CONFIG = { 
      servicios: {}, 
      horario: {}, 
      negocio: {}, 
      pagos: [], 
      faqs: [], 
      upsell: "", 
      system_prompt: "" 
    };
  }
}

async function cargarVentasPrompt() {
  try {
    VENTAS_PROMPT = await fs.readFile(VENTAS_PROMPT_PATH, 'utf8');
    console.log('✅ Ventas prompt cargado');
  } catch (e) {
    console.error('❌ Error cargando ventas.txt:', e.message);
    VENTAS_PROMPT = 'Eres Cortex IA, asistente de ventas. Responde breve, humano, y guía a la demo (/start test).';
  }
}

// ========== UTIL ==========
function now() { return DateTime.now().setZone(TIMEZONE); }

function formatearHora(hhmm) { 
  const [h, m] = hhmm.split(':').map(Number); 
  const ampm = h >= 12 ? 'PM' : 'AM'; 
  const h12 = h % 12 || 12; 
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`; 
}

// ========== ARCHIVOS DE ESTADO ==========
async function readBookings() { return readJson(BOOKINGS_FILE, []); }
async function writeBookings(d) { return writeJson(BOOKINGS_FILE, d); }
async function readReservas() { return readJson(RESERVAS_FILE, {}); }
async function writeReservas(d) { return writeJson(RESERVAS_FILE, d); }
async function readScheduledMessages() { return readJson(SCHEDULED_MESSAGES_FILE, []); }
async function writeScheduledMessages(d) { return writeJson(SCHEDULED_MESSAGES_FILE, d); }

// ========== USER STATE ==========
const userStates = new Map();

function getUserState(userId) {
  if (!userStates.has(userId)) {
    userStates.set(userId, { 
      mode: 'sales', 
      conversationHistory: [], 
      botEnabled: true 
    });
  }
  return userStates.get(userId);
}

// ========== SLOTS ==========
function calcularSlotsUsados(horaInicio, duracionMin) { 
  const base = 20; 
  const blocks = Math.ceil(duracionMin / base); 
  const [h, m] = horaInicio.split(':').map(Number); 
  const out = []; 
  
  for (let i = 0; i < blocks; i++) { 
    const total = h * 60 + m + i * base; 
    const hh = Math.floor(total / 60); 
    const mm = total % 60; 
    out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`); 
  } 
  return out; 
}

async function verificarDisponibilidad(fecha, horaInicio, duracionMin) {
  const reservas = await readReservas();
  const slotsReservados = reservas[fecha] || [];
  const slotsNecesarios = calcularSlotsUsados(horaInicio, duracionMin);
  
  console.log(`[DISPONIBILIDAD] Fecha: ${fecha}, Hora: ${horaInicio}, Duración: ${duracionMin}min`);
  console.log(`[DISPONIBILIDAD] Slots necesarios:`, slotsNecesarios);
  console.log(`[DISPONIBILIDAD] Slots reservados:`, slotsReservados);
  
  for (const slot of slotsNecesarios) {
    if (slotsReservados.includes(slot)) {
      console.log(`[DISPONIBILIDAD] ❌ COLISIÓN en slot: ${slot}`);
      return { disponible: false, slots: slotsNecesarios, colision: slot };
    }
  }
  
  console.log(`[DISPONIBILIDAD] ✅ DISPONIBLE`);
  return { disponible: true, slots: slotsNecesarios };
}

async function sugerirHorariosAlternativos(fecha, duracionMin, limite = 3) {
  const reservas = await readReservas();
  const slotsReservados = reservas[fecha] || [];
  
  const horario = BARBERIA_CONFIG?.horario || {};
  const hoy = DateTime.fromISO(fecha).setLocale('es').toFormat('EEEE').toLowerCase();
  
  let horarioStr = '';
  if (hoy.startsWith('sá')) horarioStr = horario.sab || '9:00-20:00';
  else if (hoy.startsWith('do')) horarioStr = horario.dom || 'Cerrado';
  else horarioStr = horario.lun_vie || '9:00-20:00';
  
  if (!horarioStr || horarioStr.toLowerCase() === 'cerrado' || !horarioStr.includes('-')) {
    console.warn(`⚠️ Horario inválido para ${fecha}: "${horarioStr}"`);
    return [];
  }
  
  const partes = horarioStr.split('-');
  if (partes.length !== 2) {
    console.warn(`⚠️ Formato de horario inválido: "${horarioStr}"`);
    return [];
  }
  
  const [inicio, fin] = partes.map(s => s.trim());
  
  if (!inicio.includes(':') || !fin.includes(':')) {
    console.warn(`⚠️ Formato de hora inválido: inicio="${inicio}", fin="${fin}"`);
    return [];
  }
  
  const [hInicio, mInicio] = inicio.split(':').map(Number);
  const [hFin, mFin] = fin.split(':').map(Number);
  
  if (isNaN(hInicio) || isNaN(mInicio) || isNaN(hFin) || isNaN(mFin)) {
    console.warn(`⚠️ Horas no numéricas: ${inicio} - ${fin}`);
    return [];
  }
  
  const minutoInicio = hInicio * 60 + mInicio;
  const minutoFin = hFin * 60 + mFin;
  
  const ahora = now();
  const fechaConsulta = DateTime.fromISO(fecha, { zone: TIMEZONE });
  
  const esHoy = fechaConsulta.startOf('day').equals(ahora.startOf('day'));
  
  let minutoActual = minutoInicio;
  if (esHoy) {
    const minAhora = ahora.hour * 60 + ahora.minute + 1;
    const proximoSlot = Math.ceil(minAhora / 20) * 20;
    minutoActual = Math.max(minutoInicio, proximoSlot);
  }
  
  const alternativas = [];
  
  for (let m = minutoActual; m < minutoFin - duracionMin; m += 20) {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const horaStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    
    const check = await verificarDisponibilidad(fecha, horaStr, duracionMin);
    if (check.disponible) {
      alternativas.push(horaStr);
      if (alternativas.length >= limite) break;
    }
  }
  
  return alternativas;
}

async function generarTextoSlotsDisponiblesHoy(fecha, duracionMinDefault = 40) {
  const reservas = await readReservas();
  const slotsReservados = reservas[fecha] || [];
  
  const horario = BARBERIA_CONFIG?.horario || {};
  const dia = DateTime.fromISO(fecha).setLocale('es').toFormat('EEEE').toLowerCase();
  
  let horarioStr = '';
  if (dia.startsWith('sá')) horarioStr = horario.sab || '9:00-20:00';
  else if (dia.startsWith('do')) horarioStr = horario.dom || 'Cerrado';
  else horarioStr = horario.lun_vie || '9:00-20:00';
  
  if (!horarioStr || horarioStr.toLowerCase() === 'cerrado' || !horarioStr.includes('-')) {
    return 'Hoy estamos cerrados.';
  }
  
  const partes = horarioStr.split('-');
  if (partes.length !== 2) return 'Horario no configurado.';
  
  const [inicio, fin] = partes.map(s => s.trim());
  if (!inicio.includes(':') || !fin.includes(':')) return 'Horario no configurado.';

  const [hInicio, mInicio] = inicio.split(':').map(Number);
  const [hFin, mFin] = fin.split(':').map(Number);
  if (isNaN(hInicio) || isNaN(mInicio) || isNaN(hFin) || isNaN(mFin)) return 'Horario no configurado.';
  
  const minutoInicio = hInicio * 60 + mInicio;
  const minutoFin = hFin * 60 + mFin;
  
  const ahora = now();
  const fechaConsulta = DateTime.fromISO(fecha, { zone: TIMEZONE });
  
  const esHoy = fechaConsulta.startOf('day').equals(ahora.startOf('day'));
  
  let minutoBusqueda = minutoInicio;
  if (esHoy) {
    const minAhora = ahora.hour * 60 + ahora.minute + 1;
    const proximoSlot = Math.ceil(minAhora / 20) * 20;
    minutoBusqueda = Math.max(minutoInicio, proximoSlot);
    
    console.log(`[Slots Hoy] Hora actual: ${ahora.toFormat('HH:mm')} (${minAhora-1} min). Próximo slot: ${proximoSlot} min.`);
  }
  
  const alternativas = [];
  
  for (let m = minutoBusqueda; m <= minutoFin - duracionMinDefault; m += 20) {
    const horaStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    
    const slotsNecesarios = calcularSlotsUsados(horaStr, duracionMinDefault);
    let colision = false;
    
    for (const slot of slotsNecesarios) {
      if (slotsReservados.includes(slot)) {
        colision = true;
        break;
      }
      const [slotH, slotM] = slot.split(':').map(Number);
      if (slotH * 60 + slotM > minutoFin) {
        colision = true;
        break;
      }
    }
    
    if (!colision) {
      alternativas.push(formatearHora(horaStr));
    }
  }
  
  if (alternativas.length === 0) {
    return 'Ya no quedan cupos disponibles para hoy.';
  }
  
  return `${alternativas.join(', ')}`;
}

// ========== TAGS ==========
async function procesarTags(mensaje, chatId) {
  const bookingMatch = mensaje.match(/<BOOKING:\s*({[^>]+})>/);
  const cancelMatch = mensaje.match(/<CANCELLED:\s*({[^>]+})>/);

  if (bookingMatch) {
    try {
      const bookingData = JSON.parse(bookingMatch[1]);
    
      const [h, m] = bookingData.hora_inicio.split(':').map(Number);
      if (h < 9 || h >= 20) {
        console.error('[❌ BOOKING] Hora fuera de horario:', bookingData.hora_inicio);
        return "Lo siento, solo atendemos de 9 AM a 8 PM. ¿Quieres agendar en otro horario?";
      }
      
      const duracionMin = BARBERIA_CONFIG?.servicios?.[bookingData.servicio]?.min || 40;
      const check = await verificarDisponibilidad(
        bookingData.fecha, 
        bookingData.hora_inicio, 
        duracionMin
      );
      
      if (!check.disponible) {
        const alternativas = await sugerirHorariosAlternativos(bookingData.fecha, duracionMin);
        
        let respuesta = `⚠️ Lo siento, la hora ${formatearHora(bookingData.hora_inicio)} ya está ocupada.`;
        
        if (alternativas.length > 0) {
          respuesta += '\n\n🕐 *Horarios disponibles:*\n';
          alternativas.forEach((h, i) => {
            respuesta += `${i + 1}. ${formatearHora(h)}\n`;
          });
          respuesta += '\n¿Cuál te queda mejor?';
        } else {
          respuesta += '\n\nNo hay horarios disponibles para ese día. ¿Prefieres otro día?';
        }
        
        return respuesta;
      }
      
      bookingData.id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      bookingData.chatId = chatId;
      bookingData.createdAt = new Date().toISOString();
      bookingData.status = 'confirmed';

      const bookings = await readBookings();
      
      if (!Array.isArray(bookings)) {
        console.error('⚠️ bookings no es un array, reinicializando...');
        await writeBookings([bookingData]);
      } else {
        bookings.push(bookingData);
        await writeBookings(bookings);
      }

      const reservas = await readReservas();
      reservas[bookingData.fecha] = reservas[bookingData.fecha] || [];
      
      for (const slot of check.slots) {
        if (!reservas[bookingData.fecha].includes(slot)) {
          reservas[bookingData.fecha].push(slot);
        }
      }
      
      await writeReservas(reservas);

      await programarConfirmacion(bookingData);
      await programarRecordatorio(bookingData);
      await programarResena(bookingData);
      await programarExtranamos(bookingData);
      
      await notificarDueno(
        `📅 *Nueva cita*\n👤 ${bookingData.nombreCliente}\n🔧 ${bookingData.servicio}\n📆 ${bookingData.fecha}\n⏰ ${formatearHora(bookingData.hora_inicio)}`,
        chatId
      );
      
      console.log('✅ Booking guardado:', bookingData.id);
    } catch (e) { 
      console.error('BOOKING parse error:', e); 
    }
    return mensaje.replace(/<BOOKING:[^>]+>/, '').trim();
  }

  if (cancelMatch) {
    try {
      const cancelData = JSON.parse(cancelMatch[1]);
      console.log('[🔥 CANCELACIÓN] Datos recibidos:', JSON.stringify(cancelData, null, 2));
      
      const bookings = await readBookings();
      console.log('[🔥 CANCELACIÓN] Total de citas en sistema:', bookings.length);
      
      let b = null;
      
      if (cancelData.id) {
        console.log('[🔥 CANCELACIÓN] Buscando por ID:', cancelData.id);
        b = bookings.find(x => x.id === cancelData.id && x.status !== 'cancelled');
      } else if (cancelData.nombreCliente && cancelData.fecha && cancelData.hora_inicio) {
        console.log('[🔥 CANCELACIÓN] Buscando por nombre/fecha/hora');
        
        const nombreLower = cancelData.nombreCliente.toLowerCase().trim();
        
        b = bookings.find(x => {
          if (x.status === 'cancelled') return false;
          
          const nombreCitaLower = x.nombreCliente.toLowerCase().trim();
          
          const matchNombre = nombreCitaLower.includes(nombreLower) || nombreLower.includes(nombreCitaLower);
          const matchFecha = x.fecha === cancelData.fecha;
          const matchHora = x.hora_inicio === cancelData.hora_inicio;
          
          console.log(`[🔥 CANCELACIÓN] Comparando:`, {
            citaNombre: x.nombreCliente,
            buscando: cancelData.nombreCliente,
            matchNombre,
            matchFecha,
            matchHora
          });
          
          return matchNombre && matchFecha && matchHora;
        });
      }
      
      if (b) {
        console.log('[✅ CANCELACIÓN] Cita encontrada:', b.id);
        b.status = 'cancelled';
        await writeBookings(bookings);
        
        const reservas = await readReservas();
        if (reservas[b.fecha]) {
          const duracionMin = BARBERIA_CONFIG?.servicios?.[b.servicio]?.min || 40;
          const slotsOcupados = calcularSlotsUsados(b.hora_inicio, duracionMin);
          
          console.log('[🔥 CANCELACIÓN] Liberando slots:', slotsOcupados);
          reservas[b.fecha] = reservas[b.fecha].filter(slot => !slotsOcupados.includes(slot));
          await writeReservas(reservas);
        }
        
        console.log('[📤 CANCELACIÓN] Enviando notificación al dueño...');
        const textoNotificacion = `❌ *Cita cancelada*\n👤 ${b.nombreCliente}\n🔧 ${b.servicio}\n📆 ${b.fecha}\n⏰ ${formatearHora(b.hora_inicio)}`;
        await notificarDueno(textoNotificacion, chatId);
        
        console.log('[✅ CANCELACIÓN] Booking cancelado:', b.id);
      } else {
        console.warn('[⚠️ CANCELACIÓN] No se encontró cita con datos:', cancelData);
        return "No pude encontrar la cita que mencionas para cancelar. ¿Puedes confirmar el nombre, fecha y hora exactos?";
      }
    } catch (e) { 
      console.error('[❌ CANCELACIÓN] Error:', e.message, e.stack); 
    }
    return mensaje.replace(/<CANCELLED:[^>]+>/, '').trim();
  }

  return mensaje;
}

// ========== NOTIFICAR AL DUEÑO (VERSION CORREGIDA) ==========
async function notificarDueno(txt, fromChatId = null) {
  try {
    if (!client || !client.info) {
      console.error('[❌ NOTIFICACIÓN] Cliente de WhatsApp NO está listo todavía');
      console.error('[❌ NOTIFICACIÓN] client existe:', !!client);
      console.error('[❌ NOTIFICACIÓN] client.info existe:', !!client?.info);
      return;
    }
    
    if (fromChatId === OWNER_CHAT_ID) {
      console.log('[ℹ️ NOTIFICACIÓN] Acción del dueño - no se auto-notifica');
      return;
    }
    
    console.log(`[📤 NOTIFICACIÓN] ===================`);
    console.log(`[📤 NOTIFICACIÓN] Enviando a: ${OWNER_CHAT_ID}`);
    console.log(`[📤 NOTIFICACIÓN] Mensaje: ${txt.substring(0, 80)}...`);
    console.log(`[📤 NOTIFICACIÓN] Origen: ${fromChatId || 'sistema'}`);
    console.log(`[📤 NOTIFICACIÓN] Cliente listo: ${!!client?.info}`);
    
    const sendPromise = client.sendMessage(OWNER_CHAT_ID, txt);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: no respuesta en 15s')), 15000)
    );
    
    await Promise.race([sendPromise, timeoutPromise]);
    
    console.log('[✅ NOTIFICACIÓN] ¡Enviada exitosamente!'); 
    console.log(`[✅ NOTIFICACIÓN] ===================`);
  }
  catch (e) { 
    console.error('[❌ NOTIFICACIÓN] ×××××××××××××××××××××××');
    console.error('[❌ NOTIFICACIÓN] FALLÓ EL ENVÍO');
    console.error('[❌ NOTIFICACIÓN] Error:', e.message);
    console.error('[❌ NOTIFICACIÓN] Tipo error:', e.constructor.name);
    console.error('[❌ NOTIFICACIÓN] Stack completo:', e.stack);
    console.error('[❌ NOTIFICACIÓN] OWNER_CHAT_ID:', OWNER_CHAT_ID);
    console.error('[❌ NOTIFICACIÓN] fromChatId:', fromChatId);
    console.error('[❌ NOTIFICACIÓN] Cliente estado:', {
      existe: !!client,
      info: !!client?.info,
      pupBrowser: !!client?.pupBrowser,
      authenticated: client?.info?.wid !== undefined
    });
    console.error('[❌ NOTIFICACIÓN] ×××××××××××××××××××××××');
  }
}

// ========== DETECCIÓN AUTOMÁTICA DE CITAS (POST-OPENAI) ==========
async function detectarYCrearCitaAutomatica(conversationHistory, lastResponse, chatId) {
  try {
    const respLower = lastResponse.toLowerCase();
    const esConfirmacion = respLower.includes('agend') || respLower.includes('confirm') || 
                          respLower.includes('reserv') || respLower.includes('listo') ||
                          respLower.includes('perfect');
    
    if (!esConfirmacion) return;
    
    console.log('[🔍 AUTO-CITA] Analizando conversación para extraer datos...');
    
    const ultimos = conversationHistory.slice(-10);
    
    let servicio = null;
    let fecha = null;
    let hora = null;
    let nombre = null;
    
    const serviciosValidos = Object.keys(BARBERIA_CONFIG?.servicios || {});
    const ahora = now();
    
    for (const msg of ultimos) {
      const texto = (msg.content || '').toLowerCase();
      
      if (!servicio) {
        for (const srv of serviciosValidos) {
          if (texto.includes(srv.toLowerCase()) || 
              texto.includes(srv.toLowerCase().replace(' ', ''))) {
            servicio = srv;
            console.log('[🔍 AUTO-CITA] Servicio encontrado:', servicio);
            break;
          }
        }
      }
      
      if (!hora) {
        const horaMatch = texto.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
        if (horaMatch) {
          let h = parseInt(horaMatch[1]);
          const m = horaMatch[2] || '00';
          const ampm = horaMatch[3]?.toLowerCase();
          
          if (ampm === 'pm' && h < 12) h += 12;
          if (ampm === 'am' && h === 12) h = 0;
          
          if (h >= 9 && h < 20) {
            hora = `${String(h).padStart(2, '0')}:${m}`;
            console.log('[🔍 AUTO-CITA] Hora encontrada:', hora);
          }
        }
      }
      
      if (!fecha) {
        if (texto.includes('mañana') || texto.includes('tomorrow')) {
          fecha = ahora.plus({ days: 1 }).toFormat('yyyy-MM-dd');
          console.log('[🔍 AUTO-CITA] Fecha: mañana ->', fecha);
        } else if (texto.includes('hoy') || texto.includes('today')) {
          fecha = ahora.toFormat('yyyy-MM-dd');
          console.log('[🔍 AUTO-CITA] Fecha: hoy ->', fecha);
        } else if (texto.includes('pasado mañana')) {
          fecha = ahora.plus({ days: 2 }).toFormat('yyyy-MM-dd');
          console.log('[🔍 AUTO-CITA] Fecha: pasado mañana ->', fecha);
        }
      }
      
      if (!nombre && msg.role === 'user') {
        const nombreMatch = texto.match(/(?:soy|nombre|llamo|me llamo)\s+([a-záéíóúñ\s]{2,30})/i);
        if (nombreMatch) {
          nombre = nombreMatch[1].trim();
          nombre = nombre.split(' ').map(p => 
            p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
          ).join(' ');
          console.log('[🔍 AUTO-CITA] Nombre encontrado:', nombre);
        } else {
          const palabras = msg.content.split(/\s+/);
          for (const palabra of palabras) {
            if (/^[A-ZÁÉÍÓÚÑ'][a-záéíóúñ]{2,}$/.test(palabra) && 
                palabra.length > 2 && 
                !['Para', 'Quiero', 'Hola', 'Buenos', 'Días'].includes(palabra)) {
              nombre = palabra;
              console.log('[🔍 AUTO-CITA] Nombre por capitalización:', nombre);
              break;
            }
          }
        }
      }
    }
    
    if (!servicio || !fecha || !hora || !nombre) {
      console.log('[🔍 AUTO-CITA] Datos incompletos:', { servicio, fecha, hora, nombre });
      return;
    }
    
    const bookings = await readBookings();
    const citaExistente = bookings.find(b => 
      b.chatId === chatId && 
      b.fecha === fecha && 
      b.hora_inicio === hora &&
      b.status !== 'cancelled'
    );
    
    if (citaExistente) {
      console.log('[🔍 AUTO-CITA] Ya existe cita similar, no duplicar');
      return;
    }
    
    console.log('[🔥 AUTO-CITA] ¡Todos los datos completos! Creando cita...');
    
    const duracionMin = BARBERIA_CONFIG?.servicios?.[servicio]?.min || 40;
    const check = await verificarDisponibilidad(fecha, hora, duracionMin);
    if (!check.disponible) {
      console.log('[❌ AUTO-CITA] Horario no disponible');
      return;
    }
    
    const bookingData = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      chatId,
      nombreCliente: nombre,
      servicio,
      fecha,
      hora_inicio: hora,
      createdAt: new Date().toISOString(),
      status: 'confirmed'
    };
    
    bookings.push(bookingData);
    await writeBookings(bookings);
    
    const reservas = await readReservas();
    const slotsOcupados = calcularSlotsUsados(hora, duracionMin);
    if (!reservas[fecha]) reservas[fecha] = [];
    reservas[fecha].push(...slotsOcupados);
    await writeReservas(reservas);
    
    await programarConfirmacion(bookingData);
    await programarRecordatorio(bookingData);
    await programarResena(bookingData);
    await programarExtranamos(bookingData);
    
    console.log('[🔥 AUTO-CITA] Notificando al dueño...');
    await notificarDueno(
      `📅 *Nueva cita (auto-detectada)*\n👤 ${nombre}\n🔧 ${servicio}\n📆 ${fecha}\n⏰ ${formatearHora(hora)}`,
      chatId
    );
    
    console.log('[✅ AUTO-CITA] Cita creada exitosamente:', bookingData.id);
    
  } catch (e) {
    console.error('[❌ AUTO-CITA] Error:', e.message);
  }
}

// ========== CANCELACIÓN DIRECTA (SIN DEPENDER DE OPENAI) ==========
async function manejarCancelacionDirecta(userMessage, chatId) {
  const msgLower = userMessage.toLowerCase().trim();
  const state = getUserState(chatId);
  
  if (state.esperandoConfirmacionCancelacion && state.citaParaCancelar) {
    const confirma = msgLower === 'si' || msgLower === 'sí' || 
                     msgLower === 'confirmo' || msgLower === 'dale' ||
                     msgLower === 'ok' || msgLower === 'yes';
    
    console.log('[🔥 CANCELACIÓN DIRECTA] Esperando confirmación, usuario dice:', msgLower);
    console.log('[🔥 CANCELACIÓN DIRECTA] Confirma:', confirma);
    
    if (confirma) {
      const cita = state.citaParaCancelar;
      
      const bookings = await readBookings();
      const citaIndex = bookings.findIndex(b => b.id === cita.id);
      if (citaIndex !== -1) {
        bookings[citaIndex].status = 'cancelled';
        await writeBookings(bookings);
        
        console.log('[🔥 CANCELACIÓN DIRECTA] Cita marcada como cancelada:', cita.id);
        
        const reservas = await readReservas();
        if (reservas[cita.fecha]) {
          const duracionMin = BARBERIA_CONFIG?.servicios?.[cita.servicio]?.min || 40;
          const slotsOcupados = calcularSlotsUsados(cita.hora_inicio, duracionMin);
          reservas[cita.fecha] = reservas[cita.fecha].filter(slot => !slotsOcupados.includes(slot));
          await writeReservas(reservas);
          console.log('[🔥 CANCELACIÓN DIRECTA] Slots liberados:', slotsOcupados);
        }
        
        console.log('[📤 CANCELACIÓN] Enviando notificación al dueño...');
        await notificarDueno(
          `❌ *Cita cancelada*\n👤 ${cita.nombreCliente}\n🔧 ${cita.servicio}\n📆 ${cita.fecha}\n⏰ ${formatearHora(cita.hora_inicio)}`,
          chatId
        );
        
        state.esperandoConfirmacionCancelacion = false;
        state.citaParaCancelar = null;
        console.log('[✅ CANCELACIÓN DIRECTA] Proceso completo');
        
        return `✅ Listo, tu cita del ${cita.fecha} a las ${formatearHora(cita.hora_inicio)} ha sido cancelada. Si necesitas reprogramar, avísame. 😊`;
      }
    } else {
      state.esperandoConfirmacionCancelacion = false;
      state.citaParaCancelar = null;
      return "Ok, tu cita sigue activa. ¿En qué más puedo ayudarte?";
    }
  }
  
  if (state.citasParaCancelar && state.citasParaCancelar.length > 0) {
    const numeroMatch = userMessage.match(/\b(\d+)\b/);
    
    if (numeroMatch) {
      const numero = parseInt(numeroMatch[1]);
      console.log('[🔥 CANCELACIÓN DIRECTA] Usuario seleccionó número:', numero);
      
      if (numero >= 1 && numero <= state.citasParaCancelar.length) {
        const cita = state.citasParaCancelar[numero - 1];
        
        state.esperandoConfirmacionCancelacion = true;
        state.citaParaCancelar = cita;
        state.citasParaCancelar = null;
        
        console.log('[🔥 CANCELACIÓN DIRECTA] Preguntando confirmación para:', cita.id);
        return `¿Me confirmas que deseas cancelar tu cita del ${cita.fecha} a las ${formatearHora(cita.hora_inicio)} para ${cita.servicio}?\n\nResponde "sí" para confirmar.`;
      } else {
        return `Por favor responde con un número entre 1 y ${state.citasParaCancelar.length}.`;
      }
    }
    
    state.citasParaCancelar = null;
  }
  
  const palabrasCancelacion = [
    'cancelar',
    'cancela',
    'cancelarla',
    'cancelarlo',
    'quitar la cita',
    'anular',
    'no puedo ir',
    'no voy a poder'
  ];
  
  const esCancelacion = palabrasCancelacion.some(p => msgLower.includes(p));
  
  if (!esCancelacion) {
    return null;
  }
  
  console.log('[🔥 CANCELACIÓN DIRECTA] Detectada palabra de cancelación');
  
  const bookings = await readBookings();
  const ahora = now();
  
  const citasActivas = bookings.filter(b => {
    if (b.chatId !== chatId || b.status === 'cancelled') return false;
    
    const [year, month, day] = b.fecha.split('-').map(Number);
    const [hour, minute] = b.hora_inicio.split(':').map(Number);
    const fechaHoraCita = DateTime.fromObject(
      { year, month, day, hour, minute }, 
      { zone: TIMEZONE }
    );
    
    return fechaHoraCita > ahora;
  });
  
  console.log('[🔥 CANCELACIÓN DIRECTA] Citas activas del usuario:', citasActivas.length);
  
  if (citasActivas.length === 0) {
    return "No encontré ninguna cita activa futura para cancelar. ¿Necesitas ayuda con algo más?";
  }
  
  const horaMatch = userMessage.match(/(\d{1,2}):?(\d{2})\s*(am|pm)?/i);
  if (horaMatch) {
    let hora = parseInt(horaMatch[1]);
    const minuto = horaMatch[2];
    const ampm = horaMatch[3]?.toLowerCase();
    
    if (ampm === 'pm' && hora < 12) hora += 12;
    if (ampm === 'am' && hora === 12) hora = 0;
    
    const horaStr = `${String(hora).padStart(2, '0')}:${minuto}`;
    
    const citaPorHora = citasActivas.find(c => c.hora_inicio === horaStr);
    if (citaPorHora) {
      console.log('[🔥 CANCELACIÓN DIRECTA] Encontrada cita por hora:', horaStr);
      state.esperandoConfirmacionCancelacion = true;
      state.citaParaCancelar = citaPorHora;
      return `¿Me confirmas que deseas cancelar tu cita del ${citaPorHora.fecha} a las ${formatearHora(citaPorHora.hora_inicio)} para ${citaPorHora.servicio}?\n\nResponde "sí" para confirmar.`;
    }
  }
  
  const fechaMatch = userMessage.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2})/);
  if (fechaMatch) {
    const fechaBuscada = fechaMatch[1] || `${ahora.year}-${String(ahora.month).padStart(2, '0')}-${String(fechaMatch[2]).padStart(2, '0')}`;
    
    const citasPorFecha = citasActivas.filter(c => c.fecha === fechaBuscada);
    if (citasPorFecha.length === 1) {
      const cita = citasPorFecha[0];
      console.log('[🔥 CANCELACIÓN DIRECTA] Encontrada cita por fecha:', fechaBuscada);
      state.esperandoConfirmacionCancelacion = true;
      state.citaParaCancelar = cita;
      return `¿Me confirmas que deseas cancelar tu cita del ${cita.fecha} a las ${formatearHora(cita.hora_inicio)} para ${cita.servicio}?\n\nResponde "sí" para confirmar.`;
    }
  }
  
  if (citasActivas.length === 1) {
    const cita = citasActivas[0];
    state.esperandoConfirmacionCancelacion = true;
    state.citaParaCancelar = cita;
    console.log('[🔥 CANCELACIÓN DIRECTA] Solo 1 cita, preguntando confirmación');
    return `¿Me confirmas que deseas cancelar tu cita del ${cita.fecha} a las ${formatearHora(cita.hora_inicio)} para ${cita.servicio}?\n\nResponde "sí" para confirmar.`;
  }
  
  let msg = "Tienes varias citas activas:\n\n";
  citasActivas.forEach((c, i) => {
    msg += `${i+1}. ${c.servicio} - ${c.fecha} a las ${formatearHora(c.hora_inicio)}\n`;
  });
  msg += "\n¿Cuál deseas cancelar? Responde con:\n- El número (ej: 1)\n- La fecha (ej: 24)\n- La hora (ej: 7:20 PM)";
  
  state.citasParaCancelar = citasActivas;
  
  return msg;
}

// ========== PROGRAMACIONES ==========
async function programarConfirmacion(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); 
    const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.minus({ hours: 2 });
    
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ 
        id: `confirm_${booking.id}`, 
        chatId: booking.chatId, 
        scheduledFor: when.toISO(), 
        type: 'confirmation', 
        message: `👋 Hola ${booking.nombreCliente}! Te recordamos tu cita de *${booking.servicio}* hoy a las ${formatearHora(booking.hora_inicio)}.\n\n¿Confirmas que asistirás? Responde *SÍ* o *NO*.`, 
        bookingId: booking.id 
      });
      await writeScheduledMessages(messages); 
      console.log('✅ Confirmación programada:', when.toISO());
    }
  } catch (e) { 
    console.error('❌ Error programarConfirmacion:', e.message); 
  }
}

async function programarRecordatorio(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); 
    const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.minus({ minutes: 30 });
    
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ 
        id:`reminder_${booking.id}`, 
        chatId: booking.chatId, 
        scheduledFor: when.toISO(), 
        type: 'reminder', 
        message: `⏰ *Recordatorio*\n\nHola ${booking.nombreCliente}! Tu cita de *${booking.servicio}* es en 30 minutos (${formatearHora(booking.hora_inicio)}).\n\nNos vemos pronto! 💈`, 
        bookingId: booking.id 
      });
      await writeScheduledMessages(messages); 
      console.log('✅ Recordatorio programado:', when.toISO());
    }
  } catch (e) { 
    console.error('❌ Error programarRecordatorio:', e.message); 
  }
}

async function programarResena(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); 
    const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.plus({ days: 1, hours: 2 });
    
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ 
        id:`review_${booking.id}`, 
        chatId: booking.chatId, 
        scheduledFor: when.toISO(), 
        type: 'review', 
        message: `⭐ Hola ${booking.nombreCliente}!\n\nEsperamos que hayas quedado contento con tu *${booking.servicio}* 😊\n\n¿Nos ayudas con una reseña en Google? Nos ayuda a crecer:\n\n${GOOGLE_REVIEW_LINK}\n\n¡Gracias! 💈`, 
        bookingId: booking.id 
      });
      await writeScheduledMessages(messages); 
      console.log('✅ Reseña programada:', when.toISO());
    }
  } catch (e) { 
    console.error('❌ Error programarResena:', e.message); 
  }
}

async function programarExtranamos(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); 
    const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.plus({ weeks: 2 });
    
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ 
        id:`winback_${booking.id}`, 
        chatId: booking.chatId, 
        scheduledFor: when.toISO(), 
        type: 'winback', 
        message: `👋 ${booking.nombreCliente}, te extrañamos! ¿Agendamos otra? 💈\n\n*10% OFF* en tu próxima cita!`, 
        bookingId: booking.id 
      });
      await writeScheduledMessages(messages); 
      console.log('✅ "Te extrañamos" programado:', when.toISO());
    }
  } catch (e) { 
    console.error('❌ Error programarExtranamos:', e.message); 
  }
}

// ========== ENVIAR MENSAJES PROGRAMADOS ==========
setInterval(async () => {
  try {
    const messages = await readScheduledMessages();
    const t = now();
    const remain = [];
    
    for (const m of messages) {
      const when = DateTime.fromISO(m.scheduledFor);
      
      if (when <= t) {
        try { 
          await client.sendMessage(m.chatId, m.message); 
          console.log(`✅ Mensaje ${m.type} enviado:`, m.id); 
        }
        catch (e) { 
          console.error('❌ Error enviando mensaje:', e.message); 
          remain.push(m); 
        }
      } else {
        remain.push(m);
      }
    }
    
    await writeScheduledMessages(remain);
  } catch (e) { 
    console.error('❌ Error en scheduler:', e.message); 
  }
}, 60000);

// ========== GENERADORES PARA SYSTEM PROMPT ==========
function generarTextoServicios() {
  if (!BARBERIA_CONFIG?.servicios) return '';
  return Object.entries(BARBERIA_CONFIG.servicios).map(([nombre, s]) => {
    const precio = (s.precio || 0).toLocaleString('es-CO'); 
    const min = s.min || 'N/A'; 
    const emoji = s.emoji || '✂️';
    return `${emoji} ${nombre} — ${precio} — ${min} min`;
  }).join('\n');
}

function generarTextoFAQs() {
  if (!BARBERIA_CONFIG?.faqs) return '';
  return BARBERIA_CONFIG.faqs.map((f,i)=>`${i+1}. ${f.q}\n   → ${f.a}`).join('\n\n');
}

// ========== COMANDO /show bookings ==========
async function mostrarReservas(chatId) {
  try {
    const bookings = await readBookings();
    const ahora = now();
    
    const citasFuturas = bookings.filter(b => {
      if (b.status === 'cancelled') return false;
      
      const [year, month, day] = b.fecha.split('-').map(Number);
      const [hour, minute] = b.hora_inicio.split(':').map(Number);
      const fechaHoraCita = DateTime.fromObject(
        { year, month, day, hour, minute }, 
        { zone: TIMEZONE }
      );
      
      return fechaHoraCita > ahora;
    });
    
    if (citasFuturas.length === 0) {
      return '📅 *No hay citas programadas*\n\nNo tienes citas futuras en este momento.';
    }
    
    citasFuturas.sort((a, b) => {
      const dateA = new Date(a.fecha + 'T' + a.hora_inicio);
      const dateB = new Date(b.fecha + 'T' + b.hora_inicio);
      return dateA - dateB;
    });
    
    let mensaje = '📅 *CITAS PROGRAMADAS*\n\n';
    
    citasFuturas.forEach((cita, index) => {
      const [year, month, day] = cita.fecha.split('-').map(Number);
      const fechaDT = DateTime.fromObject({ year, month, day }, { zone: TIMEZONE });
      const fechaLegible = fechaDT.setLocale('es').toFormat('EEEE d \'de\' MMMM');
      
      mensaje += `${index + 1}. 👤 *${cita.nombreCliente}*\n`;
      mensaje += `   🔧 ${cita.servicio}\n`;
      mensaje += `   📆 ${fechaLegible}\n`;
      mensaje += `   ⏰ ${formatearHora(cita.hora_inicio)}\n\n`;
    });
    
    return mensaje.trim();
  } catch (error) {
    console.error('❌ Error en mostrarReservas:', error);
    return '❌ Error al cargar las reservas. Intenta de nuevo.';
  }
}

// ========== COMANDO /send later ==========
async function programarMensajePersonalizado(args, fromChatId) {
  try {
    const regex = /"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/;
    const match = args.match(regex);
    
    if (!match) {
      return '❌ Formato incorrecto.\n\nUso:\n`/send later "573001234567" "2025-10-25 10:30" "Tu mensaje aquí"`\n\n📝 Formato de fecha: YYYY-MM-DD HH:MM';
    }
    
    const [, numero, fechaHora, mensaje] = match;
    
    if (!/^\d{10,15}$/.test(numero)) {
      return '❌ Número inválido. Debe incluir código de país sin + (ej: 573001234567)';
    }
    
    const fechaHoraDT = DateTime.fromFormat(fechaHora, 'yyyy-MM-dd HH:mm', { zone: TIMEZONE });
    
    if (!fechaHoraDT.isValid) {
      return '❌ Fecha/hora inválida.\n\nFormato: YYYY-MM-DD HH:MM\nEjemplo: 2025-10-25 14:30';
    }
    
    if (fechaHoraDT <= now()) {
      return '❌ La fecha/hora debe ser futura.';
    }
    
    const messages = await readScheduledMessages();
    const nuevoMensaje = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      chatId: `${numero}@c.us`,
      scheduledFor: fechaHoraDT.toISO(),
      type: 'custom',
      message: mensaje,
      scheduledBy: fromChatId
    };
    
    messages.push(nuevoMensaje);
    await writeScheduledMessages(messages);
    
    const fechaLegible = fechaHoraDT.setLocale('es').toFormat('EEEE d \'de\' MMMM \'a las\' HH:mm');
    
    return `✅ *Mensaje programado*\n\n📱 Para: ${numero}\n📅 ${fechaLegible}\n💬 "${mensaje}"\n\n🔔 Se enviará automáticamente.`;
    
  } catch (error) {
    console.error('❌ Error en programarMensajePersonalizado:', error);
    return '❌ Error al programar el mensaje. Revisa el formato.';
  }
}

// ========== COMANDOS DE CONFIGURACIÓN ==========
function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

async function guardarConfigBarberia() {
  try {
    const contenido = JSON.stringify(BARBERIA_CONFIG, null, 2);
    await fs.writeFile(BARBERIA_BASE_PATH, contenido, 'utf8');
    console.log('✅ Configuración guardada en barberia_base.txt');
    return true;
  } catch (e) {
    console.error('❌ Error guardando configuración:', e.message);
    return false;
  }
}

async function comandoConfigReload(fromChatId) {
  if (fromChatId !== OWNER_CHAT_ID) {
    return '❌ Solo el dueño puede usar este comando.';
  }
  
  await cargarConfigBarberia();
  return `✅ *Configuración recargada*\n\n📋 Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length}\n🪒 Negocio: ${BARBERIA_CONFIG?.negocio?.nombre || 'Sin nombre'}`;
}

async function comandoConfigSet(args, fromChatId) {
  if (fromChatId !== OWNER_CHAT_ID) {
    return '❌ Solo el dueño puede usar este comando.';
  }
  
  try {
    const jsonMatch = args.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return '❌ No se encontró JSON válido.\n\nUso: `/config set "{\\"negocio\\":{\\"nombre\\":\\"Mi Barber\\"}}"}`';
    }
    
    const updates = JSON.parse(jsonMatch[0]);
    deepMerge(BARBERIA_CONFIG, updates);
    
    const guardado = await guardarConfigBarberia();
    
    if (guardado) {
      return `✅ *Configuración actualizada*\n\n${JSON.stringify(updates, null, 2)}\n\n💾 Cambios guardados en disco.`;
    } else {
      return '⚠️ Configuración actualizada en memoria pero NO se pudo guardar en disco.';
    }
  } catch (e) {
    return `❌ Error parseando JSON:\n${e.message}`;
  }
}

async function comandoConfigAddServicio(args, fromChatId) {
  if (fromChatId !== OWNER_CHAT_ID) {
    return '❌ Solo el dueño puede usar este comando.';
  }
  
  const match = args.match(/"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]+)"/);
  if (!match) {
    return '❌ Formato incorrecto.\n\nUso: `/config add servicio "Nombre" precio minutos "emoji"`\nEjemplo: `/config add servicio "Keratina" 120000 90 "✨"`';
  }
  
  const [, nombre, precio, min, emoji] = match;
  
  BARBERIA_CONFIG.servicios = BARBERIA_CONFIG.servicios || {};
  BARBERIA_CONFIG.servicios[nombre] = {
    precio: parseInt(precio),
    min: parseInt(min),
    emoji: emoji
  };
  
  const guardado = await guardarConfigBarberia();
  
  if (guardado) {
    return `✅ *Servicio añadido*\n\n${emoji} ${nombre}\n💰 ${parseInt(precio).toLocaleString('es-CO')}\n⏱️ ${min} min\n\n💾 Guardado en disco.`;
  } else {
    return '⚠️ Servicio añadido en memoria pero NO se pudo guardar en disco.';
  }
}

async function comandoConfigEditServicio(args, fromChatId) {
  if (fromChatId !== OWNER_CHAT_ID) {
    return '❌ Solo el dueño puede usar este comando.';
  }
  
  const matchNombre = args.match(/"([^"]+)"/);
  if (!matchNombre) {
    return '❌ Debes especificar el nombre del servicio entre comillas.\n\nUso: `/config edit servicio "Nombre" precio=NN min=MM emoji="X"`';
  }
  
  const nombre = matchNombre[1];
  
  if (!BARBERIA_CONFIG.servicios?.[nombre]) {
    return `❌ El servicio "${nombre}" no existe.`;
  }
  
  const precioMatch = args.match(/precio=(\d+)/);
  const minMatch = args.match(/min=(\d+)/);
  const emojiMatch = args.match(/emoji="([^"]+)"/);
  
  if (precioMatch) BARBERIA_CONFIG.servicios[nombre].precio = parseInt(precioMatch[1]);
  if (minMatch) BARBERIA_CONFIG.servicios[nombre].min = parseInt(minMatch[1]);
  if (emojiMatch) BARBERIA_CONFIG.servicios[nombre].emoji = emojiMatch[1];
  
  const guardado = await guardarConfigBarberia();
  
  const s = BARBERIA_CONFIG.servicios[nombre];
  if (guardado) {
    return `✅ *Servicio actualizado*\n\n${s.emoji} ${nombre}\n💰 ${s.precio.toLocaleString('es-CO')}\n⏱️ ${s.min} min\n\n💾 Guardado en disco.`;
  } else {
    return '⚠️ Servicio actualizado en memoria pero NO se pudo guardar en disco.';
  }
}

async function comandoConfigDelServicio(args, fromChatId) {
  if (fromChatId !== OWNER_CHAT_ID) {
    return '❌ Solo el dueño puede usar este comando.';
  }
  
  const match = args.match(/"([^"]+)"/);
  if (!match) {
    return '❌ Debes especificar el nombre del servicio entre comillas.\n\nUso: `/config del servicio "Nombre"`';
  }
  
  const nombre = match[1];
  
  if (!BARBERIA_CONFIG.servicios?.[nombre]) {
    return `❌ El servicio "${nombre}" no existe.`;
  }
  
  delete BARBERIA_CONFIG.servicios[nombre];
  
  const guardado = await guardarConfigBarberia();
  
  if (guardado) {
    return `✅ *Servicio eliminado*\n\n"${nombre}" ha sido eliminado.\n\n💾 Guardado en disco.`;
  } else {
    return '⚠️ Servicio eliminado en memoria pero NO se pudo guardar en disco.';
  }
}

async function comandoSetOwner(args, fromChatId) {
  if (fromChatId !== OWNER_CHAT_ID) {
    return '❌ Solo el dueño actual puede cambiar el owner.';
  }
  
  const match = args.match(/"?(\d{10,15})"?/);
  if (!match) {
    return '❌ Formato incorrecto.\n\nUso: `/set owner "573223698554"`\n\n⚠️ Este cambio es temporal. Para que persista, actualiza OWNER_NUMBER en tu .env';
  }
  
  const nuevoOwner = match[1];
  OWNER_NUMBER = nuevoOwner;
  OWNER_CHAT_ID = `${nuevoOwner}@c.us`;
  
  return `✅ *Owner cambiado temporalmente*\n\n📱 Nuevo owner: ${nuevoOwner}\n\n⚠️ *Importante:* Este cambio solo dura hasta que reinicies el bot.\n\nPara hacerlo permanente, actualiza tu archivo .env:\n\`\`\`\nOWNER_NUMBER=${nuevoOwner}\n\`\`\``;
}

// ========== COMANDO /ayuda ==========
function mostrarAyuda(fromChatId) {
  const esDueno = fromChatId === OWNER_CHAT_ID;
  
  let ayuda = `🤖 *COMANDOS DISPONIBLES*

📋 *Generales:*
• /ayuda - Muestra este mensaje
• /bot off - Desactiva el bot
• /bot on - Reactiva el bot

🧪 *Demo:*
• /start test - Inicia modo demo (Barbería)
• /end test - Finaliza demo y vuelve a ventas

📅 *Gestión:*
• /show bookings - Ver citas programadas

⏰ *Programación:*
• /send later "número" "fecha hora" "mensaje"
  Ejemplo: /send later "573001234567" "2025-10-25 14:30" "Hola!"`;

  if (esDueno) {
    ayuda += `

🔧 *Configuración (Solo dueño):*
• /config reload - Recargar configuración desde archivo
• /config set "<json>" - Actualizar configuración
• /config add servicio "Nombre" precio minutos "emoji"
• /config edit servicio "Nombre" [precio=NN] [min=MM] [emoji="X"]
• /config del servicio "Nombre"
• /set owner "número" - Cambiar dueño (temporal)`;
  }

  ayuda += `

💡 *Nota:* Los comandos solo funcionan en modo texto.`;

  return ayuda;
}

// ========== TRANSCRIPCIÓN DE AUDIO ==========
async function transcribeVoiceFromMsg(msg) {
  try {
    const media = await msg.downloadMedia();
    if (!media || !media.data) return null;
    
    const ext = (media.mimetype || '').includes('ogg') ? 'ogg' : 'mp3';
    const tmpPath = path.join(DATA_DIR, `voice_${Date.now()}.${ext}`);
    await fs.writeFile(tmpPath, Buffer.from(media.data, 'base64'));

    try {
      console.log(`[Audio] Transcribiendo ${tmpPath}...`);
      const resp = await openai.audio.transcriptions.create({
        file: fssync.createReadStream(tmpPath),
        model: 'whisper-1',
        language: 'es'
      });
      console.log(`[Audio] Transcrito: "${resp.text}"`);
      return (resp.text || '').trim();
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  } catch (err) {
    console.error('[Audio] Error transcribiendo:', err);
    return null;
  }
}

// ========== CHAT CORE ==========
async function chatWithAI(userMessage, userId, chatId) {
  const state = getUserState(userId);
  const msgLower = userMessage.toLowerCase();
  
  if (msgLower.includes('/ayuda') || msgLower.includes('/help')) {
    return mostrarAyuda(chatId);
  }
  
  if (msgLower.includes('/bot off')) { 
    state.botEnabled = false; 
    return '✅ Bot desactivado. Escribe `/bot on` para reactivarlo.'; 
  }
  
  if (msgLower.includes('/bot on')) { 
    state.botEnabled = true; 
    return '✅ Bot reactivado. Estoy aquí para ayudarte 24/7 💪'; 
  }
  
  if (msgLower.includes('/show bookings')) { 
    return await mostrarReservas(chatId); 
  }
  
  if (msgLower.startsWith('/send later')) { 
    const args = userMessage.replace(/\/send later/i, '').trim(); 
    return await programarMensajePersonalizado(args, chatId); 
  }
  
  if (msgLower.startsWith('/config reload')) {
    return await comandoConfigReload(chatId);
  }
  
  if (msgLower.startsWith('/config set')) {
    const args = userMessage.replace(/\/config set/i, '').trim();
    return await comandoConfigSet(args, chatId);
  }
  
  if (msgLower.startsWith('/config add servicio')) {
    const args = userMessage.replace(/\/config add servicio/i, '').trim();
    return await comandoConfigAddServicio(args, chatId);
  }
  
  if (msgLower.startsWith('/config edit servicio')) {
    const args = userMessage.replace(/\/config edit servicio/i, '').trim();
    return await comandoConfigEditServicio(args, chatId);
  }
  
  if (msgLower.startsWith('/config del servicio')) {
    const args = userMessage.replace(/\/config del servicio/i, '').trim();
    return await comandoConfigDelServicio(args, chatId);
  }
  
  if (msgLower.startsWith('/set owner')) {
    const args = userMessage.replace(/\/set owner/i, '').trim();
    return await comandoSetOwner(args, chatId);
  }

  if (!state.botEnabled) return null;

  if (msgLower.includes('/start test')) { 
    state.mode = 'demo'; 
    state.conversationHistory = []; 
    return '✅ *Demo activada*\n\nAhora hablas con el Asistente Cortex Barbershop. Prueba agendar una cita, consultar servicios, horarios, etc.\n\n💡 Escribe `/end test` para volver al modo ventas.'; 
  }
  
  if (msgLower.includes('/end test')) { 
    state.mode = 'sales'; 
    state.conversationHistory = []; 
    return '✅ *Demo finalizada*\n\n¿Qué tal la experiencia? 😊\n\nSi te gustó, el siguiente paso es dejar uno igual en tu WhatsApp (con tus horarios, precios y tono).'; 
  }

  // Get current date/time info
  const ahora = now();
  const diaSemanaTxt = ahora.setLocale('es').toFormat('EEEE');
  const fechaISO = ahora.toFormat('yyyy-MM-dd');
  const nombreBarberia = BARBERIA_CONFIG?.negocio?.nombre || 'Barbería';

  // Generate service text
  const serviciosTxt = generarTextoServicios();
  const faqsTxt = generarTextoFAQs();
  const pagosTxt = (BARBERIA_CONFIG?.pagos || []).join(', ');
  const upsell = BARBERIA_CONFIG?.upsell || '';
  
  // Get schedule text
  const horarioLv = BARBERIA_CONFIG?.horario?.lun_vie || ''; 
  const horarioS = BARBERIA_CONFIG?.horario?.sab || ''; 
  const horarioD = BARBERIA_CONFIG?.horario?.dom || '';
  
  const horarioHoy = (
    diaSemanaTxt.toLowerCase().startsWith('sá') ? horarioS : 
    diaSemanaTxt.toLowerCase().startsWith('do') ? horarioD : 
    horarioLv
  ) || 'Cerrado';

  // Get available slots
  const slotsDisponiblesHoyTxt = await generarTextoSlotsDisponiblesHoy(fechaISO);

  let systemPrompt = '';
  
  if (state.mode === 'demo') {
    // Generate demo system prompt
    systemPrompt = `Eres un asistente virtual para una barbería. Tu tarea es ayudar a los clientes a agendar citas, responder preguntas y brindar información sobre los servicios. Usa un tono amable, profesional y eficiente. Si no estás seguro sobre algo, es mejor pedir aclaraciones. Nunca asumas información. Siempre pregunta si algo no está claro.

🚨🚨🚨 CONTEXTO TEMPORAL 🚨🚨🚨
📅 HOY ES: ${diaSemanaTxt}, ${fechaISO}
🕐 HORA ACTUAL: ${ahora.toFormat('HH:mm')} (formato 24h) = ${ahora.toFormat('h:mm a')}

⚠️ REGLAS DE HORARIO:
- Si son más de las 8 PM (20:00), NO ofrezcas citas para "hoy"
- Solo ofrece horarios FUTUROS que no hayan pasado
- Si un horario ya pasó HOY, NO lo ofrezcas

Eres el "Asistente Cortex Barbershop" de **${nombreBarberia}**. Tono humano paisa, amable, eficiente. HOY=${fechaISO}. HORA ACTUAL=${ahora.toFormat('h:mm a')}.

**🚨 REGLAS OBLIGATORIAS PARA AGENDAR:**
1. Pregunta qué servicio necesita
2. Da precio y duración del servicio
3. Ofrece SOLO horarios FUTUROS (si son más de las 8 PM, NO ofrezcas para "hoy")
4. Si confirman hora, EXTRAE EL NOMBRE si ya lo dijeron
5. Si no te han dado nombre, pide nombre completo
6. 🚨🚨🚨 CUANDO CONFIRMES LA CITA, DEBES EMITIR EL TAG EN LA MISMA RESPUESTA:
   
   Ejemplo CORRECTO:
   "Listo, José! Te agendé corte mañana 24 de octubre a las 10:30 AM. <BOOKING:{\"nombreCliente\":\"José\",\"servicio\":\"corte clásico\",\"fecha\":\"2025-10-24\",\"hora_inicio\":\"10:30\"}>"
   
   🚨 SIN EL TAG, LA CITA NO SE GUARDA. ES OBLIGATORIO INCLUIRLO.

**🚨 REGLAS CRÍTICAS PARA CANCELAR - DEBES SEGUIRLAS SIEMPRE:**
1. Si el cliente pide cancelar, pregunta: "¿Me confirmas que quieres cancelar la cita de [fecha] a las [hora]?"
2. Cuando el cliente confirme (dice "sí", "confirmo", "dale", etc.), INMEDIATAMENTE emite el tag:
   <CANCELLED:{"nombreCliente":"(nombre EXACTO de la cita)","fecha":"YYYY-MM-DD","hora_inicio":"HH:MM"}>
3. **CRÍTICO:** Debes emitir el tag <CANCELLED:...> EN LA MISMA RESPUESTA donde confirmas la cancelación
4. **FORMATO OBLIGATORIO:** fecha="YYYY-MM-DD" y hora_inicio="HH:MM" en formato 24h
5. Usa el nombre EXACTO que está en la cita (no cambies mayúsculas/minúsculas)`;
  } else {
    systemPrompt = BARBERIA_CONFIG?.system_prompt || '';
  }

  // Replace template variables in system prompt
  if (systemPrompt.includes('<')) {
    systemPrompt = systemPrompt
      .replace(/<SERVICIOS>/g, serviciosTxt)
      .replace(/<FAQ>/g, faqsTxt)
      .replace(/<PAGOS>/g, pagosTxt)
      .replace(/<UPS>/g, upsell)
      .replace(/<HORARIO_HOY>/g, horarioHoy)
      .replace(/<SLOTS_DISPONIBLES_HOY>/g, slotsDisponiblesHoyTxt);
  }
  
  const isFirstMessage = state.conversationHistory.length === 0;
  
  if (isFirstMessage) {
    state.conversationHistory.push({
      role: 'system',
      content: `Eres un asistente virtual para una barbería. Tu tarea es ayudar a los clientes a agendar citas, responder preguntas y brindar información sobre los servicios. Usa un tono amable, profesional y eficiente. Si no estás seguro sobre algo, es mejor pedir aclaraciones. Nunca asumas información. Siempre pregunta si algo no está claro.`
    });
  }
  
  state.conversationHistory.push({
    role: 'user',
    content: userMessage
  });
  
  const maxTokens = 300;
  const temperature = 0.7;
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        ...state.conversationHistory
      ],
      max_tokens: maxTokens,
      temperature: temperature
    });
    
    const respuestaAI = response.choices[0]?.message?.content?.trim();
    
    if (respuestaAI) {
      state.conversationHistory.push({
        role: 'assistant',
        content: respuestaAI
      });
    }
    
    return respuestaAI;
  } catch (error) {
    console.error('❌ Error en chatWithAI:', error);
    return 'Lo siento, hubo un problema procesando tu solicitud. Intenta nuevamente más tarde.';
  }
}
// ========== CLEANUP ON PROCESS EXIT ==========
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM received, cleaning up...');
  await cleanupStaleLocks().catch(() => {});
  if (client) {
    await client.destroy().catch(() => {});
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️ SIGINT received, cleaning up...');
  await cleanupStaleLocks().catch(() => {});
  if (client) {
    await client.destroy().catch(() => {});
  }
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await cleanupStaleLocks().catch(() => {});
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await cleanupStaleLocks().catch(() => {});
});