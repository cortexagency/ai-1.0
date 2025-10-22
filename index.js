// =========================
// CORTEX IA - INDEX.JS (v19 - External Prompts & Config)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
// No nodemailer

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null };

// ======== GESTIÓN PERSISTENTE ========
const DATA_DIR = path.join(__dirname, 'data');
const PROMPTS_DIR = path.join(__dirname, 'prompts'); // Nueva carpeta de prompts
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json');
const USER_BOOKINGS_PATH = path.join(DATA_DIR, 'user_bookings.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const BARBERIA_INFO_PATH = path.join(DATA_DIR, 'barberia_info.json'); // Nuevo archivo de info
const PROMPT_VENTAS_PATH = path.join(PROMPTS_DIR, 'ventas.txt');
const PROMPT_BARBERIA_BASE_PATH = path.join(PROMPTS_DIR, 'barberia_base.txt');

let DEMO_RESERVAS = {};
let USER_BOOKINGS = {};
let BARBERIA_DATA = {}; // Se carga desde JSON
let PROMPT_VENTAS = ""; // Se carga desde TXT
let PROMPT_DEMO_TEMPLATE = ""; // Se carga desde TXT

// Asegurarse de que las carpetas existan
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR);

// --- Funciones de Carga/Guardado ---
function loadData(filePath, defaultData = {}, isJson = true) {
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (isJson) {
        return fileContent ? JSON.parse(fileContent) : defaultData;
      } else {
        return fileContent; // Para archivos TXT
      }
    } else {
      const contentToWrite = isJson ? JSON.stringify(defaultData, null, 2) : (typeof defaultData === 'string' ? defaultData : '');
      fs.writeFileSync(filePath, contentToWrite, 'utf8');
      console.log(`[Memoria] Archivo ${path.basename(filePath)} creado.`);
      return defaultData;
    }
  } catch (e) {
    console.error(`[Error Memoria] ${path.basename(filePath)}:`, e.message);
    try { const contentToWrite = isJson ? JSON.stringify(defaultData, null, 2) : ''; fs.writeFileSync(filePath, contentToWrite, 'utf8'); console.warn(`[Memoria] Archivo ${path.basename(filePath)} reseteado.`); } catch (writeError) { console.error(`[Error Fatal] ${path.basename(filePath)}:`, writeError.message); }
    return defaultData;
  }
}
function saveData(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf8'); } catch (e) { console.error(`[Error Save] ${path.basename(filePath)}:`, e.message); }
}
function loadConfig() { BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null }); if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null; console.log('[Config] Cargada'); if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Config] ownerWhatsappId no configurado.'); else console.log(`[Config] Dueño WhatsApp: ${BOT_CONFIG.ownerWhatsappId}`); }
function saveConfig() { saveData(CONFIG_PATH, BOT_CONFIG); }
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Reservas] Cargadas'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[User Bookings] Cargadas'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

// Cargar Datos y Prompts Externos
function loadExternalFiles() {
    BARBERIA_DATA = loadData(BARBERIA_INFO_PATH, {}, true);
    PROMPT_VENTAS = loadData(PROMPT_VENTAS_PATH, "Error: Prompt de ventas no encontrado.", false);
    PROMPT_DEMO_TEMPLATE = loadData(PROMPT_BARBERIA_BASE_PATH, "Error: Plantilla de prompt de barbería no encontrada.", false);

    // Validar que los datos esenciales se cargaron
    if (!BARBERIA_DATA || Object.keys(BARBERIA_DATA).length === 0) {
        console.error("¡ERROR FATAL! No se pudo cargar data/barberia_info.json. Usando datos vacíos.");
        BARBERIA_DATA = { nombre: "Demo", horario: {}, servicios: {}, pagos: [], faqs: [], upsell: "" }; // Fallback muy básico
    }
    if (!PROMPT_VENTAS || PROMPT_VENTAS.startsWith("Error:")) {
        console.error("¡ERROR FATAL! No se pudo cargar prompts/ventas.txt.");
        // PROMPT_VENTAS tendrá el mensaje de error
    }
     if (!PROMPT_DEMO_TEMPLATE || PROMPT_DEMO_TEMPLATE.startsWith("Error:")) {
        console.error("¡ERROR FATAL! No se pudo cargar prompts/barberia_base.txt.");
        // PROMPT_DEMO_TEMPLATE tendrá el mensaje de error
    }
}

// Cargar todo al iniciar
loadConfig();
loadReservas();
loadUserBookings();
loadExternalFiles(); // Cargar archivos JSON y TXT

// ======== PROMPTS (Variables ahora leen de archivos) ========
const CTAs = ["¿Quieres verlo? /start test 💈", "¿Agendamos 10 min para explicarte?"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// *** FUNCIÓN MODIFICADA: Usa la plantilla y los datos cargados ***
function getPromptDemoBarberia(slotsDisponibles) {
  if (!PROMPT_DEMO_TEMPLATE || PROMPT_DEMO_TEMPLATE.startsWith("Error:")) {
      return "Error interno: No se pudo cargar la configuración de la barbería."; // Mensaje de error si la plantilla falló
  }

  const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy');
  const hoyDiaSemana = now().weekday;

  // Asegurar que BARBERIA_DATA y sus propiedades existan
  const servicios = BARBERIA_DATA.servicios || {};
  const horario = BARBERIA_DATA.horario || {};
  const faqs = BARBERIA_DATA.faqs || [];
  const pagos = BARBERIA_DATA.pagos || [];

  const serviciosTxt = Object.entries(servicios).map(([k, v]) => `- ${k}: $${(v.precio || 0).toLocaleString('es-CO')} (${v.min || 'N/A'} min)`).join('\n');
  let slotsTxt = "Lo siento, no veo cupos disponibles en los próximos 3 días.";
  if (slotsDisponibles?.length) {
    slotsTxt = slotsDisponibles.map(d => `${DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d LLLL')}: ${d.horas.join(', ')}`).join('\n');
  }

  let horarioHoy = horario.festivos || "No disponible";
  if (hoyDiaSemana >= 1 && hoyDiaSemana <= 5) horarioHoy = horario.lun_vie || horarioHoy;
  else if (hoyDiaSemana === 6) horarioHoy = horario.sab || horarioHoy;
  else if (hoyDiaSemana === 7) horarioHoy = horario.dom || horarioHoy;

  const faqsBarberia = faqs.map(f => `- P: ${f.q}\n  R: ${f.a}`).join('\n');

  // Reemplazar marcadores en la plantilla
  let finalPrompt = PROMPT_DEMO_TEMPLATE;
  finalPrompt = finalPrompt.replace(/{nombreBarberia}/g, BARBERIA_DATA.nombre || "la barbería");
  finalPrompt = finalPrompt.replace(/{hoy}/g, hoy);
  finalPrompt = finalPrompt.replace(/{horarioHoy}/g, horarioHoy);
  finalPrompt = finalPrompt.replace(/{slotsTxt}/g, slotsTxt || "No disponible");
  finalPrompt = finalPrompt.replace(/{horarioLv}/g, horario.lun_vie || "No disponible");
  finalPrompt = finalPrompt.replace(/{horarioS}/g, horario.sab || "No disponible");
  finalPrompt = finalPrompt.replace(/{horarioD}/g, horario.dom || "No disponible");
  finalPrompt = finalPrompt.replace(/{serviciosTxt}/g, serviciosTxt || "No disponibles");
  finalPrompt = finalPrompt.replace(/{direccionBarberia}/g, BARBERIA_DATA.direccion || "No disponible");
  finalPrompt = finalPrompt.replace(/{pagosBarberia}/g, pagos.join(', ') || "No disponibles");
  finalPrompt = finalPrompt.replace(/{faqsBarberia}/g, faqsBarberia || "No disponibles");

  // Añadir upsell dinámicamente si existe
  if (BARBERIA_DATA.upsell) {
     finalPrompt = finalPrompt.replace(`ofrece el upsell: "\${BARBERIA_DATA.upsell}"`, `ofrece el upsell: "${BARBERIA_DATA.upsell}"`);
  } else {
     finalPrompt = finalPrompt.replace(`ofrece el upsell: "\${BARBERIA_DATA.upsell}"`, ""); // Quitar si no hay upsell
  }

  return finalPrompt;
}

// ======== UTILIDADES ========
function now() { return DateTime.now().setZone(TZ); }
function detectServicio(text) { const m = text.toLowerCase(); if (m.includes('vip')) return 'vip'; if (m.includes('degrad')) return 'corte + degradado + diseño'; if (m.includes('barba')) return 'barba completa'; if (m.includes('corte')) return 'corte clasico'; return null; }
function detectHoraExacta(text) { const h = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); if (!h) return null; let hh = parseInt(h[1], 10); const mm = h[2] ? parseInt(h[2], 10) : 0; let suffix = (h[3] || '').toUpperCase(); if (!suffix) suffix = (hh >= 9 && hh <= 11) ? 'AM' : 'PM'; if (hh === 0) hh=12; if (hh > 12) { hh -= 12; suffix = 'PM'; } return `${hh}:${String(mm).padStart(2, '0')} ${suffix}`; }
function detectCancelacion(text) { return /cancelar|cancela|no puedo ir/i.test(text); }
function calcularSlotsUsados(horaInicio, durMin) { const baseMin = BARBERIA_DATA.capacidad?.slot_base_min || 20; const n = Math.ceil(durMin / baseMin); const start = DateTime.fromFormat(horaInicio.toUpperCase(), 'h:mm a', { zone: TZ }); if (!start.isValid) return [horaInicio]; const arr = []; for (let i = 0; i < n; i++) arr.push(start.plus({ minutes: i * baseMin }).toFormat('h:mm a')); return arr; }
function parseRango(fecha, rango) { const [ini, fin] = rango.split('–').map(s => s.trim()); const open = DateTime.fromFormat(ini, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); const close = DateTime.fromFormat(fin, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); return [open, close]; }
function generateBookingId() { return Math.random().toString(36).substring(2, 9); }

// ===== Gestión de Estado =====
function ensureState(id) { if (!id || typeof id !== 'string') return { botEnabled: false, mode: 'cortex', history: [], sales: {}, ctx: {} }; if (!state[id]) state[id] = { botEnabled: true, mode: 'cortex', history: [], sales: {}, ctx: {} }; return state[id]; }
function setState(id, s) { if (id && typeof id === 'string') state[id] = s; }
function pushHistory(id, role, content) { const s = ensureState(id); s.history.push({ role, content, at: Date.now() }); while (s.history.length > MAX_TURNS) s.history.shift(); }

// ===== Gestión de Reservas =====
async function addReserva(userId, fecha, hora_inicio, servicio, slots_usados = [], nombreCliente = "Cliente") {
  if (!DEMO_RESERVAS[fecha]) DEMO_RESERVAS[fecha] = [];
  let conflict = slots_usados.some(h => DEMO_RESERVAS[fecha].includes(h));
  if (conflict) { console.warn(`[Reserva] Conflicto ${servicio} ${hora_inicio} ${fecha}`); return false; }
  slots_usados.forEach(h => DEMO_RESERVAS[fecha].push(h));
  saveReservas();
  if (!USER_BOOKINGS[userId]) USER_BOOKINGS[userId] = [];
  const bookingId = generateBookingId();
  const newBooking = { id: bookingId, fecha, hora_inicio, servicio, slots_usados, nombreCliente };
  USER_BOOKINGS[userId].push(newBooking);
  saveUserBookings();
  console.log(`[Reserva] Nueva para ${userId}:`, newBooking);
  if (BOT_CONFIG.ownerWhatsappId) await sendOwnerNotification(newBooking, 'new').catch(e => console.error('[WhatsApp Notif Error]:', e.message));
  return true;
}

async function removeReserva(userId, bookingId) {
  if (!USER_BOOKINGS[userId]) return false;
  const idx = USER_BOOKINGS[userId].findIndex(b => b.id === bookingId);
  if (idx === -1) return false;
  const booking = USER_BOOKINGS[userId][idx];
  if (DEMO_RESERVAS[booking.fecha]) { DEMO_RESERVAS[booking.fecha] = DEMO_RESERVAS[booking.fecha].filter(s => !booking.slots_usados.includes(s)); if (DEMO_RESERVAS[booking.fecha].length === 0) delete DEMO_RESERVAS[booking.fecha]; }
  saveReservas();
  USER_BOOKINGS[userId].splice(idx, 1);
  if (USER_BOOKINGS[userId].length === 0) delete USER_BOOKINGS[userId];
  saveUserBookings();
  console.log(`[Cancelación] ${bookingId} de ${userId}`);
  if (BOT_CONFIG.ownerWhatsappId) await sendOwnerNotification(booking, 'cancelled').catch(e => console.error('[WhatsApp Cancel Notif Error]:', e.message));
  return true;
}

// ===== Notificaciones (Solo WhatsApp) =====
async function sendOwnerNotification(bookingData, type = 'new') {
  const ownerId = BOT_CONFIG.ownerWhatsappId;
  if (!ownerId) { console.warn('[WhatsApp Notif Send] ownerWhatsappId no configurado.'); return; }
  const fecha = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL');
  const msg = type === 'new'
    ? `🔔 *Nueva Cita*\n\nCliente: *${bookingData.nombreCliente || 'N/A'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fecha}*\nHora: *${bookingData.hora_inicio}*\n\n_(Cortex IA)_`
    : `❌ *Cita Cancelada*\n\nCliente: *${bookingData.nombreCliente || 'N/A'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fecha}*\nHora: *${bookingData.hora_inicio}*`;
  await client.sendMessage(ownerId, msg);
  console.log(`[WhatsApp Notif Send] Notificación tipo '${type}' enviada a ${ownerId}`);
}

function generarSlotsDemo(diasAdelante = 3) {
  const hoy = now();
  const out = [];
  const slotMin = BARBERIA_DATA.capacidad?.slot_base_min || 20; // Default a 20 si no está definido
  const almuerzo = BARBERIA_DATA.horario?.almuerzo_demo || { start: -1, end: -1 }; // Default si no hay almuerzo

  for (let d = 0; d < diasAdelante; d++) {
    const fecha = hoy.plus({ days: d });
    const fechaStr = fecha.toFormat('yyyy-LL-dd');
    const wd = fecha.weekday;
    let openStr = BARBERIA_DATA.horario?.festivos || null;
    let closeStr = null; // Para manejar rangos correctamente

    if (BARBERIA_DATA.horario) {
        if (wd >= 1 && wd <= 5 && BARBERIA_DATA.horario.lun_vie) [openStr, closeStr] = BARBERIA_DATA.horario.lun_vie.split('–').map(s => s.trim());
        else if (wd === 6 && BARBERIA_DATA.horario.sab) [openStr, closeStr] = BARBERIA_DATA.horario.sab.split('–').map(s => s.trim());
        else if (wd === 7 && BARBERIA_DATA.horario.dom) [openStr, closeStr] = BARBERIA_DATA.horario.dom.split('–').map(s => s.trim());
    }

    // Si no se encontró horario para el día, saltar
    if (!openStr || !closeStr) continue;

    const open = DateTime.fromFormat(openStr, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day });
    const close = DateTime.fromFormat(closeStr, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day });

    if (!open.isValid || !close.isValid) {
        console.warn(`[Slots] Horario inválido para ${fechaStr}: ${openStr}-${closeStr}`);
        continue; // Saltar día si el horario es inválido
    }

    let cursor = open;
    if (d === 0 && hoy > open) {
      const minsSinceOpen = hoy.diff(open, 'minutes').minutes;
      cursor = open.plus({ minutes: Math.ceil(minsSinceOpen / slotMin) * slotMin });
    }

    const horas = [];
    while (cursor < close && horas.length < 20) {
      const hh = cursor.toFormat('h:mm a');
      const hora24 = cursor.hour;
      const ocupada = DEMO_RESERVAS[fechaStr]?.includes(hh);
      const esAlmuerzo = hora24 >= almuerzo.start && hora24 < almuerzo.end;
      // Añadir check para asegurar que el slot termina antes de la hora de cierre
      const slotEndTime = cursor.plus({ minutes: slotMin });
      if (!ocupada && !esAlmuerzo && cursor >= hoy.plus({ minutes: 30 }) && slotEndTime <= close) {
           horas.push(hh);
      }
      cursor = cursor.plus({ minutes: slotMin });
    }
    if (horas.length) out.push({ fecha: fechaStr, horas });
  }
  return out;
}

// ======== WHATSAPP CLIENT ========
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'data', 'session') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});
client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { if (!err) console.log('\n⚠️ Escanea el QR en: ', url, '\n'); }); });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => console.error('ERROR AUTH:', msg));
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI ========
async function safeChatCall(payload, tries = 2) { /* ... (Sin cambios) ... */ }

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  if (!msg?.from || typeof msg.from !== 'string') return;

  try {
    const from = msg.from;
    const originalText = (msg.body || '').trim();
    let low = originalText.toLowerCase();
    let processedText = originalText;

    // --- MANEJO DE VOZ ---
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
        console.log(`[Audio] Recibido de ${from}`);
        const tempAudioPath = path.join(DATA_DIR, `audio_${msg.id.id}.ogg`);
        try {
            const media = await msg.downloadMedia();
            if (!media?.data) throw new Error('Media data missing');
            fs.writeFileSync(tempAudioPath, Buffer.from(media.data, 'base64'));
            console.log(`[Audio] Enviando a Whisper...`);
            const transcription = await openai.audio.transcriptions.create({ file: fs.createReadStream(tempAudioPath), model: "whisper-1" });
            console.log(`[Audio] Transcripción: "${transcription.text}"`);
            processedText = transcription.text.trim();
            low = processedText.toLowerCase();
        } catch (transcriptionError) {
            console.error('[Error Whisper]:', transcriptionError.message);
            await msg.reply('⚠️ No entendí tu audio. ¿Puedes escribirlo?');
            processedText = ""; low = "";
        } finally {
            if (fs.existsSync(tempAudioPath)) try { fs.unlinkSync(tempAudioPath); } catch (e) { console.error(`[Error Audio Delete]:`, e.message); }
        }
    }
    // --- FIN MANEJO VOZ ---

    if (!processedText && !(low.startsWith('/'))) return;

    const s = ensureState(from);
    pushHistory(from, 'user', processedText); // Usar texto procesado

    // --- Comandos Admin ---
    if (low.startsWith('/set owner ')) { /* ... (Sin cambios) ... */ }
    // Comando /set email REMOVED
    if (low === '/clear reservas demo' && from === BOT_CONFIG.ownerWhatsappId) { /* ... (Sin cambios) ... */ }
    // --- Fin Comandos Admin ---

    // Bot ON/OFF
    if (low === '/bot off') { s.botEnabled = false; setState(from, s); return msg.reply('👌 Bot desactivado.'); }
    if (low === '/bot on') { s.botEnabled = true; setState(from, s); return msg.reply('💪 Bot activado.'); }
    if (!s.botEnabled) return;

    // Demo on/off
    if (low === '/start test') { s.mode = 'barberia'; s.history = []; s.ctx = {}; setState(from, s); return msg.reply(`*${BARBERIA_DATA.nombre}* 💈 (Demo)\nEscríbeme como cliente.`); }
    if (low === '/end test') { s.mode = 'cortex'; s.history = []; s.sales = { awaiting: 'confirm' }; setState(from, s); return msg.reply('¡Demo finalizada! ¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp.'); }

    // MODO BARBERÍA
    if (s.mode === 'barberia') {
      if (detectCancelacion(processedText)) { // <-- Usar texto procesado
        const userBookings = USER_BOOKINGS[from] || [];
        if (userBookings.length === 0) return msg.reply("No veo citas para cancelar.");
        if (userBookings.length === 1) { const b = userBookings[0]; const fechaFmt = DateTime.fromISO(b.fecha).setLocale('es').toFormat('cccc d'); s.ctx.bookingToCancel = b.id; setState(from, s); return msg.reply(`¿Confirmas cancelar tu cita de *${b.servicio}* el *${fechaFmt} ${b.hora_inicio}*? (SÍ/NO)`); }
        const citasStr = userBookings.map((b, i) => `${i+1}. ${b.servicio} (${DateTime.fromISO(b.fecha).setLocale('es').toFormat('cccc d')} ${b.hora_inicio})`).join('\n');
        return msg.reply(`Tienes varias citas:\n${citasStr}\n¿Cuál cancelar?`);
      }

      const slots = generarSlotsDemo(3);
      let promptSystem = getPromptDemoBarberia(slots);
      if (s.ctx?.bookingToCancel) promptSystem += `\n\nContexto: Usuario pidió cancelar cita ID ${s.ctx.bookingToCancel}. Si dice "SÍ", incluye <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>. Si no, olvida cancelación.`;

      const messages = [{ role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS)];
      const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 });
      let reply = completion.choices?.[0]?.message?.content?.trim() || 'No entendí';

      const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/);
      const cancelledMatch = reply.match(/<CANCELLED:\s*({.*?})\s*>/);

      if (bookingMatch?.[1]) {
        let bookingData; try { bookingData = JSON.parse(bookingMatch[1]); } catch (e) { console.error('JSON booking error:', e.message); }
        if (bookingData?.fecha && bookingData?.hora_inicio && bookingData?.servicio) {
          if (!bookingData.slots_usados?.length) { const dur = BARBERIA_DATA.servicios[bookingData.servicio.toLowerCase()]?.min; if (dur) bookingData.slots_usados = calcularSlotsUsados(bookingData.hora_inicio, dur); }
          if (!bookingData.nombreCliente) { const nameHistory = s.history.slice(-3).find(h => h.role === 'user' && h.content.split(' ').length <= 3 && !/^\d/.test(h.content) && !/^(si|sí|no|ok)$/i.test(h.content)); bookingData.nombreCliente = nameHistory?.content || "Cliente"; }
          const success = await addReserva(from, bookingData.fecha, bookingData.hora_inicio, bookingData.servicio, bookingData.slots_usados, bookingData.nombreCliente);
          if (success) { reply = reply.replace(/<BOOKING:.*?>/, '').trim(); s.history = []; s.ctx = {}; }
          else { reply = "Esa hora se ocupó. ¿Otra?"; }
        } else { reply = reply.replace(/<BOOKING:.*?>/, '').trim(); console.warn("[Booking] Tag inválido:", bookingMatch[1]); }
      } else if (cancelledMatch?.[1]) {
        let cancelData; try { cancelData = JSON.parse(cancelledMatch[1]); } catch (e) { console.error('JSON cancel error:', e.message); }
        if (cancelData?.id) { const cancelled = await removeReserva(from, cancelData.id); if (cancelled) { reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); s.history = []; s.ctx = {}; } }
        else { reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); console.warn("[Cancel] Tag inválido:", cancelledMatch[1]); }
        s.ctx.bookingToCancel = null;
      } else { if (s.ctx?.bookingToCancel) s.ctx.bookingToCancel = null; }

      pushHistory(from, 'assistant', reply);
      setState(from, s);
      return msg.reply(reply);
    }

    // MODO VENTAS
    if (s.mode === 'cortex') {
      const yes_post_demo = /^(si|sí|dale|me interesa|me gust|brutal|ok|perfecto)\b/i.test(low);
      if (s.sales?.awaiting === 'confirm') {
        if (yes_post_demo) { s.sales.awaiting = 'schedule'; const reply = 'Perfecto 🔥. ¿Tu nombre y tipo de negocio?'; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); }
        else { s.sales.awaiting = null; const reply = '¿Prefieres una llamada corta primero?'; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); }
      }
      const messages = [{ role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS)];
      const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 });
      let reply = completion.choices?.[0]?.message?.content?.trim() || '¿En qué te ayudo? 🙂';
      if (!/demo|probar|prueba/i.test(low) && !/nombre|negocio|agendar/i.test(low) && s.sales?.awaiting !== 'schedule') { if (Math.random() < 0.6) reply += `\n\n${pick(CTAs)}`; }
      pushHistory(from, 'assistant', reply);
      setState(from, s);
      return msg.reply(reply);
    }

  } catch (error) {
    console.error('ERROR:', error.message); // Log conciso
    try { await msg.reply('Ups, error. Inténtalo de nuevo.'); } catch (e) {} // Evitar crasheo si falla respuesta de error
  }
});

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
client.initialize().catch(err => console.error("ERROR INICIALIZAR:", err));