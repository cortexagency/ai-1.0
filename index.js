// =========================
// CORTEX IA - INDEX.JS (Optimizado y Consolidado)
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

// Import the Puppeteer helper for robust browser launching
const { launchBrowser } = require('./lib/puppeteer-launch');
// ========== CONFIGURACIÓN ==========
let OWNER_NUMBER = process.env.OWNER_NUMBER || '573223698554';
let OWNER_CHAT_ID = process.env.OWNER_WHATSAPP_ID || `${OWNER_NUMBER}@c.us`;

const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/TU_LINK_AQUI/review';
const TIMEZONE = process.env.TZ || 'America/Bogota';
const PORT = process.env.PORT || 3000;

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
const MIN_RESPONSE_DELAY = 2000; // 2 seconds minimum
const MAX_RESPONSE_DELAY = 5000; // 5 seconds maximum

function humanDelay() {
  const delay = Math.floor(Math.random() * (MAX_RESPONSE_DELAY - MIN_RESPONSE_DELAY + 1)) + MIN_RESPONSE_DELAY;
  console.log(`[🕐 ANTI-BAN] Waiting ${(delay/1000).toFixed(1)}s before responding...`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function sendWithTyping(chat, message) {
  try {
    await chat.sendStateTyping(); // Show "typing..."
    await humanDelay(); // Wait like human typing
    await chat.sendMessage(message);
    await chat.clearState(); // Stop typing indicator
  } catch (error) {
    // Fallback if typing state fails
    console.log('[⚠️ ANTI-BAN] Typing state failed, using simple delay');
    await humanDelay();
    await chat.sendMessage(message);
  }
}



// ========== WHATSAPP CLIENT ==========
// Custom puppeteer instance factory using our robust launcher
const puppeteerFactory = async () => {
  const browser = await launchBrowser({
    // whatsapp-web.js expects a browser instance
    // The launchBrowser helper handles all the container-safe flags
  });
  return browser;
};

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }), 
  puppeteer: puppeteerFactory,
  qrTimeout: 0,
  authTimeout: 0,
});

// ========== EXPRESS SERVER ==========
const app = express();
let latestQR = null;

app.get('/', (req, res) => res.send('✅ Cortex AI Bot is running! 🤖'));

app.get('/qr', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <!DOCTYPE html><html><head>
        <title>Cortex AI Bot - QR Code</title>
        <meta http-equiv="refresh" content="3">
        <style>
          body {
            font-family: monospace;
            background: #000;
            color: #0f0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            text-align: center;
            padding: 20px;
          }
        </style>
      </head><body>
        <div>
          <h2>⏳ Generando código QR...</h2>
          <p>El bot está iniciando. La página se actualizará automáticamente.</p>
        </div>
      </body></html>
    `);
  }

  try {
    const qrSVG = await QRCode.toString(latestQR, { 
      type: 'svg', 
      width: 400, 
      margin: 2, 
      color: { dark: '#000', light: '#fff' } 
    });
    
    res.send(`
      <!DOCTYPE html><html><head>
        <title>Cortex AI Bot - Escanea QR</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #1a1a1a;
            color: #fff;
            padding: 20px;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .container { text-align: center; max-width: 500px; }
          h1 { color: #00ff00; margin-bottom: 20px; font-size: 24px; }
          .qr-box {
            background: white;
            padding: 30px;
            border-radius: 15px;
            display: inline-block;
            margin: 20px 0;
            box-shadow: 0 10px 40px rgba(0, 255, 0, 0.3);
          }
          .instructions {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
            text-align: left;
            line-height: 1.8;
          }
          .instructions ol { padding-left: 20px; }
          .warning {
            background: rgba(255, 100, 0, 0.2);
            border-left: 4px solid #ff6400;
            padding: 15px;
            margin-top: 15px;
            border-radius: 5px;
            text-align: left;
          }
        </style>
      </head><body>
        <div class="container">
          <h1>📱 CORTEX AI BOT</h1>
          <div class="qr-box">${qrSVG}</div>
          <div class="instructions">
            <strong>📋 Pasos para vincular:</strong>
            <ol>
              <li>Abre <strong>WhatsApp</strong> en tu celular</li>
              <li>Ve a <strong>Menú (⋮)</strong> → <strong>Dispositivos vinculados</strong></li>
              <li>Toca <strong>"Vincular un dispositivo"</strong></li>
              <li><strong>Escanea este QR</strong> directamente desde WhatsApp</li>
            </ol>
          </div>
          <div class="warning">
            <strong>⚠️ Si no funciona:</strong><br>
            Usa la app de <strong>Cámara</strong> de tu celular, apunta a la pantalla y abre el link que aparece
          </div>
        </div>
      </body></html>
    `);
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).send(`
      <html><head><title>Error</title>
      <style>body {font-family: monospace; background: #000; color: #f00; padding: 20px; text-align: center;}</style>
      </head><body>
        <h1>❌ Error generando QR</h1>
        <p>${error.message}</p>
        <p><a href="/qr" style="color: #0f0;">Reintentar</a></p>
      </body></html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`✅ HTTP server running on port ${PORT}`);
  console.log(`🌐 Accede al QR en: https://ai-10-production.up.railway.app/qr`);
});

// ========== HELPERS FS ==========
async function ensureDir(p) { 
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true }); 
}

async function initDataFiles() {
  try {
    await ensureDir(DATA_DIR);
    await ensureDir(PROMPTS_DIR);
    
    for (const [file, def] of [
      [BOOKINGS_FILE, []],
      [RESERVAS_FILE, {}],
      [SCHEDULED_MESSAGES_FILE, []]
    ]) {
      try { await fs.access(file); } 
      catch { 
        await fs.writeFile(file, JSON.stringify(def, null, 2)); 
        console.log(`✅ Creado: ${path.basename(file)}`); 
      }
    }
  } catch (error) {
    console.error('❌ Error inicializando archivos:', error);
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
  
  // 🔥 CORRECCIÓN 1 (Robustez): Comparación de días más estricta
  const esHoy = fechaConsulta.startOf('day').equals(ahora.startOf('day'));
  
  let minutoActual = minutoInicio;
  if (esHoy) {
    // 🔥 CORRECCIÓN 2 (Buffer): Añadir +1 min a la hora actual ANTES de calcular el próximo slot
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

// 🔥 FUNCIÓN CORREGIDA: Genera slots disponibles HOY (sin horas pasadas)
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
  
  // 🔥 CORRECCIÓN 1 (Robustez): Comparación de días más estricta
  const esHoy = fechaConsulta.startOf('day').equals(ahora.startOf('day'));
  
  let minutoBusqueda = minutoInicio;
  if (esHoy) {
    // 🔥 CORRECCIÓN 2 (Buffer): Añadir +1 min a la hora actual ANTES de calcular el próximo slot
    // Esto evita ofrecer 4:00 PM a las 4:00 PM en punto (ofrecerá 4:20 PM)
    // Y evita ofrecer 4:00 PM a las 4:32 PM (ofrecerá 4:40 PM)
    const minAhora = ahora.hour * 60 + ahora.minute + 1; // +1 min buffer
    const proximoSlot = Math.ceil(minAhora / 20) * 20;
    minutoBusqueda = Math.max(minutoInicio, proximoSlot);
    
    console.log(`[Slots Hoy] Hora actual: ${ahora.toFormat('HH:mm')} (${minAhora-1} min). Próximo slot: ${proximoSlot} min.`);
  }
  
  const alternativas = [];
  
  // Buscar slots disponibles
  for (let m = minutoBusqueda; m <= minutoFin - duracionMinDefault; m += 20) {
    const horaStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    
    // Verificar disponibilidad del slot
    const slotsNecesarios = calcularSlotsUsados(horaStr, duracionMinDefault);
    let colision = false;
    
    for (const slot of slotsNecesarios) {
      if (slotsReservados.includes(slot)) {
        colision = true;
        break;
      }
      // Verificar que no se pase del cierre
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
    
    // 🔥 VALIDAR HORA (9 AM - 8 PM)
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
          respuesta += '\n\n🕒 *Horarios disponibles:*\n';
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
      
      // 🔥 BÚSQUEDA MEJORADA: Sin normalización agresiva
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
          
          // Match más flexible: contiene o es contenido
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
        
        // Liberar slots
        const reservas = await readReservas();
        if (reservas[b.fecha]) {
          const duracionMin = BARBERIA_CONFIG?.servicios?.[b.servicio]?.min || 40;
          const slotsOcupados = calcularSlotsUsados(b.hora_inicio, duracionMin);
          
          console.log('[🔥 CANCELACIÓN] Liberando slots:', slotsOcupados);
          reservas[b.fecha] = reservas[b.fecha].filter(slot => !slotsOcupados.includes(slot));
          await writeReservas(reservas);
        }
        
        // 🔥 NOTIFICAR AL DUEÑO (SIEMPRE, se filtra dentro de notificarDueno)
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
    // 🔥 VALIDACIÓN CRÍTICA 1: Verificar que el cliente esté inicializado
    if (!client || !client.info) {
      console.error('[❌ NOTIFICACIÓN] Cliente de WhatsApp NO está listo todavía');
      console.error('[❌ NOTIFICACIÓN] client existe:', !!client);
      console.error('[❌ NOTIFICACIÓN] client.info existe:', !!client?.info);
      return;
    }
    
    // 🔥 VALIDACIÓN 2: No notificar si el dueño hace la acción
    if (fromChatId === OWNER_CHAT_ID) {
      console.log('[ℹ️ NOTIFICACIÓN] Acción del dueño - no se auto-notifica');
      return;
    }
    
    console.log(`[📤 NOTIFICACIÓN] ===================`);
    console.log(`[📤 NOTIFICACIÓN] Enviando a: ${OWNER_CHAT_ID}`);
    console.log(`[📤 NOTIFICACIÓN] Mensaje: ${txt.substring(0, 80)}...`);
    console.log(`[📤 NOTIFICACIÓN] Origen: ${fromChatId || 'sistema'}`);
    console.log(`[📤 NOTIFICACIÓN] Cliente listo: ${!!client?.info}`);
    
    // 🔥 ENVÍO CON TIMEOUT de 15 segundos
    const sendPromise = client.sendMessage(OWNER_CHAT_ID, txt);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: no respuesta en 15s')), 15000)
    );
    
    await Promise.race([sendPromise, timeoutPromise]);
    
    console.log('[✅ NOTIFICACIÓN] ¡Enviada exitosamente!'); 
    console.log(`[✅ NOTIFICACIÓN] ===================`);
  }
  catch (e) { 
    console.error('[❌ NOTIFICACIÓN] ××××××××××××××××××××××');
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
    console.error('[❌ NOTIFICACIÓN] ××××××××××××××××××××××');
  }
}

// ========== DETECCIÓN AUTOMÁTICA DE CITAS (POST-OPENAI) ==========
async function detectarYCrearCitaAutomatica(conversationHistory, lastResponse, chatId) {
  try {
    // Solo intentar si la respuesta de OpenAI sugiere confirmación de cita
    const respLower = lastResponse.toLowerCase();
    const esConfirmacion = respLower.includes('agend') || respLower.includes('confirm') || 
                          respLower.includes('reserv') || respLower.includes('listo') ||
                          respLower.includes('perfect');
    
    if (!esConfirmacion) return;
    
    console.log('[🔍 AUTO-CITA] Analizando conversación para extraer datos...');
    
    // Analizar últimos 10 mensajes
    const ultimos = conversationHistory.slice(-10);
    
    let servicio = null;
    let fecha = null;
    let hora = null;
    let nombre = null;
    
    const serviciosValidos = Object.keys(BARBERIA_CONFIG?.servicios || {});
    const ahora = now();
    
    for (const msg of ultimos) {
      const texto = (msg.content || '').toLowerCase();
      
      // Buscar servicio
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
      
      // Buscar hora (formato flexible: 9am, 9:00, 15:00, etc)
      if (!hora) {
        const horaMatch = texto.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
        if (horaMatch) {
          let h = parseInt(horaMatch[1]);
          const m = horaMatch[2] || '00';
          const ampm = horaMatch[3]?.toLowerCase();
          
          // Convertir a 24h
          if (ampm === 'pm' && h < 12) h += 12;
          if (ampm === 'am' && h === 12) h = 0;
          
          // Validar horario (9 AM a 8 PM)
          if (h >= 9 && h < 20) {
            hora = `${String(h).padStart(2, '0')}:${m}`;
            console.log('[🔍 AUTO-CITA] Hora encontrada:', hora);
          }
        }
      }
      
      // Buscar fecha (palabras clave)
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
      
      // Buscar nombre (solo en mensajes del usuario)
      if (!nombre && msg.role === 'user') {
        // Intentar extraer nombre después de palabras clave
        const nombreMatch = texto.match(/(?:soy|nombre|llamo|me llamo)\s+([a-záéíóúñ\s]{2,30})/i);
        if (nombreMatch) {
          nombre = nombreMatch[1].trim();
          // Capitalizar primera letra
          nombre = nombre.split(' ').map(p => 
            p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
          ).join(' ');
          console.log('[🔍 AUTO-CITA] Nombre encontrado:', nombre);
        } else {
          // Buscar palabras capitalizadas
          const palabras = msg.content.split(/\s+/);
          for (const palabra of palabras) {
            if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}$/.test(palabra) && 
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
    
    // Verificar si tenemos todos los datos
    if (!servicio || !fecha || !hora || !nombre) {
      console.log('[🔍 AUTO-CITA] Datos incompletos:', { servicio, fecha, hora, nombre });
      return;
    }
    
    // Verificar si ya existe una cita similar (evitar duplicados)
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
    
    // Verificar disponibilidad
    const duracionMin = BARBERIA_CONFIG?.servicios?.[servicio]?.min || 40;
    // ======= CAMBIO APLICADO AQUÍ =======
    const check = await verificarDisponibilidad(fecha, hora, duracionMin);
    if (!check.disponible) {
      console.log('[❌ AUTO-CITA] Horario no disponible');
      return;
    }
    
    // Crear la cita
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
    
    // Reservar slots
    const reservas = await readReservas();
    const slotsOcupados = calcularSlotsUsados(hora, duracionMin);
    if (!reservas[fecha]) reservas[fecha] = [];
    reservas[fecha].push(...slotsOcupados);
    await writeReservas(reservas);
    
    // Programar mensajes
    await programarConfirmacion(bookingData);
    await programarRecordatorio(bookingData);
    await programarResena(bookingData);
    await programarExtranamos(bookingData);
    
    // 🔥 NOTIFICAR AL DUEÑO
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
  
  // 🔥 CASO 1: Si está esperando confirmación de cancelación
  if (state.esperandoConfirmacionCancelacion && state.citaParaCancelar) {
    const confirma = msgLower === 'si' || msgLower === 'sí' || 
                     msgLower === 'confirmo' || msgLower === 'dale' ||
                     msgLower === 'ok' || msgLower === 'yes';
    
    console.log('[🔥 CANCELACIÓN DIRECTA] Esperando confirmación, usuario dice:', msgLower);
    console.log('[🔥 CANCELACIÓN DIRECTA] Confirma:', confirma);
    
    if (confirma) {
      const cita = state.citaParaCancelar;
      
      // Cancelar la cita
      const bookings = await readBookings();
      const citaIndex = bookings.findIndex(b => b.id === cita.id);
      if (citaIndex !== -1) {
        bookings[citaIndex].status = 'cancelled';
        await writeBookings(bookings);
        
        console.log('[🔥 CANCELACIÓN DIRECTA] Cita marcada como cancelada:', cita.id);
        
        // Liberar slots
        const reservas = await readReservas();
        if (reservas[cita.fecha]) {
          const duracionMin = BARBERIA_CONFIG?.servicios?.[cita.servicio]?.min || 40;
          const slotsOcupados = calcularSlotsUsados(cita.hora_inicio, duracionMin);
          reservas[cita.fecha] = reservas[cita.fecha].filter(slot => !slotsOcupados.includes(slot));
          await writeReservas(reservas);
          console.log('[🔥 CANCELACIÓN DIRECTA] Slots liberados:', slotsOcupados);
        }
        
        // Notificar al dueño
        console.log('[🔥 CANCELACIÓN DIRECTA] Enviando notificación al dueño...');
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
  
  // 🔥 CASO 2: Si tiene lista de citas y responde con número
  if (state.citasParaCancelar && state.citasParaCancelar.length > 0) {
    // Intentar extraer número del mensaje
    const numeroMatch = userMessage.match(/\b(\d+)\b/);
    
    if (numeroMatch) {
      const numero = parseInt(numeroMatch[1]);
      console.log('[🔥 CANCELACIÓN DIRECTA] Usuario seleccionó número:', numero);
      
      if (numero >= 1 && numero <= state.citasParaCancelar.length) {
        const cita = state.citasParaCancelar[numero - 1];
        
        // Preguntar confirmación
        state.esperandoConfirmacionCancelacion = true;
        state.citaParaCancelar = cita;
        state.citasParaCancelar = null;
        
        console.log('[🔥 CANCELACIÓN DIRECTA] Preguntando confirmación para:', cita.id);
        return `¿Me confirmas que deseas cancelar tu cita del ${cita.fecha} a las ${formatearHora(cita.hora_inicio)} para ${cita.servicio}?\n\nResponde "sí" para confirmar.`;
      } else {
        return `Por favor responde con un número entre 1 y ${state.citasParaCancelar.length}.`;
      }
    }
    
    // Si no es número, limpiar estado y continuar
    state.citasParaCancelar = null;
  }
  
  // 🔥 CASO 3: Detectar palabras de cancelación
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
    return null; // No es cancelación, continuar normal
  }
  
  console.log('[🔥 CANCELACIÓN DIRECTA] Detectada palabra de cancelación');
  
  // Buscar citas activas del usuario
  const bookings = await readBookings();
  const ahora = now();
  
  const citasActivas = bookings.filter(b => {
    if (b.chatId !== chatId || b.status === 'cancelled') return false;
    
    // Filtrar citas pasadas
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
  
  // 🔥 CASO 4: Intentar detectar fecha/hora específica en el mensaje
  // Ejemplo: "cancelar cita del 24" o "cancelar cita de mañana" o "cancelar la de 7:20 PM"
  
  // Buscar por hora (7:20, 19:20, etc)
  const horaMatch = userMessage.match(/(\d{1,2}):?(\d{2})\s*(am|pm)?/i);
  if (horaMatch) {
    let hora = parseInt(horaMatch[1]);
    const minuto = horaMatch[2];
    const ampm = horaMatch[3]?.toLowerCase();
    
    // Convertir a 24h si es necesario
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
  
  // Buscar por fecha (2025-10-24, 24, etc)
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
  
  // Si tiene solo 1 cita, preguntar directamente
  if (citasActivas.length === 1) {
    const cita = citasActivas[0];
    state.esperandoConfirmacionCancelacion = true;
    state.citaParaCancelar = cita;
    console.log('[🔥 CANCELACIÓN DIRECTA] Solo 1 cita, preguntando confirmación');
    return `¿Me confirmas que deseas cancelar tu cita del ${cita.fecha} a las ${formatearHora(cita.hora_inicio)} para ${cita.servicio}?\n\nResponde "sí" para confirmar.`;
  }
  
  // Si tiene múltiples citas, listarlas
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
  return `✅ *Configuración recargada*\n\n📋 Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length}\n🏪 Negocio: ${BARBERIA_CONFIG?.negocio?.nombre || 'Sin nombre'}`;
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
    return '✅ *Demo finalizada*\n\n¿Qué tal la experiencia? 😊\n\nSi te gustó, el siguiente paso es dejar uno igual en tu WhatsApp (con tus horarios, precios y tono).\n\n¿Prefieres una llamada rápida de 10 min o te paso los pasos por aquí?'; 
  }

  const palabrasEmergencia = ['urgente', 'emergencia', 'problema grave', 'queja seria'];
  const esEmergencia = palabrasEmergencia.some(p => msgLower.includes(p));
  
  if (esEmergencia) {
    await notificarDueno(`🚨 *ALERTA DE EMERGENCIA*\n\nUsuario: ${chatId}\nMensaje: "${userMessage}"\n\n⚠️ Requiere atención inmediata.`, chatId);
  }

  let systemPrompt = '';
  
  if (state.mode === 'demo') {
    const hoy = now(); 
    const diaSemanaTxt = hoy.setLocale('es').toFormat('EEEE'); 
    const fechaISO = hoy.toFormat('yyyy-MM-dd');
    
    const duracionDefault = 40;
    const slotsDisponiblesHoyTxt = await generarTextoSlotsDisponiblesHoy(fechaISO, duracionDefault);
    
    const horario = BARBERIA_CONFIG?.horario || {}; 
    const nombreBarberia = BARBERIA_CONFIG?.negocio?.nombre || 'Barbería';
    const direccion = BARBERIA_CONFIG?.negocio?.direccion || ''; 
    const telefono = BARBERIA_CONFIG?.negocio?.telefono || '';
    
    const serviciosTxt = generarTextoServicios(); 
    const faqsTxt = generarTextoFAQs(); 
    const pagosTxt = (BARBERIA_CONFIG?.pagos || []).join(', ');
    const upsell = BARBERIA_CONFIG?.upsell || ''; 
    
    const horarioLv = horario.lun_vie || ''; 
    const horarioS = horario.sab || ''; 
    const horarioD = horario.dom || '';
    
    const horarioHoy = (
      diaSemanaTxt.toLowerCase().startsWith('sá') ? horarioS : 
      diaSemanaTxt.toLowerCase().startsWith('do') ? horarioD : 
      horarioLv
    ) || 'Cerrado';
    
    const plantilla = (BARBERIA_CONFIG?.system_prompt || '').trim();
    const horaActual = hoy.toFormat('h:mm a');
    
    // 🔥 NUEVO: Obtener citas del usuario para poder cancelarlas
    const bookings = await readBookings();
    const citasUsuario = bookings.filter(b => 
      b.chatId === chatId && 
      b.status !== 'cancelled'
    );
    
    let citasUsuarioTxt = '';
    if (citasUsuario.length > 0) {
      citasUsuarioTxt = '\n\n**📋 TUS CITAS ACTUALES:**\n';
      citasUsuario.forEach((cita, i) => {
        citasUsuarioTxt += `${i+1}. ${cita.nombreCliente} - ${cita.servicio} - ${cita.fecha} a las ${cita.hora_inicio}\n`;
      });
      citasUsuarioTxt += '\n*Si el cliente quiere cancelar, usa estos datos EXACTOS en el tag <CANCELLED:...>*\n';
    }
    
    const fallback = `🚨🚨🚨 CONTEXTO TEMPORAL 🚨🚨🚨
📅 HOY ES: ${diaSemanaTxt}, ${fechaISO}
🕐 HORA ACTUAL: ${hoy.toFormat('HH:mm')} (formato 24h) = ${hoy.toFormat('h:mm a')}

⚠️ REGLAS DE HORARIO:
- Si son más de las 8 PM (20:00), NO ofrezcas citas para "hoy"
- Solo ofrece horarios FUTUROS que no hayan pasado
- Si un horario ya pasó HOY, NO lo ofrezcas

Eres el "Asistente Cortex Barbershop" de **${nombreBarberia}**. Tono humano paisa, amable, eficiente. HOY=${fechaISO}. HORA ACTUAL=${horaActual}.
${citasUsuarioTxt}

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
5. Usa el nombre EXACTO que está en la cita (no cambies mayúsculas/minúsculas)

**EJEMPLO CORRECTO DE CANCELACIÓN:**
User: "quiero cancelar mi cita"
Bot: "Claro, ¿me confirmas que quieres cancelar la cita del 2025-10-24 a las 11:00 AM?"
User: "sí"
Bot: "Listo, tu cita ha sido cancelada. <CANCELLED:{"nombreCliente":"Zapata el duende","fecha":"2025-10-24","hora_inicio":"11:00"}>"

**⏰ HORARIOS DISPONIBLES HOY:**
${slotsDisponiblesHoyTxt}

---
**Info:**
Horario de hoy: ${horarioHoy}
**Servicios:**
${serviciosTxt}
**Dirección:** ${direccion}
**Pagos:** ${pagosTxt}
**FAQs:**
${faqsTxt}
**Upsell:** ${upsell}`;
    
    systemPrompt = (plantilla || fallback)
      .replace(/{hoy}/g, fechaISO)
      .replace(/{horaActual}/g, horaActual)
      .replace(/{diaSemana}/g, diaSemanaTxt)
      .replace(/{nombreBarberia}/g, nombreBarberia)
      .replace(/{direccionBarberia}/g, direccion)
      .replace(/{telefonoBarberia}/g, telefono)
      .replace(/{horarioLv}/g, horarioLv)
      .replace(/{horarioS}/g, horarioS)
      .replace(/{horarioD}/g, horarioD)
      .replace(/{horarioHoy}/g, horarioHoy)
      .replace(/{serviciosTxt}/g, serviciosTxt)
      .replace(/{faqsBarberia}/g, faqsTxt)
      .replace(/{pagosBarberia}/g, pagosTxt)
      .replace(/{upsellText}/g, upsell)
      .replace(/{slotsDisponiblesHoy}/g, slotsDisponiblesHoyTxt)
      .replace(/{horasOcupadasHoy}/g, '');
      
  } else {
    systemPrompt = (VENTAS_PROMPT || '').trim() || 
      'Eres Cortex IA (ventas). Tono humano, corto. Guía a /start test o llamada.';
  }

  state.conversationHistory.push({ role: 'user', content: userMessage });
  
  if (state.conversationHistory.length > 20) {
    state.conversationHistory = state.conversationHistory.slice(-20);
  }

  try {
    const completion = await openai.chat.completions.create({ 
      model: 'gpt-4o-mini', 
      messages: [
        { role: 'system', content: systemPrompt }, 
        ...state.conversationHistory
      ], 
      temperature: state.mode === 'demo' ? 0.4 : 0.6, 
      max_tokens: 500 
    });
    
    let respuesta = (completion.choices?.[0]?.message?.content || '').trim() || 
      '¿Te ayudo con algo más?';
    
    if (state.mode === 'demo') {
      respuesta = await procesarTags(respuesta, chatId);
      
      // 🔥 NUEVO: Detectar y crear cita automáticamente si OpenAI no generó el tag
      await detectarYCrearCitaAutomatica(state.conversationHistory, respuesta, chatId);
    }
    
    const frasesNoSabe = [
      'no estoy seguro', 
      'no tengo esa información', 
      'no puedo ayudarte', 
      'necesito confirmarlo', 
      'no sé'
    ];
    
    const noSabe = frasesNoSabe.some(f => respuesta.toLowerCase().includes(f));
    
    if (noSabe) {
      await notificarDueno(
        `❓ *BOT NO SABE RESPONDER*\n\nUsuario: ${chatId}\nPregunta: "${userMessage}"\nRespuesta: "${respuesta}"\n\n💡 Revisa el chat.`,
        chatId
      );
    }
    
    state.conversationHistory.push({ role: 'assistant', content: respuesta });
    
    return respuesta;
    
  } catch (e) {
    console.error('OpenAI error:', e.message);
    await notificarDueno(
      `❌ *ERROR OPENAI*\nUsuario: ${chatId}\nMsg: "${userMessage}"\n${e.message}`,
      chatId
    );
    return 'Uy, se me enredó algo aquí. ¿Me repites porfa? 🙏';
  }
}

// ========== WHATSAPP EVENTS ==========
client.on('qr', (qr) => {
  console.log('📱 Código QR generado!');
  console.log('🌐 Abre este link para escanear:');
  console.log(`\n   👉 https://ai-10-production.up.railway.app/qr\n`);
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Cliente de WhatsApp listo!');
  console.log(`👤 Notificaciones se envían a: ${OWNER_NUMBER}`);
  latestQR = null;
  
  await initDataFiles();
  await cargarConfigBarberia();
  await cargarVentasPrompt();
  
  console.log('📝 Estado de archivos:');
  console.log(`  - Barbería config: ${BARBERIA_CONFIG ? '✅' : '❌'}`);
  console.log(`  - Ventas prompt: ${VENTAS_PROMPT ? '✅' : '❌'}`);
  console.log(`  - Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length} encontrados`);
});

client.on('message', async (message) => {
  try {
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    const userMessage = (message.body || '').trim();
    const state = getUserState(userId);

    let processedMessage = userMessage;
    
    if (message.hasMedia && 
        (message.type === 'audio' || 
         message.type === 'ptt' || 
         (message.mimetype && message.mimetype.startsWith('audio/')))) {
      try {
        const transcript = await transcribeVoiceFromMsg(message);
        if (transcript) {
          processedMessage = transcript;
          console.log(`🎤 Audio transcrito [${userId}]: "${processedMessage}"`);
        } else {
          await humanDelay(); // 🛡️ Anti-ban
          await message.reply('No alcancé a entender el audio. ¿Puedes repetirlo?');
          return;
        }
      } catch (e) {
        console.error('[Handler Voz] Error:', e);
        await humanDelay(); // 🛡️ Anti-ban
        await message.reply('Tuve un problema leyendo el audio. ¿Me lo reenvías porfa?');
        return;
      }
    }
    
    if (!processedMessage && !userMessage.startsWith('/')) return;
    
    console.log(`📩 Mensaje de ${userId}: ${processedMessage || userMessage}`);
    
    const comandosEspeciales = [
      '/bot on', 
      '/bot off', 
      '/show bookings', 
      '/send later', 
      '/start test', 
      '/end test', 
      '/ayuda', 
      '/help',
      '/config',
      '/set owner'
    ];
    const esComandoEspecial = comandosEspeciales.some(cmd => 
      (processedMessage || userMessage).toLowerCase().includes(cmd)
    );
    
    if (!state.botEnabled && !esComandoEspecial) {
      return;
    }

    // 🔥 NUEVO: Intentar manejar cancelación directamente (sin OpenAI)
    const respuestaCancelacion = await manejarCancelacionDirecta(processedMessage || userMessage, userId);
    
    if (respuestaCancelacion) {
      // Se detectó y manejó una cancelación
      await humanDelay(); // 🛡️ Anti-ban
      await message.reply(respuestaCancelacion);
      return; // No pasar a OpenAI
    }

    const respuesta = await chatWithAI(processedMessage || userMessage, userId, message.from);
    
    if (respuesta) {
      await humanDelay(); // 🛡️ Anti-ban
      await message.reply(respuesta);
    }
    
  } catch (e) {
    console.error('❌ Error procesando mensaje:', e.message);
    try {
      await notificarDueno(
        `❌ *ERROR HANDLER*\nUsuario: ${message.from}\nError: ${e.message}`,
        message.from
      );
    } catch (notifyError) {
      console.error('❌ Error notificando sobre error:', notifyError.message);
    }
  }
});

client.on('disconnected', (r) => { 
  console.log('❌ Cliente desconectado:', r); 
  latestQR = null;
});

client.on('auth_failure', (msg) => {
  console.error('❌ Fallo de autenticación:', msg);
  latestQR = null;
});

// ========== START ==========
console.log('🚀 Iniciando Cortex AI Bot...');
// 🔥 DEBUG: Verificar timezone al iniciar
const ahora = now();
console.log('🕐 TIMEZONE DEBUG:', {
  timezone: TIMEZONE,
  fecha: ahora.toFormat('yyyy-MM-dd'),
  hora: ahora.toFormat('HH:mm'),
  diaSemana: ahora.toFormat('cccc'),
  fechaCompleta: ahora.toString()
});

console.log(`📍 Timezone: ${TIMEZONE}`);
console.log(`👤 Owner: ${OWNER_NUMBER}`);
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => {
  console.error('❌ UNHANDLED REJECTION:', e);
});

process.on('uncaughtException', (e) => {
  console.error('❌ UNCAUGHT EXCEPTION:', e);
});