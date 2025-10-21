// =========================
// CORTEX IA - INDEX.JS (v10 - WhatsApp + Email Notifications)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer'); // <--- Añadido para email

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null, ownerEmail: null }; // Incluye Email

// ======== GESTIÓN PERSISTENTE (Reservas y Configuración) ========
const DATA_DIR = path.join(__dirname, 'data');
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
let DEMO_RESERVAS = {};

// Asegurarse de que el directorio 'data' exista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Cargar/Guardar Configuración (Owner Number + Email)
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      BOT_CONFIG = JSON.parse(data);
      // Asegurarse de que ambas propiedades existan después de cargar
      if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null;
      if (!BOT_CONFIG.ownerEmail) BOT_CONFIG.ownerEmail = null;
      console.log('[Memoria] Configuración cargada.');
      if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Advertencia Config] ownerWhatsappId no configurado. Usa /set owner.');
      if (!BOT_CONFIG.ownerEmail) console.warn('[Advertencia Config] ownerEmail no configurado. Usa /set email.');
      if (BOT_CONFIG.ownerWhatsappId) console.log(`[Config] Dueño WhatsApp cargado: ${BOT_CONFIG.ownerWhatsappId}`);
      if (BOT_CONFIG.ownerEmail) console.log(`[Config] Dueño Email cargado: ${BOT_CONFIG.ownerEmail}`);
    } else {
      BOT_CONFIG = { ownerWhatsappId: null, ownerEmail: null }; // Inicializar con ambas
      saveConfig();
      console.log('[Memoria] Archivo config.json creado. Configura /set owner y /set email.');
    }
  } catch (e) {
    console.error('[Error Memoria] No se pudo cargar config.json:', e);
    BOT_CONFIG = { ownerWhatsappId: null, ownerEmail: null }; // Reset seguro
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(BOT_CONFIG, null, 2), 'utf8');
    console.log('[Memoria] Configuración guardada.');
  } catch (e) {
    console.error('[Error Memoria] No se pudo guardar config.json:', e);
  }
}

// Cargar/Guardar Reservas Demo
function loadReservas() { /* ... (Sin cambios) ... */
    try { if (fs.existsSync(DEMO_RESERVAS_PATH)) { const data = fs.readFileSync(DEMO_RESERVAS_PATH, 'utf8'); DEMO_RESERVAS = JSON.parse(data); console.log('[Memoria] Reservas de demo cargadas.'); } else { DEMO_RESERVAS = {}; fs.writeFileSync(DEMO_RESERVAS_PATH, JSON.stringify(DEMO_RESERVAS), 'utf8'); console.log('[Memoria] Archivo demo_reservas.json creado.'); } } catch (e) { console.error('[Error Memoria] No se pudo cargar demo_reservas.json:', e); DEMO_RESERVAS = {}; }
}
function saveReservas() { /* ... (Sin cambios) ... */
    try { fs.writeFileSync(DEMO_RESERVAS_PATH, JSON.stringify(DEMO_RESERVAS, null, 2), 'utf8'); } catch (e) { console.error('[Error Memoria] No se pudo guardar demo_reservas.json:', e); }
}

// Cargar todo al iniciar
loadConfig();
loadReservas();

// ======== DATOS DE LA DEMO (BARBERÍA LA 70) ========
const BARBERIA_DATA = { /* ... (Mismos datos de antes) ... */
    nombre: "Barbería La 70", direccion: "Calle 70 #45-18, Belén, Medellín (esquina con Cra. 48)", referencia: "Frente al Parque Belén, local 3 (al lado de la panadería El Molino)", telefono: "+57 310 555 1234 (demo)", instagram: "@barberial70 (demo)", horario: { lun_vie: "9:00 AM – 8:00 PM", sab: "9:00 AM – 6:00 PM", dom: "10:00 AM – 4:00 PM", festivos: "Cerrado o solo por cita previa", almuerzo_demo: { start: 13, end: 14 } }, capacidad: { slot_base_min: 20 }, servicios: { 'corte clasico': { precio: 35000, min: 40 }, 'corte + degradado + diseño': { precio: 55000, min: 60 }, 'barba completa': { precio: 28000, min: 30 }, 'corte + barba': { precio: 75000, min: 70 }, 'afeitado tradicional': { precio: 45000, min: 45 }, 'coloracion barba': { precio: 65000, min: 60 }, 'arreglo patillas': { precio: 18000, min: 20 }, 'vip': { precio: 120000, min: 90 } }, pagos: ["Nequi", "Daviplata", "PSE", "Efectivo", "Datáfono (pago en el local)"], faqs: [ { q: "¿Cómo puedo cancelar?", a: "Responde a este chat o llama al +57 310 555 1234. Cancela con 6+ horas para evitar cargo." }, { q: "¿Puedo cambiar la cita?", a: "Sí, reprogramamos si hay disponibilidad y avisas con 6+ horas." }, { q: "¿Aceptan tarjeta?", a: "Sí, datáfono, Nequi/Daviplata y efectivo." }, { q: "¿Tienen estacionamiento?", a: "Sí, 3 cupos en la parte trasera y parqueo público en la 70." } ], upsell: "¿Agregamos barba por $28.000? Queda en $75.000 el combo 😉"
};

// ======== PROMPT VENTAS (CORTEX IA - "STRAIGHT LINE" + CTAs) ========
const PROMPT_VENTAS = `... (Sin cambios en el prompt de ventas) ...`;
const CTAs = [ /* ... (Sin cambios) ... */ ];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ======== PROMPT DEMO (BARBERÍA - v3 Con NLU Hints) ========
function getPromptDemoBarberia(slotsDisponibles) { /* ... (Sin cambios en el prompt de barbería) ... */ }

// ======== Utilidades ========
function now() { return DateTime.now().setZone(TZ); }
// --- NLU Ligero ---
function detectServicio(text) { /* ... (Sin cambios) ... */ }
function detectHoraExacta(text) { /* ... (Sin cambios) ... */ }
function detectHoyOMañana(text) { /* ... (Sin cambios) ... */ }
// --- Cálculo de Slots Usados (Fallback) ---
function calcularSlotsUsados(horaInicio, durMin) { /* ... (Sin cambios) ... */ }

// ===== Gestión de Estado y Contexto =====
function ensureState(id) { /* ... (Sin cambios) ... */ }
function setState(id, s) { state[id] = s; }
function pushHistory(id, role, content) { /* ... (Sin cambios) ... */ }

// ===== Gestión de Reservas y Notificaciones =====
function parseRango(fecha, rango) { /* ... (Sin cambios) ... */ }

// *** FUNCIÓN MODIFICADA PARA LLAMAR A AMBAS NOTIFICACIONES ***
async function addReserva(fecha, hora_inicio, servicio, slots_usados = []) {
  if (!DEMO_RESERVAS[fecha]) DEMO_RESERVAS[fecha] = [];
  let reservaNueva = false;
  slots_usados.forEach(hora => {
    if (!DEMO_RESERVAS[fecha].includes(hora)) {
      DEMO_RESERVAS[fecha].push(hora);
      console.log(`[Reserva Demo] Slot Ocupado: ${fecha} @ ${hora}`);
      reservaNueva = true;
    }
  });
  saveReservas(); // Guardar reserva en archivo

  if (reservaNueva) {
    // Intentar enviar WhatsApp si está configurado
    if (BOT_CONFIG.ownerWhatsappId) {
      try {
        await sendOwnerNotification({ fecha, hora_inicio, servicio });
        console.log(`[Notificación WhatsApp] Enviada al dueño.`);
      } catch (error) {
        console.error('[Error Notificación WhatsApp] No se pudo enviar:', error);
      }
    }
    // Intentar enviar Email si está configurado
    if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
       try {
         await sendOwnerEmailNotification({ fecha, hora_inicio, servicio });
         // El log de éxito ya está dentro de la función de email
       } catch (error) {
         // El error ya se loguea dentro de la función de email
         console.error('[Error Notificación Email] Fallo general al intentar enviar email.');
       }
    }
  }
}

// Función para enviar notificación por WhatsApp
async function sendOwnerNotification(bookingData) { /* ... (Sin cambios) ... */ }

// *** NUEVA FUNCIÓN PARA ENVIAR NOTIFICACIÓN POR EMAIL ***
async function sendOwnerEmailNotification(bookingData) {
  const ownerEmail = BOT_CONFIG.ownerEmail;
  const senderEmail = process.env.GMAIL_USER;
  const senderPassword = process.env.GMAIL_APP_PASSWORD;

  if (!ownerEmail) {
    console.warn('[Advertencia Email] ownerEmail no está configurado.');
    return;
  }
  if (!senderEmail || !senderPassword) {
    console.error('[Error Email] GMAIL_USER o GMAIL_APP_PASSWORD no están configurados en Railway.');
    return;
  }

  // Configura el "transporter" de nodemailer
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: senderEmail,
      pass: senderPassword, // Usa la contraseña de aplicación
    },
  });

  const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL');
  const subject = `Nueva Cita Agendada: ${bookingData.servicio} - ${fechaFormateada}`;
  const body = `
    <h2>🔔 ¡Nueva Cita Agendada! 🔔</h2>
    <p>Se ha agendado una nueva cita a través del asistente Cortex IA:</p>
    <ul>
      <li><strong>Servicio:</strong> ${bookingData.servicio}</li>
      <li><strong>Fecha:</strong> ${fechaFormateada}</li>
      <li><strong>Hora:</strong> ${bookingData.hora_inicio}</li>
    </ul>
    <hr>
    <p><em>Este es un mensaje automático.</em></p>
  `;

  try {
    let info = await transporter.sendMail({
      from: `"Cortex IA Notificaciones" <${senderEmail}>`,
      to: ownerEmail,
      subject: subject,
      html: body,
    });
    console.log(`[Notificación Email] Enviada a ${ownerEmail}. Message ID: ${info.messageId}`);
  } catch (error) {
    console.error(`[Error Email] Fallo al enviar a ${ownerEmail}:`, error);
    // Podrías añadir lógica de reintento o alerta adicional aquí si falla
    throw error; // Re-lanza el error para que el catch en addReserva lo vea si es necesario
  }
}

function generarSlotsDemo(diasAdelante = 3) { /* ... (Sin cambios) ... */ }

// ======== WHATSAPP CLIENT ========
const client = new Client({ /* ... (Sin cambios) ... */ });
client.on('qr', (qr) => { /* ... (Sin cambios) ... */ });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => { console.error('ERROR DE AUTENTICACIÓN:', msg); });
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI (CON RETRY) ========
async function safeChatCall(payload, tries = 2) { /* ... (Sin cambios) ... */ }

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  try {
    const from = msg.from;
    const text = (msg.body || '').trim();
    const low = text.toLowerCase();

    const s = ensureState(from);
    pushHistory(from, 'user', text);

    // --- Comandos Administrativos ---
    // Comando /set owner
    if (low.startsWith('/set owner ')) {
        if (BOT_CONFIG.ownerWhatsappId && from !== BOT_CONFIG.ownerWhatsappId) {
            return msg.reply('🔒 Solo el dueño actual puede cambiar este número.');
        }
        const newOwner = low.split(' ')[2]?.trim();
        if (newOwner && /^\d+@c\.us$/.test(newOwner)) {
            const oldOwner = BOT_CONFIG.ownerWhatsappId;
            BOT_CONFIG.ownerWhatsappId = newOwner;
            saveConfig();
            if (!oldOwner) {
                console.log(`[Config] Dueño inicial establecido a: ${newOwner}`);
                return msg.reply(`✅ ¡Perfecto! Ahora eres el dueño. Las notificaciones de WhatsApp llegarán a este número.`);
            } else {
                console.log(`[Config] Dueño WhatsApp cambiado de ${oldOwner} a ${newOwner} por ${from}`);
                return msg.reply(`✅ Número de dueño (WhatsApp) actualizado a: ${newOwner}`);
            }
        } else {
            return msg.reply('❌ Formato inválido. Usa: /set owner numero@c.us');
        }
    }
    // *** NUEVO COMANDO /set email ***
    if (low.startsWith('/set email ')) {
      // Solo el dueño configurado por WhatsApp puede cambiar el email
      if (!BOT_CONFIG.ownerWhatsappId || from !== BOT_CONFIG.ownerWhatsappId) {
         return msg.reply('🔒 Debes ser el dueño configurado (/set owner) para cambiar el email.');
      }
      const newEmail = low.split(' ')[2]?.trim();
      // Validación básica de formato de email
      if (newEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
         const oldEmail = BOT_CONFIG.ownerEmail;
         BOT_CONFIG.ownerEmail = newEmail;
         saveConfig();
         console.log(`[Config] Email de notificación cambiado a ${newEmail} por ${from}`);
         if (!oldEmail) {
            return msg.reply(`✅ Email de notificaciones configurado: ${newEmail}`);
         } else {
            return msg.reply(`✅ Email de notificaciones actualizado a: ${newEmail}`);
         }
      } else {
         return msg.reply('❌ Formato de email inválido. Usa: /set email tu@correo.com');
      }
    }
    // Comando /clear reservas demo (SOLO dueño)
    if (low === '/clear reservas demo') {
        if (from === BOT_CONFIG.ownerWhatsappId) {
            DEMO_RESERVAS = {}; saveReservas();
            console.log('[Memoria] Reservas de demo limpiadas por el admin.');
            return msg.reply('🧹 Reservas de la demo limpiadas.');
        } else {
            console.log(`[Comando Ignorado] Intento de /clear reservas por ${from} (no es dueño).`);
        }
    }
    // --- Fin Comandos Admin ---

    // 2. BOT ON/OFF
    if (low === '/bot off') { s.botEnabled = false; setState(from, s); return msg.reply('👌 Quedas tú al mando. Escribe /bot on para reactivarme.'); }
    if (low === '/bot on') { s.botEnabled = true; setState(from, s); return msg.reply('💪 ¡Listo! Vuelvo a ayudarte 24/7.'); }
    if (!s.botEnabled) return; // Ignora si está apagado (después de procesar comandos admin)

    // 3. TEST DEMO on/off
    if (low === '/start test') { /* ... (Sin cambios) ... */ }
    if (low === '/end test') { /* ... (Sin cambios) ... */ }

    // 4. ===== MODO DEMO: BARBERÍA =====
    if (s.mode === 'barberia') { /* ... (Sin cambios) ... */ }

    // 5. ===== MODO SHOWROOM (VENTAS) =====
    if (s.mode === 'cortex') { /* ... (Sin cambios) ... */ }

  } catch (error) {
    console.error('****** ¡ERROR DETECTADO! ******\n', error, '\n*******************************');
    if (msg && typeof msg.reply === 'function') { try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (replyError) { console.error('Error al enviar mensaje de error:', replyError); } } else { console.error('No se pudo enviar mensaje de error (msg inválido).'); }
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason); });
client.initialize().catch(err => { console.error("ERROR AL INICIALIZAR CLIENTE:", err); });