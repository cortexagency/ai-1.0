// =========================
// CORTEX IA - INDEX.JS (v16 - PRODUCTION READY)
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
    try { 
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8'); 
      console.warn(`[Memoria] Archivo ${path.basename(filePath)} reseteado.`); 
    } catch (writeError) { 
      console.error(`[Error Memoria Fatal] No se pudo resetear ${path.basename(filePath)}:`, writeError); 
    }
    return defaultData;
  }
}

function saveData(filePath, data) {
  try { 
    const dataToSave = data || {}; 
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8'); 
  } catch (e) { 
    console.error(`[Error Memoria] No se pudo guardar ${path.basename(filePath)}:`, e); 
  }
}

function loadConfig() { 
  BOT_CONFIG = loadData(CONFIG_PATH, { ownerWhatsappId: null, ownerEmail: null }); 
  if (!BOT_CONFIG.ownerWhatsappId) BOT_CONFIG.ownerWhatsappId = null; 
  if (!BOT_CONFIG.ownerEmail) BOT_CONFIG.ownerEmail = null; 
  console.log('[Memoria] Configuración cargada.'); 
  if (!BOT_CONFIG.ownerWhatsappId) console.warn('[Advertencia Config] ownerWhatsappId no configurado. Usa /set owner.'); 
  if (!BOT_CONFIG.ownerEmail) console.warn('[Advertencia Config] ownerEmail no configurado. Usa /set email.'); 
  if (BOT_CONFIG.ownerWhatsappId) console.log(`[Config] Dueño WhatsApp: ${BOT_CONFIG.ownerWhatsappId}`); 
  if (BOT_CONFIG.ownerEmail) console.log(`[Config] Dueño Email: ${BOT_CONFIG.ownerEmail}`); 
}

function saveConfig() { 
  saveData(CONFIG_PATH, BOT_CONFIG); 
}

function loadReservas() { 
  DEMO_RESERVAS = loadData(DEMO_RESERVAS_PATH, {}); 
  console.log('[Memoria] Reservas de demo cargadas.'); 
}

function saveReservas() { 
  saveData(DEMO_RESERVAS_PATH, DEMO_RESERVAS); 
}

function loadUserBookings() { 
  USER_BOOKINGS = loadData(USER_BOOKINGS_PATH, {}); 
  console.log('[Memoria] Reservas de usuarios cargadas.'); 
}

function saveUserBookings() { 
  saveData(USER_BOOKINGS_PATH, USER_BOOKINGS); 
}

loadConfig();
loadReservas();
loadUserBookings();

// ======== DATOS DE LA DEMO (BARBERÍA LA 70) ========
const BARBERIA_DATA = { 
  nombre: "Barbería La 70", 
  direccion: "Calle 70 #45-18, Belén, Medellín (esquina con Cra. 48)", 
  referencia: "Frente al Parque Belén, local 3 (al lado de la panadería El Molino)", 
  telefono: "+57 310 555 1234 (demo)", 
  instagram: "@barberial70 (demo)", 
  horario: { 
    lun_vie: "9:00 AM – 8:00 PM", 
    sab: "9:00 AM – 6:00 PM", 
    dom: "10:00 AM – 4:00 PM", 
    festivos: "Cerrado o solo por cita previa", 
    almuerzo_demo: { start: 13, end: 14 } 
  }, 
  capacidad: { slot_base_min: 20 }, 
  servicios: { 
    'corte clasico': { precio: 35000, min: 40 }, 
    'corte + degradado + diseño': { precio: 55000, min: 60 }, 
    'barba completa': { precio: 28000, min: 30 }, 
    'corte + barba': { precio: 75000, min: 70 }, 
    'afeitado tradicional': { precio: 45000, min: 45 }, 
    'coloracion barba': { precio: 65000, min: 60 }, 
    'arreglo patillas': { precio: 18000, min: 20 }, 
    'vip': { precio: 120000, min: 90 } 
  }, 
  pagos: ["Nequi", "Daviplata", "PSE", "Efectivo", "Datáfono (pago en el local)"], 
  faqs: [ 
    { q: "¿Cómo puedo cancelar?", a: "Responde a este chat o llama al +57 310 555 1234. Cancela con 6+ horas para evitar cargo." }, 
    { q: "¿Puedo cambiar la cita?", a: "Sí, reprogramamos si hay disponibilidad y avisas con 6+ horas." }, 
    { q: "¿Aceptan tarjeta?", a: "Sí, datáfono, Nequi/Daviplata y efectivo." }, 
    { q: "¿Tienen estacionamiento?", a: "Sí, 3 cupos en la parte trasera y parqueo público en la 70." } 
  ], 
  upsell: "¿Agregamos barba por $28.000? Queda en $75.000 el combo 😉" 
};

// ======== PROMPTS ========
const PROMPT_VENTAS = `
Eres Cortex IA, un asistente experto de Cortex Agency. Tu misión es **ayudar** a dueños de negocios (barberías, spas, uñas) a **descubrir** cómo pueden dejar de perder clientes y tiempo por no atender WhatsApp al instante. Hablas como un parcero colombiano: inteligente, empático, seguro y **muy humano**. Usas la escucha activa y preguntas clave.

**Tu Filosofía (Inspirada en "To Sell is Human"):**
* **Vender es Ayudar:** No empujas un producto, ofreces una solución a un dolor real (citas perdidas, estrés por responder). Tu meta es dejar al cliente *mejor* de lo que estaba.
* **Enfócate en el Dolor:** El cliente sabe que pierde citas, pero quizás no ha cuantificado el costo. Ayúdalo a verlo.
* **Sé un Curador:** No listes funciones. Escucha su necesidad y presenta la característica *exacta* que la resuelve.
* **Busca la Sintonía:** Ponte en sus zapatos. Valida sus preocupaciones.

**== Flujo de Conversación ==**
1.  **Saludo:** "¡Hey! 👋 Soy Cortex IA. Muchos dueños me cuentan lo frustrante que es perder una cita solo por no ver el WhatsApp a tiempo... ¿Te suena familiar?"
2.  **Diagnóstico:** Si comparten un problema, profundiza: "¿Y cómo te afecta eso?", "¿Has calculado cuánto representa al mes?".
3.  **Solución:** "Justo para eso estoy. Me encargo de responder al instante, 24/7, y agendar esas citas. ¿Te gustaría ver *cómo* lo hago?"
4.  **Objeciones:**
    * "Yo mismo respondo": "¡Excelente! Pero, ¿has pensado cuánto tiempo te quita? ¿Y si te escriben mientras duermes?"
    * "No confían en bots": "Te entiendo. ¿Yo te sueno a robot? 😉 Lo clave es sonar natural."
    * "Es caro": "Si te recupera solo 3-4 citas al mes que hoy pierdes... ¿cuánto dinero es eso? Se paga solo."
5.  **Cierre:** "La mejor forma de verlo es probándolo. Tengo una demo lista. ¿Quieres interactuar? Escribe /start test."
6.  **Post-Demo:** "¡Demo finalizada! ¿Qué tal? Si te gustó, el siguiente paso es dejarlo en *tu* WhatsApp."
`;

const CTAs = [
  "¿Quieres verlo en acción? Escribe /start test 💈",
  "¿Agendamos una llamada de 10 min y te explico cómo ponerlo en tu WhatsApp?",
];

function pick(arr) { 
  return arr[Math.floor(Math.random() * arr.length)]; 
}

function getPromptDemoBarberia(slotsDisponibles) {
  const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy'); 
  const hoyDiaSemana = now().weekday; 
  const serviciosTxt = Object.entries(BARBERIA_DATA.servicios)
    .map(([k, v]) => `- ${k}: $${v.precio.toLocaleString('es-CO')} (${v.min} min)`)
    .join('\n'); 
  
  let slotsTxt = "Lo siento, no veo cupos disponibles en los próximos 3 días."; 
  if (slotsDisponibles && slotsDisponibles.length) { 
    slotsTxt = slotsDisponibles.map(d => { 
      const fechaFormateada = DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d LLLL'); 
      return `  - ${fechaFormateada} (${d.fecha}): ${d.horas.join(', ')}`; 
    }).join('\n'); 
  } 
  
  let horarioHoy = BARBERIA_DATA.horario.festivos; 
  if (hoyDiaSemana >= 1 && hoyDiaSemana <= 5) horarioHoy = BARBERIA_DATA.horario.lun_vie; 
  else if (hoyDiaSemana === 6) horarioHoy = BARBERIA_DATA.horario.sab; 
  else if (hoyDiaSemana === 7) horarioHoy = BARBERIA_DATA.horario.dom; 
  
  return `
Eres el "Asistente Cortex Barbershop", IA de **${BARBERIA_DATA.nombre}**. Actúas como un humano: amable, profesional, eficiente, 100% paisa. Tu objetivo es agendar citas y responder FAQs. NUNCA digas que eres demo. Hoy es ${hoy}.

== REGLAS DE AGENDAMIENTO ==
1. **Calidez:** Saluda amablemente y mantén tono conversador.
2. **Fechas:** Usa formatos amigables ("Martes 21 de Octubre").
3. **Flujo:** 1. Pregunta servicio. 2. Di precio/duración. 3. Pregunta por hora deseada.
4. **Horarios:**
   * Si preguntan horario general: Da el horario del día ("Hoy atendemos de ${horarioHoy}"). NO listes slots.
   * Si preguntan hora específica: Revisa slots disponibles y confirma o sugiere alternativas cercanas.
   * NUNCA listes más de 2-3 horas seguidas.
5. **PEDIR NOMBRE:** Después de que confirme la hora, pregunta: "¿A nombre de quién agendo?"
6. **Confirmación:** SOLO cuando tengas hora y nombre, incluye: <BOOKING: {"servicio": "...", "fecha": "YYYY-MM-DD", "hora_inicio": "H:MM AM/PM", "slots_usados": [...], "nombreCliente": "..."}>
7. **NO menciones lógica interna** como "verificando disponibilidad".
8. **CANCELACIONES:** Si pide cancelar, pregunta cuál cita. Si confirma, incluye: <CANCELLED: {"id": "bookingId"}>
9. **POST-CONFIRMACIÓN:** Tras enviar confirmación con <BOOKING>, solo ofrece upsell. NO vuelvas a pedir datos.

== SLOTS DISPONIBLES ==
${slotsTxt}

== INFO DEL NEGOCIO ==
Nombre: ${BARBERIA_DATA.nombre}
Horario: Lun-Vie ${BARBERIA_DATA.horario.lun_vie}, Sáb ${BARBERIA_DATA.horario.sab}, Dom ${BARBERIA_DATA.horario.dom} (Hoy: ${horarioHoy})
Almuerzo: 1-2 PM
Servicios:
${serviciosTxt}
Dirección: ${BARBERIA_DATA.direccion}
Pagos: ${BARBERIA_DATA.pagos.join(', ')}
FAQs: ${BARBERIA_DATA.faqs.map(f => `- P: ${f.q}\n  R: ${f.a}`).join('\n')}
`;
}

// ======== Utilidades ========
function now() { 
  return DateTime.now().setZone(TZ); 
}

function detectServicio(text) { 
  const m = text.toLowerCase(); 
  if (m.includes('vip')) return 'vip'; 
  if (m.includes('degrad')) return 'corte + degradado + diseño'; 
  if (m.includes('barba')) return 'barba completa'; 
  if (m.includes('patilla')) return 'arreglo patillas'; 
  if (m.includes('afeitado')) return 'afeitado tradicional'; 
  if (m.includes('color')) return 'coloracion barba'; 
  if (m.includes('corte')) return 'corte clasico'; 
  return null; 
}

function detectHoraExacta(text) { 
  const h = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); 
  if (!h) return null; 
  
  let hh = parseInt(h[1], 10); 
  const mm = h[2] ? parseInt(h[2], 10) : 0; 
  let suffix = (h[3] || '').toUpperCase(); 
  
  if (!suffix) { 
    if (hh >= 9 && hh <= 11) suffix = 'AM'; 
    else if (hh === 12 || (hh >= 1 && hh <= 7)) suffix = 'PM'; 
    else suffix = 'PM'; 
  } 
  
  if (hh === 0) hh = 12; 
  if (hh > 12) { 
    hh -= 12; 
    suffix = 'PM'; 
  } 
  
  const HH = String(hh); 
  const MM = String(mm).padStart(2, '0'); 
  return `${HH}:${MM} ${suffix}`; 
}

function detectHoyOMañana(text) { 
  if (/\bhoy\b/i.test(text)) return 0; 
  if (/\bmañana|manana\b/i.test(text)) return 1; 
  return null; 
}

function detectCancelacion(text) { 
  return /cancelar|cancela|no puedo ir|cambiar cita|reagendar/i.test(text); 
}

function calcularSlotsUsados(horaInicio, durMin) { 
  const n = Math.ceil(durMin / BARBERIA_DATA.capacidad.slot_base_min); 
  const start = DateTime.fromFormat(horaInicio.toUpperCase(), 'h:mm a', { zone: TZ }); 
  
  if (!start.isValid) { 
    console.warn(`[Slots] Hora inválida: ${horaInicio}`); 
    return [horaInicio]; 
  } 
  
  const arr = []; 
  for (let i = 0; i < n; i++) { 
    arr.push(start.plus({ minutes: i * BARBERIA_DATA.capacidad.slot_base_min }).toFormat('h:mm a')); 
  } 
  return arr; 
}

function parseRango(fecha, rango) { 
  const [ini, fin] = rango.split('–').map(s => s.trim()); 
  const open = DateTime.fromFormat(ini, 'h:mm a', { zone: TZ }).set({ 
    year: fecha.year, 
    month: fecha.month, 
    day: fecha.day 
  }); 
  const close = DateTime.fromFormat(fin, 'h:mm a', { zone: TZ }).set({ 
    year: fecha.year, 
    month: fecha.month, 
    day: fecha.day 
  }); 
  return [open, close]; 
}

function generateBookingId() { 
  return Math.random().toString(36).substring(2, 9); 
}

// ===== Gestión de Estado =====
function ensureState(id) { 
  if (!id || typeof id !== 'string') { 
    console.error(`[Error Estado] ID inválido: ${id}`); 
    return { 
      botEnabled: false, 
      mode: 'cortex', 
      history: [], 
      sales: { lastOffer: null, awaiting: null }, 
      ctx: { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null } 
    }; 
  } 
  
  if (!state[id]) { 
    state[id] = { 
      botEnabled: true, 
      mode: 'cortex', 
      history: [], 
      sales: { lastOffer: null, awaiting: null }, 
      ctx: { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null } 
    }; 
    console.log(`[Estado] Nuevo estado para ${id}`); 
  } 
  
  if (state[id].botEnabled === undefined) state[id].botEnabled = true; 
  if (!state[id].mode) state[id].mode = 'cortex'; 
  if (!state[id].history) state[id].history = []; 
  if (!state[id].sales) state[id].sales = { lastOffer: null, awaiting: null }; 
  if (!state[id].ctx) state[id].ctx = { lastServicio: null, lastHorasSugeridas: [], bookingToCancel: null }; 
  if (state[id].ctx.bookingToCancel === undefined) state[id].ctx.bookingToCancel = null; 
  
  return state[id]; 
}

function setState(id, s) { 
  if (!id || typeof id !== 'string') { 
    console.error(`[Error Estado] ID inválido: ${id}`); 
    return; 
  } 
  state[id] = s; 
}

function pushHistory(id, role, content) { 
  if (!id || typeof id !== 'string') { 
    console.error(`[Error Historial] ID inválido: ${id}`); 
    return; 
  } 
  
  const s = ensureState(id); 
  if (!s) { 
    console.error(`[Error Historial] ensureState inválido para ${id}`); 
    return; 
  } 
  
  s.history.push({ role, content, at: Date.now() }); 
  while (s.history.length > MAX_TURNS) s.history.shift(); 
}

// ===== Gestión de Reservas =====
async function addReserva(userId, fecha, hora_inicio, servicio, slots_usados = [], nombreCliente = "Cliente") { 
  if (!DEMO_RESERVAS[fecha]) DEMO_RESERVAS[fecha] = []; 
  
  let reservaNueva = false; 
  let possibleConflict = false; 
  
  slots_usados.forEach(hora => { 
    if (DEMO_RESERVAS[fecha].includes(hora)) { 
      possibleConflict = true; 
    } 
  }); 
  
  if (possibleConflict) { 
    console.warn(`[Reserva] Conflicto para ${servicio} a ${hora_inicio} en ${fecha}`); 
    reservaNueva = false; 
  } else { 
    slots_usados.forEach(hora => { 
      DEMO_RESERVAS[fecha].push(hora); 
      console.log(`[Reserva] Slot ocupado: ${fecha} @ ${hora}`); 
    }); 
    reservaNueva = true; 
  } 
  
  saveReservas(); 
  
  if (reservaNueva) { 
    if (!USER_BOOKINGS[userId]) USER_BOOKINGS[userId] = []; 
    
    const bookingId = generateBookingId(); 
    const newBooking = { 
      id: bookingId, 
      fecha, 
      hora_inicio, 
      servicio, 
      slots_usados, 
      nombreCliente 
    }; 
    
    USER_BOOKINGS[userId].push(newBooking); 
    saveUserBookings(); 
    console.log(`[User Booking] Reserva guardada para ${userId}:`, newBooking); 
    
    // Notificación WhatsApp
    if (BOT_CONFIG.ownerWhatsappId) { 
      try { 
        await sendOwnerNotification(newBooking, 'new'); 
      } catch (error) { 
        console.error('[Error Notificación WhatsApp]:', error.message); 
      } 
    } 
    
    // Notificación Email
    if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) { 
      try { 
        await sendOwnerEmailNotification(newBooking, 'new'); 
      } catch (error) { 
        console.error('[Error Notificación Email]:', error.message); 
      } 
    } else {
      if (!BOT_CONFIG.ownerEmail) {
        console.warn('[Email] ownerEmail no configurado');
      }
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('[Email] GMAIL_USER o GMAIL_APP_PASSWORD no configurados');
      }
    }
  } 
  
  return reservaNueva; 
}

async function removeReserva(userId, bookingId) { 
  if (!USER_BOOKINGS[userId]) return false; 
  
  const bookingIndex = USER_BOOKINGS[userId].findIndex(b => b.id === bookingId); 
  if (bookingIndex === -1) return false; 
  
  const bookingToRemove = USER_BOOKINGS[userId][bookingIndex]; 
  const { fecha, slots_usados } = bookingToRemove; 
  
  if (DEMO_RESERVAS[fecha]) { 
    DEMO_RESERVAS[fecha] = DEMO_RESERVAS[fecha].filter(slot => !slots_usados.includes(slot)); 
    if (DEMO_RESERVAS[fecha].length === 0) delete DEMO_RESERVAS[fecha]; 
    saveReservas(); 
    console.log(`[Reserva] Slots liberados: ${fecha}: ${slots_usados.join(', ')}`); 
  } 
  
  USER_BOOKINGS[userId].splice(bookingIndex, 1); 
  if (USER_BOOKINGS[userId].length === 0) delete USER_BOOKINGS[userId]; 
  saveUserBookings(); 
  console.log(`[User Booking] Reserva ${bookingId} eliminada para ${userId}`); 
  
  // Notificaciones
  if (BOT_CONFIG.ownerWhatsappId) { 
    try { 
      await sendOwnerNotification(bookingToRemove, 'cancelled'); 
    } catch (error) { 
      console.error('[Error Cancelación WhatsApp]:', error.message); 
    } 
  } 
  
  if (BOT_CONFIG.ownerEmail && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) { 
    try { 
      await sendOwnerEmailNotification(bookingToRemove, 'cancelled'); 
    } catch (error) { 
      console.error('[Error Cancelación Email]:', error.message); 
    } 
  } 
  
  return true; 
}

async function sendOwnerNotification(bookingData, type = 'new') { 
  const ownerId = BOT_CONFIG.ownerWhatsappId; 
  if (!ownerId) { 
    console.warn('[WhatsApp] ownerWhatsappId no configurado'); 
    return; 
  } 
  
  const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL'); 
  let message; 
  
  if (type === 'new') { 
    message = `🔔 *¡Nueva Cita Agendada!* 🔔\n\nCliente: *${bookingData.nombreCliente || 'No especificado'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Agendada por Cortex IA)_`; 
  } else if (type === 'cancelled') { 
    message = `❌ *¡Cita Cancelada!* ❌\n\nCliente: *${bookingData.nombreCliente || 'No especificado'}*\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Cancelada vía Cortex IA)_`; 
  } else { 
    return; 
  } 
  
  await client.sendMessage(ownerId, message).catch(err => { 
    console.error(`[WhatsApp] Fallo al enviar a ${ownerId}:`, err.message); 
  }); 
}

async function sendOwnerEmailNotification(bookingData, type = 'new') { 
  const ownerEmail = BOT_CONFIG.ownerEmail; 
  const senderEmail = process.env.GMAIL_USER; 
  const senderPassword = process.env.GMAIL_APP_PASSWORD; 
  
  if (!ownerEmail) { 
    console.warn('[Email] ownerEmail no configurado'); 
    return; 
  } 
  
  if (!senderEmail || !senderPassword) { 
    console.error('[Email] GMAIL_USER o GMAIL_APP_PASSWORD no configurados'); 
    return; 
  } 
  
  const transporter = nodemailer.createTransport({ 
    service: 'gmail',
    auth: { 
      user: senderEmail, 
      pass: senderPassword 
    }
  }); 
  
  const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL'); 
  let subject; 
  let body; 
  
  if (type === 'new') { 
    subject = `Nueva Cita: ${bookingData.servicio} - ${fechaFormateada}`; 
    body = `<h2>🔔 Nueva Cita Agendada</h2>
<p><strong>Cliente:</strong> ${bookingData.nombreCliente || 'No especificado'}</p>
<p><strong>Servicio:</strong> ${bookingData.servicio}</p>
<p><strong>Fecha:</strong> ${fechaFormateada}</p>
<p><strong>Hora:</strong> ${bookingData.hora_inicio}</p>
<hr>
<p><em>Agendada por Cortex IA</em></p>`; 
  } else if (type === 'cancelled') { 
    subject = `Cita Cancelada: ${bookingData.servicio} - ${fechaFormateada}`; 
    body = `<h2>❌ Cita Cancelada</h2>
<p><strong>Cliente:</strong> ${bookingData.nombreCliente || 'No especificado'}</p>
<p><strong>Servicio:</strong> ${bookingData.servicio}</p>
<p><strong>Fecha:</strong> ${fechaFormateada}</p>
<p><strong>Hora:</strong> ${bookingData.hora_inicio}</p>
<hr>
<p><em>Cancelada vía Cortex IA</em></p>`; 
  } else {