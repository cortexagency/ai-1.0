// =========================
// CORTEX IA - INDEX.JS (v14 - SyntaxError Fixed + All Features)
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
    console.error(`[Error Memoria] No se pudo cargar/parsear ${path.basename(filePath)}:`, e);
    try { fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8'); console.warn(`[Memoria] Archivo ${path.basename(filePath)} reseteado.`); } catch (writeError) { console.error(`[Error Memoria Fatal] No se pudo resetear ${path.basename(filePath)}:`, writeError); }
    return defaultData;
  }
}
function saveData(filePath, data) {
  try { const dataToSave = data || {}; fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8'); } catch (e) { console.error(`[Error Memoria] No se pudo guardar ${path.basename(filePath)}:`, e); }
}
function loadConfig() { BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null, ownerEmail: null }); if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null; if (!BOT_CONFIG.ownerEmail) BOT_CONFIG.ownerEmail = null; console.log('[Memoria] Configuración cargada.'); if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Advertencia Config] ownerWhatsappId no configurado. Usa /set owner.'); if (!BOT_CONFIG.ownerEmail) console.warn('[Advertencia Config] ownerEmail no configurado. Usa /set email.'); if (BOT_CONFIG.ownerWhatsappId) console.log(`[Config] Dueño WhatsApp cargado: ${BOT_CONFIG.ownerWhatsappId}`); if (BOT_CONFIG.ownerEmail) console.log(`[Config] Dueño Email cargado: ${BOT_CONFIG.ownerEmail}`); }
function saveConfig() { saveData(CONFIG_PATH, BOT_CONFIG); }
function loadReservas() { DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); console.log('[Memoria] Reservas de demo cargadas.'); }
function saveReservas() { saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); }
function loadUserBookings() { USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); console.log('[Memoria] Reservas de usuarios cargadas.'); }
function saveUserBookings() { saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); }

loadConfig();
loadReservas();
loadUserBookings();

// ======== DATOS DE LA DEMO (BARBERÍA LA 70) ========
const BARBERIA_DATA = { nombre: "Barbería La 70", direccion: "Calle 70 #45-18, Belén, Medellín (esquina con Cra. 48)", referencia: "Frente al Parque Belén, local 3 (al lado de la panadería El Molino)", telefono: "+57 310 555 1234 (demo)", instagram: "@barberial70 (demo)", horario: { lun_vie: "9:00 AM – 8:00 PM", sab: "9:00 AM – 6:00 PM", dom: "10:00 AM – 4:00 PM", festivos: "Cerrado o solo por cita previa", almuerzo_demo: { start: 13, end: 14 } }, capacidad: { slot_base_min: 20 }, servicios: { 'corte clasico': { precio: 35000, min: 40 }, 'corte + degradado + diseño': { precio: 55000, min: 60 }, 'barba completa': { precio: 28000, min: 30 }, 'corte + barba': { precio: 75000, min: 70 }, 'afeitado tradicional': { precio: 45000, min: 45 }, 'coloracion barba': { precio: 65000, min: 60 }, 'arreglo patillas': { precio: 18000, min: 20 }, 'vip': { precio: 120000, min: 90 } }, pagos: ["Nequi", "Daviplata", "PSE", "Efectivo", "Datáfono (pago en el local)"], faqs: [ { q: "¿Cómo puedo cancelar?", a: "Responde a este chat o llama al +57 310 555 1234. Cancela con 6+ horas para evitar cargo." }, { q: "¿Puedo cambiar la cita?", a: "Sí, reprogramamos si hay disponibilidad y avisas con 6+ horas." }, { q: "¿Aceptan tarjeta?", a: "Sí, datáfono, Nequi/Daviplata y efectivo." }, { q: "¿Tienen estacionamiento?", a: "Sí, 3 cupos en la parte trasera y parqueo público en la 70." } ], upsell: "¿Agregamos barba por $28.000? Queda en $75.000 el combo 😉" };

// ======== PROMPTS ========
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
const CTAs = [
  "¿Quieres verlo en acción ahora? Escribe /start test 💈",
  "¿Agendamos una llamada rápida de 10 min y te explico cómo lo ponemos en tu WhatsApp?",
];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
function detectServicio(text) { const m = text.toLowerCase(); if (m.includes('vip')) return 'vip'; if (m.includes('degrad')) return 'corte + degradado + diseño'; if (m.includes('barba')) return 'barba completa'; if (m.includes('patilla')) return 'arreglo patillas'; if (m.includes('afeitado')) return 'afeitado tradicional'; if (m.includes('color')) return 'coloracion barba'; if (m.includes('corte')) return 'corte clasico'; return null; }
function detectHoraExacta(text) { const h = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); return h ? h[0] : null; }
function detectHoyOMañana(text) { if (/\bhoy\b/i.test(text)) return 0; if (/\bmañana|manana\b/i.test(text)) return 1; return null; }
function detectCancelacion(text) { return /cancelar|cancela|no puedo ir|cambiar cita|reagendar/i.test(text); }
function calcularSlotsUsados(horaInicio, durMin) { const n = Math.ceil(durMin / BARBERIA_DATA.capacidad.slot_base_min); const start = DateTime.fromFormat(horaInicio.toUpperCase(), 'h:mm a', { zone: TZ }); if (!start.isValid) return [horaInicio]; const arr = []; for (let i = 0; i < n; i++) { arr.push(start.plus({ minutes: i * BARBERIA_DATA.capacidad.slot_base_min }).toFormat('h:mm a')); } return arr; }
function parseRango(fecha, rango) { const [ini, fin] = rango.split('–').map(s => s.trim()); const open = DateTime.fromFormat(ini, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); const close = DateTime.fromFormat(fin, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); return [open, close]; }
function generateBookingId() { return Math.random().toString(36).substring(2, 9); }

// ===== Gestión de Estado y Contexto =====
function ensureState(id) { if (!id || typeof id !== 'string') { console.error(`[Error Estado] ID inválido: ${id}`); return { botEnabled: false, mode: 'cortex', history: [], sales: { lastOffer: null, awaiting: null }, ctx: { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null } }; } if (!state[id]) { state[id] = { botEnabled: true, mode: 'cortex', history: [], sales: { lastOffer: null, awaiting: null }, ctx: { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null } }; console.log(`[Estado] Nuevo estado para ${id}`); } if (state[id].botEnabled === undefined) state[id].botEnabled = true; if (!state[id].mode) state[id].mode = 'cortex'; if (!state[id].history) state[id].history = []; if (!state[id].sales) state[id].sales = { lastOffer: null, awaiting: null }; if (!state[id].ctx) state[id].ctx = { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null }; if (state[id].ctx.bookingToCancel === undefined) state[id].ctx.bookingToCancel = null; return state[id]; }
function setState(id, s) { if (!id || typeof id !== 'string') { console.error(`[Error Estado] ID inválido al guardar: ${id}`); return; } state[id] = s; }
function pushHistory(id, role, content) { if (!id || typeof id !== 'string') { console.error(`[Error Historial] ID inválido: ${id}`); return; } const s = ensureState(id); if (!s) { console.error(`[Error Historial] ensureState inválido para ${id}.`); return; } s.history.push({ role, content, at: Date.now() }); while (s.history.length > MAX_TURNS) s.history.shift(); }

// ===== Gestión de Reservas y Notificaciones =====
async function addReserva(userId, fecha, hora_inicio, servicio, slots_usados = [], nombreCliente = "Cliente") { if (!DEMO_RESERVAS[fecha]) DEMO_RESERVAS[fecha] = []; let reservaNueva = false; let possibleConflict = false; slots_usados.forEach(hora => { if (DEMO_RESERVAS[fecha].includes(hora)) { possibleConflict = true; } }); if (possibleConflict) { console.warn(`[Advertencia Reserva] Conflicto detectado para ${servicio} a las ${hora_inicio} en ${fecha}. Slots: ${slots_usados.join(', ')}`); reservaNueva = false; } else { slots_usados.forEach(hora => { DEMO_RESERVAS[fecha].push(hora); console.log(`[Reserva Demo] Slot Ocupado: ${fecha} @ ${hora}`); }); reservaNueva = true; } saveReservas(); if (reservaNueva) { if (!USER_BOOKINGS[userId]) USER_BOOKINGS[userId] = []; const bookingId = generateBookingId(); const newBooking = { id: bookingId, fecha, hora_inicio, servicio, slots_usados, nombreCliente }; USER_BOOKINGS[userId].push(newBooking); saveUserBookings(); console.log(`[User Booking] Reserva guardada para ${userId}:`, newBooking); const notificationData = { ...newBooking }; if (BOT_CONFIG.ownerWhatsappId) { try { await sendOwnerNotification(notificationData, 'new'); } catch (error) { console.error('[Error Notificación WhatsApp] No se pudo enviar:', error); } } if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) { try { await sendOwnerEmailNotification(notificationData, 'new'); } catch (error) { console.error('[Error Notificación Email] Fallo general al intentar enviar email.'); } } } return reservaNueva; }
async function removeReserva(userId, bookingId) { if (!USER_BOOKINGS[userId]) return false; const bookingIndex = USER_BOOKINGS[userId].findIndex(b => b.id === bookingId); if (bookingIndex === -1) return false; const bookingToRemove = USER_BOOKINGS[userId][bookingIndex]; const { fecha, slots_usados } = bookingToRemove; if (DEMO_RESERVAS[fecha]) { DEMO_RESERVAS[fecha] = DEMO_RESERVAS[fecha].filter(slot => !slots_usados.includes(slot)); if (DEMO_RESERVAS[fecha].length === 0) delete DEMO_RESERVAS[fecha]; saveReservas(); console.log(`[Reserva Demo] Slots liberados para ${fecha}: ${slots_usados.join(', ')}`); } USER_BOOKINGS[userId].splice(bookingIndex, 1); if (USER_BOOKINGS[userId].length === 0) delete USER_BOOKINGS[userId]; saveUserBookings(); console.log(`[User Booking] Reserva ${bookingId} eliminada para ${userId}`); const notificationData = { ...bookingToRemove }; if (BOT_CONFIG.ownerWhatsappId) { try { await sendOwnerNotification(notificationData, 'cancelled'); } catch (error) { console.error('[Error Notificación Cancelación WhatsApp] No se pudo enviar:', error); } } if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) { try { await sendOwnerEmailNotification(notificationData, 'cancelled'); } catch (error) { console.error('[Error Notificación Cancelación Email] Fallo general al intentar enviar email.'); } } return true; }
async function sendOwnerNotification(bookingData, type = 'new') { const ownerId = BOT_CONFIG.ownerWhatsappId; if (!ownerId) { console.warn('[Advertencia Notificación WhatsApp] ownerWhatsappId no configurado.'); return; } const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL'); let message; if (type === 'new') { message = `🔔 *¡Nueva Cita Agendada!* 🔔\n\nCliente: *${bookingData.nombreCliente || 'No especificado'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Agendada por Cortex IA)_`; } else if (type === 'cancelled') { message = `❌ *¡Cita Cancelada!* ❌\n\nCliente: *${bookingData.nombreCliente || 'No especificado'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Cancelada a través de Cortex IA)_`; } else { return; } await client.sendMessage(ownerId, message).catch(err => { console.error(`[Error Notificación WhatsApp] Fallo al enviar a ${ownerId}:`, err); }); }
async function sendOwnerEmailNotification(bookingData, type = 'new') { const ownerEmail = BOT_CONFIG.ownerEmail; const senderEmail = process.env.GMAIL_USER; const senderPassword = process.env.GMAIL_APP_PASSWORD; if (!ownerEmail) { console.warn('[Advertencia Email] ownerEmail no está configurado.'); return; } if (!senderEmail || !senderPassword) { console.error('[Error Email] GMAIL_USER o GMAIL_APP_PASSWORD no están configurados en Railway.'); return; } let transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: senderEmail, pass: senderPassword }, connectionTimeout: 15000, socketTimeout: 15000 }); const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL'); let subject; let body; if (type === 'new') { subject = `Nueva Cita Agendada: ${bookingData.servicio} - ${fechaFormateada}`; body = `<h2>🔔 ¡Nueva Cita Agendada! 🔔</h2><p>Cliente: <strong>${bookingData.nombreCliente || 'No especificado'}</strong></p><ul><li><strong>Servicio:</strong> ${bookingData.servicio}</li><li><strong>Fecha:</strong> ${fechaFormateada}</li><li><strong>Hora:</strong> ${bookingData.hora_inicio}</li></ul><hr><p><em>Agendada por Cortex IA.</em></p>`; } else if (type === 'cancelled') { subject = `Cita Cancelada: ${bookingData.servicio} - ${fechaFormateada}`; body = `<h2>❌ ¡Cita Cancelada! ❌</h2><p>Cliente: <strong>${bookingData.nombreCliente || 'No especificado'}</strong></p><ul><li><strong>Servicio:</strong> ${bookingData.servicio}</li><li><strong>Fecha:</strong> ${fechaFormateada}</li><li><strong>Hora:</strong> ${bookingData.hora_inicio}</li></ul><hr><p><em>Cancelada a través de Cortex IA.</em></p>`; } else { return; } try { let info = await transporter.sendMail({ from: `"Cortex IA Notificaciones" <${senderEmail}>`, to: ownerEmail, subject: subject, html: body }); console.log(`[Notificación Email ${type === 'new' ? 'Nueva' : 'Cancelada'}] Enviada a ${ownerEmail}. ID: ${info.messageId}`); } catch (error) { console.error(`[Error Email ${type === 'new' ? 'Nueva' : 'Cancelada'}] Fallo al enviar a ${ownerEmail}:`, error); /* No hacemos throw */ } }
function generarSlotsDemo(diasAdelante = 3) { const hoy = now(); const out = []; const slotMin = BARBERIA_DATA.capacidad.slot_base_min; const { almuerzo_demo } = BARBERIA_DATA.horario; for (let d = 0; d < diasAdelante; d++) { const fecha = hoy.plus({ days: d }); const fechaStr = fecha.toFormat('yyyy-LL-dd'); const wd = fecha.weekday; let open, close; if (wd >= 1 && wd <= 5) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.lun_vie); else if (wd === 6) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.sab); else [open, close] = parseRango(fecha, BARBERIA_DATA.horario.dom); let cursor = open; if (d === 0 && hoy > open) { const minsSinceOpen = hoy.diff(open, 'minutes').minutes; const nextSlot = Math.ceil(minsSinceOpen / slotMin) * slotMin; cursor = open.plus({ minutes: nextSlot }); } const horas = []; while (cursor < close) { const hh = cursor.toFormat('h:mm a'); const hora24 = cursor.hour; const ocupada = DEMO_RESERVAS[fechaStr] && DEMO_RESERVAS[fechaStr].includes(hh); const esAlmuerzo = (hora24 >= almuerzo_demo.start && hora24 < almuerzo_demo.end); if (!ocupada && !esAlmuerzo && cursor > hoy.plus({ minutes: 30 })) { horas.push(hh); } if (horas.length >= 20) break; cursor = cursor.plus({ minutes: slotMin }); } if (horas.length) out.push({ fecha: fechaStr, horas }); } return out; }

// ======== WHATSAPP CLIENT ========
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'data', 'session') }),
    puppeteer: {
        headless: true,
        // executablePath: '/usr/bin/chromium', // Mantener comentado
        args: [ '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu', '--disable-extensions' ],
    },
    qrTimeout: 0,
    authTimeout: 0,
});
client.on('qr', (qr) => { console.log('\n⚠️ No se puede mostrar el QR aquí. Copia el siguiente enlace en tu navegador para verlo: \n'); qrcode.toDataURL(qr, (err, url) => { if (err) { console.error("Error generando QR Data URL:", err); return; } console.log(url); console.log('\n↑↑↑ Copia ese enlace y pégalo en tu navegador para escanear el QR ↑↑↑'); }); });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => { console.error('ERROR DE AUTENTICACIÓN:', msg); });
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI (CON RETRY) ========
async function safeChatCall(payload, tries = 2) { for (let i = 0; i < tries; i++) { try { return await openai.chat.completions.create(payload); } catch (e) { console.error(`[Error OpenAI] Intento ${i + 1} fallido:`, e.message); if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 700)); } } }

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  // *** VALIDACIÓN INICIAL ***
  if (!msg || !msg.from || typeof msg.from !== 'string') { console.warn('[Advertencia Handler] Mensaje inválido:', msg); return; }

  try {
    const from = msg.from;
    const text = (msg.body || '').trim();
    const low = text.toLowerCase();

    // *** VALIDACIÓN DE ESTADO INMEDIATA ***
    const s = ensureState(from);
    if (!s || typeof s !== 'object') { console.error(`[Error Fatal Estado] ensureState inválido para ${from}:`, s); return; }

    pushHistory(from, 'user', text);

    // --- Comandos Administrativos ---
    if (low.startsWith('/set owner ')) { if (BOT_CONFIG.ownerWhatsappId && from !== BOT_CONFIG.ownerWhatsappId) { return msg.reply('🔒 Solo el dueño actual puede cambiar este número.'); } const newOwner = low.split(' ')[2]?.trim(); if (newOwner && /^\d+@c\.us$/.test(newOwner)) { const oldOwner = BOT_CONFIG.ownerWhatsappId; BOT_CONFIG.ownerWhatsappId = newOwner; saveConfig(); if (!oldOwner) { console.log(`[Config] Dueño inicial establecido a: ${newOwner}`); return msg.reply(`✅ ¡Perfecto! Ahora eres el dueño. Las notificaciones de WhatsApp llegarán a este número.`); } else { console.log(`[Config] Dueño WhatsApp cambiado de ${oldOwner} a ${newOwner} por ${from}`); return msg.reply(`✅ Número de dueño (WhatsApp) actualizado a: ${newOwner}`); } } else { return msg.reply('❌ Formato inválido. Usa: /set owner numero@c.us'); } }
    if (low.startsWith('/set email ')) { if (!BOT_CONFIG.ownerWhatsappId || from !== BOT_CONFIG.ownerWhatsappId) { return msg.reply('🔒 Debes ser el dueño configurado (/set owner) para cambiar el email.'); } const newEmail = low.split(' ')[2]?.trim(); if (newEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { const oldEmail = BOT_CONFIG.ownerEmail; BOT_CONFIG.ownerEmail = newEmail; saveConfig(); console.log(`[Config] Email de notificación cambiado a ${newEmail} por ${from}`); if (!oldEmail) { return msg.reply(`✅ Email de notificaciones configurado: ${newEmail}`); } else { return msg.reply(`✅ Email de notificaciones actualizado a: ${newEmail}`); } } else { return msg.reply('❌ Formato de email inválido. Usa: /set email tu@correo.com'); } }
    if (low === '/clear reservas demo') { if (from === BOT_CONFIG.ownerWhatsappId) { DEMO_RESERVAS = {}; saveReservas(); USER_BOOKINGS = {}; saveUserBookings(); console.log('[Memoria] Reservas de demo y usuarios limpiadas por el admin.'); return msg.reply('🧹 Reservas de la demo (slots y usuarios) limpiadas.'); } else { console.log(`[Comando Ignorado] Intento de /clear reservas por ${from} (no es dueño).`); } }
    // --- Fin Comandos Admin ---

    // 2. BOT ON/OFF
    if (low === '/bot off') { s.botEnabled = false; setState(from, s); return msg.reply('👌 Quedas tú al mando. Escribe /bot on para reactivarme.'); }
    if (low === '/bot on') { s.botEnabled = true; setState(from, s); return msg.reply('💪 ¡Listo! Vuelvo a ayudarte 24/7.'); }
    // *** VALIDACIÓN FINAL ANTES DE USAR s.botEnabled ***
    if (s.botEnabled === undefined || s.botEnabled === null) { console.error(`[Error Fatal Estado] s.botEnabled inválido para ${from}.`); s.botEnabled = true; setState(from, s); }
    if (!s.botEnabled) { /* console.log(`[Handler] Bot deshabilitado para ${from}, ignorando.`); */ return; }


    // 3. TEST DEMO on/off
    if (low === '/start test') { s.mode = 'barberia'; s.history = []; s.ctx = { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null }; setState(from, s); return msg.reply(`*${BARBERIA_DATA.nombre}* 💈 (Demo Activada)\nEscríbeme como cliente (ej: "corte", "¿tienen hora hoy?").`); }
    if (low === '/end test') { s.mode = 'cortex'; s.history = []; s.sales.awaiting = 'confirm'; setState(from, s); return msg.reply('¡Demo finalizada! ¿Qué tal? ¿Viste cómo agendé? Si te interesa, te explico cómo lo dejamos en tu WhatsApp en 1–2 días.'); }

    // 4. ===== MODO DEMO: BARBERÍA =====
    if (s.mode === 'barberia') {
        const isCancellation = detectCancelacion(text);
        // --- Manejo de Cancelación (Inicio) ---
        if (isCancellation) {
            const userBookings = USER_BOOKINGS[from] || [];
            if (userBookings.length === 0) { const reply = "No veo citas agendadas a tu nombre para cancelar. ¿Te ayudo con algo más?"; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); }
            else if (userBookings.length === 1) {
                const booking = userBookings[0]; const fechaFmt = DateTime.fromISO(booking.fecha).setLocale('es').toFormat('cccc d');
                const reply = `Ok, veo tu cita de *${booking.servicio}* el *${fechaFmt} a las ${booking.hora_inicio}*. ¿Confirmas que quieres cancelarla? (Responde SÍ o NO)`;
                s.ctx.bookingToCancel = booking.id; // Guardar ID en contexto
                setState(from, s); pushHistory(from, 'assistant', reply); return msg.reply(reply);
            } else {
                const citasStr = userBookings.map((b, i) => `${i+1}. ${b.servicio} (${DateTime.fromISO(b.fecha).setLocale('es').toFormat('cccc d')} ${b.hora_inicio})`).join('\n');
                const reply = `Tienes varias citas:\n${citasStr}\n¿Cuál quieres cancelar? (Dime el número o detalles)`;
                pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply);
            }
        }
        // --- Flujo Normal (Agendamiento o Preguntas) ---
        const servicioDetectado = detectServicio(text); const horaDetectada = detectHoraExacta(text); const offset = detectHoyOMañana(text); const pideHorarioGeneral = /horario|horas|hasta que hora|a que horas|disponibilidad/i.test(low) && !horaDetectada && !servicioDetectado;
        if (pideHorarioGeneral) { const hoyDia = now().weekday; let horarioHoy = BARBERIA_DATA.horario.festivos; if (hoyDia >= 1 && hoyDia <= 5) horarioHoy = BARBERIA_DATA.horario.lun_vie; else if (hoyDia === 6) horarioHoy = BARBERIA_DATA.horario.sab; else if (hoyDia === 7) horarioHoy = BARBERIA_DATA.horario.dom; const reply = `¡Claro! Hoy atendemos de ${horarioHoy}. ¿Qué servicio buscas agendar? 😉`; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); }
        s.ctx.lastServicio = servicioDetectado || s.ctx.lastServicio; setState(from, s);
        const slots = generarSlotsDemo(3); let promptSystem = getPromptDemoBarberia(slots);
        if (s.ctx.bookingToCancel) { promptSystem += `\n\nContexto Adicional: El usuario pidió cancelar. Le preguntaste si confirma la cancelación de la cita ID ${s.ctx.bookingToCancel}. Si responde "SÍ", responde "Listo, cita cancelada." e incluye <CANCELLED: {"id": "${s.ctx.bookingToCancel}"}>. Si dice "NO" o cambia de tema, olvida la cancelación.`; }
        const messages = [ { role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS) ];
        const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 }); let reply = completion.choices?.[0]?.message?.content?.trim() || 'No te entendí bien, ¿qué necesitas?';
        // --- Analizar Respuesta de IA para BOOKING o CANCELLED ---
        const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/); const cancelledMatch = reply.match(/<CANCELLED:\s*({.*?})\s*>/);
        if (bookingMatch && bookingMatch[1]) {
            let bookingData = null; try { bookingData = JSON.parse(bookingMatch[1]); } catch (e) { console.error('Error parseando JSON booking:', e.message); }
            if (bookingData) { if (!bookingData.slots_usados || bookingData.slots_usados.length === 0) { const servicio = bookingData.servicio || s.ctx.lastServicio; const dur = servicio && BARBERIA_DATA.servicios[servicio.toLowerCase()]?.min; if(bookingData.hora_inicio && dur) { bookingData.slots_usados = calcularSlotsUsados(bookingData.hora_inicio, dur); console.log("[Fallback Booking] Slots calculados:", bookingData.slots_usados); } } if (!bookingData.nombreCliente) { const nameHistory = s.history.slice(-3).find(h => h.role === 'user' && h.content.split(' ').length <= 3 && h.content.split(' ').length >= 1 && !/^\d/.test(h.content) && !/^(si|sí|no|ok)$/i.test(h.content) ); bookingData.nombreCliente = nameHistory ? nameHistory.content : "Cliente"; console.log("[Fallback Booking] Nombre cliente:", bookingData.nombreCliente); } }
            if (bookingData?.fecha && bookingData?.hora_inicio && bookingData?.servicio && bookingData?.slots_usados?.length > 0) { const success = await addReserva( from, bookingData.fecha, bookingData.hora_inicio, bookingData.servicio, bookingData.slots_usados, bookingData.nombreCliente ); if (success) { reply = reply.replace(/<BOOKING:.*?>/, '').trim(); console.log(`[Reserva Guardada]`, bookingData); s.history = []; s.ctx = { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null }; } else { console.warn("[Reserva] Conflicto de slot detectado, no se guardó reserva duplicada."); reply = "Parece que justo esa hora se ocupó mientras hablábamos. ¿Probamos con otra?"; }} else { console.warn("[Advertencia Booking] Tag BOOKING inválido:", bookingData || bookingMatch[1]); reply = reply.replace(/<BOOKING:.*?>/, '').trim(); }
        } else if (cancelledMatch && cancelledMatch[1]) {
            let cancelData = null; try { cancelData = JSON.parse(cancelledMatch[1]); } catch(e) { console.error('Error parseando JSON cancelled:', e.message); }
            if (cancelData?.id) { const cancelled = await removeReserva(from, cancelData.id); if (cancelled) { reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); console.log(`[Cancelación] Reserva ${cancelData.id} cancelada por ${from}`); s.history = []; s.ctx = { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null }; } else { console.warn(`[Cancelación] ID ${cancelData.id} no encontrado para ${from}`); reply = "Hubo un problema cancelando. Esa cita ya no aparece."; }} else { console.warn("[Cancelación] Tag CANCELLED sin ID:", cancelledMatch[1]); reply = reply.replace(/<CANCELLED:.*?>/, '').trim(); } s.ctx.bookingToCancel = null; // Limpiar siempre
        } else { if(s.ctx.bookingToCancel) s.ctx.bookingToCancel = null; } // Limpiar si no hubo acción
        // --- Fin Análisis Respuesta IA ---
        pushHistory(from, 'assistant', reply); setState(from, s); await msg.reply(reply); return;
    }

    // 5. ===== MODO SHOWROOM (VENTAS) =====
    if (s.mode === 'cortex') { const yes_post_demo = /^(si|sí|s[ií] me interesa|dale|de una|h[áa]gale|me interesa|listo|me gust[óo]|me sirve|claro|ok|perfecto|brutal)\b/i.test(low); if (s.sales.awaiting === 'confirm') { if (yes_post_demo) { s.sales.awaiting = 'schedule'; s.sales.lastOffer = 'call'; const reply = 'Perfecto 🔥. Ese es el poder de no perder clientes. Te agendo con el equipo para personalizar tu asistente. ¿Tu nombre y tipo de negocio? 🚀'; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); } else { s.sales.awaiting = null; const reply = `Entendido. ¿Prefieres entonces que te lo deje listo en tu WhatsApp o primero una llamada corta para aclarar dudas?`; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); } } const messages = [ { role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS) ]; const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 }); let reply = completion.choices?.[0]?.message?.content?.trim() || '¿En qué más te puedo ayudar? 🙂'; const isAskingForDemo = /demo|muestr|probar|prueba|\/start test/i.test(low); const isClosing = /nombre|negocio|agendar|llamada/i.test(low); if (!isAskingForDemo && !isClosing && s.sales.awaiting !== 'schedule') { if (Math.random() < 0.6) { reply += `\n\n${pick(CTAs)}`; } } if (isAskingForDemo) { s.sales.lastOffer = 'demo'; s.sales.awaiting = 'confirm'; } pushHistory(from, 'assistant', reply); setState(from, s); await msg.reply(reply); return; }

  } catch (error) {
    console.error('****** ¡ERROR DETECTADO! ******\n', error, '\n*******************************');
    if (msg && typeof msg.reply === 'function') { try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (replyError) { console.error('Error al enviar mensaje de error:', replyError); } } else { console.error('No se pudo enviar mensaje de error (msg inválido).'); }
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason); });
client.initialize().catch(err => { console.error("ERROR AL INICIALIZAR CLIENTE:", err); });