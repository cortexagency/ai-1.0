// =========================
// CORTEX IA - INDEX.JS (v5 - Con Memoria Persistente y Tono Corregido)
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

// ======== GESTIÓN DE RESERVAS (PERSISTENTE) ========
const DATA_DIR = path.join(__dirname, 'data');
const DEMO_RESERVAS_PATH = path.join(DATA_DIR, 'demo_reservas.json');
let DEMO_RESERVAS = {}; // Se cargará desde el archivo

// Asegurarse de que el directorio 'data' exista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Cargar reservas desde el archivo al iniciar
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

// Guardar reservas en el archivo
function saveReservas() {
  try {
    fs.writeFileSync(DEMO_RESERVAS_PATH, JSON.stringify(DEMO_RESERVAS, null, 2), 'utf8');
  } catch (e) {
    console.error('[Error Memoria] No se pudo guardar demo_reservas.json:', e);
  }
}

// Cargar las reservas al iniciar el script
loadReservas();

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
    almuerzo_demo: { start: 13, end: 14 } // Bloqueo de 1:00 PM a 1:59 PM
  },
  capacidad: {
    slot_base_min: 20 // Slots de 20 minutos
  },
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

// ======== PROMPT VENTAS (CORTEX IA - "STRAIGHT LINE") ========
const PROMPT_VENTAS = `
Eres Cortex IA, un asistente de ventas experto de Cortex Agency. Usas la metodología "Straight Line".
Tu personalidad es: 1. Aguda (Sharp as a tack), 2. Entusiasta (Bottled enthusiasm), 3. Experta (Expert in your field).
Hablas como un "parcero" colombiano, profesional y 100% seguro. Tu tono es clave.

Tu objetivo es vender el asistente de IA a dueños de negocios (barberías, spas, uñas).
El DOLOR principal del cliente es: "Pierdo citas y dinero por no poder contestar WhatsApp 24/7."

== REGLAS DE COMPORTAMIENTO (STRAIGHT LINE) ==
1.  **Toma Control (Primeros 4 Segundos):**
    * Si saludan: "¡Hey! 👋 Soy Cortex IA. Ayudo a dueños de negocios como tú a dejar de perder citas por no responder a tiempo. ¿Te ha pasado que te escriben a las 10 PM para agendar y ves el mensaje al otro día... y ya es tarde?"
2.  **Identifica el Dolor (Inteligencia):**
    * Haz preguntas que amplifiquen el dolor.
    * Usuario: "A veces me pasa."
    * Tú: "Total. Y cada cliente que no responde en 5 min, se va a la competencia. Es dinero que se te está yendo. Yo trabajo 24/7, incluso mientras duermes, para asegurar cada cita."
3.  **Manejo de Objeciones (Looping):**
    * NUNCA respondas una objeción directamente. Defléctala, valida, y vuelve a la línea.
    * **Objeción 1:** "Yo mismo respondo mis mensajes."
    * **Loop:** "¡Total! Y seguro lo haces genial. Pero déjame preguntarte, ¿la idea de tener un asistente que agende por ti mientras duermes o estás ocupado en un corte... tiene sentido para ti? ¿Te gusta esa idea?"
    * **Objeción 2:** "Mis clientes no confían en bots."
    * **Loop:** "Te entiendo perfectamente. Por eso yo no sueno como un robot, ¿cierto? 😉 Hablo natural. Pero, ¿la idea de que tus clientes sean atendidos al segundo, a cualquier hora, te parece valiosa?"
    * **Objeción 3:** "Debe ser muy caro."
    * **Loop:** "Entiendo la preocupación por el costo. Pero, ¿cuánto dinero crees que pierdes al mes por citas no agendadas? Si este sistema te recupera solo 3 o 4 citas, ya se pagó solo. ¿Ves el valor de la idea?"
4.  **Cierre (Llevarlo a la Demo):**
    * Tu cierre es la DEMO.
    * "Mira, basado en lo que me dices, esto es un encaje perfecto. La mejor forma de verlo es probarlo. Tengo una demo de barbería lista."
    * "Escribe /start test y prueba tú mismo cómo atiendo a un cliente."
5.  **Flujo Post-Demo:**
    * Cuando el usuario vuelve (\`/end test\`), tú dices: "¡Demo finalizada! ¿Qué tal te pareció? ¿Viste cómo agendé la cita sin problemas? Si te interesa, te explico cómo dejamos uno igual en tu WhatsApp en 1–2 días."
    * Si responden "me gustó", "me interesa", "sí", "brutal" →
    * **Cierre Final:** "Perfecto 🔥. Ese es el poder de no volver a perder un cliente. Te puedo agendar con uno de los chicos del equipo de Cortex para personalizar tu asistente. Solo confírmame tu nombre y tipo de negocio, y te mandamos la propuesta enseguida 🚀"
`;

// ======== PROMPT DEMO (BARBERÍA - CORREGIDO) ========
function getPromptDemoBarberia(slotsDisponibles) {
  const hoy = now().toFormat('cccc d LLLL, yyyy'); // "lunes 20 octubre, 2025"
  
  const serviciosTxt = Object.entries(BARBERIA_DATA.servicios)
    .map(([k, v]) => `- ${k}: $${v.precio.toLocaleString('es-CO')} (${v.min} min)`)
    .join('\n');
    
  let slotsTxt = "Lo siento, no veo cupos disponibles en los próximos 3 días. Pregúntame por otra fecha.";
  if (slotsDisponibles && slotsDisponibles.length) {
     slotsTxt = slotsDisponibles.map(d =>
      `  - ${d.fecha}: ${d.horas.join(', ')}`
    ).join('\n');
  }

  return `
Eres el "Asistente Cortex Barbershop", el asistente IA de **${BARBERIA_DATA.nombre}**.
Actúa como un humano: amable, profesional, eficiente y 100% colombiano (de Medellín).
Tu ÚNICO objetivo es agendar citas y responder preguntas sobre la barbería.
NUNCA digas que eres una demo. Eres el asistente real. Hoy es ${hoy}.

== REGLAS DE AGENDAMIENTO (CONVERSACIONAL) ==

1.  **Naturalidad y Calidez:** Si saludan (hola, cómo estás), responde siempre con amabilidad y calidez.
    * **Ejemplo BIEN:** "¡Hola! Bienvenido a Barbería La 70. ¿Cómo te podemos ayudar hoy?"
    * **Ejemplo BIEN:** "¡Qué tal! Gracias por escribir a Barbería La 70. ¿Qué servicio te interesa?"
    * **Ejemplo MAL (Cortante):** "¡Hola! ¿Listo para un corte?"
2.  **Formato de Fecha:** Cuando confirmes citas, usa un formato amigable, ej: "Martes 21 de Octubre".
3.  **Flujo Conversacional:**
    1. Pregunta el **servicio** ("¿Qué servicio te interesa?").
    2. Cuando sepas el servicio, di el precio/duración. (ej: "Perfecto, el corte clásico cuesta $35.000 y dura unos 40 min.")
    3. **PREGUNTA PRIMERO:** "¿Para qué día y hora te gustaría?"
    4. El usuario dirá (ej: "mañana tipo 9am" o "el martes en la tarde").
    5. **TÚ** revisas la lista de 'SLOTS DISPONIBLES'.
    6. **Si está libre:** ¡Confirma! (ej: "¡Perfecto! Tengo a las 9:00 AM. ¿Te agendo a esa hora? ¿A nombre de quién?")
    7. **Si está ocupado:** Ofrece la hora libre *más cercana*. (ej: "Uy, las 9:00 AM ya se fue. ¿Te sirve 9:40 AM?")
    8. **NUNCA** listes todas las horas disponibles a menos que te lo pidan explícitamente.
4.  **CRÍTICO: NO MOSTRAR LÓGICA INTERNA**
    * Cuando confirmes la cita, **NUNCA** le expliques al cliente "se reservan los siguientes slots". Eso es información interna.
    * **MAL:** "Tu cita está agendada. Se reservan los slots 9:00 AM y 9:20 AM."
    * **BIEN:** "¡Listo, Andrés! Agendado para tu corte clásico el Martes 21 de Octubre a las 9:00 AM. ¡Te esperamos!"
5.  **CRÍTICO: NO INVENTAR REGLAS**
    * **NUNCA** inventes reglas de horario (ej: "solo atendemos en la mañana"). El horario completo está en 'INFO DEL NEGOCIO'.
    * Si no ves un slot en la lista, simplemente di que "esa hora no está disponible" y ofrece la más cercana.
6.  **CRÍTICO: ETIQUETA DE RESERVA (PARA EL SISTEMA)**
    * Cuando confirmes una cita, **DEBES** terminar tu mensaje con esta etiqueta (invisible para el usuario) para guardarla.
    * (Servicio 30-40 min = 2 slots, 50-60 min = 3 slots, 90 min = 5 slots)
    * Formato: <BOOKING: {"servicio": "nombre servicio", "fecha": "yyyy-LL-dd", "hora_inicio": "H:MM AM/PM", "slots_usados": ["H:MM AM/PM", "H:MM AM/PM", ...]}>
    * Ejemplo: <BOOKING: {"servicio": "corte clasico", "fecha": "2025-10-21", "hora_inicio": "9:00 AM", "slots_usados": ["9:00 AM", "9:20 AM"]}>
7.  **Upsell:** *Después* de confirmar, ofrece el upsell: "${BARBERIA_DATA.upsell}".

== SLOTS DISPONIBLES (LISTA INTERNA PARA TI) ==
${slotsTxt}

== INFO DEL NEGOCIO ==
Servicios:
${serviciosTxt}
Horario: Lun–Vie: ${BARBERIA_DATA.horario.lun_vie}, Sáb: ${BARBERIA_DATA.horario.sab}, Dom: ${BARBERIA_DATA.horario.dom}
Dirección: ${BARBERIA_DATA.direccion}
Pagos: ${BARBERIA_DATA.pagos.join(', ')}
FAQs:
${BARBERIA_DATA.faqs.map(f => `- P: ${f.q}\n  R: ${f.a}`).join('\n')}
`;
}

// ======== Utilidades ========
function now() { return DateTime.now().setZone(TZ); }

// ===== Gestión de Estado =====
function ensureState(id) {
  if (!state[id]) {
    state[id] = {
      botEnabled: true,
      mode: 'cortex',
      history: [],
      sales: {
        lastOffer: null,
        awaiting: null
      }
    };
  }
  return state[id];
}

function setState(id, s) { state[id] = s; }

function pushHistory(id, role, content) {
  const s = ensureState(id);
  s.history.push({ role, content, at: Date.now() });
  while (s.history.length > MAX_TURNS) s.history.shift();
}

// ===== Gestión de Reservas (Demo) =====
function addReserva(fecha, slots_usados = []) {
  if (!DEMO_RESERVAS[fecha]) {
    DEMO_RESERVAS[fecha] = [];
  }
  slots_usados.forEach(hora => {
    if (!DEMO_RESERVAS[fecha].includes(hora)) {
      DEMO_RESERVAS[fecha].push(hora);
      console.log(`[Reserva Demo] Slot Ocupado: ${fecha} @ ${hora}`);
    }
  });
  // *** NUEVO: Guardar en el archivo JSON ***
  saveReservas();
}

function parseRango(fecha, rango) {
  const [ini, fin] = rango.split('–').map(s => s.trim());
  const open = DateTime.fromFormat(ini, 'h:mm a', { zone: TZ }).set({
    year: fecha.year, month: fecha.month, day: fecha.day
  });
  const close = DateTime.fromFormat(fin, 'h:mm a', { zone: TZ }).set({
    year: fecha.year, month: fecha.month, day: fecha.day
  });
  return [open, close];
}

function generarSlotsDemo(diasAdelante = 3) {
  const hoy = now();
  const out = [];
  const slotMin = BARBERIA_DATA.capacidad.slot_base_min; // 20 min
  const { almuerzo_demo } = BARBERIA_DATA.horario;

  for (let d = 0; d < diasAdelante; d++) {
    const fecha = hoy.plus({ days: d });
    const fechaStr = fecha.toFormat('yyyy-LL-dd');
    const wd = fecha.weekday; // 1..7
    let open, close;

    if (wd >= 1 && wd <= 5) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.lun_vie);
    else if (wd === 6) [open, close] = parseRango(fecha, BARBERIA_DATA.horario.sab);
    else [open, close] = parseRango(fecha, BARBERIA_DATA.horario.dom);

    let cursor = open;
    if (d === 0 && hoy > open) {
      const minsSinceOpen = hoy.diff(open, 'minutes').minutes;
      const nextSlot = Math.ceil(minsSinceOpen / slotMin) * slotMin;
      cursor = open.plus({ minutes: nextSlot });
    }

    const horas = [];
    while (cursor < close) {
      const hh = cursor.toFormat('h:mm a');
      const hora24 = cursor.hour;

      // Comprobar contra las reservas GLOBALES (cargadas del JSON)
      const ocupada = DEMO_RESERVAS[fechaStr] && DEMO_RESERVAS[fechaStr].includes(hh);
      // Comprobar hora de almuerzo
      const esAlmuerzo = (hora24 >= almuerzo_demo.start && hora24 < almuerzo_demo.end);

      if (!ocupada && !esAlmuerzo && cursor > hoy.plus({ minutes: 30 })) { // Dar 30 min de margen
        horas.push(hh);
      }
      // *** CORREGIDO: Aumentado a 20 slots para darle más contexto a la IA ***
      if (horas.length >= 20) break;
      
      cursor = cursor.plus({ minutes: slotMin });
    }

    if (horas.length) out.push({ fecha: fechaStr, horas });
  }
  return out;
}


// ======== WHATSAPP CLIENT ========
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', (qr) => {
  console.log('\n⚠️ No se puede mostrar el QR aquí. Copia el siguiente enlace en tu navegador para verlo: \n');
  // Esta función genera una URL con la imagen del QR
  qrcode.toDataURL(qr, (err, url) => {
    if (err) throw err;
    console.log(url);
    console.log('\n↑↑↑ Copia ese enlace y pégalo en tu navegador para escanear el QR ↑↑↑');
  });
});
client.on('ready', () => console.log('✅ Cortex IA listo!'));

// ======== HANDLER MENSAJES ========
client.on('message', async (msg) => {
  try {
    const from = msg.from;
    const text = (msg.body || '').trim();
    const low = text.toLowerCase();

    const s = ensureState(from);
    pushHistory(from, 'user', text); // Guardar historial de usuario

    // 2. BOT ON/OFF
    if (/^\/bot\s+off$/i.test(low)) {
      s.botEnabled = false; setState(from, s);
      return msg.reply('Perfecto 👌 quedas tú al mando. Cuando quieras que responda de nuevo, escribe /bot on.');
    }
    if (/^\/bot\s+on$/i.test(low)) {
      s.botEnabled = true; setState(from, s);
      return msg.reply('Listo, vuelvo a ayudarte 24/7 💪');
    }
    if (!s.botEnabled) return;

    // 3. TEST DEMO on/off
    if (/^\/start\s+test$/i.test(low)) {
      s.mode = 'barberia';
      s.history = []; // Limpiar historial para la demo
      setState(from, s);
      return msg.reply(
        `Demo activada: *${BARBERIA_DATA.nombre}* 💈\n` +
        `Escríbeme como cliente (ej: "corte + degradado", "¿tienen hora hoy?").`
      );
    }
    if (/^\/end\s+test$/i.test(low)) {
      s.mode = 'cortex';
      s.history = []; // Limpiar historial para ventas
      s.sales.awaiting = 'confirm'; // Preparar el estado de ventas
      setState(from, s);
      return msg.reply('¡Demo finalizada! ¿Qué tal te pareció? ¿Viste cómo agendé la cita sin problemas? Si te interesa, te explico cómo dejamos uno igual en tu WhatsApp en 1–2 días.');
    }
    
    // Comando para limpiar reservas (solo para ti, el admin)
    if (/^\/clear\s+reservas\s+demo$/i.test(low)) {
        DEMO_RESERVAS = {};
        saveReservas();
        console.log('[Memoria] Reservas de demo limpiadas por el admin.');
        return msg.reply('🧹 Reservas de la demo limpiadas.');
    }

    // 4. ===== MODO DEMO: BARBERÍA (CON IA) =====
    if (s.mode === 'barberia') {
      const slots = generarSlotsDemo(3);
      const promptSystem = getPromptDemoBarberia(slots);

      const messages = [
        { role: 'system', content: promptSystem },
        ...s.history.slice(-MAX_TURNS),
      ];

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', 
        messages,
        max_tokens: 300
      });
      let reply = completion.choices?.[0]?.message?.content?.trim() || 'No te entendí, ¿qué servicio quieres?';

      // Analizar la respuesta por el <BOOKING>
      const bookingMatch = reply.match(/<BOOKING:\s*({.*?})\s*>/);
      if (bookingMatch && bookingMatch[1]) {
        try {
          const bookingData = JSON.parse(bookingMatch[1]);
          addReserva(bookingData.fecha, bookingData.slots_usados || [bookingData.hora_inicio]);

          reply = reply.replace(/<BOOKING:.*?>/, '').trim(); // Limpiar tag
          console.log(`[Reserva Demo Detectada]`, bookingData);
          
        } catch (e) {
          console.error('Error parseando JSON de booking:', e.message);
        }
      }

      pushHistory(from, 'assistant', reply);
      setState(from, s);
      await msg.reply(reply);
      return;
    }

    // 5. ===== MODO SHOWROOM (VENTAS "STRAIGHT LINE") =====
    if (s.mode === 'cortex') {
      const yes_post_demo = /^(si|sí|s[ií] me interesa|dale|de una|hágale|hagale|me interesa|listo|me gust[óo]|me sirve|claro|ok|perfecto|brutal)\b/i.test(low);

      // Flujo de ventas post-demo
      if (s.sales.awaiting === 'confirm' && yes_post_demo) {
        s.sales.awaiting = 'schedule'; 
        s.sales.lastOffer = 'call';
        
        const reply = 'Perfecto 🔥. Ese es el poder de no volver a perder un cliente. Te puedo agendar con uno de los chicos del equipo de Cortex para personalizar tu asistente. Solo confírmame tu nombre y tipo de negocio, y te mandamos la propuesta enseguida 🚀';
        
        pushHistory(from, 'assistant', reply);
        setState(from, s);
        await msg.reply(reply);
        return;
      }

      // Flujo de ventas normal (con LLM)
      const messages = [
        { role: 'system', content: PROMPT_VENTAS },
        ...s.history.slice(-MAX_TURNS),
      ];

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 250
      });
      const reply = completion.choices?.[0]?.message?.content?.trim() || '🙂';

      if (/demo|muestr(a|e)|probar|prueba|/i.test(low)) {
        s.sales.lastOffer = 'demo';
        s.sales.awaiting = 'confirm';
      }

      pushHistory(from, 'assistant', reply);
      setState(from, s);
      await msg.reply(reply);
      return;
    }

  } catch (error) {
    console.error('Ha ocurrido un error en el handler de mensajes:', error);
    if (msg) {
      await msg.reply('Ups, algo salió mal. Por favor, inténtalo de nuevo.');
    }
  }
});

client.initialize();