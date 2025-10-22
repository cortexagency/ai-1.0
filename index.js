// =========================
// CORTEX IA - INDEX.JS (v21 - Fix File Paths & Puppeteer Args Final)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
// No nodemailer

// --- Validar OpenAI API Key al inicio ---
if (!process.env.OPENAI_API_KEY) {
    console.error("¡ERROR FATAL! La variable de entorno OPENAI_API_KEY no está configurada.");
    process.exit(1); // Detener si falta la clave
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// -----------------------------------------

const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null };

// ======== GESTIÓN PERSISTENTE ========
const DATA_DIR = path.join(__dirname, 'data');
const PROMPTS_DIR = path.join(__dirname, 'prompts');
console.log(`[Debug Path] Directorio de Datos: ${DATA_DIR}`); // Log para verificar ruta
console.log(`[Debug Path] Directorio de Prompts: ${PROMPTS_DIR}`); // Log para verificar ruta

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

// Asegurarse de que las carpetas existan
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); // recursive: true por si acaso
    if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR, { recursive: true });
} catch (dirError) {
    console.error("Error creando directorios data/prompts:", dirError);
    // Considerar salir si no se pueden crear directorios críticos
}


// --- Funciones de Carga/Guardado (Simplificadas y con más logs) ---
function loadData(filePath, defaultData = {}, isJson = true) {
  console.log(`[Debug Load] Intentando cargar: ${filePath}`); // Log antes de cargar
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      console.log(`[Debug Load] Archivo encontrado: ${filePath}`);
      if (isJson) {
        return fileContent ? JSON.parse(fileContent) : defaultData;
      } else {
        return fileContent; // Para archivos TXT
      }
    } else {
      console.warn(`[Debug Load] Archivo NO encontrado: ${filePath}. Creando con valor default.`);
      const contentToWrite = isJson ? JSON.stringify(defaultData, null, 2) : (typeof defaultData === 'string' ? defaultData : '');
      fs.writeFileSync(filePath, contentToWrite, 'utf8');
      console.log(`[Memoria] Archivo ${path.basename(filePath)} creado.`);
      return defaultData;
    }
  } catch (e) {
    // Loguear error específico de carga/parseo
    console.error(`[Error Memoria Load/Parse] ${path.basename(filePath)}:`, e.message);
    // Intentar resetear solo si el error fue al PARSEAR, no al leer
    if (e instanceof SyntaxError && isJson) {
        try { fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8'); console.warn(`[Memoria] Archivo JSON ${path.basename(filePath)} reseteado por error de parseo.`); } catch (writeError) { console.error(`[Error Memoria Fatal] No se pudo resetear ${path.basename(filePath)}:`, writeError.message); }
    } else if (!fs.existsSync(filePath)) {
        // Si el error fue porque no existe (aunque ya lo chequeamos antes, por si acaso)
         try { const contentToWrite = isJson ? JSON.stringify(defaultData, null, 2) : ''; fs.writeFileSync(filePath, contentToWrite, 'utf8'); console.warn(`[Memoria] Archivo ${path.basename(filePath)} creado tras error de lectura.`); } catch (writeError) { console.error(`[Error Memoria Fatal] No se pudo crear ${path.basename(filePath)} tras error:`, writeError.message); }
    }
    return defaultData; // Siempre devolver default en caso de error grave
  }
}
function saveData(filePath, data) {
  try { const dataToSave = data || {}; fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8'); } catch (e) { console.error(`[Error Save] ${path.basename(filePath)}:`, e.message); }
}

// --- Carga de Configuración Específica ---
function loadConfig() { BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null }); if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null; console.log('[Config] Cargada'); if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Config] ownerWhatsappId no configurado.'); else console.log(`[Config] Dueño WhatsApp: ${BOT_CONFIG.ownerWhatsappId}`); }
function saveConfig() { saveData(CONFIG_PATH, BOT_CONFIG); }
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Reservas] Cargadas'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[User Bookings] Cargadas'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

// --- Carga de Archivos Externos Críticos (Simplificada) ---
function loadExternalFiles() {
    console.log("--- Cargando Archivos Externos ---");
    BARBERIA_DATA = loadData(BARBERIA_INFO_PATH, {}, true);
    PROMPT_VENTAS = loadData(PROMPT_VENTAS_PATH, "", false); // Default a string vacía
    PROMPT_DEMO_TEMPLATE = loadData(PROMPT_BARBERIA_BASE_PATH, "", false); // Default a string vacía

    // Validaciones más estrictas
    if (!BARBERIA_DATA || typeof BARBERIA_DATA !== 'object' || Object.keys(BARBERIA_DATA).length === 0) {
        console.error("¡ERROR FATAL! data/barberia_info.json está vacío o corrupto. Usando datos mínimos.");
        BARBERIA_DATA = { nombre: "Demo", horario: {}, servicios: {}, pagos: [], faqs: [], upsell: "" };
    } else {
        console.log("[External] barberia_info.json cargado OK.");
    }
    if (!PROMPT_VENTAS || typeof PROMPT_VENTAS !== 'string' || PROMPT_VENTAS.length < 50) { // Check si es string y tiene algo de contenido
        console.error("¡ERROR FATAL! prompts/ventas.txt vacío o no cargado.");
        PROMPT_VENTAS = "Error: Prompt de ventas no disponible."; // Fallback
    } else {
         console.log("[External] ventas.txt cargado OK.");
    }
    if (!PROMPT_DEMO_TEMPLATE || typeof PROMPT_DEMO_TEMPLATE !== 'string' || PROMPT_DEMO_TEMPLATE.length < 50) {
        console.error("¡ERROR FATAL! prompts/barberia_base.txt vacío o no cargado.");
        PROMPT_DEMO_TEMPLATE = "Error: Plantilla demo no disponible."; // Fallback
    } else {
         console.log("[External] barberia_base.txt cargado OK.");
    }
     console.log("--- Fin Carga Archivos Externos ---");
}

// Cargar todo al iniciar
loadConfig();
loadReservas();
loadUserBookings();
loadExternalFiles(); // Cargar archivos JSON y TXT

// ======== DATOS BARBERÍA (Ahora se usa la variable cargada BARBERIA_DATA) ========

// ======== PROMPTS (Variables ahora leen de archivos) ========
const CTAs = ["¿Quieres verlo? /start test 💈", "¿Agendamos 10 min para explicarte?"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getPromptDemoBarberia(slotsDisponibles) {
  // Usar PROMPT_DEMO_TEMPLATE cargado y BARBERIA_DATA cargado
  if (!PROMPT_DEMO_TEMPLATE || PROMPT_DEMO_TEMPLATE.startsWith("Error:")) return "Error: Plantilla prompt demo no cargada.";
  // ... (Resto de la lógica de reemplazo, igual que antes) ...
  const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy'); const hoyDiaSemana = now().weekday;
  const servicios = BARBERIA_DATA.servicios || {}; const horario = BARBERIA_DATA.horario || {}; const faqs = BARBERIA_DATA.faqs || []; const pagos = BARBERIA_DATA.pagos || [];
  const serviciosTxt = Object.entries(servicios).map(([k, v]) => `- ${k}: $${(v.precio || 0).toLocaleString('es-CO')} (${v.min || 'N/A'} min)`).join('\n');
  let slotsTxt = "Lo siento, no veo cupos disponibles."; if (slotsDisponibles?.length) { slotsTxt = slotsDisponibles.map(d => `${DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d')}: ${d.horas.join(', ')}`).join('\n'); }
  let horarioHoy = horario.festivos || "No disponible"; if (hoyDiaSemana >= 1 && hoyDiaSemana <= 5) horarioHoy = horario.lun_vie || horarioHoy; else if (hoyDiaSemana === 6) horarioHoy = horario.sab || horarioHoy; else if (hoyDiaSemana === 7) horarioHoy = horario.dom || horarioHoy;
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
  const upsellText = BARBERIA_DATA.upsell || "";
  finalPrompt = finalPrompt.replace(/{upsellText}/g, upsellText ? `${upsellText}` : "");
  return finalPrompt;
}

// ======== UTILIDADES ========
function now() { return DateTime.now().setZone(TZ); }
function detectServicio(text) { /* ... (Sin cambios) ... */ }
function detectHoraExacta(text) { /* ... (Sin cambios) ... */ }
function detectCancelacion(text) { return /cancelar|cancela|no puedo ir/i.test(text); }
function calcularSlotsUsados(horaInicio, durMin) { /* ... (Sin cambios) ... */ }
function parseRango(fecha, rango) { /* ... (Sin cambios) ... */ }
function generateBookingId() { return Math.random().toString(36).substring(2, 9); }

// ===== Gestión de Estado =====
function ensureState(id) { /* ... (Sin cambios) ... */ }
function setState(id, s) { if (id && typeof id === 'string') state[id] = s; }
function pushHistory(id, role, content) { /* ... (Sin cambios) ... */ }

// ===== Gestión de Reservas =====
async function addReserva(userId, fecha, hora_inicio, servicio, slots_usados = [], nombreCliente = "Cliente") { /* ... (Sin cambios) ... */ }
async function removeReserva(userId, bookingId) { /* ... (Sin cambios) ... */ }

// ===== Notificaciones (Solo WhatsApp) =====
async function sendOwnerNotification(bookingData, type = 'new') { /* ... (Sin cambios) ... */ }

function generarSlotsDemo(diasAdelante = 3) { /* ... (Sin cambios, pero con validaciones añadidas) ... */
    const hoy = now(); const out = []; const slotMin = BARBERIA_DATA.capacidad?.slot_base_min || 20; const almuerzo = BARBERIA_DATA.horario?.almuerzo_demo || { start: -1, end: -1 };
    for (let d = 0; d < diasAdelante; d++) { const fecha = hoy.plus({ days: d }); const fechaStr = fecha.toFormat('yyyy-LL-dd'); const wd = fecha.weekday; let openStr = null, closeStr = null;
    if (BARBERIA_DATA.horario) { if (wd >= 1 && wd <= 5 && BARBERIA_DATA.horario.lun_vie) [openStr, closeStr] = BARBERIA_DATA.horario.lun_vie.split('–').map(s => s.trim()); else if (wd === 6 && BARBERIA_DATA.horario.sab) [openStr, closeStr] = BARBERIA_DATA.horario.sab.split('–').map(s => s.trim()); else if (wd === 7 && BARBERIA_DATA.horario.dom) [openStr, closeStr] = BARBERIA_DATA.horario.dom.split('–').map(s => s.trim()); else openStr = BARBERIA_DATA.horario.festivos || null; }
    if (!openStr || !closeStr) { console.log(`[Slots] No horario para ${fechaStr}`); continue; }
    const open = DateTime.fromFormat(openStr, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); const close = DateTime.fromFormat(closeStr, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day });
    if (!open.isValid || !close.isValid) { console.warn(`[Slots] Horario inválido ${fechaStr}: ${openStr}-${closeStr}`); continue; }
    let cursor = open; if (d === 0 && hoy > open) { const minsSinceOpen = hoy.diff(open, 'minutes').minutes; cursor = open.plus({ minutes: Math.ceil(minsSinceOpen / slotMin) * slotMin }); }
    const horas = []; while (cursor < close && horas.length < 20) { const hh = cursor.toFormat('h:mm a'); const hora24 = cursor.hour; const ocupada = DEMO_RESERVAS[fechaStr]?.includes(hh); const esAlmuerzo = hora24 >= almuerzo.start && hora24 < almuerzo.end; const slotEndTime = cursor.plus({ minutes: slotMin }); if (!ocupada && !esAlmuerzo && cursor >= hoy.plus({ minutes: 30 }) && slotEndTime <= close) { horas.push(hh); } cursor = cursor.plus({ minutes: slotMin }); } if (horas.length) out.push({ fecha: fechaStr, horas }); } return out;
}

// ======== WHATSAPP CLIENT ========
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'data', 'session') }),
    puppeteer: {
        headless: true,
        // executablePath: '/usr/bin/chromium', // Mantener comentado!
        // *** Args Finales para Puppeteer en Railway/Linux ***
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Crucial en entornos con /dev/shm limitado
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote', // A menudo necesario en contenedores
            '--disable-gpu', // GPU no suele estar disponible
            '--disable-extensions' // Evita problemas con extensiones
        ],
    },
    qrTimeout: 0,
    authTimeout: 0,
});
client.on('qr', (qr) => { console.log('\n⚠️ No se puede mostrar el QR aquí. Copia el siguiente enlace en tu navegador para verlo: \n'); qrcode.toDataURL(qr, (err, url) => { if (err) { console.error("Error generando QR Data URL:", err); return; } console.log(url); console.log('\n↑↑↑ Copia ese enlace y pégalo en tu navegador para escanear el QR ↑↑↑'); }); });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => { console.error('ERROR AUTH:', msg); });
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI ========
async function safeChatCall(payload, tries = 2) {
  // *** VALIDACIÓN PREVIA DEL PAYLOAD ***
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      console.error("[Error OpenAI Previo] Payload inválido:", payload);
      throw new Error("Payload inválido enviado a OpenAI.");
  }
  // Verificar que el prompt del sistema no esté vacío o con error
  if (!payload.messages[0].content || payload.messages[0].content.startsWith("Error:")) {
      console.error("[Error OpenAI Previo] Prompt del sistema inválido:", payload.messages[0].content);
      throw new Error("Prompt del sistema inválido enviado a OpenAI.");
  }

  for (let i = 0; i < tries; i++) {
    try {
      console.log(`[OpenAI Debug] Enviando (Intento ${i + 1})...`);
      const messagesToLog = [ payload.messages[0], ...(payload.messages.slice(-2)) ];
      // console.log("[OpenAI Debug] Messages (System + Last 2):", JSON.stringify(messagesToLog, null, 2)); // Descomentar si es MUY necesario

      const completion = await openai.chat.completions.create(payload);

      console.log(`[OpenAI Debug] Respuesta recibida (Intento ${i + 1})`);
      if (!completion?.choices?.[0]?.message?.content) {
          console.error('[Error OpenAI] Estructura de respuesta inesperada:', completion);
          throw new Error("Respuesta de OpenAI inválida.");
      }
      console.log("[OpenAI Debug] Contenido Respuesta:", completion.choices[0].message.content.substring(0, 100) + "..."); // Loguear solo inicio
      return completion;

    } catch (e) {
      console.error(`[Error OpenAI] Intento ${i + 1} falló:`, e);
      if (i === tries - 1) { console.error("[Error OpenAI] Todos los intentos fallaron."); throw e; }
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
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) { /* ... (Sin cambios) ... */ }
    // --- FIN MANEJO VOZ ---

    if (!processedText && !(low.startsWith('/'))) return;

    const s = ensureState(from);
    pushHistory(from, 'user', processedText);

    // --- Comandos Admin ---
    if (low.startsWith('/set owner ')) { /* ... (Sin cambios) ... */ }
    if (low === '/clear reservas demo' && from === BOT_CONFIG.ownerWhatsappId) { /* ... (Sin cambios) ... */ }
    // --- Fin Comandos Admin ---

    // Bot ON/OFF
    if (low === '/bot off') { s.botEnabled = false; setState(from, s); return msg.reply('👌 Bot desactivado.'); }
    if (low === '/bot on') { s.botEnabled = true; setState(from, s); return msg.reply('💪 Bot activado.'); }
    if (!s.botEnabled) return;

    // Demo on/off
    if (low === '/start test') { s.mode = 'barberia'; s.history = []; s.ctx = {}; setState(from, s); return msg.reply(`*${BARBERIA_DATA.nombre || 'Demo'}* 💈 (Demo)\nEscríbeme como cliente.`); } // Usar nombre cargado
    if (low === '/end test') { s.mode = 'cortex'; s.history = []; s.sales = { awaiting: 'confirm' }; setState(from, s); return msg.reply('¡Demo finalizada! ¿Qué tal? Si te gustó, lo dejamos en tu WhatsApp.'); }

    // MODO BARBERÍA
    if (s.mode === 'barberia') {
      const isCancellation = detectCancelacion(processedText);
      if (isCancellation) { /* ... (Sin cambios) ... */ }

      const servicioDetectado = detectServicio(processedText);
      // const horaDetectada = detectHoraExacta(processedText); // NLU puede ser menos prioritario ahora
      // const offset = detectHoyOMañana(processedText);
      const pideHorarioGeneral = /horario|horas|hasta que hora|a que horas|disponibilidad/i.test(low) && !detectHoraExacta(processedText) && !servicioDetectado;
      if (pideHorarioGeneral) {
          const hoyDia = now().weekday; let horarioHoy = BARBERIA_DATA.horario?.festivos||'No definido';
          if (BARBERIA_DATA.horario) { if (hoyDia >= 1 && hoyDia <= 5) horarioHoy = BARBERIA_DATA.horario.lun_vie; else if (hoyDia === 6) horarioHoy = BARBERIA_DATA.horario.sab; else if (hoyDia === 7) horarioHoy = BARBERIA_DATA.horario.dom;}
          const reply = `¡Claro! Hoy atendemos de ${horarioHoy}. ¿Qué servicio buscas? 😉`;
          pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply);
      }

      s.ctx.lastServicio = servicioDetectado || s.ctx?.lastServicio; setState(from, s);

      const slots = generarSlotsDemo(3);
      let promptSystem = getPromptDemoBarberia(slots);
      if (s.ctx?.bookingToCancel) { promptSystem += `\n\nContexto: Cancelar cita ID ${s.ctx.bookingToCancel}? Si dice SÍ, incluye <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>.`; }

      const messages = [{ role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS)];
      console.log(`[Handler] Llamando OpenAI (Barbería)... User: ${from}`);
      const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 });
      // No necesitamos verificar completion aquí porque safeChatCall ya lo hace o lanza error

      let reply = completion.choices[0].message.content?.trim() || 'No entendí, ¿puedes repetir?';
      const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/);
      const cancelledMatch = reply.match(/<CANCELLED:\s*({.*?})\s*>/);

      if (bookingMatch?.[1]) { /* ... (Lógica booking sin cambios) ... */ }
      else if (cancelledMatch?.[1]) { /* ... (Lógica cancelación sin cambios) ... */ }
      else { if (s.ctx?.bookingToCancel) s.ctx.bookingToCancel = null; }

      pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply);
    }

    // MODO VENTAS
    if (s.mode === 'cortex') {
      const yes_post_demo = /^(si|sí|dale|me interesa|me gust|brutal|ok|perfecto)\b/i.test(low);
      if (s.sales?.awaiting === 'confirm') { /* ... (Sin cambios) ... */ }

      console.log(`[Handler] Llamando OpenAI (Ventas)... User: ${from}`);
      const messages = [{ role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS)];
      const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 });
      // No necesitamos verificar completion aquí

      let reply = completion.choices[0].message.content?.trim() || '¿En qué te ayudo? 🙂';
      if (!/demo|probar|prueba/i.test(low) && !/nombre|negocio|agendar/i.test(low) && s.sales?.awaiting !== 'schedule') { if (Math.random() < 0.6) reply += `\n\n${pick(CTAs)}`; }
      pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply);
    }

  } catch (error) {
    // Loguear el error DETALLADO
    console.error('****** ¡ERROR CAPTURADO EN HANDLER! ******\n', error, '\n****************************************');
    try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (e) { console.error("Error enviando msg de error:", e.message);}
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason, promise); });
client.initialize().catch(err => { console.error("ERROR INICIALIZAR:", err); });