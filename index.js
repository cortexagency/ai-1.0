// =========================
// CORTEX IA - INDEX.JS (v9 - /set owner Corrected + All Features)
// =========================
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TZ = process.env.TZ || 'America/Bogota';
const MAX_TURNS = 12;

// ======== Estado Global ========
const state = {};
let BOT_CONFIG = { ownerWhatsappId: null }; // Se cargará desde archivo

// ======== GESTIÓN PERSISTENTE (Reservas y Configuración) ========
const DATA_DIR = path.join(__dirname, 'data');
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
let DEMO_RESERVAS = {};

// Asegurarse de que el directorio 'data' exista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Cargar/Guardar Configuración (Owner Number)
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      BOT_CONFIG = JSON.parse(data);
      console.log('[Memoria] Configuración cargada.');
      if (!BOT_CONFIG.ownerWhatsappId) {
        console.warn('[Advertencia Config] ownerWhatsappId no encontrado en config.json. Usa /set owner para configurarlo.');
      } else {
         console.log(`[Config] Dueño actual cargado: ${BOT_CONFIG.ownerWhatsappId}`);
      }
    } else {
      saveConfig(); // Crea el archivo si no existe
      console.log('[Memoria] Archivo config.json creado. Usa /set owner para configurar el número del dueño.');
    }
  } catch (e) {
    console.error('[Error Memoria] No se pudo cargar config.json:', e);
    BOT_CONFIG = { ownerWhatsappId: null };
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
function loadReservas() {
  try {
    if (fs.existsSync(DEMO_RESERVAS_PATH)) {
      const data = fs.readFileSync(DEMO_RESERVAS_PATH, 'utf8');
      DEMO_RESERVAS = JSON.parse(data);
      console.log('[Memoria] Reservas de demo cargadas.');
    } else {
      DEMO_RESERVAS = {};
      fs.writeFileSync(DEMO_RESERVAS_PATH, JSON.stringify(DEMO_RESERVAS), 'utf8');
      console.log('[Memoria] Archivo demo_reservas.json creado.');
    }
  } catch (e) {
    console.error('[Error Memoria] No se pudo cargar demo_reservas.json:', e);
    DEMO_RESERVAS = {};
  }
}

function saveReservas() {
  try {
    fs.writeFileSync(DEMO_RESERVAS_PATH, JSON.stringify(DEMO_RESERVAS, null, 2), 'utf8');
  } catch (e) {
    console.error('[Error Memoria] No se pudo guardar demo_reservas.json:', e);
  }
}

// Cargar todo al iniciar
loadConfig();
loadReservas();

// ======== DATOS DE LA DEMO (BARBERÍA LA 70) ========
const BARBERIA_DATA = { /* ... (Mismos datos de antes) ... */
    nombre: "Barbería La 70", direccion: "Calle 70 #45-18, Belén, Medellín (esquina con Cra. 48)", referencia: "Frente al Parque Belén, local 3 (al lado de la panadería El Molino)", telefono: "+57 310 555 1234 (demo)", instagram: "@barberial70 (demo)", horario: { lun_vie: "9:00 AM – 8:00 PM", sab: "9:00 AM – 6:00 PM", dom: "10:00 AM – 4:00 PM", festivos: "Cerrado o solo por cita previa", almuerzo_demo: { start: 13, end: 14 } }, capacidad: { slot_base_min: 20 }, servicios: { 'corte clasico': { precio: 35000, min: 40 }, 'corte + degradado + diseño': { precio: 55000, min: 60 }, 'barba completa': { precio: 28000, min: 30 }, 'corte + barba': { precio: 75000, min: 70 }, 'afeitado tradicional': { precio: 45000, min: 45 }, 'coloracion barba': { precio: 65000, min: 60 }, 'arreglo patillas': { precio: 18000, min: 20 }, 'vip': { precio: 120000, min: 90 } }, pagos: ["Nequi", "Daviplata", "PSE", "Efectivo", "Datáfono (pago en el local)"], faqs: [ { q: "¿Cómo puedo cancelar?", a: "Responde a este chat o llama al +57 310 555 1234. Cancela con 6+ horas para evitar cargo." }, { q: "¿Puedo cambiar la cita?", a: "Sí, reprogramamos si hay disponibilidad y avisas con 6+ horas." }, { q: "¿Aceptan tarjeta?", a: "Sí, datáfono, Nequi/Daviplata y efectivo." }, { q: "¿Tienen estacionamiento?", a: "Sí, 3 cupos en la parte trasera y parqueo público en la 70." } ], upsell: "¿Agregamos barba por $28.000? Queda en $75.000 el combo 😉"
};

// ======== PROMPT VENTAS (CORTEX IA - "STRAIGHT LINE" + CTAs) ========
const PROMPT_VENTAS = `
Eres Cortex IA, un asistente de ventas experto de Cortex Agency. Usas la metodología "Straight Line". Tu personalidad es aguda, entusiasta y experta. Hablas como un "parcero" colombiano, profesional y seguro.

Tu objetivo es vender el asistente de IA a dueños de negocios (barberías, spas, uñas), enfocándote en su DOLOR: "Pierdo citas y dinero por no poder contestar WhatsApp 24/7."

== REGLAS (STRAIGHT LINE) ==
1.  **Toma Control:** Si saludan, responde cálido e inmediatamente introduce el dolor: "¡Hey! 👋 Soy Cortex IA. Ayudo a dueños de negocios como tú a dejar de perder citas por no responder a tiempo. ¿Te ha pasado que te escriben tarde para agendar y al otro día ya es tarde?"
2.  **Amplifica el Dolor:** Haz preguntas que lo refuercen: "Total. Y cada cliente que no responde rápido, se va con otro. Es plata que se pierde. Yo aseguro cada cita, 24/7."
3.  **Manejo de Objeciones (Looping):** Deflecta, valida y vuelve a la línea.
    * "Yo mismo respondo": "¡Claro! Pero, ¿la idea de tener a alguien agendando *mientras* duermes o trabajas, tiene sentido para ti?"
    * "No confían en bots": "Te entiendo. Por eso no sueno robot 😉. Pero, ¿la idea de atención *instantánea* a cualquier hora, te parece valiosa?"
    * "Es caro": "Entiendo. Pero, ¿cuánto pierdes al mes por citas no agendadas? Si esto te recupera 3-4 citas, se pagó solo. ¿Ves el valor de la idea?"
4.  **Cierre (Demo):** Tu cierre principal es la DEMO: "Mira, basado en lo que dices, esto es perfecto para ti. La mejor forma de verlo es probarlo. Tengo una demo de barbería lista. Escribe /start test y pruébalo tú mismo."
5.  **Flujo Post-Demo:**
    * Al volver (\`/end test\`): "¡Demo finalizada! ¿Qué tal? ¿Viste cómo agendé? Si te interesa, te explico cómo lo dejamos en tu WhatsApp en 1–2 días."
    * Si responden SÍ/ME GUSTÓ/BRUTAL: "Perfecto 🔥. Ese es el poder de no perder clientes. Te agendo con el equipo para personalizar tu asistente. ¿Tu nombre y tipo de negocio? 🚀"
    * Si responden OTRA COSA: NO resaludes. Ofrece opciones: "¿Prefieres que te lo deje en tu WhatsApp o primero una llamada corta?"
`;
// CTAs para el modo Cortex
const CTAs = [
  "¿Quieres verlo en acción ahora? Escribe /start test 💈",
  "¿Agendamos una llamada rápida de 10 min y te explico cómo lo ponemos en tu WhatsApp?",
];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ======== PROMPT DEMO (BARBERÍA - v3 Con NLU Hints) ========
function getPromptDemoBarberia(slotsDisponibles) { /* ... (Misma función de antes) ... */
    const hoy = now().setLocale('es').toFormat('cccc d LLLL, yyyy'); const hoyDiaSemana = now().weekday; const serviciosTxt = Object.entries(BARBERIA_DATA.servicios).map(([k, v]) => `- ${k}: $${v.precio.toLocaleString('es-CO')} (${v.min} min)`).join('\n'); let slotsTxt = "Lo siento, no veo cupos disponibles en los próximos 3 días. Pregúntame por otra fecha."; if (slotsDisponibles && slotsDisponibles.length) { slotsTxt = slotsDisponibles.map(d => { const fechaFormateada = DateTime.fromISO(d.fecha).setLocale('es').toFormat('cccc d LLLL'); return `  - ${fechaFormateada} (${d.fecha}): ${d.horas.join(', ')}`; }).join('\n'); } let horarioHoy = BARBERIA_DATA.horario.festivos; if (hoyDiaSemana >= 1 && hoyDiaSemana <= 5) horarioHoy = BARBERIA_DATA.horario.lun_vie; else if (hoyDiaSemana === 6) horarioHoy = BARBERIA_DATA.horario.sab; else if (hoyDiaSemana === 7) horarioHoy = BARBERIA_DATA.horario.dom; return `
Eres el "Asistente Cortex Barbershop", el asistente IA de **${BARBERIA_DATA.nombre}**. Actúa como un humano: amable, profesional, eficiente y 100% colombiano (de Medellín). Tu ÚNICO objetivo es agendar citas y responder preguntas sobre la barbería. NUNCA digas que eres una demo. Eres el asistente real. Hoy es ${hoy}.

== REGLAS DE AGENDAMIENTO Y HORARIOS (MUY IMPORTANTE) ==
1.  **Naturalidad y Calidez:** Saluda amablemente ("¡Hola! Bienvenido a Barbería La 70...") y pregunta qué necesita.
2.  **Formato de Fecha:** Usa formatos amigables ("Martes 21 de Octubre").
3.  **Flujo Conversacional:** 1. Pregunta el **servicio**. 2. Di precio/duración. 3. **PREGUNTA POR HORA DESEADA:** "¿Para qué día y hora te gustaría agendar?"
4.  **CÓMO RESPONDER SOBRE HORARIOS (CRÍTICO):**
    * **Si preguntan genéricamente por horas** (ej: "¿Qué horas tienen?"): Responde con el **horario general del día**, NO con slots específicos. (Ej: "¡Claro! Hoy Martes estamos abiertos de ${horarioHoy}.").
    * **Si preguntan por una HORA ESPECÍFICA** (ej: "¿Tienes cita a las 4 PM?"): **Revisa** si esa hora EXACTA está en la lista de 'SLOTS DISPONIBLES'. Si SÍ: Confirma directamente (ej: "¡Sí! A las 4 PM está libre. ¿Agendamos? ¿A nombre de quién?"). Si NO: Ofrece **SOLO 1 o 2 alternativas cercanas** de la lista (ej: "Uy, a las 4 PM ya está ocupado. ¿Te sirve 4:20 PM o 4:40 PM?").
    * **NUNCA listes más de 2-3 horas seguidas**. Prioriza responder a la hora específica que pidan.
5.  **NO MOSTRAR LÓGICA INTERNA:** Nunca digas "se reservan los slots". Solo confirma la cita.
6.  **NO INVENTAR REGLAS:** No inventes horarios. Usa la info del negocio.
7.  **ETIQUETA DE RESERVA (PARA EL SISTEMA):** Al confirmar, **DEBES** incluir la etiqueta invisible <BOOKING: {...}> con \`servicio\`, \`fecha\`, \`hora_inicio\`, y \`slots_usados\` calculados (30-40min=2 slots, 50-60min=3 slots, 90min=5 slots). Ejemplo: <BOOKING: {"servicio": "corte clasico", "fecha": "2025-10-21", "hora_inicio": "9:00 AM", "slots_usados": ["9:00 AM", "9:20 AM"]}>
8.  **Upsell:** *Después* de confirmar, ofrece el upsell: "${BARBERIA_DATA.upsell}".

== SLOTS DISPONIBLES (LISTA INTERNA PARA TI - NO MOSTRAR AL CLIENTE DIRECTAMENTE) ==
${slotsTxt}

== INFO DEL NEGOCIO (PARA RESPONDER PREGUNTAS GENERALES) ==
Nombre: ${BARBERIA_DATA.nombre}
Horario General: - Lun–Vie: ${BARBERIA_DATA.horario.lun_vie} (Hoy: ${horarioHoy}) - Sáb: ${BARBERIA_DATA.horario.sab} - Dom: ${BARBERIA_DATA.horario.dom} (Recuerda el break de almuerzo 1 PM-2 PM, filtrado de la lista).
Servicios Principales: ${serviciosTxt}
Dirección: ${BARBERIA_DATA.direccion} Pagos: ${BARBERIA_DATA.pagos.join(', ')}
FAQs: ${BARBERIA_DATA.faqs.map(f => `- P: ${f.q}\n  R: ${f.a}`).join('\n')}
`;
}

// ======== Utilidades ========
function now() { return DateTime.now().setZone(TZ); }

// --- NLU Ligero ---
function detectServicio(text) { /* ... (Misma función) ... */ const m = text.toLowerCase(); if (m.includes('vip')) return 'vip'; if (m.includes('degrad')) return 'corte + degradado + diseño'; if (m.includes('barba')) return 'barba completa'; if (m.includes('patilla')) return 'arreglo patillas'; if (m.includes('afeitado')) return 'afeitado tradicional'; if (m.includes('color')) return 'coloracion barba'; if (m.includes('corte')) return 'corte clasico'; return null; }
function detectHoraExacta(text) { /* ... (Misma función) ... */ const h = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); return h ? h[0] : null; }
function detectHoyOMañana(text) { /* ... (Misma función) ... */ if (/\bhoy\b/i.test(text)) return 0; if (/\bmañana|manana\b/i.test(text)) return 1; return null; }

// --- Cálculo de Slots Usados (Fallback) ---
function calcularSlotsUsados(horaInicio, durMin) { /* ... (Misma función) ... */ const n = Math.ceil(durMin / BARBERIA_DATA.capacidad.slot_base_min); const start = DateTime.fromFormat(horaInicio.toUpperCase(), 'h:mm a', { zone: TZ }); if (!start.isValid) return [horaInicio]; const arr = []; for (let i = 0; i < n; i++) { arr.push(start.plus({ minutes: i * BARBERIA_DATA.capacidad.slot_base_min }).toFormat('h:mm a')); } return arr; }

// ===== Gestión de Estado y Contexto =====
function ensureState(id) { /* ... (Misma función) ... */ if (!state[id]) { state[id] = { botEnabled: true, mode: 'cortex', history: [], sales: { lastOffer: null, awaiting: null }, ctx: { lastServicio: null, lastHorasSugeridas: [] } }; } return state[id]; }
function setState(id, s) { state[id] = s; }
function pushHistory(id, role, content) { /* ... (Misma función) ... */ const s = ensureState(id); s.history.push({ role, content, at: Date.now() }); while (s.history.length > MAX_TURNS) s.history.shift(); }

// ===== Gestión de Reservas (Demo) =====
function parseRango(fecha, rango) { /* ... (Misma función) ... */ const [ini, fin] = rango.split('–').map(s => s.trim()); const open = DateTime.fromFormat(ini, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); const close = DateTime.fromFormat(fin, 'h:mm a', { zone: TZ }).set({ year: fecha.year, month: fecha.month, day: fecha.day }); return [open, close]; }
async function addReserva(fecha, hora_inicio, servicio, slots_usados = []) { /* ... (Misma función) ... */ if (!DEMO_RESERVAS[fecha]) DEMO_RESERVAS[fecha] = []; let reservaNueva = false; slots_usados.forEach(hora => { if (!DEMO_RESERVAS[fecha].includes(hora)) { DEMO_RESERVAS[fecha].push(hora); console.log(`[Reserva Demo] Slot Ocupado: ${fecha} @ ${hora}`); reservaNueva = true; } }); saveReservas(); if (reservaNueva && BOT_CONFIG.ownerWhatsappId) { try { await sendOwnerNotification({ fecha, hora_inicio, servicio }); console.log(`[Notificación] Enviada al dueño por nueva reserva.`); } catch (error) { console.error('[Error Notificación] No se pudo enviar mensaje al dueño:', error); } } }
async function sendOwnerNotification(bookingData) { /* ... (Misma función) ... */ const ownerId = BOT_CONFIG.ownerWhatsappId; if (!ownerId) { console.warn('[Advertencia Notificación] ownerWhatsappId no está configurado en config.json.'); return; } const fechaFormateada = DateTime.fromISO(bookingData.fecha).setLocale('es').toFormat('cccc d LLLL'); const message = `🔔 *¡Nueva Cita Agendada!* 🔔\n\nServicio: *${bookingData.servicio}*\nFecha: *${fechaFormateada}*\nHora: *${bookingData.hora_inicio}*\n\n_(Agendada por Cortex IA)_`; await client.sendMessage(ownerId, message).catch(err => { console.error(`[Error Notificación] Fallo al enviar a ${ownerId}:`, err); }); }
function generarSlotsDemo(diasAdelante = 3) { /* ... (Misma función) ... */ const hoy = now(); const out = []; const slotMin = BARBERIA_DATA.capacidad.slot_base_min; const { almuerzo_demo } = BARBERIA_DATA.horario; for (let d = 0; d < diasAdelante; d++) { const fecha = hoy.plus({ days: d }); const fechaStr = fecha.toFormat('yyyy-LL-dd'); const wd = fecha.weekday; let open, close; if (wd >= 1 && wd <= 5) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.lun_vie); else if (wd === 6) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.sab); else [open, close] = parseRango(fecha, BARBERIA_DATA.horario.dom); let cursor = open; if (d === 0 && hoy > open) { const minsSinceOpen = hoy.diff(open, 'minutes').minutes; const nextSlot = Math.ceil(minsSinceOpen / slotMin) * slotMin; cursor = open.plus({ minutes: nextSlot }); } const horas = []; while (cursor < close) { const hh = cursor.toFormat('h:mm a'); const hora24 = cursor.hour; const ocupada = DEMO_RESERVAS[fechaStr] && DEMO_RESERVAS[fechaStr].includes(hh); const esAlmuerzo = (hora24 >= almuerzo_demo.start && hora24 < almuerzo_demo.end); if (!ocupada && !esAlmuerzo && cursor > hoy.plus({ minutes: 30 })) { horas.push(hh); } if (horas.length >= 20) break; cursor = cursor.plus({ minutes: slotMin }); } if (horas.length) out.push({ fecha: fechaStr, horas }); } return out; }

// ======== WHATSAPP CLIENT ========
const client = new Client({ /* ... (Misma config) ... */
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'data', 'session') }), puppeteer: { headless: true, args: [ '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu' ], },
});
client.on('qr', (qr) => { /* ... (Mismo QR con toDataURL) ... */ console.log('\n⚠️ No se puede mostrar el QR aquí. Copia el siguiente enlace en tu navegador para verlo: \n'); qrcode.toDataURL(qr, (err, url) => { if (err) { console.error("Error generando QR Data URL:", err); return; } console.log(url); console.log('\n↑↑↑ Copia ese enlace y pégalo en tu navegador para escanear el QR ↑↑↑'); }); });
client.on('ready', () => console.log('✅ Cortex IA listo!'));
client.on('auth_failure', msg => { console.error('ERROR DE AUTENTICACIÓN:', msg); });
client.on('disconnected', (reason) => { console.log('Cliente desconectado:', reason); });

// ======== LLAMADA SEGURA A OPENAI (CON RETRY) ========
async function safeChatCall(payload, tries = 2) { /* ... (Misma función) ... */ for (let i = 0; i < tries; i++) { try { return await openai.chat.completions.create(payload); } catch (e) { console.error(`[Error OpenAI] Intento ${i + 1} fallido:`, e.message); if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 700)); } } }

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  try {
    const from = msg.from;
    const text = (msg.body || '').trim();
    const low = text.toLowerCase();

    const s = ensureState(from);
    pushHistory(from, 'user', text);

    // --- Comandos Administrativos ---
    // *** ¡AQUÍ ESTÁ LA LÓGICA CORRECTA PARA /set owner! ***
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
            return msg.reply(`✅ ¡Perfecto! Ahora eres el dueño. Las notificaciones llegarán a este número.`);
        } else {
            console.log(`[Config] Dueño cambiado de ${oldOwner} a ${newOwner} por ${from}`);
            return msg.reply(`✅ Número de dueño actualizado a: ${newOwner}`);
        }
      } else {
        return msg.reply('❌ Formato inválido. Usa: /set owner numero@c.us (ej: /set owner 573101234567@c.us)');
      }
    }
    // Comando para limpiar reservas (SOLO dueño)
    if (low === '/clear reservas demo') {
      if (from === BOT_CONFIG.ownerWhatsappId) {
        DEMO_RESERVAS = {}; saveReservas();
        console.log('[Memoria] Reservas de demo limpiadas por el admin.');
        return msg.reply('🧹 Reservas de la demo limpiadas.');
      } else {
         console.log(`[Comando Ignorado] Intento de /clear reservas por ${from} (no es dueño).`);
         // No respondemos nada al usuario no autorizado
      }
    }
    // --- Fin Comandos Admin ---


    // 2. BOT ON/OFF (Evaluar DESPUÉS de comandos admin)
    if (low === '/bot off') {
        // Solo el dueño puede apagar/prender el bot globalmente? O cada usuario puede hacerlo para sí mismo?
        // Asumamos que cada usuario puede hacerlo para sí mismo por ahora.
        s.botEnabled = false; setState(from, s); return msg.reply('👌 Quedas tú al mando. Escribe /bot on para reactivarme.');
    }
    if (low === '/bot on') {
        s.botEnabled = true; setState(from, s); return msg.reply('💪 ¡Listo! Vuelvo a ayudarte 24/7.');
    }
    // Si el bot está deshabilitado para este usuario Y no es un comando admin que ya se procesó, no hacer nada más.
    if (!s.botEnabled) return;


    // 3. TEST DEMO on/off
    if (low === '/start test') { s.mode = 'barberia'; s.history = []; s.ctx = { lastServicio: null, lastHorasSugeridas: [] }; setState(from, s); return msg.reply(`*${BARBERIA_DATA.nombre}* 💈 (Demo Activada)\nEscríbeme como cliente (ej: "corte", "¿tienen hora hoy?").`); }
    if (low === '/end test') { s.mode = 'cortex'; s.history = []; s.sales.awaiting = 'confirm'; setState(from, s); return msg.reply('¡Demo finalizada! ¿Qué tal? ¿Viste cómo agendé? Si te interesa, te explico cómo lo dejamos en tu WhatsApp en 1–2 días.'); }


    // 4. ===== MODO DEMO: BARBERÍA (CON NLU + IA) =====
    if (s.mode === 'barberia') { /* ... (Misma lógica de antes) ... */
        const servicioDetectado = detectServicio(text); const horaDetectada = detectHoraExacta(text); const offset = detectHoyOMañana(text); const pideHorarioGeneral = /horario|horas|hasta que hora|a que horas|disponibilidad/i.test(low) && !horaDetectada && !servicioDetectado; if (pideHorarioGeneral) { const hoyDia = now().weekday; let horarioHoy = BARBERIA_DATA.horario.festivos; if (hoyDia >= 1 && hoyDia <= 5) horarioHoy = BARBERIA_DATA.horario.lun_vie; else if (hoyDia === 6) horarioHoy = BARBERIA_DATA.horario.sab; else if (hoyDia === 7) horarioHoy = BARBERIA_DATA.horario.dom; const reply = `¡Claro! Hoy atendemos de ${horarioHoy}. ¿Qué servicio te gustaría agendar? (corte, barba, etc.) 😉`; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); } s.ctx.lastServicio = servicioDetectado || s.ctx.lastServicio; setState(from, s); const slots = generarSlotsDemo(3); const promptSystem = getPromptDemoBarberia(slots); const messages = [ { role: 'system', content: promptSystem }, ...s.history.slice(-MAX_TURNS) ]; const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 350 }); let reply = completion.choices?.[0]?.message?.content?.trim() || 'No te entendí bien, ¿qué servicio necesitas?'; const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/); let bookingData = null; if (bookingMatch && bookingMatch[1]) { try { bookingData = JSON.parse(bookingMatch[1]); } catch (e) { console.error('Error parseando JSON de booking (IA):', e.message); } } if (bookingData && (!bookingData.slots_usados || bookingData.slots_usados.length === 0)) { const servicio = bookingData.servicio || s.ctx.lastServicio; const dur = servicio && BARBERIA_DATA.servicios[servicio.toLowerCase()]?.min; if(bookingData.hora_inicio && dur) { bookingData.slots_usados = calcularSlotsUsados(bookingData.hora_inicio, dur); console.log("[Fallback Booking] Slots calculados:", bookingData.slots_usados); } } if (bookingData?.fecha && bookingData?.hora_inicio && bookingData?.servicio && bookingData?.slots_usados?.length > 0) { await addReserva( bookingData.fecha, bookingData.hora_inicio, bookingData.servicio, bookingData.slots_usados ); reply = reply.replace(/<BOOKING:.*?>/, '').trim(); console.log(`[Reserva Demo Detectada y Guardada]`, bookingData); s.history = []; } else if (bookingMatch) { console.warn("[Advertencia Booking] Tag BOOKING detectado pero incompleto o inválido:", bookingData || bookingMatch[1]); reply = reply.replace(/<BOOKING:.*?>/, '').trim(); } pushHistory(from, 'assistant', reply); setState(from, s); await msg.reply(reply); return;
    }


    // 5. ===== MODO SHOWROOM (VENTAS + CTAs) =====
    if (s.mode === 'cortex') { /* ... (Misma lógica de antes) ... */
        const yes_post_demo = /^(si|sí|s[ií] me interesa|dale|de una|h[áa]gale|me interesa|listo|me gust[óo]|me sirve|claro|ok|perfecto|brutal)\b/i.test(low); if (s.sales.awaiting === 'confirm') { if (yes_post_demo) { s.sales.awaiting = 'schedule'; s.sales.lastOffer = 'call'; const reply = 'Perfecto 🔥. Ese es el poder de no perder clientes. Te agendo con el equipo para personalizar tu asistente. ¿Tu nombre y tipo de negocio? 🚀'; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); } else { s.sales.awaiting = null; const reply = `Entendido. ¿Prefieres entonces que te lo deje listo en tu WhatsApp o primero una llamada corta para aclarar dudas?`; pushHistory(from, 'assistant', reply); setState(from, s); return msg.reply(reply); } } const messages = [ { role: 'system', content: PROMPT_VENTAS }, ...s.history.slice(-MAX_TURNS) ]; const completion = await safeChatCall({ model: 'gpt-4o-mini', messages, max_tokens: 250 }); let reply = completion.choices?.[0]?.message?.content?.trim() || '¿En qué más te puedo ayudar? 🙂'; const isAskingForDemo = /demo|muestr|probar|prueba|\/start test/i.test(low); const isClosing = /nombre|negocio|agendar|llamada/i.test(low); if (!isAskingForDemo && !isClosing && s.sales.awaiting !== 'schedule') { if (Math.random() < 0.6) { reply += `\n\n${pick(CTAs)}`; } } if (isAskingForDemo) { s.sales.lastOffer = 'demo'; s.sales.awaiting = 'confirm'; } pushHistory(from, 'assistant', reply); setState(from, s); await msg.reply(reply); return;
    }

  } catch (error) {
    console.error('****** ¡ERROR DETECTADO! ******\n', error, '\n*******************************');
    if (msg && typeof msg.reply === 'function') { try { await msg.reply('Ups, algo salió mal. Inténtalo de nuevo.'); } catch (replyError) { console.error('Error al enviar mensaje de error:', replyError); } } else { console.error('No se pudo enviar mensaje de error (msg inválido).'); }
  }
});

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason); });
client.initialize().catch(err => { console.error("ERROR AL INICIALIZAR CLIENTE:", err); });