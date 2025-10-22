// =========================
// CORTEX IA - INDEX.JS (v20 - Enhanced OpenAI Debugging)
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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR);

// --- Funciones de Carga/Guardado ---
function loadData(filePath, defaultData = {}, isJson = true) { /* ... (Sin cambios) ... */ }
function saveData(filePath, data) { /* ... (Sin cambios) ... */ }
function loadConfig() { /* ... (Sin cambios) ... */ }
function saveConfig() { saveData(CONFIG_PATH, BOT_CONFIG); }
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Reservas] Cargadas'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[User Bookings] Cargadas'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

function loadExternalFiles() {
    BARBERIA_DATA = loadData(BARBERIA_INFO_PATH, {}, true);
    PROMPT_VENTAS = loadData(PROMPT_VENTAS_PATH, "Error: Prompt de ventas no encontrado.", false);
    PROMPT_DEMO_TEMPLATE = loadData(PROMPT_BARBERIA_BASE_PATH, "Error: Plantilla de prompt de barbería no encontrada.", false);
    if (!BARBERIA_DATA || Object.keys(BARBERIA_DATA).length === 0) { console.error("¡ERROR FATAL! data/barberia_info.json vacío o no cargado."); BARBERIA_DATA = { nombre: "Demo", horario: {}, servicios: {}, pagos: [], faqs: [], upsell: "" }; }
    if (!PROMPT_VENTAS || PROMPT_VENTAS.startsWith("Error:")) { console.error("¡ERROR FATAL! prompts/ventas.txt no cargado."); }
    if (!PROMPT_DEMO_TEMPLATE || PROMPT_DEMO_TEMPLATE.startsWith("Error:")) { console.error("¡ERROR FATAL! prompts/barberia_base.txt no cargado."); }
}

loadConfig();
loadReservas();
loadUserBookings();
loadExternalFiles();

// ======== PROMPTS (Variables leen de archivos) ========
const CTAs = ["¿Quieres verlo? /start test 💈", "¿Agendamos 10 min para explicarte?"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// *** FUNCIÓN MODIFICADA: Usa marcador {upsellText} ***
function getPromptDemoBarberia(slotsDisponibles) {
  if (!PROMPT_DEMO_TEMPLATE || PROMPT_DEMO_TEMPLATE.startsWith("Error:")) return "Error: Plantilla prompt demo no cargada.";
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
  // *** Upsell con marcador ***
  const upsellText = BARBERIA_DATA.upsell || "";
  finalPrompt = finalPrompt.replace(/{upsellText}/g, upsellText ? `"${upsellText}"` : ""); // Reemplaza {upsellText}
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

function generarSlotsDemo(diasAdelante = 3) { /* ... (Sin cambios) ... */ }

// ======== WHATSAPP CLIENT ========
const client = new Client({ /* ... (Sin cambios) ... */ });
client.on('qr', (qr) => { /* ... (Sin cambios) ... */ });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => console.error('ERROR AUTH:', msg));
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI (CON DEBUG LOGS) ========
async function safeChatCall(payload, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      // *** Log detallado del request ***
      console.log(`[OpenAI Debug] Enviando (Intento ${i + 1})...`);
      // Loguear solo el system prompt y los últimos 2 mensajes para no saturar
      const messagesToLog = [
          payload.messages[0], // System prompt
          ...(payload.messages.slice(-2)) // Last two messages
      ]
      console.log("[OpenAI Debug] Messages (System + Last 2):", JSON.stringify(messagesToLog, null, 2));

      const completion = await openai.chat.completions.create(payload);

      // *** Log detallado de la respuesta ***
      console.log(`[OpenAI Debug] Respuesta recibida (Intento ${i + 1})`);
      // console.log("[OpenAI Debug] Respuesta Completa:", JSON.stringify(completion, null, 2)); // Descomentar si necesitas ver TODO

      // Validar estructura básica ANTES de devolver
      if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message || typeof completion.choices[0].message.content !== 'string') {
          console.error('[Error OpenAI] Estructura de respuesta inesperada:', completion);
          throw new Error("Respuesta de OpenAI inválida o incompleta."); // Forzar reintento o error final
      }
      console.log("[OpenAI Debug] Contenido Respuesta:", completion.choices[0].message.content);
      return completion; // Devolver solo si es válida

    } catch (e) {
      console.error(`[Error OpenAI] Intento ${i + 1} falló:`, e); // Loguear el objeto de error completo
      if (i === tries - 1) {
          console.error("[Error OpenAI] Todos los intentos fallaron.");
          throw e; // Lanzar el error final
      }
      await new Promise(r => setTimeout(r, 700));
    }
  }
  // Fallback por si acaso
  throw new Error("safeChatCall falló inesperadamente después de reintentos.");
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
    if (low === '/bot off') { /* ... (Sin cambios) ... */ }
    if (low === '/bot on') { /* ... (Sin cambios) ... */ }
    if (!s.botEnabled) return;

    // Demo on/off
    if (low === '/start test') { /* ... (Sin cambios) ... */ }
    if (low === '/end test') { /* ... (Sin cambios) ... */ }

    // MODO BARBERÍA
    if (s.mode === 'barberia') {
        const isCancellation = detectCancelacion(processedText);
        if (isCancellation) { /* ... (Sin cambios) ... */ }

        const servicioDetectado = detectServicio(processedText);
        const horaDetectada = detectHoraExacta(processedText);
        const offset = detectHoyOMañana(processedText);
        const pideHorarioGeneral = /horario|horas|hasta que hora|a que horas|disponibilidad/i.test(low) && !horaDetectada && !servicioDetectado;
        if (pideHorarioGeneral) { /* ... (Sin cambios) ... */ }

        s.ctx.lastServicio = servicioDetectado || s.ctx.lastServicio; setState(from, s);

        const slots = generarSlotsDemo(3);
        let promptSystem = getPromptDemoBarberia(slots);
        if (s.ctx?.bookingToCancel) { promptSystem += `\n\nContexto: Usuario pidió cancelar cita ID ${s.ctx.bookingToCancel}. Si dice "SÍ", incluye <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>. Si no, olvida.`; }

        const messages = [{ role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS)];

        // *** LLAMADA A OPENAI ***
        console.log(`[Handler] Llamando a OpenAI para modo barberia... User: ${from}`);
        const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 });
        // =======================

        // *** Verificación post-llamada (por si safeChatCall falla catastróficamente) ***
        if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message) {
            console.error("[Handler] safeChatCall devolvió una respuesta inválida.");
            throw new Error("Fallo crítico al comunicarse con OpenAI."); // Forzar error
        }
        // =========================================================================

        let reply = completion.choices[0].message.content?.trim() || 'No entendí bien, ¿puedes repetir?';

        const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/);
        const cancelledMatch = reply.match(/<CANCELLED:\s*({.*?})\s*>/);

        if (bookingMatch?.[1]) { /* ... (Lógica de booking sin cambios) ... */ }
        else if (cancelledMatch?.[1]) { /* ... (Lógica de cancelación sin cambios) ... */ }
        else { if (s.ctx?.bookingToCancel) s.ctx.bookingToCancel = null; }

        pushHistory(from, 'assistant', reply);
        setState(from, s);
        return msg.reply(reply);
    }

    // MODO VENTAS
    if (s.mode === 'cortex') {
        const yes_post_demo = /^(si|sí|dale|me interesa|me gust|brutal|ok|perfecto)\b/i.test(low);
        if (s.sales?.awaiting === 'confirm') { /* ... (Sin cambios) ... */ }

        console.log(`[Handler] Llamando a OpenAI para modo ventas... User: ${from}`); // Log OpenAI
        const messages = [{ role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS)];
        const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 });

        if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message) {
             console.error("[Handler] safeChatCall devolvió respuesta inválida en modo ventas.");
             throw new Error("Fallo crítico al comunicarse con OpenAI.");
        }

        let reply = completion.choices[0].message.content?.trim() || '¿En qué te ayudo? 🙂';
        if (!/demo|probar|prueba/i.test(low) && !/nombre|negocio|agendar/i.test(low) && s.sales?.awaiting !== 'schedule') { if (Math.random() < 0.6) reply += `\n\n${pick(CTAs)}`; }
        pushHistory(from, 'assistant', reply);
        setState(from, s);
        return msg.reply(reply);
    }

  } catch (error) {
    // Loguear el error DETALLADO que viene del try o de safeChatCall
    console.error('****** ¡ERROR CAPTURADO EN HANDLER! ******\n', error, '\n****************************************');
    try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (e) { console.error("Error enviando msg de error:", e.message);}
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason, promise); }); // Loguear la promesa también
client.initialize().catch(err => { console.error("ERROR INICIALIZAR:", err); });