// =========================
// CORTEX IA - INDEX.JS (v12 - Cancelaciones, Nombre, Email Notifs, Prompts Mejorados)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null, ownerEmail: null };

// ======== GESTIÓN PERSISTENTE ========
const DATA_DIR = path.join(__dirname, 'data');
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json'); // Slots ocupados
const USER_BOOKINGS_PATH = path.join(DATA_DIR, 'user_bookings.json'); // Quién reservó qué
const CONFIG_PATH = path.join(DATA_DIR, 'config.json'); // Configuración del bot (dueño)
let DEMO_RESERVAS = {}; // {'YYYY-MM-DD': ['H:MM AM/PM', ...]}
let USER_BOOKINGS = {}; // {'userId@c.us': [{id: string, fecha: 'YYYY-MM-DD', hora_inicio: 'H:MM AM/PM', servicio: '...', slots_usados: [...]}]}

// Asegurarse de que el directorio 'data' exista
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Funciones de Carga/Guardado ---
function loadData(filePath, defaultData = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
      console.log(`[Memoria] Archivo ${path.basename(filePath)} creado.`);
      return defaultData;
    }
  } catch (e) {
    console.error(`[Error Memoria] No se pudo cargar ${path.basename(filePath)}:`, e);
    return defaultData; // Retorna data por defecto en caso de error
  }
}

function saveData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    // console.log(`[Memoria] Datos guardados en ${path.basename(filePath)}.`); // Opcional: log en cada guardado
  } catch (e) {
    console.error(`[Error Memoria] No se pudo guardar ${path.basename(filePath)}:`, e);
  }
}

function loadConfig() {
    BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null, ownerEmail: null });
    // Asegurarse de que las propiedades existan post-carga
    if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null;
    if (!BOT_CONFIG.ownerEmail) BOT_CONFIG.ownerEmail = null;
    console.log('[Memoria] Configuración cargada.');
    if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Advertencia Config] ownerWhatsappId no configurado. Usa /set owner.');
    if (!BOT_CONFIG.ownerEmail) console.warn('[Advertencia Config] ownerEmail no configurado. Usa /set email.');
    if (BOT_CONFIG.ownerWhatsappId) console.log(`[Config] Dueño WhatsApp cargado: ${BOT_CONFIG.ownerWhatsappId}`);
    if (BOT_CONFIG.ownerEmail) console.log(`[Config] Dueño Email cargado: ${BOT_CONFIG.ownerEmail}`);
}

function saveConfig() { saveData(CONFIG_PATH, BOT_CONFIG); }
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Memoria] Reservas de demo cargadas.'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[Memoria] Reservas de usuarios cargadas.'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

// Cargar todo al iniciar
loadConfig();
loadReservas();
loadUserBookings();

// ======== DATOS DE LA DEMO (BARBERÍA LA 70) ========
const BARBERIA_DATA = { /* ... (Mismos datos de antes) ... */ };

// ======== PROMPT VENTAS (CORTEX IA - v12 Enfoque Humano/Valor) ========
const PROMPT_VENTAS = `
Eres Cortex IA, un asistente experto de Cortex Agency. Tu misión es **ayudar** a dueños de negocios (barberías, spas, uñas) a **descubrir** cómo pueden dejar de perder clientes y tiempo por no atender WhatsApp al instante. Hablas como un parcero colombiano: inteligente, empático, seguro y **muy humano**. Usas la escucha activa y preguntas clave.

**Tu Filosofía (Inspirada en "To Sell is Human"):**
* **Vender es Ayudar:** No empujas un producto, ofreces una solución a un dolor real (citas perdidas, estrés por responder). Tu meta es dejar al cliente *mejor* de lo que estaba.
* **Enfócate en el Dolor (Incluso el Oculto):** El cliente sabe que pierde citas, pero quizás no ha cuantificado el costo o el estrés. Ayúdalo a verlo.
* **Sé un Curador:** No listes funciones. Escucha su necesidad y presenta la característica *exacta* que la resuelve ("Si te escriben de noche, yo agendo por ti para que no pierdas esa cita").
* **Busca la Sintonía (Attunement):** Ponte en sus zapatos. Valida sus preocupaciones ("Total, te entiendo...").

**== Flujo de Conversación ==**
1.  **Saludo y Dolor:** "¡Hey! 👋 Soy Cortex IA. Muchos dueños de negocios con los que hablo, como tú, me cuentan lo frustrante que es perder una cita solo por no ver el WhatsApp a tiempo... ¿Te suena familiar esa situación?" (Invita a compartir su experiencia).
2.  **Explora y Amplifica:** Si dice "sí" o cuenta algo: "Uf, total. Y fijo ese cliente se fue a otro lado, ¿cierto? Es dinero y reputación que se van. ¿Más o menos cuántas veces a la semana te pasa eso?" (Cuantifica el dolor). Muestra empatía: "Imagino el estrés de estar trabajando y ver el celular sonar sin poder contestar...".
3.  **Presenta la Solución (Curada):** "Mira, justo para eso estoy diseñado. Yo me encargo de responder al instante, 24/7, y agendar esas citas para que tú te enfoques tranquilo en atender. ¿Te gustaría ver *cómo* lo hago?"
4.  **Manejo de Objeciones (Con Empatía y Valor):**
    * "Yo mismo respondo": "¡Excelente! Eso habla bien de tu servicio. Pero, ¿has pensado cuánto tiempo te quita eso al día que podrías usar para atender más clientes o descansar? ¿Y qué pasa si te escriben mientras duermes? ¿La idea de delegar esa parte repetitiva para liberar tu tiempo tiene sentido?"
    * "No confían en bots": "Te entiendo perfecto, muchos bots suenan a robot. ¿Yo te sueno a robot ahora? 😉 La clave es sonar natural. Pero más allá de eso, ¿crees que un cliente prefiere esperar tu respuesta... o ser atendido al instante, incluso por un asistente, si resuelve su necesidad rápido?"
    * "Es caro": "Comprendo que el presupuesto es clave. Pero pensemos: si este sistema te asegura solo 3 o 4 citas *extra* al mes que hoy estás perdiendo... ¿cuánto dinero es eso? Lo más probable es que se pague solo muy rápido. ¿Tiene sentido verlo como una inversión que te trae más clientes?"
5.  **Cierre (Demo como Prueba Lógica):** "La verdad, la mejor forma de que veas si esto te sirve es probándolo tú mismo. Tengo una demo de barbería lista. ¿Quieres interactuar con ella como si fueras un cliente? Escribe /start test."
6.  **Flujo Post-Demo:**
    * Al volver (\`/end test\`): "¡Demo finalizada! ¿Qué tal la experiencia? ¿Viste lo fácil que fue agendar? Si te gustó, el siguiente paso es dejar uno igualito funcionando en *tu* WhatsApp."
    * Si SÍ/ME GUSTÓ/BRUTAL: "¡Excelente! Ese es el objetivo: que recuperes tiempo y no pierdas ni un cliente más. Para empezar a personalizar el tuyo, solo necesito un par de datos. ¿Agendamos una llamada corta mañana o te envío la info por acá?"
    * Si OTRA COSA: "Entendido. No hay problema. ¿Qué dudas te quedaron? ¿O prefieres ver cómo funcionaría con tus propios servicios y horarios en una llamada rápida?" (Sigue explorando, no abandones).
`;
const CTAs = [ /* ... (Mismos CTAs) ... */ ];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ======== PROMPT DEMO (BARBERÍA - v4 Pide Nombre + Post-Confirm Rule) ========
function getPromptDemoBarberia(slotsDisponibles) {
    const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy'); const hoyDiaSemana = now().weekday; const serviciosTxt = Object.entries(BARBERIA_DATA.servicios).map(([k, v]) => `- ${k}: $${v.precio.toLocaleString('es-CO')} (${v.min} min)`).join('\n'); let slotsTxt = "Lo siento, no veo cupos disponibles en los próximos 3 días. Pregúntame por otra fecha."; if (slotsDisponibles && slotsDisponibles.length) { slotsTxt = slotsDisponibles.map(d => { const fechaFormateada = DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d LLLL'); return `  - ${fechaFormateada} (${d.fecha}): ${d.horas.join(', ')}`; }).join('\n'); } let horarioHoy = BARBERIA_DATA.horario.festivos; if (hoyDiaSemana >= 1 && hoyDiaSemana <= 5) horarioHoy = BARBERIA_DATA.horario.lun_vie; else if (hoyDiaSemana === 6) horarioHoy = BARBERIA_DATA.horario.sab; else if (hoyDiaSemana === 7) horarioHoy = BARBERIA_DATA.horario.dom; return `
Eres el "Asistente Cortex Barbershop", IA de **${BARBERIA_DATA.nombre}**. Actúa como un humano: amable, profesional, eficiente, 100% colombiano (Medellín). Tu objetivo es agendar citas y responder FAQs. NUNCA digas que eres demo. Hoy es ${hoy}.

== REGLAS DE AGENDAMIENTO Y HORARIOS ==
1.  **Calidez:** Saluda amablemente ("¡Hola! Bienvenido a Barbería La 70...") y pregunta qué necesita. Sé conversador.
2.  **Fechas:** Usa formatos amigables ("Martes 21 de Octubre").
3.  **Flujo:** 1. Pregunta **servicio**. 2. Di precio/duración. 3. **PREGUNTA POR HORA DESEADA:** "¿Para qué día y hora te gustaría agendar?".
4.  **Manejo de Horarios:**
    * Si preguntan horario general: Da el horario del día ("Hoy Martes atendemos de ${horarioHoy}."). NO listes slots.
    * Si preguntan HORA ESPECÍFICA ("¿4 PM?"): Revisa 'SLOTS DISPONIBLES'. Si SÍ: "¡Sí! A las 4 PM está libre. ¿Agendamos?". Si NO: "Uy, 4 PM ya no está. ¿Te sirve 4:20 PM o 4:40 PM?" (Ofrece 1-2 alternativas cercanas).
    * NUNCA listes > 3 slots seguidos. Prioriza la hora pedida.
5.  **PEDIR NOMBRE (CRÍTICO):** Después de que el cliente confirme la HORA (ej. dice "Sí, a las 4:20 PM"), **DEBES** preguntar el nombre: "¿Perfecto! ¿A nombre de quién agendo la cita?".
6.  **Confirmación Final y Tag:** SOLO cuando tengas HORA CONFIRMADA y NOMBRE, responde con la confirmación final + upsell, e INCLUYE la etiqueta invisible <BOOKING: {...}>.
    * La etiqueta DEBE tener: "servicio", "fecha", "hora_inicio", "slots_usados" (calculados: 30-40min=2, 50-60min=3, 90min=5), y "nombreCliente".
    * Ejemplo: <BOOKING: {"servicio": "corte clasico", "fecha": "2025-10-21", "hora_inicio": "9:00 AM", "slots_usados": ["9:00 AM", "9:20 AM"], "nombreCliente": "Zapata el Oso"}>
7.  **NO LÓGICA INTERNA:** No digas "reservando slots".
8.  **NO INVENTAR REGLAS:** Usa solo la info del negocio.
9.  **CANCELACIONES:** Si el cliente dice "cancelar cita", "ya no puedo ir", etc., pregunta "¿Claro, cuál cita deseas cancelar? ¿La de [fecha] a las [hora] para [servicio]?". Una vez confirmado, responde "Listo, tu cita ha sido cancelada." e incluye la etiqueta <CANCELLED: {"id": "bookingId"}> (El sistema te dará el bookingId cuando preguntes).
10. **POST-CONFIRMACIÓN:** Tras confirmar (tag <BOOKING> enviado), solo ofrece el upsell. NO vuelvas a pedir nombre/hora.

== SLOTS DISPONIBLES (USO INTERNO) ==
${slotsTxt}

== INFO DEL NEGOCIO ==
Nombre: ${BARBERIA_DATA.nombre} Horario: Lun-Vie ${BARBERIA_DATA.horario.lun_vie}, Sáb ${BARBERIA_DATA.horario.sab}, Dom ${BARBERIA_DATA.horario.dom} (Hoy: ${horarioHoy}). Almuerzo 1-2 PM. Servicios: ${serviciosTxt} Dirección: ${BARBERIA_DATA.direccion} Pagos: ${BARBERIA_DATA.pagos.join(', ')} FAQs: ${BARBERIA_DATA.faqs.map(f => `- P: ${f.q}\n  R: ${f.a}`).join('\n')}
`;
}

// ======== Utilidades ========
function now() { return DateTime.now().setZone(TZ); }
// --- NLU Ligero ---
function detectServicio(text) { /* ... (Sin cambios) ... */ }
function detectHoraExacta(text) { /* ... (Sin cambios) ... */ }
function detectHoyOMañana(text) { /* ... (Sin cambios) ... */ }
function detectCancelacion(text) { return /cancelar|cancela|no puedo ir|cambiar cita|reagendar/i.test(text); } // Simple detector
// --- Cálculo de Slots Usados ---
function calcularSlotsUsados(horaInicio, durMin) { /* ... (Sin cambios) ... */ }

// ===== Gestión de Estado y Contexto =====
function ensureState(id) { /* ... (Sin cambios) ... */ }
function setState(id, s) { state[id] = s; }
function pushHistory(id, role, content) { /* ... (Sin cambios) ... */ }

// ===== Gestión de Reservas y Notificaciones =====
function parseRango(fecha, rango) { /* ... (Sin cambios) ... */ }

// *** NUEVO: Generar ID único para reservas ***
function generateBookingId() { return Math.random().toString(36).substring(2, 9); }

// *** MODIFICADO: addReserva ahora guarda en USER_BOOKINGS también ***
async function addReserva(userId, fecha, hora_inicio, servicio, slots_usados = [], nombreCliente = "Cliente") {
  if (!DEMO_RESERVAS[fecha]) DEMO_RESERVAS[fecha] = [];
  let reservaNueva = false;
  let possibleConflict = false;

  // Verificar si algún slot ya está ocupado
  slots_usados.forEach(hora => {
      if (DEMO_RESERVAS[fecha].includes(hora)) {
          possibleConflict = true;
      }
  });

  if (possibleConflict) {
      console.warn(`[Advertencia Reserva] Conflicto detectado al intentar reservar ${servicio} a las ${hora_inicio} en ${fecha}. Slots: ${slots_usados.join(', ')}`);
      // Podríamos decidir no guardar o manejar el conflicto de otra manera
      // Por ahora, lo guardaremos pero marcaremos que no es "nueva" para no notificar duplicado
      reservaNueva = false;
  } else {
      slots_usados.forEach(hora => {
          DEMO_RESERVAS[fecha].push(hora);
          console.log(`[Reserva Demo] Slot Ocupado: ${fecha} @ ${hora}`);
      });
      reservaNueva = true;
  }

  saveReservas(); // Guardar slots ocupados

  // Guardar la reserva del usuario si es nueva y no hay conflicto
  if (reservaNueva) {
    if (!USER_BOOKINGS[userId]) USER_BOOKINGS[userId] = [];
    const bookingId = generateBookingId();
    const newBooking = { id: bookingId, fecha, hora_inicio, servicio, slots_usados, nombreCliente };
    USER_BOOKINGS[userId].push(newBooking);
    saveUserBookings(); // Guardar la reserva específica del usuario
    console.log(`[User Booking] Reserva guardada para ${userId}:`, newBooking);

    // Enviar notificaciones solo si es realmente nueva
    const notificationData = { ...newBooking }; // Enviar copia

    if (BOT_CONFIG.ownerWhatsappId) {
      try { await sendOwnerNotification(notificationData, 'new'); }
      catch (error) { console.error('[Error Notificación WhatsApp] No se pudo enviar:', error); }
    }
    if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
       try { await sendOwnerEmailNotification(notificationData, 'new'); }
       catch (error) { console.error('[Error Notificación Email] Fallo general al intentar enviar email.'); }
    }
  }
  return reservaNueva; // Devuelve true si se guardó una reserva nueva
}

// *** NUEVO: removeReserva para cancelaciones ***
async function removeReserva(userId, bookingId) {
    if (!USER_BOOKINGS[userId]) return false; // Usuario no tiene reservas

    const bookingIndex = USER_BOOKINGS[userId].findIndex(b => b.id === bookingId);
    if (bookingIndex === -1) return false; // Reserva no encontrada

    const bookingToRemove = USER_BOOKINGS[userId][bookingIndex];
    const { fecha, slots_usados } = bookingToRemove;

    // Liberar slots en DEMO_RESERVAS
    if (DEMO_RESERVAS[fecha]) {
        DEMO_RESERVAS[fecha] = DEMO_RESERVAS[fecha].filter(slot => !slots_usados.includes(slot));
        if (DEMO_RESERVAS[fecha].length === 0) delete DEMO_RESERVAS[fecha]; // Limpiar si el día queda vacío
        saveReservas();
        console.log(`[Reserva Demo] Slots liberados para ${fecha}: ${slots_usados.join(', ')}`);
    }

    // Eliminar reserva del usuario
    USER_BOOKINGS[userId].splice(bookingIndex, 1);
    if (USER_BOOKINGS[userId].length === 0) delete USER_BOOKINGS[userId]; // Limpiar si el usuario queda sin reservas
    saveUserBookings();
    console.log(`[User Booking] Reserva ${bookingId} eliminada para ${userId}`);

    // Notificar al dueño sobre la cancelación
    const notificationData = { ...bookingToRemove }; // Enviar copia

    if (BOT_CONFIG.ownerWhatsappId) {
      try { await sendOwnerNotification(notificationData, 'cancelled'); }
      catch (error) { console.error('[Error Notificación Cancelación WhatsApp] No se pudo enviar:', error); }
    }
    if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
       try { await sendOwnerEmailNotification(notificationData, 'cancelled'); }
       catch (error) { console.error('[Error Notificación Cancelación Email] Fallo general al intentar enviar email.'); }
    }

    return true; // Cancelación exitosa
}


// *** MODIFICADO: Notificaciones ahora incluyen nombre y tipo (nueva/cancelada) ***
async function sendOwnerNotification(bookingData, type = 'new') {
  const ownerId = BOT_CONFIG.ownerWhatsappId;
  if (!ownerId) { /* ... (warning) ... */ return; }
  const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL');
  let message;
  if (type === 'new') {
      message = `🔔 *¡Nueva Cita Agendada!* 🔔\n\nCliente: *${bookingData.nombreCliente || 'No especificado'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Agendada por Cortex IA)_`;
  } else if (type === 'cancelled') {
      message = `❌ *¡Cita Cancelada!* ❌\n\nCliente: *${bookingData.nombreCliente || 'No especificado'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Cancelada a través de Cortex IA)_`;
  } else {
      return; // Tipo no reconocido
  }
  await client.sendMessage(ownerId, message).catch(err => { console.error(`[Error Notificación WhatsApp] Fallo al enviar a ${ownerId}:`, err); });
}

async function sendOwnerEmailNotification(bookingData, type = 'new') {
  const ownerEmail = BOT_CONFIG.ownerEmail;
  const senderEmail = process.env.GMAIL_USER;
  const senderPassword = process.env.GMAIL_APP_PASSWORD;
  if (!ownerEmail || !senderEmail || !senderPassword) { /* ... (warnings/errors) ... */ return; }

  let transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: senderEmail, pass: senderPassword }, connectionTimeout: 10000 });
  const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL');
  let subject;
  let body;

  if (type === 'new') {
      subject = `Nueva Cita Agendada: ${bookingData.servicio} - ${fechaFormateada}`;
      body = `<h2>🔔 ¡Nueva Cita Agendada! 🔔</h2><p>Cliente: <strong>${bookingData.nombreCliente || 'No especificado'}</strong></p><ul><li><strong>Servicio:</strong> ${bookingData.servicio}</li><li><strong>Fecha:</strong> ${fechaFormateada}</li><li><strong>Hora:</strong> ${bookingData.hora_inicio}</li></ul><hr><p><em>Agendada por Cortex IA.</em></p>`;
  } else if (type === 'cancelled') {
      subject = `Cita Cancelada: ${bookingData.servicio} - ${fechaFormateada}`;
      body = `<h2>❌ ¡Cita Cancelada! ❌</h2><p>Cliente: <strong>${bookingData.nombreCliente || 'No especificado'}</strong></p><ul><li><strong>Servicio:</strong> ${bookingData.servicio}</li><li><strong>Fecha:</strong> ${fechaFormateada}</li><li><strong>Hora:</strong> ${bookingData.hora_inicio}</li></ul><hr><p><em>Cancelada a través de Cortex IA.</em></p>`;
  } else {
      return; // Tipo no reconocido
  }

  try {
    let info = await transporter.sendMail({ from: `"Cortex IA Notificaciones" <${senderEmail}>`, to: ownerEmail, subject: subject, html: body });
    console.log(`[Notificación Email ${type === 'new' ? 'Nueva' : 'Cancelada'}] Enviada a ${ownerEmail}. ID: ${info.messageId}`);
  } catch (error) {
    console.error(`[Error Email ${type === 'new' ? 'Nueva' : 'Cancelada'}] Fallo al enviar a ${ownerEmail}:`, error);
    // Ya no hacemos throw error;
  }
}

function generarSlotsDemo(diasAdelante = 3) { /* ... (Sin cambios) ... */ }

// ======== WHATSAPP CLIENT ========
const client = new Client({
  authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, 'data', 'session')
  }),
  puppeteer: {
    headless: true,
    // *** AÑADIR RUTA EXPLÍCITA AL CHROMIUM INSTALADO ***
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      // '--single-process', // Mantenlo comentado por ahora
      '--disable-gpu',
      '--disable-extensions'
    ],
  },
});

// ======== LLAMADA SEGURA A OPENAI (CON RETRY) ========
async function safeChatCall(payload, tries = 2) { /* ... (Sin cambios) ... */ }

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  try {
    const from = msg.from; // ID del usuario: numero@c.us
    const text = (msg.body || '').trim();
    const low = text.toLowerCase();

    const s = ensureState(from);
    pushHistory(from, 'user', text);

    // --- Comandos Administrativos ---
    if (low.startsWith('/set owner ')) { /* ... (Lógica corregida de antes) ... */ }
    if (low.startsWith('/set email ')) { /* ... (Lógica de antes) ... */ }
    if (low === '/clear reservas demo') { /* ... (Lógica de antes) ... */ }
    // --- Fin Comandos Admin ---

    // 2. BOT ON/OFF
    if (low === '/bot off') { /* ... (Lógica de antes) ... */ }
    if (low === '/bot on') { /* ... (Lógica de antes) ... */ }
    if (!s.botEnabled) return;

    // 3. TEST DEMO on/off
    if (low === '/start test') { /* ... (Lógica de antes) ... */ }
    if (low === '/end test') { /* ... (Lógica de antes) ... */ }

    // 4. ===== MODO DEMO: BARBERÍA =====
    if (s.mode === 'barberia') {
      const isCancellation = detectCancelacion(text);

      // --- Manejo de Cancelación ---
      if (isCancellation) {
          const userBookings = USER_BOOKINGS[from] || [];
          if (userBookings.length === 0) {
              const reply = "Parece que no tienes ninguna cita agendada conmigo para cancelar. ¿Necesitas algo más?";
              pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply);
          } else if (userBookings.length === 1) {
              // Si solo tiene una, confirma y cancela
              const booking = userBookings[0];
              const fechaFmt = DateTime.fromISO(booking.fecha).setLocale('es').toFormat('cccc d');
              // Pregunta para confirmar, incluye el ID en el contexto para la IA
              const reply = `Ok, veo tu cita para *${booking.servicio}* el *${fechaFmt} a las ${booking.hora_inicio}*. ¿Confirmas que quieres cancelarla? (Responde SÍ o NO)`;
              // Podríamos añadir lógica más robusta aquí o dejar que la IA maneje la confirmación
              // Por simplicidad, pasamos el ID a la IA para que lo use en la etiqueta <CANCELLED>
              s.ctx.bookingToCancel = booking.id; // Guardar ID en contexto
              setState(from, s);
              pushHistory(from, 'assistant', reply); return msg.reply(reply);
          } else {
              // Si tiene varias, pide especificar (la IA debería manejar esto)
              const citasStr = userBookings.map((b, i) => `${i+1}. ${b.servicio} (${DateTime.fromISO(b.fecha).setLocale('es').toFormat('cccc d')} ${b.hora_inicio})`).join('\n');
              const reply = `Veo que tienes varias citas agendadas:\n${citasStr}\n¿Cuál de ellas quieres cancelar? (Dime el número o detalles)`;
              pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply);
          }
      }

      // Si la IA responde con una etiqueta <CANCELLED: {"id": "bookingId"}>
      const cancellationMatch = text.match(/<CANCELLED:\s*({.*?})\s*>/); // OJO: Lo busca en el MENSAJE DEL USUARIO (asumiendo que la IA le pidió confirmar y el usuario dijo SÍ + tag)
      // *** ESTA LÓGICA DE CANCELACIÓN DEBERÍA ESTAR EN LA RESPUESTA DE LA IA, NO EN EL MENSAJE DEL USUARIO ***
      // *** VAMOS A DEJAR QUE LA IA MANEJE LA CONFIRMACIÓN Y PONGA EL TAG EN *SU* RESPUESTA ***

      // --- Flujo Normal (Agendamiento o Preguntas) ---
      const servicioDetectado = detectServicio(text);
      const horaDetectada = detectHoraExacta(text);
      const offset = detectHoyOMañana(text);
      const pideHorarioGeneral = /horario|horas|hasta que hora|a que horas|disponibilidad/i.test(low) && !horaDetectada && !servicioDetectado;

      if (pideHorarioGeneral) { /* ... (Misma lógica de antes) ... */ }

      s.ctx.lastServicio = servicioDetectado || s.ctx.lastServicio;
      setState(from, s);

      const slots = generarSlotsDemo(3);
      const promptSystem = getPromptDemoBarberia(slots);
      // Añadir contexto sobre posible cancelación si aplica
      if (s.ctx.bookingToCancel) {
          promptSystem += `\n\nContexto Adicional: El usuario acaba de pedir cancelar una cita. Le preguntaste si confirma la cancelación de la cita con ID ${s.ctx.bookingToCancel}. Si responde "SÍ", debes responder "Listo, cita cancelada." e incluir la etiqueta <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>. Si dice "NO" o pregunta otra cosa, olvida la cancelación y continúa normal.`;
      }
      const messages = [ { role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS) ];

      const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 });
      let reply = completion.choices?.[0]?.message?.content?.trim() || 'No te entendí bien, ¿qué servicio necesitas?';

      // --- Analizar Respuesta de IA para BOOKING o CANCELLED ---
      const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/);
      const cancelledMatch = reply.match(/<CANCELLED:\s*({.*?})\s*>/);

      if (bookingMatch && bookingMatch[1]) {
        let bookingData = null;
        try { bookingData = JSON.parse(bookingMatch[1]); } catch (e) { console.error('Error parseando JSON de booking (IA):', e.message); }
        // Fallback si la IA olvidó slots_usados o nombreCliente
        if (bookingData) {
            if (!bookingData.slots_usados || bookingData.slots_usados.length === 0) {
               const servicio = bookingData.servicio || s.ctx.lastServicio; const dur = servicio && BARBERIA_DATA.servicios[servicio.toLowerCase()]?.min;
               if(bookingData.hora_inicio && dur) { bookingData.slots_usados = calcularSlotsUsados(bookingData.hora_inicio, dur); console.log("[Fallback Booking] Slots calculados:", bookingData.slots_usados); }
            }
            if (!bookingData.nombreCliente) {
                // Intentar extraer nombre del historial reciente si la IA lo olvidó
                const nameHistory = s.history.slice(-3).find(h => h.role === 'user' && h.content.split(' ').length <= 3 && h.content.split(' ').length >= 1);
                bookingData.nombreCliente = nameHistory ? nameHistory.content : "Cliente"; // Fallback simple
                console.log("[Fallback Booking] Nombre cliente deducido:", bookingData.nombreCliente);
            }
        }
        if (bookingData?.fecha && bookingData?.hora_inicio && bookingData?.servicio && bookingData?.slots_usados?.length > 0) {
          await addReserva( from, bookingData.fecha, bookingData.hora_inicio, bookingData.servicio, bookingData.slots_usados, bookingData.nombreCliente );
          reply = reply.replace(/<BOOKING:.*?>/, '').trim();
          console.log(`[Reserva Demo Detectada y Guardada]`, bookingData);
          s.history = []; // Limpiar historial post-reserva
          s.ctx = { lastServicio: null, lastHorasSugeridas: [] }; // Limpiar contexto también
        } else if (bookingMatch) {
           console.warn("[Advertencia Booking] Tag BOOKING detectado pero incompleto:", bookingData || bookingMatch[1]);
           reply = reply.replace(/<BOOKING:.*?>/, '').trim();
        }
      } else if (cancelledMatch && cancelledMatch[1]) {
          let cancelData = null;
          try { cancelData = JSON.parse(cancelledMatch[1]); } catch(e) { console.error('Error parseando JSON de cancelled (IA):', e.message); }
          if (cancelData?.id) {
              const cancelled = await removeReserva(from, cancelData.id);
              if (cancelled) {
                  reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); // Limpiar tag
                  console.log(`[Cancelación Demo] Reserva ${cancelData.id} cancelada por ${from}`);
                  s.history = []; // Limpiar historial post-cancelación
                  s.ctx = { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null }; // Limpiar contexto
              } else {
                  console.warn(`[Advertencia Cancelación] ID ${cancelData.id} no encontrado para usuario ${from}`);
                  reply = "Hubo un problema al intentar cancelar. Parece que esa cita ya no existe."; // Respuesta de fallback
              }
          } else {
             console.warn("[Advertencia Cancelación] Tag CANCELLED detectado pero sin ID:", cancelledMatch[1]);
             reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); // Limpiar tag
          }
          // Limpiar el ID de cancelación pendiente del contexto en cualquier caso
          s.ctx.bookingToCancel = null;
      } else {
           // Si no hubo booking ni cancelación, pero estábamos esperando confirmación de cancelación, limpiar el estado
           if(s.ctx.bookingToCancel) s.ctx.bookingToCancel = null;
      }
      // --- Fin Análisis Respuesta IA ---

      pushHistory(from, 'assistant', reply);
      setState(from, s);
      await msg.reply(reply);
      return;
    }

    // 5. ===== MODO SHOWROOM (VENTAS) =====
    if (s.mode === 'cortex') { /* ... (Sin cambios aquí, ya estaba mejorado) ... */ }

  } catch (error) {
    console.error('****** ¡ERROR DETECTADO! ******\n', error, '\n*******************************');
    if (msg && typeof msg.reply === 'function') { try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (replyError) { console.error('Error al enviar mensaje de error:', replyError); } } else { console.error('No se pudo enviar mensaje de error (msg inválido).'); }
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason); });
client.initialize().catch(err => { console.error("ERROR AL INICIALIZAR CLIENTE:", err); });