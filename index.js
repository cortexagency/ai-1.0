// =========================
// CORTEX IA - INDEX.JS (Fixed: state init + voice + handlers)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');

// --- Validar OpenAI API Key al inicio ---
if (!process.env.OPENAI_API_KEY) {
  console.error("¡ERROR FATAL! La variable de entorno OPENAI_API_KEY no está configurada.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null };

// ======== GESTIÓN PERSISTENTE ========
const DATA_DIR = path.join(__dirname, 'data');
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json');
const USER_BOOKINGS_PATH = path.join(DATA_DIR, 'user_bookings.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const BARBERIA_INFO_PATH = path.join(DATA_DIR, 'barberia_info.json');
const PROMPT_VENTAS_PATH = path.join(PROMPTS_DIR, 'ventas.txt');
const PROMPT_BARBERIA_BASE_PATH = path.join(PROMPTS_DIR, 'barberia_base.txt');

let DEMO_RESERVAS = {};
let USER_BOOKINGS = {};
let BARBERIA_DATA = {};
let PROMPT_VENTAS = "";
let PROMPT_DEMO_TEMPLATE = "";

// Asegurar carpetas
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR, { recursive: true });
} catch (e) {
  console.error("Error creando directorios:", e);
}

// --- Util de carga/guardado ---
function loadData(filePath, defaultData = {}, isJson = true) {
  console.log(`[Debug Load] Intentando cargar: ${filePath}`);
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      console.log(`[Debug Load] Archivo encontrado: ${filePath}`);
      if (isJson) {
        return fileContent ? JSON.parse(fileContent) : defaultData;
      } else {
        return fileContent;
      }
    } else {
      console.warn(`[Debug Load] Archivo NO encontrado: ${filePath}. Creando con valor default.`);
      const contentToWrite = isJson ? JSON.stringify(defaultData, null, 2) : (typeof defaultData === 'string' ? defaultData : '');
      fs.writeFileSync(filePath, contentToWrite, 'utf8');
      console.log(`[Memoria] Archivo ${path.basename(filePath)} creado.`);
      return defaultData;
    }
  } catch (e) {
    console.error(`[Error Memoria Load/Parse] ${path.basename(filePath)}:`, e.message);
    if (e instanceof SyntaxError && isJson) {
      try { fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8'); console.warn(`[Memoria] Archivo JSON ${path.basename(filePath)} reseteado por error de parseo.`);} catch (w) { console.error(`[Error Memoria Fatal] No se pudo resetear ${path.basename(filePath)}:`, w.message); }
    } else if (!fs.existsSync(filePath)) {
      try { const contentToWrite = isJson ? JSON.stringify(defaultData, null, 2) : ''; fs.writeFileSync(filePath, contentToWrite, 'utf8'); console.warn(`[Memoria] Archivo ${path.basename(filePath)} creado tras error.`);} catch (w) { console.error(`[Error Memoria Fatal] No se pudo crear ${path.basename(filePath)} tras error:`, w.message); }
    }
    return defaultData;
  }
}
function saveData(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf8'); }
  catch (e) { console.error(`[Error Save] ${path.basename(filePath)}:`, e.message); }
}

// --- Cargas ---
function loadConfig() {
  BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null });
  if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null;
  console.log('[Config] Cargada');
  if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Config] ownerWhatsappId no configurado.');
  else console.log(`[Config] Dueño WhatsApp: ${BOT_CONFIG.ownerWhatsappId}`);
}
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Reservas] Cargadas'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[User Bookings] Cargadas'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

function loadExternalFiles() {
  console.log("--- Cargando Archivos Externos ---");
  BARBERIA_DATA = loadData(BARBERIA_INFO_PATH, {}, true);
  PROMPT_VENTAS = loadData(PROMPT_VENTAS_PATH, "", false);
  PROMPT_DEMO_TEMPLATE = loadData(PROMPT_BARBERIA_BASE_PATH, "", false);

  if (!BARBERIA_DATA || typeof BARBERIA_DATA !== 'object' || Object.keys(BARBERIA_DATA).length === 0) {
    console.error("¡ERROR FATAL! data/barberia_info.json está vacío o corrupto. Usando datos mínimos.");
    BARBERIA_DATA = { nombre: "Demo", horario: {}, servicios: {}, pagos: [], faqs: [], upsell: "" };
  } else {
    console.log("[External] barberia_info.json cargado OK.");
  }
  if (!PROMPT_VENTAS || typeof PROMPT_VENTAS !== 'string' || PROMPT_VENTAS.length < 50) {
    console.error("¡ERROR FATAL! prompts/ventas.txt vacío o no cargado.");
    PROMPT_VENTAS = "Error: Prompt de ventas no disponible.";
  } else { console.log("[External] ventas.txt cargado OK."); }
  if (!PROMPT_DEMO_TEMPLATE || typeof PROMPT_DEMO_TEMPLATE !== 'string' || PROMPT_DEMO_TEMPLATE.length < 50) {
    console.error("¡ERROR FATAL! prompts/barberia_base.txt vacío o no cargado.");
    PROMPT_DEMO_TEMPLATE = "Error: Plantilla demo no disponible.";
  } else { console.log("[External] barberia_base.txt cargado OK."); }
  console.log("--- Fin Carga Archivos Externos ---");
}

// Init loads
loadConfig();
loadReservas();
loadUserBookings();
loadExternalFiles();

// ======== PROMPTS / UTIL ========
const CTAs = ["¿Quieres verlo? /start test 💈", "¿Agendamos 10 min para explicarte?"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function now() { return DateTime.now().setZone(TZ); }

// -- Detectores mínimos (no tocamos tu lógica si ya la tienes) --
function detectServicio(text) { return null; }
function detectHoraExacta(text) { return null; }
function detectCancelacion(text) { return /cancelar|cancela|no puedo ir/i.test(text || ''); }
function calcularSlotsUsados(horaInicio, durMin) { return []; }
function parseRango(fecha, rango) { return null; }
function generateBookingId() { return Math.random().toString(36).substring(2, 9); }

// ===== Gestión de Estado =====
function ensureState(id) {
  const defaultState = {
    botEnabled: true,
    mode: 'cortex',
    history: [],
    reservas: [],
    flags: { justEndedTest: false },
    ctx: {},
    sales: {}
  };
  if (!id || typeof id !== 'string') return { ...defaultState };
  if (!state[id]) state[id] = { ...defaultState };
  return state[id];
}
function setState(id, s) { if (id && typeof id === 'string') state[id] = s; }
function pushHistory(id, role, content) {
  if (!id) return;
  const s = ensureState(id);
  s.history = s.history || [];
  s.history.push({ role, content, at: Date.now() });
  if (s.history.length > 2 * MAX_TURNS) s.history = s.history.slice(-2 * MAX_TURNS);
  setState(id, s);
}

// ===== Gestión de Reservas (mínimas, no-op seguras) =====
async function addReserva(userId, fecha, hora_inicio, servicio, slots_usados = [], nombreCliente = "Cliente") {
  // No-op para evitar romper si no usas almacenamiento real aquí
  return { id: generateBookingId() };
}
async function removeReserva(userId, bookingId) { return true; }

// ===== Generación de Slots de Demo =====
function generarSlotsDemo(diasAdelante = 3) {
  const hoy = now();
  const out = [];
  const slotMin = BARBERIA_DATA.capacidad?.slot_base_min || 20;
  const almuerzo = BARBERIA_DATA.horario?.almuerzo_demo || { start: -1, end: -1 };

  for (let d = 0; d < diasAdelante; d++) {
    const fecha = hoy.plus({ days: d });
    const fechaStr = fecha.toFormat('yyyy-LL-dd');
    const wd = fecha.weekday;

    let openStr = null, closeStr = null;
    if (BARBERIA_DATA.horario) {
      if (wd >= 1 && wd <= 5 && BARBERIA_DATA.horario.lun_vie) [openStr, closeStr] = BARBERIA_DATA.horario.lun_vie.split('–').map(s => s.trim());
      else if (wd === 6 && BARBERIA_DATA.horario.sab) [openStr, closeStr] = BARBERIA_DATA.horario.sab.split('–').map(s => s.trim());
      else if (wd === 7 && BARBERIA_DATA.horario.dom) [openStr, closeStr] = BARBERIA_DATA.horario.dom.split('–').map(s => s.trim());
      else openStr = BARBERIA_DATA.horario.festivos || null;
    }
    if (!openStr || !closeStr) { console.log(`[Slots] No horario para ${fechaStr}`); continue; }

    const open = DateTime.fromFormat(openStr, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day });
    const close = DateTime.fromFormat(closeStr, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day });
    if (!open.isValid || !close.isValid) { console.warn(`[Slots] Horario inválido ${fechaStr}: ${openStr}-${closeStr}`); continue; }

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

// ===== Prompt de demo barbería =====
function getPromptDemoBarberia(slotsDisponibles) {
  if (!PROMPT_DEMO_TEMPLATE || PROMPT_DEMO_TEMPLATE.startsWith("Error:")) return "Error: Plantilla prompt demo no cargada.";
  const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy');
  const hoyDiaSemana = now().weekday;

  const servicios = BARBERIA_DATA.servicios || {};
  const horario = BARBERIA_DATA.horario || {};
  const faqs = BARBERIA_DATA.faqs || [];
  const pagos = BARBERIA_DATA.pagos || [];

  const serviciosTxt = Object.entries(servicios).map(([k, v]) => `- ${k}: $${(v.precio || 0).toLocaleString('es-CO')} (${v.min || 'N/A'} min)`).join('\n');
  let slotsTxt = "Lo siento, no veo cupos disponibles.";
  if (slotsDisponibles?.length) {
    slotsTxt = slotsDisponibles.map(d => `${DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d')}: ${d.horas.join(', ')}`).join('\n');
  }

  let horarioHoy = horario.festivos || "No disponible";
  if (hoyDiaSemana >= 1 && hoyDiaSemana <= 5) horarioHoy = horario.lun_vie || horarioHoy;
  else if (hoyDiaSemana === 6) horarioHoy = horario.sab || horarioHoy;
  else if (hoyDiaSemana === 7) horarioHoy = horario.dom || horarioHoy;

  const faqsBarberia = faqs.map(f => `- P: ${f.q}\n  R: ${f.a}`).join('\n');

  let finalPrompt = PROMPT_DEMO_TEMPLATE;
  finalPrompt = finalPrompt.replace(/{nombreBarberia}/g, BARBERIA_DATA.nombre || "la barbería");
  finalPrompt = finalPrompt.replace(/{hoy}/g, hoy);
  finalPrompt = finalPrompt.replace(/{horarioHoy}/g, horarioHoy);
  finalPrompt = finalPrompt.replace(/{slotsTxt}/g, slotsTxt || "No disponible");
  finalPrompt = finalPrompt.replace(/{horarioLv}/g, horario.lun_vie || "N/A");
  finalPrompt = finalPrompt.replace(/{horarioS}/g, horario.sab || "N/A");
  finalPrompt = finalPrompt.replace(/{horarioD}/g, horario.dom || "N/A");
  finalPrompt = finalPrompt.replace(/{serviciosTxt}/g, serviciosTxt || "N/A");
  finalPrompt = finalPrompt.replace(/{direccionBarberia}/g, BARBERIA_DATA.direccion || "N/A");
  finalPrompt = finalPrompt.replace(/{pagosBarberia}/g, pagos.join(', ') || "N/A");
  finalPrompt = finalPrompt.replace(/{faqsBarberia}/g, faqsBarberia || "N/A");
  finalPrompt = finalPrompt.replace(/{upsellText}/g, BARBERIA_DATA.upsell || "");
  return finalPrompt;
}

// === TRANSCRIPCIÓN DE AUDIO (WhatsApp -> OpenAI) ===
async function transcribeVoiceFromMsg(msg) {
  try {
    const media = await msg.downloadMedia();
    if (!media || !media.data) return null;

    const mime = media.mimetype || '';
    const ext = mime.includes('ogg') ? 'ogg'
             : (mime.includes('mpeg') || mime.includes('mp3')) ? 'mp3'
             : mime.includes('wav') ? 'wav'
             : 'ogg';

    const tmpPath = path.join(DATA_DIR, `voice_${Date.now()}.${ext}`);
    const buffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(tmpPath, buffer);

    try {
      let resp;
      try {
        resp = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tmpPath),
          model: 'gpt-4o-transcribe',
          language: 'es'
        });
      } catch (e) {
        resp = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tmpPath),
          model: 'whisper-1',
          language: 'es'
        });
      }
      const text = resp?.text || resp?.results?.[0]?.alternatives?.[0]?.transcript || '';
      return (text || '').trim();
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  } catch (err) {
    console.error('[Audio] Error transcribiendo:', err);
    return null;
  }
}

// ======== WHATSAPP CLIENT ========
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'data', 'session') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-accelerated-2d-canvas','--no-first-run','--no-zygote','--disable-gpu','--disable-extensions'],
  },
  qrTimeout: 0,
  authTimeout: 0,
});
client.on('qr', (qr) => {
  console.log('\n⚠️ No se puede mostrar el QR aquí. Copia el siguiente enlace en tu navegador para verlo:\n');
  qrcode.toDataURL(qr, (err, url) => {
    if (err) { console.error("Error generando QR Data URL:", err); return; }
    console.log(url);
    console.log('\n↑↑↑ Copia ese enlace y pégalo en tu navegador para escanear el QR ↑↑↑');
  });
});
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => { console.error('ERROR AUTH:', msg); });
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI ========
async function safeChatCall(payload, tries = 2) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    console.error("[Error OpenAI Previo] Payload inválido:", payload);
    throw new Error("Payload inválido enviado a OpenAI.");
  }
  if (!payload.messages[0].content || payload.messages[0].content.startsWith("Error:")) {
    console.error("[Error OpenAI Previo] Prompt del sistema inválido:", payload.messages[0].content);
    throw new Error("Prompt del sistema inválido enviado a OpenAI.");
  }
  for (let i = 0; i < tries; i++) {
    try {
      const completion = await openai.chat.completions.create(payload);
      if (!completion?.choices?.[0]?.message?.content) throw new Error("Respuesta de OpenAI inválida.");
      return completion;
    } catch (e) {
      console.error(`[Error OpenAI] Intento ${i + 1} falló:`, e);
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 700));
    }
  }
  throw new Error("safeChatCall falló inesperadamente.");
}

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  if (!msg?.from || typeof msg.from !== 'string') return;

  try {
    const from = msg.from;
    const originalText = (msg.body || '').trim();
    let low = originalText.toLowerCase();
    let processedText = originalText;

    // --- MANEJO DE VOZ ---
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || (msg.mimetype && msg.mimetype.startsWith('audio/')))) {
      try {
        const transcript = await transcribeVoiceFromMsg(msg);
        if (transcript && transcript.length > 0) {
          processedText = transcript;
          low = transcript.toLowerCase();
        } else {
          return await msg.reply('No alcancé a entender el audio. ¿Puedes repetirlo un poco más claro?');
        }
      } catch (e) {
        console.error('[Handler Voz] Error:', e);
        return await msg.reply('Tuve un problema leyendo el audio. ¿Me lo reenvías porfa?');
      }
    }
    // --- FIN MANEJO VOZ ---

    if (!processedText && !(low.startsWith('/'))) return;

    const s = ensureState(from);
    pushHistory(from, 'user', processedText);

    // --- Comandos básicos ---
    if (low.startsWith('/set owner ')) {
      const id = processedText.split(' ')[2] || null;
      BOT_CONFIG.ownerWhatsappId = id;
      saveData(CONFIG_PATH, BOT_CONFIG);
      return msg.reply(`Owner seteado en: ${id}`);
    }

    if (low === '/bot off') { s.botEnabled = false; setState(from, s); return msg.reply('👌 Bot desactivado.'); }
    if (low === '/bot on')  { s.botEnabled = true;  setState(from, s); return msg.reply('💪 Bot activado.'); }
    if (s.botEnabled === false) return;

    if (low === '/start test') { s.mode = 'barberia'; s.history = []; s.ctx = {}; setState(from, s); return msg.reply(`*${BARBERIA_DATA.nombre || 'Demo'}* 💈 (Demo)\nEscríbeme como cliente.`); }
    if (low === '/end test')   { s.mode = 'cortex';   s.history = []; s.sales = { awaiting: 'confirm' }; setState(from, s); return msg.reply('¡Demo finalizada! ¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp.'); }

    // ======= MODO BARBERÍA =======
    if (s.mode === 'barberia') {
      try {
        const isCancellation = detectCancelacion(processedText);
        if (isCancellation) {
          // podrías setear s.ctx.bookingToCancel según tu flujo
        }
        const slots = generarSlotsDemo(3);
        let promptSystem = getPromptDemoBarberia(slots);
        if (s.ctx?.bookingToCancel) {
          promptSystem += `\n\nContexto: Cancelar cita ID ${s.ctx.bookingToCancel}? Si confirma, incluye <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>.`;
        }

        const messages = [{ role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS)];
        const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 });
        let reply = completion.choices?.[0]?.message?.content?.trim() || 'No te entendí, ¿me repites porfa?';
        const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/);
        const cancelledMatch = reply.match(/<CANCELLED:\s*({.*?})\s*>/);

        if (bookingMatch?.[1]) {
          try {
            const booking = JSON.parse(bookingMatch[1]);
            await addReserva(from, booking.fecha, booking.hora_inicio, booking.servicio, booking.slots_usados || [], booking.nombreCliente || "Cliente");
          } catch (_) {}
        } else if (cancelledMatch?.[1]) {
          try {
            const data = JSON.parse(cancelledMatch[1]);
            await removeReserva(from, data.id);
          } catch (_) {}
        }

        pushHistory(from, 'assistant', reply);
        setState(from, s);
        return msg.reply(reply);

      } catch (e) {
        console.error('[Barbería] Error:', e);
        return msg.reply('Uy, se me enredó algo aquí. ¿Puedes escribirlo de nuevo? 🙏');
      }
    }

    // ======= MODO VENTAS =======
    if (s.mode === 'cortex') {
      try {
        if (s.sales?.awaiting === 'confirm') {
          const yes = /^(si|sí|dale|me interesa|brutal|ok|perfecto)\b/i.test(low);
          if (yes) {
            s.sales.awaiting = 'schedule';
            setState(from, s);
            return msg.reply('¡Excelente! Te paso dos opciones: ¿te sirve mañana a las 10:00 am o 4:00 pm para afinarlo y dejarlo en tu WhatsApp?');
          }
        }

        const messages = [{ role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS)];
        const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 });
        let reply = completion.choices?.[0]?.message?.content?.trim() || '¿En qué te puedo ayudar hoy con tu negocio? 🙂';
        if (s.sales?.awaiting !== 'schedule' && Math.random() < 0.6) {
          reply += `\n\n${pick(CTAs)}`;
        }

        pushHistory(from, 'assistant', reply);
        setState(from, s);
        return msg.reply(reply);

      } catch (e) {
        console.error('[Ventas] Error:', e);
        return msg.reply('Se me trabó la mente un segundito. ¿Puedes repetirlo, porfa?');
      }
    }

  } catch (error) {
    console.error('****** ¡ERROR CAPTURADO EN HANDLER! ******\n', error, '\n****************************************');
    try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (e) { console.error("Error enviando msg de error:", e.message); }
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason, promise); });
client.initialize().catch(err => { console.error("ERROR INICIALIZAR:", err); });
