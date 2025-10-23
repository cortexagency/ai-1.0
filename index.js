// =========================
// CORTEX IA - INDEX.JS (v25 - Corregido: Sesión Persistente + Web QR)
// =========================
require('dotenv').config();

const fs = require('fs').promises;
const fssync = require('fs'); // Mantenemos fs sync para chequeos rápidos
const path = require('path');
const qrcode = require('qrcode-terminal'); // Lo mantenemos por si acaso, pero no lo usaremos para el QR principal
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
const express = require('express');

// ========== CONFIGURACIÓN ==========
const OWNER_NUMBER = process.env.OWNER_NUMBER || '573001234567'; // Número del dueño (formato: 57300...)
const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/TU_LINK_AQUI/review';
const TIMEZONE = process.env.TZ || 'America/Bogota';
const PORT = process.env.PORT || 3000;

// ======== RUTAS DE CARPETAS/ARCHIVOS ========
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data'); // Carpeta persistente
const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts'); // Carpeta de código

const BOOKINGS_FILE = path.join(DATA_DIR, 'user_bookings.json');
const RESERVAS_FILE = path.join(DATA_DIR, 'demo_reservas.json'); // *** CORREGIDO: Ahora en DATA_DIR ***
const SCHEDULED_MESSAGES_FILE = path.join(DATA_DIR, 'scheduled_messages.json');
const BARBERIA_BASE_PATH = path.join(PROMPTS_DIR, 'barberia_base.txt');
const VENTAS_PROMPT_PATH = path.join(PROMPTS_DIR, 'ventas.txt');


// Cliente de OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== WHATSAPP CLIENT (CON FIX DE SESIÓN) ==========
const client = new Client({
  // *** CORRECCIÓN DE SESIÓN PERSISTENTE ***
  // Guardar la sesión dentro de la carpeta 'data' que es persistente
  authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }), 
  puppeteer: {
    headless: true,
    // *** ARGS DE PUPPETEER CORREGIDOS ***
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions' // Añadido por si acaso
    ]
  },
  qrTimeout: 0, // Esperar indefinidamente por el QR
  authTimeout: 0, // Esperar indefinidamente por la autenticación
});

// ========== EXPRESS ==========
const app = express();
let latestQR = null; // Variable global para guardar el QR

app.get('/', (req, res) => res.send('Cortex AI Bot is running! 🤖'));

app.get('/qr', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <!DOCTYPE html><html><head><title>Cortex AI Bot - QR</title><meta http-equiv="refresh" content="3">
      <style>body {font-family: monospace; background: #000; color: #0f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; text-align: center;}</style>
      </head><body><div><h2>⏳ Generando código QR...</h2><p>El bot está iniciando. La página se actualizará automáticamente.</p></div></body></html>
    `);
  }
  try {
    const qrSVG = await QRCode.toString(latestQR, { type: 'svg', width: 400, margin: 2, color: { dark: '#000', light: '#fff' } });
    res.send(`
      <!DOCTYPE html><html><head><title>Cortex AI Bot - Escanea QR</title><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; padding: 20px; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh;}
        .container {text-align: center; max-width: 500px;} h1 {color: #00ff00; margin-bottom: 20px; font-size: 24px;}
        .qr-box {background: white; padding: 30px; border-radius: 15px; display: inline-block; margin: 20px 0; box-shadow: 0 10px 40px rgba(0, 255, 0, 0.3);}
        .instructions {background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin-top: 20px; text-align: left; line-height: 1.8;}
        .instructions ol {padding-left: 20px;}
        .warning {background: rgba(255, 100, 0, 0.2); border-left: 4px solid #ff6400; padding: 15px; margin-top: 15px; border-radius: 5px; text-align: left;}
      </style></head><body><div class="container"><h1>📱 CORTEX AI BOT</h1><div class="qr-box">${qrSVG}</div>
      <div class="instructions"><strong>📋 Pasos para vincular:</strong><ol><li>Abre <strong>WhatsApp</strong> en tu celular</li><li>Ve a <strong>Menú (⋮)</strong> → <strong>Dispositivos vinculados</strong></li><li>Toca <strong>"Vincular un dispositivo"</strong></li><li><strong>Escanea este QR</strong> directamente desde WhatsApp</li></ol></div>
      <div class="warning"><strong>⚠️ Si no funciona:</strong><br>Usa la app de <strong>Cámara</strong> de tu celular, apunta a la pantalla y abre el link que aparece</div>
      </div></body></html>
    `);
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).send(`<html><head><title>Error</title><style>body {font-family: monospace; background: #000; color: #f00; padding: 20px; text-align: center;}</style></head><body><h1>❌ Error generando QR</h1><p>${error.message}</p><p><a href="/qr" style="color: #0f0;">Reintentar</a></p></body></html>`);
  }
});

app.listen(PORT, () => console.log(`✅ HTTP server on port ${PORT}`));

// ========== HELPERS FS ==========
async function ensureDir(p) { if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true }); }

async function initDataFiles() {
  try {
    await ensureDir(DATA_DIR);
    await ensureDir(PROMPTS_DIR); // Asegurarse que prompts/ exista (aunque los archivos deban estar en Git)
    
    for (const [file, def] of [
      [BOOKINGS_FILE, []],
      [RESERVAS_FILE, {}],
      [SCHEDULED_MESSAGES_FILE, []]
    ]) {
      try { await fs.access(file); } 
      catch { await fs.writeFile(file, JSON.stringify(def, null, 2)); console.log(`✅ Creado archivo: ${path.basename(file)}`); }
    }
  } catch (error) {
    console.error('❌ Error inicializando archivos:', error);
  }
}

// ========== LECTURA/ESCRITURA JSON ==========
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ========== PROMPTS / CONFIG ==========
let BARBERIA_CONFIG = null;
let VENTAS_PROMPT = '';

function parseFirstJsonBlock(text) {
  try { return JSON.parse(text); } catch (_) {}
  const s = text.indexOf('{'); if (s === -1) return null;
  let depth = 0;
  for (let i = s; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++; else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function cargarConfigBarberia() {
  try {
    console.log(`📖 Leyendo: ${BARBERIA_BASE_PATH}`);
    const raw = await fs.readFile(BARBERIA_BASE_PATH, 'utf8');
    const parsed = parseFirstJsonBlock(raw);
    if (!parsed || typeof parsed !== 'object') {
      console.error('❌ prompts/barberia_base.txt no tiene JSON válido o no se encontró. Usando fallback.');
      BARBERIA_CONFIG = { servicios: {}, horario: {}, negocio: {}, pagos: [], faqs: [], upsell: "", system_prompt: "" };
    } else {
      BARBERIA_CONFIG = parsed;
      if (!BARBERIA_CONFIG.negocio) BARBERIA_CONFIG.negocio = { nombre: parsed.nombre || 'Demo', direccion: parsed.direccion || '', telefono: parsed.telefono || '' };
      if (!BARBERIA_CONFIG.horario) BARBERIA_CONFIG.horario = {};
      if (!BARBERIA_CONFIG.servicios) BARBERIA_CONFIG.servicios = {};
      if (!BARBERIA_CONFIG.pagos) BARBERIA_CONFIG.pagos = [];
      if (!BARBERIA_CONFIG.faqs) BARBERIA_CONFIG.faqs = [];
      if (!BARBERIA_CONFIG.upsell) BARBERIA_CONFIG.upsell = "";
      if (typeof BARBERIA_CONFIG.system_prompt !== 'string') BARBERIA_CONFIG.system_prompt = "";
      console.log(`✅ Cargado prompts/barberia_base.txt (${Object.keys(BARBERIA_CONFIG.servicios || {}).length} servicios)`);
    }
  } catch (e) {
    console.error('❌ No se pudo leer prompts/barberia_base.txt:', e.message);
    BARBERIA_CONFIG = { servicios: {}, horario: {}, negocio: {}, pagos: [], faqs: [], upsell: "", system_prompt: "" };
  }
}

async function cargarVentasPrompt() {
  try {
    VENTAS_PROMPT = await fs.readFile(VENTAS_PROMPT_PATH, 'utf8');
    console.log('✅ Cargado prompts/ventas.txt');
  } catch (e) {
    console.error('❌ No se pudo leer prompts/ventas.txt:', e.message);
    VENTAS_PROMPT = 'Eres Cortex IA, asistente de ventas. Responde breve, humano, y guía a la demo (/start test).';
  }
}

// ========== UTIL ==========
function now() { return DateTime.now().setZone(TIMEZONE); }
function formatearHora(hhmm) { const [h, m] = hhmm.split(':').map(Number); const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, '0')} ${ampm}`; }

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
    userStates.set(userId, { mode: 'sales', conversationHistory: [], botEnabled: true });
  }
  return userStates.get(userId);
}

// ========== SLOTS ==========
function calcularSlotsUsados(horaInicio, duracionMin) { const base = 20; const blocks = Math.ceil(duracionMin / base); const [h, m] = horaInicio.split(':').map(Number); const out = []; for (let i = 0; i < blocks; i++) { const total = h * 60 + m + i * base; const hh = Math.floor(total / 60); const mm = total % 60; out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`); } return out; }

// ========== TAGS ==========
async function procesarTags(mensaje, chatId) {
  const bookingMatch = mensaje.match(/<BOOKING:\s*({[^>]+})>/);
  const cancelMatch = mensaje.match(/<CANCELLED:\s*({[^>]+})>/);

  if (bookingMatch) {
    try {
      const bookingData = JSON.parse(bookingMatch[1]);
      bookingData.id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      bookingData.chatId = chatId;
      bookingData.createdAt = new Date().toISOString();
      bookingData.status = 'confirmed';

      const bookings = await readBookings();
      bookings.push(bookingData);
      await writeBookings(bookings);

      const reservas = await readReservas();
      reservas[bookingData.fecha] = reservas[bookingData.fecha] || [];
      const horaF = formatearHora(bookingData.hora_inicio);
      if (!reservas[bookingData.fecha].includes(horaF)) reservas[bookingData.fecha].push(horaF);
      await writeReservas(reservas);

      await programarConfirmacion(bookingData);
      await programarRecordatorio(bookingData);
      await programarResena(bookingData);
      await programarExtranamos(bookingData);
      await notificarDueno(`📅 *Nueva cita*\n👤 ${bookingData.nombreCliente}\n🔧 ${bookingData.servicio}\n📆 ${bookingData.fecha}\n⏰ ${horaF}`);
      console.log('✅ Booking guardado:', bookingData.id);
    } catch (e) { console.error('BOOKING parse error:', e); }
    return mensaje.replace(/<BOOKING:[^>]+>/, '').trim();
  }

  if (cancelMatch) {
    try {
      const cancelData = JSON.parse(cancelMatch[1]);
      const bookings = await readBookings();
      const b = bookings.find(x => x.id === cancelData.id);
      if (b) {
        b.status = 'cancelled';
        await writeBookings(bookings);
        const reservas = await readReservas();
        if (reservas[b.fecha]) { const horaF = formatearHora(b.hora_inicio); reservas[b.fecha] = reservas[b.fecha].filter(h => h !== horaF); await writeReservas(reservas); }
        await notificarDueno(`❌ *Cita cancelada*\n👤 ${b.nombreCliente}\n🔧 ${b.servicio}\n📆 ${b.fecha}\n⏰ ${formatearHora(b.hora_inicio)}`);
        console.log('✅ Booking cancelado:', cancelData.id);
      }
    } catch (e) { console.error('CANCELLED parse error:', e); }
    return mensaje.replace(/<CANCELLED:[^>]+>/, '').trim();
  }

  return mensaje;
}

// ========== NOTIFICAR DUEÑO ==========
async function notificarDueno(txt) {
  try { await client.sendMessage(`${OWNER_NUMBER}@c.us`, txt); console.log('✅ Notificación enviada al dueño'); }
  catch (e) { console.error('Notify owner error:', e.message); }
}

// ========== PROGRAMACIONES ==========
async function programarConfirmacion(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.minus({ hours: 2 });
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ id: `confirm_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(), type: 'confirmation', message: `👋 Hola ${booking.nombreCliente}! Te recordamos tu cita de *${booking.servicio}* hoy a las ${formatearHora(booking.hora_inicio)}.\n\n¿Confirmas que asistirás? Responde *SÍ* o *NO*.`, bookingId: booking.id });
      await writeScheduledMessages(messages); console.log('✅ Confirmación programada:', when.toISO());
    }
  } catch (e) { console.error('programarConfirmacion:', e.message); }
}

async function programarRecordatorio(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.minus({ minutes: 30 });
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ id:`reminder_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(), type: 'reminder', message: `⏰ *Recordatorio*\n\nHola ${booking.nombreCliente}! Tu cita de *${booking.servicio}* es en 30 minutos (${formatearHora(booking.hora_inicio)}).\n\nNos vemos pronto! 💈`, bookingId: booking.id });
      await writeScheduledMessages(messages); console.log('✅ Recordatorio programado:', when.toISO());
    }
  } catch (e) { console.error('programarRecordatorio:', e.message); }
}

async function programarResena(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.plus({ days: 1, hours: 2 });
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ id:`review_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(), type: 'review', message: `⭐ Hola ${booking.nombreCliente}!\n\nEsperamos que hayas quedado contento con tu *${booking.servicio}* 😊\n\n¿Nos ayudas con una reseña en Google? Nos ayuda a crecer:\n\n${GOOGLE_REVIEW_LINK}\n\n¡Gracias! 💈`, bookingId: booking.id });
      await writeScheduledMessages(messages); console.log('✅ Reseña programada:', when.toISO());
    }
  } catch (e) { console.error('programarResena:', e.message); }
}

async function programarExtranamos(booking) {
  try {
    const [y,m,d] = booking.fecha.split('-').map(Number); const [hh,mm] = booking.hora_inicio.split(':').map(Number);
    const cita = DateTime.fromObject({ year:y, month:m, day:d, hour:hh, minute:mm }, { zone: TIMEZONE });
    const when = cita.plus({ weeks: 2 });
    if (when > now()) {
      const messages = await readScheduledMessages();
      messages.push({ id:`winback_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(), type: 'winback', message: `👋 ${booking.nombreCliente}, te extrañamos! ¿Agendamos otra? 💈\n\n*10% OFF* en tu próxima cita!`, bookingId: booking.id });
      await writeScheduledMessages(messages); console.log('✅ "Te extrañamos" programado:', when.toISO());
    }
  } catch (e) { console.error('programarExtranamos:', e.message); }
}

setInterval(async () => {
  try {
    const messages = await readScheduledMessages();
    const t = now();
    const remain = [];
    for (const m of messages) {
      const when = DateTime.fromISO(m.scheduledFor);
      if (when <= t) {
        try { await client.sendMessage(m.chatId, m.message); console.log(`✅ Mensaje programado ${m.type} enviado:`, m.id); }
        catch (e) { console.error('send scheduled error:', e.message); remain.push(m); }
      } else remain.push(m);
    }
    await writeScheduledMessages(remain);
  } catch (e) { console.error('scheduler loop:', e.message); }
}, 60000); // Revisa cada 60 segundos

// ========== GENERADORES PARA SYSTEM PROMPT ==========
function generarTextoServicios() {
  if (!BARBERIA_CONFIG?.servicios) return '';
  return Object.entries(BARBERIA_CONFIG.servicios).map(([nombre, s]) => {
    const precio = (s.precio || 0).toLocaleString('es-CO'); const min = s.min || 'N/A'; const emoji = s.emoji || '✂️';
    return `${emoji} ${nombre} — $${precio} — ${min} min`;
  }).join('\n');
}
function generarTextoFAQs() {
  if (!BARBERIA_CONFIG?.faqs) return '';
  return BARBERIA_CONFIG.faqs.map((f,i)=>`${i+1}. ${f.q}\n   → ${f.a}`).join('\n\n');
}

// ========== TRANSCRIPCIÓN DE AUDIO (Whisper) ==========
async function transcribeVoiceFromMsg(msg) {
  try {
    const media = await msg.downloadMedia();
    if (!media || !media.data) return null;
    const ext = (media.mimetype || '').includes('ogg') ? 'ogg' : 'mp3'; // Simplificado
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
      await fs.unlink(tmpPath);
    }
  } catch (err) {
    console.error('[Audio] Error transcribiendo:', err);
    return null;
  }
}

// ========== CHAT CORE ==========
async function chatWithAI(userMessage, userId, chatId) {
  const state = getUserState(userId);

  // Comandos especiales
  if (userMessage.toLowerCase().includes('/bot off')) { state.botEnabled = false; return '✅ Bot desactivado. Escribe `/bot on` para reactivarlo.'; }
  if (userMessage.toLowerCase().includes('/bot on')) { state.botEnabled = true; return '✅ Bot reactivado. Estoy aquí para ayudarte 24/7 💪'; }
  if (userMessage.toLowerCase().includes('/show bookings')) { return await mostrarReservas(chatId); }
  if (userMessage.toLowerCase().startsWith('/send later')) { const args = userMessage.replace('/send later', '').trim(); return await programarMensajePersonalizado(args, chatId); }

  if (!state.botEnabled) return null;

  if (userMessage.toLowerCase().includes('/start test')) { state.mode = 'demo'; state.conversationHistory = []; return '✅ *Demo activada*\nHablas con el Asistente Cortex Barbershop. Prueba agendar.\nEscribe `/end test` para salir.'; }
  if (userMessage.toLowerCase().includes('/end test')) { state.mode = 'sales'; state.conversationHistory = []; return '✅ *Demo finalizada* — ¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp. ¿Llamada de 10 min?'; }

  // Construir prompt del sistema
  let systemPrompt = '';
  if (state.mode === 'demo') {
    const hoy = now(); const diaSemanaTxt = hoy.setLocale('es').toFormat('EEEE'); const fechaISO = hoy.toFormat('yyyy-MM-dd');
    const reservas = await readReservas(); const reservasHoy = reservas[fechaISO] || [];
    const horario = BARBERIA_CONFIG?.horario || {}; const nombreBarberia = BARBERIA_CONFIG?.negocio?.nombre || 'Barbería';
    const direccion = BARBERIA_CONFIG?.negocio?.direccion || ''; const telefono = BARBERIA_CONFIG?.negocio?.telefono || '';
    const serviciosTxt = generarTextoServicios(); const faqsTxt = generarTextoFAQs(); const pagosTxt = (BARBERIA_CONFIG?.pagos || []).join(', ');
    const upsell = BARBERIA_CONFIG?.upsell || ''; const horarioLv = horario.lun_vie || ''; const horarioS = horario.sab || ''; const horarioD = horario.dom || '';
    const horarioHoy = (diaSemanaTxt.toLowerCase().startsWith('sá') ? horarioS : diaSemanaTxt.toLowerCase().startsWith('do') ? horarioD : horarioLv) || 'Cerrado';
    const plantilla = (BARBERIA_CONFIG?.system_prompt || '').trim();
    const fallback = `Eres el "Asistente Cortex Barbershop" de **${nombreBarberia}**. Tono humano paisa, amable, eficiente. Objetivo: agendar y responder FAQs. HOY=${fechaISO}.` + `\nReglas: 1.Pregunta servicio 2.Da precio/duración 3.Pide día/hora 4.Si confirman hora pide nombre 5.Confirma y emite <BOOKING:{...}>.` + `\nHorario hoy: ${horarioHoy}. Servicios:\n${serviciosTxt}\nDirección: ${direccion}\nPagos: ${pagosTxt}\nFAQs:\n${faqsTxt}\nUpsell: ${upsell}`;
    systemPrompt = (plantilla || fallback).replace(/{hoy}/g, fechaISO).replace(/{diaSemana}/g, diaSemanaTxt).replace(/{nombreBarberia}/g, nombreBarberia).replace(/{direccionBarberia}/g, direccion).replace(/{telefonoBarberia}/g, telefono).replace(/{horarioLv}/g, horarioLv).replace(/{horarioS}/g, horarioS).replace(/{horarioD}/g, horarioD).replace(/{horarioHoy}/g, horarioHoy).replace(/{serviciosTxt}/g, serviciosTxt).replace(/{faqsBarberia}/g, faqsTxt).replace(/{pagosBarberia}/g, pagosTxt).replace(/{upsellText}/g, upsell).replace(/{slotsTxt}/g, `Hoy ${reservasHoy.length ? 'ocupados' : 'libres'}: ${reservasHoy.join(', ') || 'sin ocupaciones'}`);
  } else {
    systemPrompt = (VENTAS_PROMPT || '').trim() || 'Eres Cortex IA (ventas). Tono humano, corto. Guía a /start test o llamada.';
  }

  // Historial
  state.conversationHistory.push({ role: 'user', content: userMessage });
  if (state.conversationHistory.length > 20) state.conversationHistory = state.conversationHistory.slice(-20);

  // Llamada a OpenAI
  try {
    const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, ...state.conversationHistory], temperature: state.mode === 'demo' ? 0.4 : 0.6, max_tokens: 500 });
    let respuesta = (completion.choices?.[0]?.message?.content || '').trim() || '¿Te ayudo con algo más?';
    if (state.mode === 'demo') {
      respuesta = await procesarTags(respuesta, chatId);
    }
    const frasesNoSabe = ['no estoy seguro', 'no tengo esa información', 'no puedo ayudarte', 'necesito confirmarlo', 'no sé'];
    const noSabe = frasesNoSabe.some(f => respuesta.toLowerCase().includes(f));
    if (noSabe) {
      await notificarDueno(`❓ *BOT NO SABE RESPONDER*\n\nUsuario: ${chatId}\nPregunta: "${userMessage}"\nRespuesta: "${respuesta}"\n\n💡 Revisa el chat.`);
    }
    state.conversationHistory.push({ role: 'assistant', content: respuesta });
    return respuesta;
  } catch (e) {
    console.error('OpenAI error:', e.message);
    await notificarDueno(`❌ *ERROR OPENAI*\nUsuario: ${chatId}\nMsg: "${userMessage}"\n${e.message}`);
    return 'Uy, se me enredó algo aquí. ¿Me repites porfa? 🙏';
  }
}

// ========== WHATSAPP EVENTS ==========
client.on('qr', (qr) => {
  console.log('📱 QR listo. Abre /qr en tu app para escanear.');
  latestQR = qr; // *** CORRECCIÓN: Guardar el QR para el endpoint /qr ***
  // qrcode.generate(qr, { small: true }); // No imprimir en consola
});

client.on('ready', async () => {
  console.log('✅ WhatsApp listo');
  latestQR = null;
  await initDataFiles();
  await cargarConfigBarberia();
  await cargarVentasPrompt();
  console.log('📁 Archivos cargados:');
  console.log(`  - Barbería config: ${BARBERIA_CONFIG ? '✅' : '❌'}`);
  console.log(`  - Ventas prompt: ${VENTAS_PROMPT ? '✅' : '❌'}`);
  console.log(`  - Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length} encontrados`);
});

client.on('message', async (message) => {
  try {
    // Ignorar mensajes de grupos y del propio bot
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    const userMessage = (message.body || '').trim();
    const state = getUserState(userId);

    // --- MANEJO DE VOZ ---
    let processedMessage = userMessage;
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt' || (message.mimetype && message.mimetype.startsWith('audio/')))) {
      try {
        const transcript = await transcribeVoiceFromMsg(message);
        if (transcript) {
          processedMessage = transcript;
          console.log(`🎤 Audio transcrito [${userId}]: "${processedMessage}"`);
        } else {
          await message.reply('No alcancé a entender el audio. ¿Puedes repetirlo?');
          return;
        }
      } catch (e) {
        console.error('[Handler Voz] Error:', e);
        await message.reply('Tuve un problema leyendo el audio. ¿Me lo reenvías porfa?');
        return;
      }
    }
    // --- FIN MANEJO VOZ ---
    
    if (!processedMessage && !userMessage.startsWith('/')) return;
    
    const low = processedMessage.toLowerCase();

    // Comandos especiales (siempre funcionan)
    const comandosEspeciales = ['/bot on', '/bot off', '/show bookings', '/send later', '/reload', '/start test', '/end test'];
    const esComandoEspecial = comandosEspeciales.some(cmd => low.startsWith(cmd));
    
    // *** Lógica de comandos especiales movida dentro de chatWithAI para centralizar respuestas ***
    
    // Verificar si el bot está habilitado (para mensajes normales)
    if (!state.botEnabled && !esComandoEspecial) {
      return; // No responder si el bot está desactivado y no es comando especial
    }

    // Procesar con IA (usando processedMessage)
    const respuesta = await chatWithAI(processedMessage, userId, message.from);
    
    if (respuesta) {
      await message.reply(respuesta);
    }
    
  } catch (e) {
    console.error('❌ Error procesando mensaje:', e.message);
    try {
      await notificarDueno(`❌ ERROR handler\nUsuario: ${message.from}\nError: ${e.message}`);
    } catch (notifyError) {
      console.error('❌ Error notificando al dueño sobre error:', notifyError.message);
    }
  }
});

client.on('disconnected', (r) => { 
  console.log('❌ Desconectado:', r); 
  latestQR = null;
});

// ========== START ==========
console.log('🚀 Iniciando Cortex AI Bot...');
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));