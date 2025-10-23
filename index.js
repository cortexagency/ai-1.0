// =========================
// CORTEX IA - INDEX.JS (FIXED: Bot now replies correctly)
// =========================
require('dotenv').config();

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');

// ========== CONFIGURACIÓN ==========
const OWNER_NUMBER = process.env.OWNER_NUMBER || '573001234567';
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

// ========== OPENAI ==========
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== WHATSAPP CLIENT ==========
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
      '--single-process','--disable-gpu'
    ]
  },
  qrTimeout: 0,
  authTimeout: 0,
});

// ========== EXPRESS ==========
const app = express();
let latestQR = null;

app.get('/', (_, res) => res.send('Cortex AI Bot is running! 🤖'));

app.get('/qr', async (_, res) => {
  if (!latestQR) {
    return res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"><style>
      body{font-family:Arial;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh}
    </style></head><body><h2>⏳ Generando QR…</h2></body></html>`);
  }
  try {
    const svg = await QRCode.toString(latestQR, { type:'svg', width: 360, margin: 2 });
    res.send(`<!DOCTYPE html><html><head><style>
      body{font-family:Arial;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}
      .card{background:#fff;padding:24px;border-radius:12px}
    </style></head><body><h1>📱 CORTEX AI BOT</h1><div class="card">${svg}</div></body></html>`);
  } catch (e) {
    console.error('QR error:', e);
    res.status(500).send('Error generando QR');
  }
});
app.listen(PORT, () => console.log(`✅ HTTP server on :${PORT}`));

// ========== HELPERS FS ==========
async function ensureDir(p) { if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true }); }

async function initDataFiles() {
  await ensureDir(DATA_DIR);
  await ensureDir(PROMPTS_DIR);

  for (const [file, def] of [
    [BOOKINGS_FILE, []],
    [RESERVAS_FILE, {}],
    [SCHEDULED_MESSAGES_FILE, []]
  ]) {
    try { await fs.access(file); } catch { await fs.writeFile(file, JSON.stringify(def, null, 2)); }
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
      console.error('❌ barberia_base.txt no tiene JSON válido.');
      BARBERIA_CONFIG = { servicios: {}, horario: {}, negocio: {}, pagos: [], faqs: [], upsell: "", system_prompt: "" };
    } else {
      BARBERIA_CONFIG = parsed;
      if (!BARBERIA_CONFIG.negocio) {
        BARBERIA_CONFIG.negocio = {
          nombre: parsed.nombre || 'Demo',
          direccion: parsed.direccion || '',
          telefono: parsed.telefono || ''
        };
      }
      if (!BARBERIA_CONFIG.horario) BARBERIA_CONFIG.horario = {};
      if (!BARBERIA_CONFIG.servicios) BARBERIA_CONFIG.servicios = {};
      if (!BARBERIA_CONFIG.pagos) BARBERIA_CONFIG.pagos = [];
      if (!BARBERIA_CONFIG.faqs) BARBERIA_CONFIG.faqs = [];
      if (!BARBERIA_CONFIG.upsell) BARBERIA_CONFIG.upsell = "";
      if (typeof BARBERIA_CONFIG.system_prompt !== 'string') BARBERIA_CONFIG.system_prompt = "";
    }
    console.log(`✅ Cargado prompts/barberia_base.txt (${Object.keys(BARBERIA_CONFIG.servicios || {}).length} servicios)`);
  } catch (e) {
    console.error('❌ No se pudo leer prompts/barberia_base.txt:', e.message);
    console.error(`   Ruta intentada: ${BARBERIA_BASE_PATH}`);
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
    userStates.set(userId, { mode: 'sales', conversationHistory: [], botEnabled: true });
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
        if (reservas[b.fecha]) {
          const horaF = formatearHora(b.hora_inicio);
          reservas[b.fecha] = reservas[b.fecha].filter(h => h !== horaF);
          await writeReservas(reservas);
        }
        await notificarDueno(`❌ *Cita cancelada*\n👤 ${b.nombreCliente}\n🔧 ${b.servicio}\n📆 ${b.fecha}\n⏰ ${formatearHora(b.hora_inicio)}`);
      }
    } catch (e) { console.error('CANCELLED parse error:', e); }
    return mensaje.replace(/<CANCELLED:[^>]+>/, '').trim();
  }

  return mensaje;
}

// ========== NOTIFICAR DUEÑO ==========
async function notificarDueno(txt) {
  try { await client.sendMessage(`${OWNER_NUMBER}@c.us`, txt); }
  catch (e) { console.error('Notify owner error:', e.message); }
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
        id: `confirm_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(),
        type: 'confirmation',
        message: `👋 Hola ${booking.nombreCliente}! ¿Confirmas tu *${booking.servicio}* a las ${formatearHora(booking.hora_inicio)}? Responde *SÍ* o *NO*.`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
    }
  } catch (e) { console.error('programarConfirmacion:', e.message); }
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
        id:`reminder_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(),
        type: 'reminder',
        message: `⏰ *Recordatorio* — Tu cita de *${booking.servicio}* es en 30 minutos (${formatearHora(booking.hora_inicio)}).`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
    }
  } catch (e) { console.error('programarRecordatorio:', e.message); }
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
        id:`review_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(),
        type: 'review',
        message: `⭐ Hola ${booking.nombreCliente}! ¿Nos dejas una reseña? ${GOOGLE_REVIEW_LINK}`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
    }
  } catch (e) { console.error('programarResena:', e.message); }
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
        id:`winback_${booking.id}`, chatId: booking.chatId, scheduledFor: when.toISO(),
        type: 'winback',
        message: `👋 ${booking.nombreCliente}, te extrañamos! ¿Agendamos otra? 💈`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
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
        try { await client.sendMessage(m.chatId, m.message); }
        catch (e) { console.error('send scheduled error:', e.message); remain.push(m); }
      } else remain.push(m);
    }
    await writeScheduledMessages(remain);
  } catch (e) { console.error('scheduler loop:', e.message); }
}, 60000);

// ========== GENERADORES PARA SYSTEM PROMPT ==========
function generarTextoServicios() {
  if (!BARBERIA_CONFIG?.servicios) return '';
  return Object.entries(BARBERIA_CONFIG.servicios).map(([nombre, s]) => {
    const precio = (s.precio || 0).toLocaleString('es-CO');
    const min = s.min || 'N/A';
    const emoji = s.emoji || '✂️';
    return `${emoji} ${nombre} — $${precio} — ${min} min`;
  }).join('\n');
}

function generarTextoFAQs() {
  if (!BARBERIA_CONFIG?.faqs) return '';
  return BARBERIA_CONFIG.faqs.map((f,i)=>`${i+1}. ${f.q}\n   → ${f.a}`).join('\n\n');
}

// ========== CHAT CORE ==========
async function chatWithAI(userMessage, userId, chatId) {
  const state = getUserState(userId);

  // Construir prompt del sistema
  let systemPrompt = '';
  if (state.mode === 'demo') {
    const hoy = now();
    const diaSemanaTxt = hoy.setLocale('es').toFormat('EEEE');
    const fechaISO = hoy.toFormat('yyyy-LL-dd');

    const reservas = await readReservas();
    const reservasHoy = reservas[fechaISO] || [];

    const horario = BARBERIA_CONFIG?.horario || {};
    const nombreBarberia = BARBERIA_CONFIG?.negocio?.nombre || 'Barbería';
    const direccion = BARBERIA_CONFIG?.negocio?.direccion || '';
    const telefono = BARBERIA_CONFIG?.negocio?.telefono || '';
    const serviciosTxt = generarTextoServicios();
    const faqsTxt = generarTextoFAQs();
    const pagosTxt = (BARBERIA_CONFIG?.pagos || []).join(', ');
    const upsell = BARBERIA_CONFIG?.upsell || '';
    const horarioLv = horario.lun_vie || '';
    const horarioS  = horario.sab || '';
    const horarioD  = horario.dom || '';
    const horarioHoy = (diaSemanaTxt.toLowerCase().startsWith('sá') ? horarioS :
                       diaSemanaTxt.toLowerCase().startsWith('do') ? horarioD : horarioLv) || '';

    const plantilla = (BARBERIA_CONFIG?.system_prompt || '').trim();

    const fallback = `Eres el "Asistente Cortex Barbershop" de **${nombreBarberia}**. Tono humano paisa, amable y eficiente. Objetivo: agendar y responder FAQs. HOY=${fechaISO}.` +
    `\nReglas clave: pregunta servicio → da precio/duración → pide día/hora → si confirman hora pide nombre → confirma y emite <BOOKING:{...}>.` +
    `\nHorario hoy: ${horarioHoy}. Servicios:\n${serviciosTxt}\nDirección: ${direccion}\nPagos: ${pagosTxt}\nFAQs:\n${faqsTxt}\nUpsell: ${upsell}`;

    systemPrompt = (plantilla || fallback)
      .replace(/{hoy}/g, fechaISO)
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
      .replace(/{slotsTxt}/g, `Hoy ${reservasHoy.length ? 'ocupados' : 'libres'}: ${reservasHoy.join(', ') || 'sin ocupaciones registradas'}`);
  } else {
    systemPrompt = (VENTAS_PROMPT || '').trim();
    if (!systemPrompt) {
      systemPrompt = 'Eres Cortex IA (ventas). Tono humano, corto y claro. Guía al dueño a /start test o a una llamada de 10 min.';
    }
  }

  // Historial
  state.conversationHistory.push({ role: 'user', content: userMessage });
  if (state.conversationHistory.length > 20) state.conversationHistory = state.conversationHistory.slice(-20);

  // Llamada a OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...state.conversationHistory],
      temperature: state.mode === 'demo' ? 0.4 : 0.6,
      max_tokens: 500
    });
    let respuesta = (completion.choices?.[0]?.message?.content || '').trim() || '¿Te ayudo con algo más?';

    if (state.mode === 'demo') {
      respuesta = await procesarTags(respuesta, chatId);
    }
    state.conversationHistory.push({ role: 'assistant', content: respuesta });
    return respuesta;
  } catch (e) {
    console.error('OpenAI error:', e.message);
    await notificarDueno(`❌ *ERROR OPENAI*\nUsuario: ${chatId}\nMsg: "${userMessage}"\n${e.message}`);
    return 'Uy, se me enredó algo aquí. ¿Me repites porfa? 🙏';
  }
}

// ========== MENÚS / COMANDOS ADICIONALES ==========
async function mostrarReservas(chatId) {
  try {
    const bookings = await readBookings();
    const ahora = now().startOf('day');
    const futuras = bookings.filter(b => b.status !== 'cancelled' && DateTime.fromISO(`${b.fecha}T${b.hora_inicio}:00`).setZone(TIMEZONE) >= ahora);
    if (!futuras.length) return '📅 *No hay citas futuras*';
    futuras.sort((a,b)=> (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio));
    let out = '📅 *CITAS PROGRAMADAS*\n\n';
    for (const b of futuras) {
      const fechaLegible = DateTime.fromISO(`${b.fecha}T00:00:00`).setZone(TIMEZONE).setLocale('es').toFormat("EEEE d 'de' MMMM");
      out += `• ${b.nombreCliente} — ${b.servicio}\n  ${fechaLegible}, ${formatearHora(b.hora_inicio)}\n\n`;
    }
    return out.trim();
  } catch (e) {
    console.error('mostrarReservas error:', e.message);
    return '❌ Error al cargar las reservas.';
  }
}

async function programarMensajePersonalizado(args, fromChatId) {
  try {
    const rx = /"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/;
    const m = args.match(rx);
    if (!m) {
      return '❌ Formato: /send later "573001234567" "2025-10-25 10:30" "Mensaje"';
    }
    const [, numero, fechaHora, mensaje] = m;
    if (!/^\d{10,15}$/.test(numero)) return '❌ Número inválido (usa 57...)';
    const dt = DateTime.fromFormat(fechaHora, 'yyyy-MM-dd HH:mm', { zone: TIMEZONE });
    if (!dt.isValid) return '❌ Fecha/hora inválida. Usa YYYY-MM-DD HH:MM';
    if (dt <= now()) return '❌ Debe ser en el futuro.';
    const msgs = await readScheduledMessages();
    msgs.push({
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      chatId: `${numero}@c.us`, scheduledFor: dt.toISO(), type: 'custom',
      message: mensaje, scheduledBy: fromChatId
    });
    await writeScheduledMessages(msgs);
    const legible = dt.setLocale('es').toFormat("EEEE d 'de' MMMM 'a las' HH:mm");
    return `✅ Programado para ${numero}\n📅 ${legible}\n💬 "${mensaje}"`;
  } catch (e) {
    console.error('programarMensajePersonalizado:', e.message);
    return '❌ No pude programarlo, revisa el formato.';
  }
}

// ========== WHATSAPP EVENTS ==========
client.on('qr', (qr) => {
  console.log('📱 QR listo. Abre /qr en tu app para escanear.');
  latestQR = qr;
  qrcode.generate(qr, { small: true });
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
    // Ignorar grupos y mensajes propios
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    const userMessage = (message.body || '').trim();
    const state = getUserState(userId);

    console.log(`📩 Mensaje de ${userId}: ${userMessage}`);

    const low = userMessage.toLowerCase();

    // ✅ COMANDOS ESPECIALES (funcionan siempre, incluso con bot off)
    if (low.includes('/bot off')) {
      state.botEnabled = false;
      await message.reply('✅ Bot desactivado. Escribe `/bot on` para reactivarlo.');
      return;
    }
    
    if (low.includes('/bot on')) {
      state.botEnabled = true;
      await message.reply('✅ Bot reactivado. Aquí estoy pa\' ayudarte 💪');
      return;
    }
    
    if (low.includes('/show bookings')) {
      const respuesta = await mostrarReservas(message.from);
      await message.reply(respuesta);
      return;
    }
    
    if (low.startsWith('/send later')) {
      const args = userMessage.replace('/send later', '').trim();
      const respuesta = await programarMensajePersonalizado(args, message.from);
      await message.reply(respuesta);
      return;
    }

    // ✅ RECARGAR CONFIGURACIÓN (solo para el dueño)
    if (low === '/reload' && userId === `${OWNER_NUMBER}@c.us`) {
      await cargarConfigBarberia();
      await cargarVentasPrompt();
      await message.reply('✅ *Configuración recargada*\n\n📁 Archivos actualizados:\n• barberia_base.txt\n• ventas.txt\n\nCambios aplicados ✨');
      return;
    }

    // ✅ CAMBIO DE MODO (también funcionan siempre)
    if (low.includes('/start test')) {
      state.mode = 'demo';
      state.conversationHistory = [];
      await message.reply('✅ *Demo activada*\nHablas con el Asistente Cortex Barbershop. Puedes agendar, pedir precios, horarios, etc.\nEscribe `/end test` para salir.');
      return;
    }
    
    if (low.includes('/end test')) {
      state.mode = 'sales';
      state.conversationHistory = [];
      await message.reply('✅ *Demo finalizada* — ¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp. ¿Prefieres llamada de 10 min o pasos por aquí?');
      return;
    }

    // ✅ VERIFICAR SI EL BOT ESTÁ HABILITADO
    if (!state.botEnabled) {
      // Bot está OFF, no responder a mensajes normales
      return;
    }

    // ✅ PROCESAR CON IA
    const respuesta = await chatWithAI(userMessage, userId, message.from);
    
    if (respuesta) {
      await message.reply(respuesta);
    }
    
  } catch (e) {
    console.error('❌ Error procesando mensaje:', e.message);
    await notificarDueno(`❌ ERROR handler\nUsuario: ${message.from}\nError: ${e.message}`);
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