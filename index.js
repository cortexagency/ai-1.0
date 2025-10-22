// =========================
// CORTEX IA - INDEX.JS (v18 - Voice Recognition Added, No Email)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
// No nodemailer needed

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null }; // Solo WhatsApp ID

// ======== GESTIÓN PERSISTENTE ========
const DATA_DIR = path.join(__dirname, 'data');
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json');
const USER_BOOKINGS_PATH = path.join(DATA_DIR, 'user_bookings.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
let DEMO_RESERVAS = {};
let USER_BOOKINGS = {};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Funciones de Carga/Guardado ---
function loadData(filePath, defaultData = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return data ? JSON.parse(data) : defaultData;
    } else {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
      console.log(`[Memoria] Archivo ${path.basename(filePath)} creado.`);
      return defaultData;
    }
  } catch (e) {
    console.error(`[Error Memoria] ${path.basename(filePath)}:`, e.message);
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
      console.warn(`[Memoria] Archivo ${path.basename(filePath)} reseteado.`);
    } catch (writeError) {
      console.error(`[Error Fatal] ${path.basename(filePath)}:`, writeError.message);
    }
    return defaultData;
  }
}
function saveData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf8');
  } catch (e) {
    console.error(`[Error Save] ${path.basename(filePath)}:`, e.message);
  }
}
function loadConfig() {
  BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null });
  if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null;
  console.log('[Config] Cargada');
  if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Advertencia Config] ownerWhatsappId no configurado. Usa /set owner.');
  if (BOT_CONFIG.ownerWhatsappId) console.log(`[Config] Dueño WhatsApp: ${BOT_CONFIG.ownerWhatsappId}`);
}
function saveConfig() { saveData(CONFIG_PATH, BOT_CONFIG); }
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Reservas] Cargadas'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[User Bookings] Cargadas'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

loadConfig();
loadReservas();
loadUserBookings();

// ======== DATOS BARBERÍA ========
const BARBERIA_DATA = {
  nombre: "Barbería La 70",
  direccion: "Calle 70 #45-18, Belén, Medellín",
  telefono: "+57 310 555 1234",
  horario: {
    lun_vie: "9:00 AM – 8:00 PM",
    sab: "9:00 AM – 6:00 PM",
    dom: "10:00 AM – 4:00 PM",
    almuerzo_demo: { start: 13, end: 14 }
  },
  capacidad: { slot_base_min: 20 },
  servicios: {
    'corte clasico': { precio: 35000, min: 40 },
    'corte + degradado + diseño': { precio: 55000, min: 60 },
    'barba completa': { precio: 28000, min: 30 },
    'corte + barba': { precio: 75000, min: 70 },
    'afeitado tradicional': { precio: 45000, min: 45 },
    'vip': { precio: 120000, min: 90 }
  },
  pagos: ["Nequi", "Daviplata", "Efectivo"]
};

// ======== PROMPTS ========
const PROMPT_VENTAS = `Eres Cortex IA de Cortex Agency. Ayudas a dueños de negocios a recuperar clientes perdidos por no atender WhatsApp 24/7. Hablas como parcero colombiano: empático, seguro, humano. Tu meta es mostrar valor, no empujar. Escuchas el dolor (citas perdidas, estrés), lo cuantificas, y ofreces solución: "Yo respondo al instante y agendo por ti". Manejas objeciones con empatía. Cierras con demo: "Escribe /start test". Post-demo preguntas: "¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp".`;
const CTAs = ["¿Quieres verlo? /start test 💈", "¿Agendamos 10 min para explicarte?"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getPromptDemoBarberia(slotsDisponibles) {
  const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy');
  const serviciosTxt = Object.entries(BARBERIA_DATA.servicios).map(([k, v]) => `- ${k}: $${v.precio.toLocaleString('es-CO')} (${v.min} min)`).join('\n');
  let slotsTxt = "No hay cupos disponibles próximos 3 días.";
  if (slotsDisponibles?.length) {
    slotsTxt = slotsDisponibles.map(d => `${DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d LLLL')}: ${d.horas.join(', ')}`).join('\n');
  }
  // Simplified prompt for brevity in example, ensure full rules are included
  return `Eres Asistente de ${BARBERIA_DATA.nombre}. Amable, paisa. Agendas citas. Hoy: ${hoy}. FLUJO: 1.Servicio? 2.Precio/Duración 3.Hora deseada? 4.Confirma hora y PIDE NOMBRE 5.Con hora+nombre responde confirmación final + <BOOKING: {...}>. SLOTS DISPONIBLES (uso interno):\n${slotsTxt}\nSERVICIOS:\n${serviciosTxt}\nHorario: L-V ${BARBERIA_DATA.horario.lun_vie}, S ${BARBERIA_DATA.horario.sab}, D ${BARBERIA_DATA.horario.dom}. Si piden cancelar, confirma cuál cita y usa <CANCELLED: {"id": "..."}>.`;
}

// ======== UTILIDADES ========
function now() { return DateTime.now().setZone(TZ); }
function detectServicio(text) { const m = text.toLowerCase(); if (m.includes('vip')) return 'vip'; if (m.includes('degrad')) return 'corte + degradado + diseño'; if (m.includes('barba')) return 'barba completa'; if (m.includes('corte')) return 'corte clasico'; return null; }
function detectHoraExacta(text) { const h = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); if (!h) return null; let hh = parseInt(h[1], 10); const mm = h[2] ? parseInt(h[2], 10) : 0; let suffix = (h[3] || '').toUpperCase(); if (!suffix) suffix = (hh >= 9 && hh <= 11) ? 'AM' : 'PM'; if (hh > 12) { hh -= 12; suffix = 'PM'; } return `${hh}:${String(mm).padStart(2, '0')} ${suffix}`; }
function detectCancelacion(text) { return /cancelar|cancela|no puedo ir/i.test(text); }
function calcularSlotsUsados(horaInicio, durMin) { const n = Math.ceil(durMin / BARBERIA_DATA.capacidad.slot_base_min); const start = DateTime.fromFormat(horaInicio.toUpperCase(), 'h:mm a', { zone: TZ }); if (!start.isValid) return [horaInicio]; const arr = []; for (let i = 0; i < n; i++) arr.push(start.plus({ minutes: i * 20 }).toFormat('h:mm a')); return arr; }
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
  if (DEMO_RESERVAS[booking.fecha]) {
    DEMO_RESERVAS[booking.fecha] = DEMO_RESERVAS[booking.fecha].filter(s => !booking.slots_usados.includes(s));
    if (DEMO_RESERVAS[booking.fecha].length === 0) delete DEMO_RESERVAS[booking.fecha];
  }
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
  for (let d = 0; d < diasAdelante; d++) {
    const fecha = hoy.plus({ days: d });
    const fechaStr = fecha.toFormat('yyyy-LL-dd');
    const wd = fecha.weekday;
    let open, close;
    if (wd >= 1 && wd <= 5) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.lun_vie);
    else if (wd === 6) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.sab);
    else [open, close] = parseRango(fecha, BARBERIA_DATA.horario.dom);
    let cursor = open;
    if (d === 0 && hoy > open) {
      const minsSinceOpen = hoy.diff(open, 'minutes').minutes;
      cursor = open.plus({ minutes: Math.ceil(minsSinceOpen / 20) * 20 });
    }
    const horas = [];
    while (cursor < close && horas.length < 20) {
      const hh = cursor.toFormat('h:mm a');
      const ocupada = DEMO_RESERVAS[fechaStr]?.includes(hh);
      const esAlmuerzo = cursor.hour >= 13 && cursor.hour < 14;
      if (!ocupada && !esAlmuerzo && cursor > hoy.plus({ minutes: 30 })) horas.push(hh);
      cursor = cursor.plus({ minutes: 20 });
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] // Simplified args
  }
});
client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { if (!err) console.log('\n⚠️ Escanea el QR en: ', url, '\n'); }); });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => console.error('ERROR AUTH:', msg));
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI ========
async function safeChatCall(payload, tries = 2) { for (let i = 0; i < tries; i++) { try { return await openai.chat.completions.create(payload); } catch (e) { console.error(`[OpenAI] Intento ${i + 1} falló:`, e.message); if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 700)); } } }

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  // Ignorar mensajes inválidos o sin remitente
  if (!msg?.from || typeof msg.from !== 'string') {
      console.warn("[Handler] Mensaje inválido ignorado.");
      return;
  }

  try {
    const from = msg.from;
    const originalText = (msg.body || '').trim();
    let low = originalText.toLowerCase();
    let processedText = originalText; // Texto a usar después de posible transcripción

    // *** INICIO: MANEJO DE MENSAJES DE VOZ ***
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
        console.log(`[Audio] Mensaje de voz recibido de ${from}`);
        const tempAudioPath = path.join(DATA_DIR, `audio_${msg.id.id}.ogg`);

        try {
            const media = await msg.downloadMedia();
            if (!media || !media.data) throw new Error('Media data missing');

            const audioBuffer = Buffer.from(media.data, 'base64');
            fs.writeFileSync(tempAudioPath, audioBuffer);
            console.log(`[Audio] Archivo temporal: ${tempAudioPath}`);

            console.log(`[Audio] Enviando a Whisper...`);
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(tempAudioPath),
                model: "whisper-1",
            });
            console.log(`[Audio] Transcripción: "${transcription.text}"`);

            processedText = transcription.text.trim(); // Usar texto transcrito
            low = processedText.toLowerCase(); // Actualizar low

        } catch (transcriptionError) {
            console.error('[Error Whisper]:', transcriptionError.message);
            await msg.reply('⚠️ No pude entender tu audio. ¿Puedes escribirlo?');
            processedText = ""; // Marcar como inválido para no procesar
            low = "";
        } finally {
            if (fs.existsSync(tempAudioPath)) {
                try { fs.unlinkSync(tempAudioPath); console.log(`[Audio] Temporal eliminado: ${tempAudioPath}`); }
                catch (deleteError) { console.error(`[Error Audio Delete]:`, deleteError.message); }
            }
        }
    }
    // *** FIN: MANEJO DE MENSAJES DE VOZ ***

    // Si el mensaje procesado está vacío Y no es un comando, no hacer nada.
    if (!processedText && !(low.startsWith('/'))) {
         console.log(`[Handler] Mensaje vacío/error de audio ignorado.`);
         return;
    }

    // Obtener estado y guardar historial CON EL TEXTO PROCESADO
    const s = ensureState(from);
    pushHistory(from, 'user', processedText); // Guardar texto original o transcrito

    // --- Comandos Admin (Usan 'low' actualizado) ---
    if (low.startsWith('/set owner ')) {
      if (BOT_CONFIG.ownerWhatsappId && from !== BOT_CONFIG.ownerWhatsappId) return msg.reply('🔒 Solo el dueño actual puede cambiar esto.');
      const newOwner = low.split(' ')[2]?.trim();
      if (newOwner && /^\d+@c\.us$/.test(newOwner)) {
        BOT_CONFIG.ownerWhatsappId = newOwner;
        saveConfig();
        return msg.reply(`✅ Dueño WhatsApp configurado: ${newOwner}`);
      }
      return msg.reply('❌ Formato: /set owner numero@c.us');
    }
    // Comando /set email REMOVED
    if (low === '/clear reservas demo' && from === BOT_CONFIG.ownerWhatsappId) {
      DEMO_RESERVAS = {}; saveReservas();
      USER_BOOKINGS = {}; saveUserBookings();
      console.log('[Memoria] Reservas limpiadas por admin.');
      return msg.reply('🧹 Reservas limpiadas');
    }
    // --- Fin Comandos Admin ---

    // Bot ON/OFF
    if (low === '/bot off') { s.botEnabled = false; setState(from, s); return msg.reply('👌 Bot desactivado. /bot on para reactivar'); }
    if (low === '/bot on') { s.botEnabled = true; setState(from, s); return msg.reply('💪 Bot activado'); }
    if (!s.botEnabled) return; // Si está apagado, no seguir

    // Demo on/off
    if (low === '/start test') { s.mode = 'barberia'; s.history = []; s.ctx = {}; setState(from, s); return msg.reply(`*${BARBERIA_DATA.nombre}* 💈 (Demo)\nEscríbeme como cliente.`); }
    if (low === '/end test') { s.mode = 'cortex'; s.history = []; s.sales = { awaiting: 'confirm' }; setState(from, s); return msg.reply('¡Demo finalizada! ¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp.'); }

    // MODO BARBERÍA (Usa 'processedText' para NLU y 'low' para keywords)
    if (s.mode === 'barberia') {
      if (detectCancelacion(processedText)) { // <--- Usar processedText para detección
        const userBookings = USER_BOOKINGS[from] || [];
        if (userBookings.length === 0) return msg.reply("No veo citas para cancelar.");
        if (userBookings.length === 1) { const b = userBookings[0]; const fechaFmt = DateTime.fromISO(b.fecha).setLocale('es').toFormat('cccc d'); s.ctx.bookingToCancel = b.id; setState(from, s); return msg.reply(`¿Confirmas cancelar tu cita de *${b.servicio}* el *${fechaFmt} ${b.hora_inicio}*? (SÍ/NO)`); }
        const citasStr = userBookings.map((b, i) => `${i+1}. ${b.servicio} (${DateTime.fromISO(b.fecha).setLocale('es').toFormat('cccc d')} ${b.hora_inicio})`).join('\n');
        return msg.reply(`Tienes varias citas:\n${citasStr}\n¿Cuál cancelar?`);
      }

      const slots = generarSlotsDemo(3);
      let promptSystem = getPromptDemoBarberia(slots);
      if (s.ctx?.bookingToCancel) promptSystem += `\n\nUsuario pidió cancelar. Si dice "SÍ", incluye <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>`;

      // El historial ya contiene processedText, OpenAI lo usará
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
        } else { reply = reply.replace(/<BOOKING:.*?>/, '').trim(); console.warn("[Booking] Tag inválido:", bookingMatch[1]); } // Limpiar tag aunque sea inválido
      } else if (cancelledMatch?.[1]) {
        let cancelData; try { cancelData = JSON.parse(cancelledMatch[1]); } catch (e) { console.error('JSON cancel error:', e.message); }
        if (cancelData?.id) { const cancelled = await removeReserva(from, cancelData.id); if (cancelled) { reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); s.history = []; s.ctx = {}; } }
        else { reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); console.warn("[Cancel] Tag inválido:", cancelledMatch[1]); } // Limpiar tag
        s.ctx.bookingToCancel = null; // Limpiar estado de cancelación pendiente
      } else {
         // Si no hubo acción pero esperábamos cancelación, limpiar
         if (s.ctx?.bookingToCancel) s.ctx.bookingToCancel = null;
      }

      pushHistory(from, 'assistant', reply);
      setState(from, s);
      return msg.reply(reply);
    }

    // MODO VENTAS (Usa 'low' actualizado si hubo transcripción)
    if (s.mode === 'cortex') {
      const yes_post_demo = /^(si|sí|dale|me interesa|me gust|brutal|ok|perfecto)\b/i.test(low);
      if (s.sales?.awaiting === 'confirm') {
        if (yes_post_demo) { s.sales.awaiting = 'schedule'; const reply = 'Perfecto 🔥. ¿Tu nombre y tipo de negocio?'; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); }
        else { s.sales.awaiting = null; const reply = '¿Prefieres una llamada corta primero?'; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); }
      }

      // El historial ya contiene processedText
      const messages = [{ role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS)];
      const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 });
      let reply = completion.choices?.[0]?.message?.content?.trim() || '¿En qué te ayudo? 🙂';

      if (!/demo|probar|prueba/i.test(low) && !/nombre|negocio|agendar/i.test(low) && s.sales?.awaiting !== 'schedule') {
        if (Math.random() < 0.6) reply += `\n\n${pick(CTAs)}`;
      }

      pushHistory(from, 'assistant', reply);
      setState(from, s);
      return msg.reply(reply);
    }

  } catch (error) {
    console.error('ERROR:', error.message); // Log de error más conciso
    try { await msg.reply('Ups, error. Inténtalo de nuevo.'); } catch (e) { console.error("Error enviando msg de error:", e.message);}
  }
});

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
client.initialize().catch(err => console.error("ERROR INICIALIZAR:", err));