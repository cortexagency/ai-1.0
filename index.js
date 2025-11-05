// =========================
// CORTEX IA - BARBERSHOP BOT (Producción)
// =========================
require('dotenv').config();

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');
const express = require('express');

// ========== CONFIGURACIÓN ==========
let OWNER_NUMBER = process.env.OWNER_NUMBER || '573223698554';
let OWNER_CHAT_ID = process.env.OWNER_WHATSAPP_ID || `${OWNER_NUMBER}@c.us`;

const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/TU_LINK_AQUI/review';
const TIMEZONE = process.env.TZ || 'America/Bogota';
const PORT = process.env.PORT || 3000;
const PANEL_URL = process.env.PANEL_URL || 'https://cortexbarberia.site/panel';

// ======== RUTAS DE CARPETAS/ARCHIVOS ========
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');

const BOOKINGS_FILE = path.join(DATA_DIR, 'citas.json');
const WAITLIST_FILE = path.join(DATA_DIR, 'waitlist.json');
const BARBERS_FILE = path.join(DATA_DIR, 'barberos.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clientes.json');
const SCHEDULED_MESSAGES_FILE = path.join(DATA_DIR, 'scheduled_messages.json');
const BARBERIA_CONFIG_PATH = path.join(ROOT_DIR, 'barberia_base.txt');

// Cliente de OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== 🛡️ ANTI-BAN: HUMAN-LIKE DELAYS ==========
const MIN_RESPONSE_DELAY = 2000;
const MAX_RESPONSE_DELAY = 5000;

function humanDelay() {
  const delay = Math.floor(Math.random() * (MAX_RESPONSE_DELAY - MIN_RESPONSE_DELAY + 1)) + MIN_RESPONSE_DELAY;
  console.log(`[🕐 ANTI-BAN] Waiting ${(delay/1000).toFixed(1)}s before responding...`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function sendWithTyping(chat, message) {
  try {
    await chat.sendStateTyping();
    await humanDelay();
    await chat.sendMessage(message);
    await chat.clearState();
  } catch (error) {
    console.log('[⚠️ ANTI-BAN] Typing state failed, using simple delay');
    await humanDelay();
    await chat.sendMessage(message);
  }
}

// ========== WHATSAPP CLIENT ==========
const WWEBJS_EXECUTABLE = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
  puppeteer: {
    headless: true,
    executablePath: WWEBJS_EXECUTABLE,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  },
  qrMaxRetries: 3,
  qrTimeout: 0,
  authTimeout: 0,
});

// ========== ESTADO GLOBAL ==========
let BARBERIA_CONFIG = null;
let BARBEROS = {}; // { nombre: { telefono, horario, especialidades, estado, bloques } }
let CITAS = []; // Array de todas las citas
let WAITLIST = []; // Lista de espera
let CLIENTES = {}; // Base de datos de clientes { telefono: { nombre, historial, preferencias } }
const userStates = new Map();
let BOT_PAUSED_GLOBAL = false;
let BOT_PAUSED_CHATS = new Set();

// ========== FUNCIONES AUXILIARES ==========
function now() {
  return DateTime.now().setZone(TIMEZONE);
}

function parseDate(dateStr) {
  return DateTime.fromISO(dateStr, { zone: TIMEZONE });
}

function formatTime(dt) {
  return dt.toFormat('h:mm a');
}

function formatDate(dt) {
  return dt.toFormat('EEEE d \'de\' MMMM', { locale: 'es' });
}

// ========== INICIALIZACIÓN DE ARCHIVOS ==========
async function initDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'session'), { recursive: true });
  await fs.mkdir(PROMPTS_DIR, { recursive: true });
  
  const files = {
    [BOOKINGS_FILE]: [],
    [WAITLIST_FILE]: [],
    [BARBERS_FILE]: {},
    [CLIENTS_FILE]: {},
    [SCHEDULED_MESSAGES_FILE]: []
  };
  
  for (const [file, defaultContent] of Object.entries(files)) {
    if (!fssync.existsSync(file)) {
      await fs.writeFile(file, JSON.stringify(defaultContent, null, 2), 'utf-8');
      console.log(`✅ Creado: ${path.basename(file)}`);
    }
  }
  
  await cargarDatos();
}

async function cargarDatos() {
  try {
    CITAS = JSON.parse(await fs.readFile(BOOKINGS_FILE, 'utf-8'));
    WAITLIST = JSON.parse(await fs.readFile(WAITLIST_FILE, 'utf-8'));
    BARBEROS = JSON.parse(await fs.readFile(BARBERS_FILE, 'utf-8'));
    CLIENTES = JSON.parse(await fs.readFile(CLIENTS_FILE, 'utf-8'));
    console.log('✅ Datos cargados correctamente');
  } catch (error) {
    console.error('❌ Error cargando datos:', error.message);
  }
}

async function guardarCitas() {
  await fs.writeFile(BOOKINGS_FILE, JSON.stringify(CITAS, null, 2), 'utf-8');
}

async function guardarWaitlist() {
  await fs.writeFile(WAITLIST_FILE, JSON.stringify(WAITLIST, null, 2), 'utf-8');
}

async function guardarBarberos() {
  await fs.writeFile(BARBERS_FILE, JSON.stringify(BARBEROS, null, 2), 'utf-8');
}

async function guardarClientes() {
  await fs.writeFile(CLIENTS_FILE, JSON.stringify(CLIENTES, null, 2), 'utf-8');
}

async function cargarConfigBarberia() {
  try {
    const raw = await fs.readFile(BARBERIA_CONFIG_PATH, 'utf-8');
    BARBERIA_CONFIG = JSON.parse(raw);
    console.log(`✅ Config barbería cargada: ${BARBERIA_CONFIG.negocio.nombre}`);
  } catch (error) {
    console.error('❌ Error cargando config barbería:', error.message);
  }
}

// ========== GESTIÓN DE CLIENTES ==========
function getOrCreateClient(telefono, nombre = null) {
  if (!CLIENTES[telefono]) {
    CLIENTES[telefono] = {
      nombre: nombre || 'Cliente',
      telefono,
      historial: [],
      preferencias: {
        barbero: null,
        servicio: null
      },
      primeraVisita: now().toISO(),
      ultimaVisita: now().toISO(),
      totalCitas: 0,
      totalCancelaciones: 0
    };
    guardarClientes();
  } else if (nombre && CLIENTES[telefono].nombre === 'Cliente') {
    CLIENTES[telefono].nombre = nombre;
    guardarClientes();
  }
  return CLIENTES[telefono];
}

function esClienteRecurrente(telefono) {
  const cliente = CLIENTES[telefono];
  return cliente && cliente.totalCitas > 0;
}

function registrarAccionCliente(telefono, accion, detalles = {}) {
  const cliente = getOrCreateClient(telefono);
  cliente.historial.push({
    fecha: now().toISO(),
    accion,
    ...detalles
  });
  cliente.ultimaVisita = now().toISO();
  guardarClientes();
}

// ========== GESTIÓN DE BARBEROS ==========
function obtenerBarberosDisponibles() {
  return Object.entries(BARBEROS)
    .filter(([nombre, data]) => data.estado !== 'cerrado')
    .map(([nombre, data]) => ({
      nombre,
      estado: data.estado,
      especialidades: data.especialidades || []
    }));
}

function obtenerEstadoBarbero(nombreBarbero) {
  const barbero = BARBEROS[nombreBarbero];
  if (!barbero) return 'no_existe';
  
  const ahora = now();
  const horaActual = ahora.hour * 60 + ahora.minute;
  
  // Verificar si está en descanso
  if (barbero.estado === 'descanso') return 'descanso';
  
  // Verificar si está cerrado
  if (barbero.estado === 'cerrado') return 'cerrado';
  
  // Verificar bloques de tiempo
  if (barbero.bloques) {
    for (const bloque of barbero.bloques) {
      const [inicioH, inicioM] = bloque.inicio.split(':').map(Number);
      const [finH, finM] = bloque.fin.split(':').map(Number);
      const inicioMin = inicioH * 60 + inicioM;
      const finMin = finH * 60 + finM;
      
      if (horaActual >= inicioMin && horaActual <= finMin) {
        return 'bloqueado';
      }
    }
  }
  
  // Verificar si tiene cita ahora
  const citaActual = CITAS.find(c => {
    if (c.barbero !== nombreBarbero || c.estado === 'cancelada') return false;
    const citaDT = parseDate(`${c.fecha}T${c.hora_inicio}`);
    const diff = ahora.diff(citaDT, 'minutes').minutes;
    return diff >= 0 && diff < (c.duracion || 30);
  });
  
  if (citaActual) return 'en_cita';
  
  return 'disponible';
}

// ========== GESTIÓN DE CITAS ==========
function obtenerCitasDelDia(fecha = null, barbero = null) {
  const fechaBuscar = fecha || now().toFormat('yyyy-MM-dd');
  return CITAS.filter(c => {
    if (c.estado === 'cancelada') return false;
    if (c.fecha !== fechaBuscar) return false;
    if (barbero && c.barbero !== barbero) return false;
    return true;
  });
}

function verificarDisponibilidad(fecha, hora, duracion, barbero = null) {
  const horaSolicitada = parseDate(`${fecha}T${hora}`);
  const horaFin = horaSolicitada.plus({ minutes: duracion });
  
  const citasDelDia = obtenerCitasDelDia(fecha, barbero);
  
  for (const cita of citasDelDia) {
    const citaInicio = parseDate(`${cita.fecha}T${cita.hora_inicio}`);
    const citaFin = citaInicio.plus({ minutes: cita.duracion || 30 });
    
    // Verificar solapamiento
    if (horaSolicitada < citaFin && horaFin > citaInicio) {
      return false;
    }
  }
  
  return true;
}

function obtenerProximosSlots(fecha = null, cantidad = 3, servicio = null) {
  const fechaBuscar = fecha || now().toFormat('yyyy-MM-dd');
  const ahora = now();
  const duracion = servicio ? (BARBERIA_CONFIG.servicios[servicio]?.min || 30) : 30;
  
  const slots = [];
  const horarioHoy = obtenerHorarioDelDia(ahora.weekday);
  
  if (!horarioHoy) return [];
  
  const [aperturaH, aperturaM] = horarioHoy.inicio.split(':').map(Number);
  const [cierreH, cierreM] = horarioHoy.fin.split(':').map(Number);
  
  let horaActual = DateTime.fromObject({ 
    year: ahora.year, 
    month: ahora.month, 
    day: ahora.day,
    hour: aperturaH,
    minute: aperturaM
  }, { zone: TIMEZONE });
  
  const horaCierre = DateTime.fromObject({ 
    year: ahora.year, 
    month: ahora.month, 
    day: ahora.day,
    hour: cierreH,
    minute: cierreM
  }, { zone: TIMEZONE });
  
  // Si es hoy, comenzar desde la hora actual + 30 minutos
  if (fechaBuscar === ahora.toFormat('yyyy-MM-dd')) {
    horaActual = ahora.plus({ minutes: 30 });
    // Redondear a la siguiente media hora
    if (horaActual.minute < 30) {
      horaActual = horaActual.set({ minute: 30 });
    } else {
      horaActual = horaActual.plus({ hours: 1 }).set({ minute: 0 });
    }
  }
  
  while (horaActual < horaCierre && slots.length < cantidad) {
    const hora = horaActual.toFormat('HH:mm');
    
    // Saltar almuerzo
    const horaNum = horaActual.hour;
    if (BARBERIA_CONFIG.horario.almuerzo && 
        horaNum >= BARBERIA_CONFIG.horario.almuerzo.start && 
        horaNum < BARBERIA_CONFIG.horario.almuerzo.end) {
      horaActual = horaActual.plus({ minutes: 30 });
      continue;
    }
    
    // Verificar disponibilidad
    if (verificarDisponibilidad(fechaBuscar, hora, duracion)) {
      slots.push(formatTime(horaActual));
    }
    
    horaActual = horaActual.plus({ minutes: 30 });
  }
  
  return slots;
}

function obtenerHorarioDelDia(diaSemana) {
  // diaSemana: 1-7 (1=Lunes, 7=Domingo)
  const config = BARBERIA_CONFIG.horario;
  
  if (diaSemana >= 1 && diaSemana <= 5) {
    // Lunes a Viernes
    const [inicio, fin] = config.lun_vie.split(' - ');
    return { inicio: convertirA24h(inicio), fin: convertirA24h(fin) };
  } else if (diaSemana === 6) {
    // Sábado
    const [inicio, fin] = config.sab.split(' - ');
    return { inicio: convertirA24h(inicio), fin: convertirA24h(fin) };
  } else {
    // Domingo
    const [inicio, fin] = config.dom.split(' - ');
    return { inicio: convertirA24h(inicio), fin: convertirA24h(fin) };
  }
}

function convertirA24h(hora12) {
  const match = hora12.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return hora12;
  
  let [, h, m, periodo] = match;
  h = parseInt(h);
  m = parseInt(m);
  
  if (periodo.toUpperCase() === 'PM' && h !== 12) h += 12;
  if (periodo.toUpperCase() === 'AM' && h === 12) h = 0;
  
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function crearCita(datos) {
  const { nombreCliente, servicio, fecha, hora_inicio, barbero, telefono } = datos;
  
  // Obtener duración del servicio
  const duracion = BARBERIA_CONFIG.servicios[servicio]?.min || 30;
  
  // Verificar disponibilidad
  if (!verificarDisponibilidad(fecha, hora_inicio, duracion, barbero)) {
    return { error: 'Ese horario ya no está disponible' };
  }
  
  const cita = {
    id: `CITA-${Date.now()}`,
    nombreCliente,
    telefono,
    servicio,
    fecha,
    hora_inicio,
    duracion,
    barbero: barbero || 'Cualquiera',
    estado: 'confirmada',
    createdAt: now().toISO(),
    notificaciones: {
      recordatorio: false,
      review: false
    }
  };
  
  CITAS.push(cita);
  await guardarCitas();
  
  // Registrar en historial del cliente
  const cliente = getOrCreateClient(telefono, nombreCliente);
  cliente.totalCitas++;
  if (barbero) cliente.preferencias.barbero = barbero;
  cliente.preferencias.servicio = servicio;
  registrarAccionCliente(telefono, 'cita_creada', { citaId: cita.id, servicio, fecha, hora_inicio });
  
  // Programar recordatorio (1 hora antes)
  await programarRecordatorio(cita);
  
  // Notificar al barbero (si es específico)
  if (barbero && barbero !== 'Cualquiera' && BARBEROS[barbero]) {
    await notificarBarbero(barbero, `📅 Nueva cita: ${nombreCliente} - ${servicio} - ${fecha} ${hora_inicio}`);
  }
  
  // Notificar al dueño
  await notificarDueno(`📅 *NUEVA CITA*\n\n👤 Cliente: ${nombreCliente}\n💇 Servicio: ${servicio}\n📆 Fecha: ${fecha}\n🕐 Hora: ${hora_inicio}\n👨‍🦲 Barbero: ${barbero || 'Cualquiera'}`);
  
  return { success: true, cita };
}

async function cancelarCita(nombreCliente, fecha, hora_inicio) {
  const cita = CITAS.find(c => 
    c.nombreCliente.toLowerCase() === nombreCliente.toLowerCase() &&
    c.fecha === fecha &&
    c.hora_inicio === hora_inicio &&
    c.estado !== 'cancelada'
  );
  
  if (!cita) {
    return { error: 'No encontré esa cita' };
  }
  
  cita.estado = 'cancelada';
  cita.canceladaAt = now().toISO();
  await guardarCitas();
  
  // Registrar en historial del cliente
  if (cita.telefono) {
    const cliente = CLIENTES[cita.telefono];
    if (cliente) {
      cliente.totalCancelaciones++;
      registrarAccionCliente(cita.telefono, 'cita_cancelada', { citaId: cita.id });
    }
  }
  
  // Notificar al barbero
  if (cita.barbero && cita.barbero !== 'Cualquiera' && BARBEROS[cita.barbero]) {
    await notificarBarbero(cita.barbero, `❌ Cita cancelada: ${nombreCliente} - ${fecha} ${hora_inicio}`);
  }
  
  // Notificar al dueño
  await notificarDueno(`❌ *CITA CANCELADA*\n\n👤 Cliente: ${nombreCliente}\n📆 Fecha: ${fecha}\n🕐 Hora: ${hora_inicio}`);
  
  // Revisar waitlist
  await procesarWaitlist(fecha);
  
  return { success: true, cita };
}

// ========== WAITLIST (LISTA DE ESPERA) ==========
async function agregarAWaitlist(telefono, nombreCliente, servicio, fecha) {
  const entrada = {
    id: `WAIT-${Date.now()}`,
    telefono,
    nombreCliente,
    servicio,
    fecha,
    createdAt: now().toISO()
  };
  
  WAITLIST.push(entrada);
  await guardarWaitlist();
  
  registrarAccionCliente(telefono, 'waitlist_agregado', { servicio, fecha });
  
  return entrada;
}

async function procesarWaitlist(fecha) {
  const enEspera = WAITLIST.filter(w => w.fecha === fecha);
  
  if (enEspera.length === 0) return;
  
  // Obtener slots disponibles
  const slotsDisponibles = obtenerProximosSlots(fecha, 5);
  
  if (slotsDisponibles.length === 0) return;
  
  // Notificar al primero en la lista
  const primero = enEspera[0];
  const horaDisponible = slotsDisponibles[0];
  
  try {
    const chat = await client.getChatById(primero.telefono);
    await sendWithTyping(chat, 
      `¡Hola ${primero.nombreCliente}! 🎉\n\nSe liberó un espacio para *${primero.servicio}* hoy a las *${horaDisponible}*.\n\n¿Lo tomas? Responde *Sí* o *No*`
    );
    
    // Marcar como reserva provisional por 2 minutos
    setTimeout(() => {
      // Si no ha confirmado, pasar al siguiente
      const estaEnWaitlist = WAITLIST.find(w => w.id === primero.id);
      if (estaEnWaitlist) {
        WAITLIST = WAITLIST.filter(w => w.id !== primero.id);
        guardarWaitlist();
        procesarWaitlist(fecha); // Intentar con el siguiente
      }
    }, 120000); // 2 minutos
    
  } catch (error) {
    console.error('Error notificando waitlist:', error.message);
  }
}

// ========== RECORDATORIOS Y NOTIFICACIONES ==========
async function programarRecordatorio(cita) {
  const citaDT = parseDate(`${cita.fecha}T${cita.hora_inicio}`);
  const recordatorioTime = citaDT.minus({ hours: 1 });
  
  const ahora = now();
  const diff = recordatorioTime.diff(ahora, 'milliseconds').milliseconds;
  
  if (diff > 0 && diff < 86400000) { // Menos de 24 horas
    setTimeout(async () => {
      try {
        const chat = await client.getChatById(cita.telefono);
        await sendWithTyping(chat, 
          `🔔 *Recordatorio*\n\nHola ${cita.nombreCliente}! Te esperamos en 1 hora para tu *${cita.servicio}*.\n\n📍 ${BARBERIA_CONFIG.negocio.direccion}\n🕐 ${cita.hora_inicio}\n\n¡Nos vemos pronto! 😊`
        );
        
        cita.notificaciones.recordatorio = true;
        await guardarCitas();
      } catch (error) {
        console.error('Error enviando recordatorio:', error.message);
      }
    }, diff);
  }
  
  // Programar solicitud de review (2 días después)
  const reviewTime = citaDT.plus({ days: 2 });
  const reviewDiff = reviewTime.diff(ahora, 'milliseconds').milliseconds;
  
  if (reviewDiff > 0 && reviewDiff < 172800000) { // Menos de 2 días
    setTimeout(async () => {
      try {
        const chat = await client.getChatById(cita.telefono);
        await sendWithTyping(chat, 
          `¡Hola ${cita.nombreCliente}! 😊\n\nEsperamos que hayas quedado contento con tu ${cita.servicio}.\n\n¿Nos ayudas con una reseña? ⭐️\n${GOOGLE_REVIEW_LINK}\n\n¡Gracias por preferirnos!`
        );
        
        cita.notificaciones.review = true;
        await guardarCitas();
      } catch (error) {
        console.error('Error enviando solicitud de review:', error.message);
      }
    }, reviewDiff);
  }
}

async function notificarBarbero(nombreBarbero, mensaje) {
  const barbero = BARBEROS[nombreBarbero];
  if (!barbero || !barbero.telefono) return;
  
  try {
    const chat = await client.getChatById(barbero.telefono);
    await sendWithTyping(chat, mensaje);
  } catch (error) {
    console.error(`Error notificando a barbero ${nombreBarbero}:`, error.message);
  }
}

async function notificarDueno(mensaje, contextChatId = null) {
  try {
    const chat = await client.getChatById(OWNER_CHAT_ID);
    let fullMsg = mensaje;
    if (contextChatId) {
      fullMsg += `\n\n💬 Chat: ${contextChatId}`;
    }
    await sendWithTyping(chat, fullMsg);
  } catch (error) {
    console.error('Error notificando al dueño:', error.message);
  }
}

// ========== COMANDOS PARA BARBEROS Y DUEÑO ==========
async function handleCommand(command, args, userId) {
  const esOwner = userId === OWNER_CHAT_ID;
  const esBarbero = Object.values(BARBEROS).some(b => b.telefono === userId);
  
  switch (command) {
    // ========== COMANDOS DEL DUEÑO ==========
    case '/ayuda':
    case '/help':
      if (esOwner) {
        return `📋 *COMANDOS DISPONIBLES*\n\n` +
          `*Gestión General:*\n` +
          `/panel - Ver panel de control\n` +
          `/pausar - Pausar bot en este chat\n` +
          `/pausar todo - Pausar bot en todos los chats\n` +
          `/iniciar - Reactivar bot en este chat\n` +
          `/iniciar todo - Reactivar bot en todos los chats\n\n` +
          `*Barberos:*\n` +
          `/barberos - Lista de barberos y estados\n` +
          `/disponibilidad [nombre] - Ver disponibilidad de un barbero\n\n` +
          `*Citas:*\n` +
          `/citas general - Todas las citas de hoy\n` +
          `/citas [nombre] - Citas de un barbero específico\n` +
          `/agendar [nombre] [servicio] [hora] - Crear cita manual (walk-in)\n\n` +
          `*Configuración:*\n` +
          `/cerrar [hora inicial]-[hora final] - Bloquear horario\n` +
          `/abrir [hora inicial]-[hora final] - Liberar horario bloqueado`;
      } else if (esBarbero) {
        const nombreBarbero = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
        return `📋 *COMANDOS DISPONIBLES (Barbero)*\n\n` +
          `/citas - Tus citas de hoy\n` +
          `/disponibilidad - Tu horario de hoy\n` +
          `/descanso iniciar - Iniciar descanso\n` +
          `/descanso terminar - Terminar descanso\n` +
          `/cerrar [hora]-[hora] - Bloquear horario\n` +
          `/abrir [hora]-[hora] - Liberar horario`;
      }
      return 'Comando no disponible para tu rol.';
    
    case '/panel':
      if (!esOwner) return 'Solo el dueño puede acceder al panel.';
      return `📊 *Panel de Control*\n\n${PANEL_URL}\n\n✅ Desde ahí puedes ver todas las estadísticas y gestionar citas.`;
    
    case '/pausar':
      if (!esOwner) return 'Solo el dueño puede pausar el bot.';
      if (args[0] === 'todo') {
        // Solicitar confirmación
        return '⚠️ *¿Estás seguro?*\n\nEsto pausará el bot en *TODOS* los chats.\n\nResponde *Sí* para confirmar o *No* para cancelar.';
      } else {
        BOT_PAUSED_CHATS.add(userId);
        return '⏸ Bot pausado en este chat. Usa /iniciar para reactivarlo.';
      }
    
    case '/iniciar':
      if (!esOwner) return 'Solo el dueño puede iniciar el bot.';
      if (args[0] === 'todo') {
        BOT_PAUSED_GLOBAL = false;
        BOT_PAUSED_CHATS.clear();
        return '▶️ Bot reactivado en todos los chats.';
      } else {
        BOT_PAUSED_CHATS.delete(userId);
        return '▶️ Bot reactivado en este chat.';
      }
    
    case '/barberos':
      const barberosDisponibles = obtenerBarberosDisponibles();
      let lista = '*👨‍🦲 BARBEROS*\n\n';
      for (const [nombre, data] of Object.entries(BARBEROS)) {
        const estado = obtenerEstadoBarbero(nombre);
        const emoji = estado === 'disponible' ? '🟢' : 
                      estado === 'en_cita' ? '🔴' : 
                      estado === 'descanso' ? '🟡' : '⚫';
        const estadoTxt = estado === 'disponible' ? 'Disponible' :
                          estado === 'en_cita' ? 'En cita' :
                          estado === 'descanso' ? 'En descanso' : 'Cerrado';
        lista += `${emoji} *${nombre}* - ${estadoTxt}\n`;
        if (data.especialidades && data.especialidades.length > 0) {
          lista += `   Especialidades: ${data.especialidades.join(', ')}\n`;
        }
        lista += '\n';
      }
      return lista;
    
    case '/citas':
      const argCitas = args.join(' ').toLowerCase();
      if (argCitas === 'general' && esOwner) {
        const citasHoy = obtenerCitasDelDia();
        if (citasHoy.length === 0) {
          return '📅 No hay citas agendadas para hoy.';
        }
        let msg = `📅 *CITAS DE HOY (${now().toFormat('d/M/yyyy')})*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `🕐 ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   💇 ${cita.servicio}\n`;
          msg += `   👨‍🦲 ${cita.barbero}\n\n`;
        }
        return msg;
      } else if (esBarbero) {
        const nombreBarbero = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
        const citasHoy = obtenerCitasDelDia(null, nombreBarbero);
        if (citasHoy.length === 0) {
          return '📅 No tienes citas agendadas para hoy.';
        }
        let msg = `📅 *TUS CITAS DE HOY*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `🕐 ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   💇 ${cita.servicio}\n\n`;
        }
        return msg;
      } else if (esOwner && args.length > 0) {
        // Ver citas de un barbero específico
        const nombreBarbero = args.join(' ');
        const citasHoy = obtenerCitasDelDia(null, nombreBarbero);
        if (citasHoy.length === 0) {
          return `📅 ${nombreBarbero} no tiene citas agendadas para hoy.`;
        }
        let msg = `📅 *CITAS DE ${nombreBarbero.toUpperCase()} HOY*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `🕐 ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   💇 ${cita.servicio}\n\n`;
        }
        return msg;
      }
      return 'Uso: /citas general o /citas [nombre barbero]';
    
    case '/agendar':
      if (!esOwner && !esBarbero) return 'No tienes permiso para usar este comando.';
      if (args.length < 3) return 'Uso: /agendar [nombre] [servicio] [hora]\nEjemplo: /agendar Juan Corte 4:30pm';
      
      const nombreCliente = args[0];
      const servicio = args[1];
      const horaStr = args[2];
      
      // Convertir hora a formato 24h
      const hora24 = convertirA24h(horaStr);
      const fechaHoy = now().toFormat('yyyy-MM-dd');
      
      // Obtener barbero (si es barbero quien ejecuta el comando, usar su nombre)
      let barberoAsignado = 'Cualquiera';
      if (esBarbero) {
        barberoAsignado = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
      }
      
      const resultado = await crearCita({
        nombreCliente,
        servicio,
        fecha: fechaHoy,
        hora_inicio: hora24,
        barbero: barberoAsignado,
        telefono: `WALKIN-${Date.now()}@c.us` // Teléfono temporal para walk-ins
      });
      
      if (resultado.error) {
        return `❌ ${resultado.error}`;
      }
      
      return `✅ Cita creada:\n*${nombreCliente}* - ${servicio}\n📆 Hoy a las ${horaStr}`;
    
    case '/disponibilidad':
      if (esBarbero) {
        const nombreBarbero = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
        const horario = obtenerHorarioDelDia(now().weekday);
        const slots = obtenerProximosSlots(null, 10);
        return `📅 *Tu horario de hoy*\n\n` +
          `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.join('\n')}`;
      } else if (esOwner && args.length > 0) {
        const nombreBarbero = args.join(' ');
        const horario = obtenerHorarioDelDia(now().weekday);
        const slots = obtenerProximosSlots(null, 10);
        return `📅 *Horario de ${nombreBarbero}*\n\n` +
          `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.join('\n')}`;
      }
      return 'Uso: /disponibilidad [nombre barbero]';
    
    case '/descanso':
      if (!esBarbero && !esOwner) return 'Solo los barberos pueden usar este comando.';
      
      const nombreBarbero = esBarbero ? 
        Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId) :
        args[1];
      
      if (!nombreBarbero || !BARBEROS[nombreBarbero]) {
        return 'Barbero no encontrado.';
      }
      
      if (args[0] === 'iniciar') {
        BARBEROS[nombreBarbero].estado = 'descanso';
        await guardarBarberos();
        return `☕️ Descanso iniciado para ${nombreBarbero}. Las nuevas consultas se asignarán a otros barberos.`;
      } else if (args[0] === 'terminar') {
        BARBEROS[nombreBarbero].estado = 'disponible';
        await guardarBarberos();
        return `✅ Descanso terminado. ${nombreBarbero} está disponible nuevamente.`;
      }
      return 'Uso: /descanso iniciar [nombre] o /descanso terminar [nombre]';
    
    case '/cerrar':
      if (!esOwner && !esBarbero) return 'No tienes permiso para usar este comando.';
      if (args.length === 0) return 'Uso: /cerrar [hora inicial]-[hora final]\nEjemplo: /cerrar 3pm-5pm';
      
      const rangoStr = args[0];
      const [inicioStr, finStr] = rangoStr.split('-');
      
      if (!inicioStr || !finStr) {
        return 'Formato incorrecto. Usa: /cerrar 3pm-5pm';
      }
      
      const inicioBloque = convertirA24h(inicioStr);
      const finBloque = convertirA24h(finStr);
      
      // Preguntar si es solo por hoy o todos los días
      return `⚠️ *Bloquear horario ${inicioStr} - ${finStr}*\n\n¿Solo por hoy o para todos los días?\n\nResponde *Hoy* o *Todos*`;
    
    case '/abrir':
      if (!esOwner && !esBarbero) return 'No tienes permiso para usar este comando.';
      if (args.length === 0) return 'Uso: /abrir [hora inicial]-[hora final]\nEjemplo: /abrir 3pm-5pm';
      
      const rangoAbrir = args[0];
      const [inicioAbrirStr, finAbrirStr] = rangoAbrir.split('-');
      
      if (!inicioAbrirStr || !finAbrirStr) {
        return 'Formato incorrecto. Usa: /abrir 3pm-5pm';
      }
      
      return `✅ Horario ${inicioAbrirStr} - ${finAbrirStr} liberado.`;
    
    default:
      return null;
  }
}

// ========== DETECCIÓN DE IDIOMA ==========
function detectarIdioma(mensaje) {
  const palabrasIngles = ['hello', 'hi', 'hey', 'appointment', 'booking', 'schedule', 'haircut', 'how much', 'price', 'when', 'where', 'can i', 'i want', 'i need', 'thank you', 'thanks'];
  const palabrasEspanol = ['hola', 'buenos', 'cita', 'agendar', 'corte', 'cuanto', 'precio', 'cuando', 'donde', 'puedo', 'quiero', 'necesito', 'gracias'];
  
  const mensajeMin = mensaje.toLowerCase();
  
  const contadorIngles = palabrasIngles.filter(p => mensajeMin.includes(p)).length;
  const contadorEspanol = palabrasEspanol.filter(p => mensajeMin.includes(p)).length;
  
  if (contadorIngles > contadorEspanol) {
    return 'en';
  }
  return 'es';
}

// ========== PROCESAMIENTO CON IA ==========
function getUserState(userId) {
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      conversationHistory: [],
      botEnabled: true,
      lastInteraction: Date.now(),
      idioma: 'es'
    });
  }
  return userStates.get(userId);
}

async function chatWithAI(userMessage, userId, chatId) {
  const state = getUserState(userId);
  const cliente = getOrCreateClient(userId);
  
  // Detectar idioma
  state.idioma = detectarIdioma(userMessage);
  
  // Verificar si el bot está pausado
  if (BOT_PAUSED_GLOBAL || BOT_PAUSED_CHATS.has(chatId)) {
    return null;
  }
  
  // Manejar comandos
  if (userMessage.startsWith('/')) {
    const [command, ...args] = userMessage.split(' ');
    const respuesta = await handleCommand(command, args, chatId);
    if (respuesta) return respuesta;
  }
  
  // Construir contexto del cliente
  let contextoCliente = '';
  if (esClienteRecurrente(userId)) {
    contextoCliente = `\n\n🔔 CLIENTE RECURRENTE: ${cliente.nombre} (${cliente.totalCitas} citas anteriores)`;
    if (cliente.preferencias.servicio) {
      contextoCliente += `\nÚltimo servicio: ${cliente.preferencias.servicio}`;
    }
    if (cliente.preferencias.barbero) {
      contextoCliente += `\nBarbero preferido: ${cliente.preferencias.barbero}`;
    }
  }
  
  // Obtener slots disponibles
  const slotsHoy = obtenerProximosSlots(null, 5);
  const slotsTxt = slotsHoy.length > 0 ? slotsHoy.join(', ') : 'No hay horarios disponibles hoy';
  
  // Construir lista de servicios
  const serviciosTxt = Object.entries(BARBERIA_CONFIG.servicios)
    .map(([nombre, data]) => `• ${nombre} - $${data.precio.toLocaleString()} (${data.min} min)`)
    .join('\n');
  
  // Construir lista de barberos
  const barberosTxt = Object.entries(BARBEROS)
    .map(([nombre, data]) => {
      const estado = obtenerEstadoBarbero(nombre);
      const especialidades = data.especialidades ? ` (${data.especialidades.join(', ')})` : '';
      return `• ${nombre}${especialidades} - ${estado}`;
    })
    .join('\n');
  
  // Sistema prompt
  const ahora = now();
  const fechaISO = ahora.toFormat('yyyy-MM-dd');
  const horaActual = ahora.toFormat('HH:mm');
  const diaSemanaTxt = ahora.toFormat('cccc', { locale: 'es' });
  const horarioHoy = obtenerHorarioDelDia(ahora.weekday);
  const horarioHoyTxt = horarioHoy ? `${horarioHoy.inicio} - ${horarioHoy.fin}` : 'Cerrado';
  
  let systemPrompt = BARBERIA_CONFIG.system_prompt || '';
  
  // Reemplazar variables
  systemPrompt = systemPrompt
    .replace(/{hoy}/g, fechaISO)
    .replace(/{horaActual}/g, horaActual)
    .replace(/{diaSemana}/g, diaSemanaTxt)
    .replace(/{nombreBarberia}/g, BARBERIA_CONFIG.negocio.nombre)
    .replace(/{direccionBarberia}/g, BARBERIA_CONFIG.negocio.direccion)
    .replace(/{telefonoBarberia}/g, BARBERIA_CONFIG.negocio.telefono)
    .replace(/{horarioHoy}/g, horarioHoyTxt)
    .replace(/{serviciosTxt}/g, serviciosTxt)
    .replace(/{slotsDisponiblesHoy}/g, slotsTxt)
    .replace(/{barberosTxt}/g, barberosTxt);
  
  // Agregar contexto del cliente
  systemPrompt += contextoCliente;
  
  // Si es en inglés, agregar instrucción
  if (state.idioma === 'en') {
    systemPrompt += '\n\n🌐 RESPONDE EN INGLÉS. El cliente está escribiendo en inglés.';
  }
  
  // Agregar mensaje del usuario al historial
  state.conversationHistory.push({ role: 'user', content: userMessage });
  
  // Limitar historial
  if (state.conversationHistory.length > 20) {
    state.conversationHistory = state.conversationHistory.slice(-20);
  }
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...state.conversationHistory
      ],
      temperature: 0.5,
      max_tokens: 500
    });
    
    let respuesta = (completion.choices?.[0]?.message?.content || '').trim() || 
      '¿Te ayudo con algo más?';
    
    // Procesar tags de booking/cancelación
    respuesta = await procesarTags(respuesta, userId, cliente.nombre);
    
    state.conversationHistory.push({ role: 'assistant', content: respuesta });
    
    return respuesta;
    
  } catch (e) {
    console.error('OpenAI error:', e.message);
    await notificarDueno(
      `❌ *ERROR OPENAI*\nUsuario: ${chatId}\nMsg: "${userMessage}"\n${e.message}`,
      chatId
    );
    return state.idioma === 'en' ? 
      'Sorry, something went wrong. Can you repeat that?' :
      'Uy, se me enredó algo aquí. ¿Me repites porfa? 🙏';
  }
}

async function procesarTags(respuesta, userId, nombreCliente) {
  // Detectar tag <BOOKING:...>
  const bookingMatch = respuesta.match(/<BOOKING:(.+?)>/);
  if (bookingMatch) {
    try {
      const jsonStr = bookingMatch[1].trim();
      const datos = JSON.parse(jsonStr);
      
      datos.telefono = userId;
      datos.nombreCliente = datos.nombreCliente || nombreCliente;
      
      const resultado = await crearCita(datos);
      
      if (resultado.error) {
        respuesta = respuesta.replace(/<BOOKING:.+?>/, `\n\n❌ ${resultado.error}`);
      } else {
        respuesta = respuesta.replace(/<BOOKING:.+?>/, '');
      }
    } catch (e) {
      console.error('Error procesando BOOKING:', e.message);
      respuesta = respuesta.replace(/<BOOKING:.+?>/, '\n\n❌ Error al crear la cita');
    }
  }
  
  // Detectar tag <CANCELLED:...>
  const cancelMatch = respuesta.match(/<CANCELLED:(.+?)>/);
  if (cancelMatch) {
    try {
      const jsonStr = cancelMatch[1].trim();
      const datos = JSON.parse(jsonStr);
      
      const resultado = await cancelarCita(datos.nombreCliente, datos.fecha, datos.hora_inicio);
      
      if (resultado.error) {
        respuesta = respuesta.replace(/<CANCELLED:.+?>/, `\n\n❌ ${resultado.error}`);
      } else {
        respuesta = respuesta.replace(/<CANCELLED:.+?>/, '');
      }
    } catch (e) {
      console.error('Error procesando CANCELLED:', e.message);
      respuesta = respuesta.replace(/<CANCELLED:.+?>/, '\n\n❌ Error al cancelar la cita');
    }
  }
  
  return respuesta;
}

// ========== EXPRESS SERVER ==========
const app = express();
app.use(express.json());

let latestQR = null;

app.get('/', (req, res) => res.send('✅ Cortex Barbershop Bot is running! 💈'));

app.get('/qr', async (req, res) => {
  if (!latestQR) {
    const isAuthenticated = client && client.info && client.info.wid;
    
    if (isAuthenticated) {
      return res.send(`
        <!DOCTYPE html><html><head>
          <title>Cortex Barbershop Bot - Conectado</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #1a1a1a;
              color: #fff;
              padding: 20px;
              margin: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            .container { text-align: center; max-width: 500px; }
            h1 { color: #00ff00; margin-bottom: 20px; font-size: 28px; }
            .status {
              background: rgba(0, 255, 0, 0.1);
              border: 2px solid #00ff00;
              padding: 30px;
              border-radius: 15px;
              margin: 20px 0;
            }
            .checkmark {
              font-size: 64px;
              color: #00ff00;
              margin-bottom: 20px;
            }
          </style>
        </head><body>
          <div class="container">
            <h1>✅ CORTEX BARBERSHOP BOT</h1>
            <div class="status">
              <div class="checkmark">✓</div>
              <h2 style="color: #00ff00; margin: 0;">Sesión Activa</h2>
              <p style="margin-top: 10px; color: #ccc;">WhatsApp conectado correctamente</p>
            </div>
          </div>
        </body></html>
      `);
    }
    
    return res.send(`
      <!DOCTYPE html><html><head>
        <title>Cortex Barbershop Bot - Iniciando</title>
        <meta http-equiv="refresh" content="3">
        <style>
          body {
            font-family: monospace;
            background: #000;
            color: #0f0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            text-align: center;
            padding: 20px;
          }
          .spinner {
            border: 4px solid rgba(0, 255, 0, 0.1);
            border-top: 4px solid #0f0;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head><body>
        <div>
          <div class="spinner"></div>
          <h2>⏳ Iniciando Bot...</h2>
          <p>Generando código QR...</p>
        </div>
      </body></html>
    `);
  }

  try {
    const qrSVG = await QRCode.toString(latestQR, { 
      type: 'svg', 
      width: 400, 
      margin: 2 
    });
    
    res.send(`
      <!DOCTYPE html><html><head>
        <title>Cortex Barbershop Bot - Escanea QR</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="15">
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #1a1a1a;
            color: #fff;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          .container {
            text-align: center;
            max-width: 500px;
          }
          h1 { color: #00ff00; }
          .qr-container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            display: inline-block;
            margin: 20px 0;
          }
        </style>
      </head><body>
        <div class="container">
          <h1>💈 Cortex Barbershop Bot</h1>
          <p>Escanea el QR con WhatsApp:</p>
          <div class="qr-container">
            ${qrSVG}
          </div>
          <p><small>La página se actualizará automáticamente</small></p>
        </div>
      </body></html>
    `);
  } catch (error) {
    res.status(500).send('Error generando QR');
  }
});

// API endpoints para el panel
app.get('/api/citas', async (req, res) => {
  const { fecha, barbero } = req.query;
  let citas = CITAS.filter(c => c.estado !== 'cancelada');
  
  if (fecha) {
    citas = citas.filter(c => c.fecha === fecha);
  }
  
  if (barbero) {
    citas = citas.filter(c => c.barbero === barbero);
  }
  
  res.json(citas);
});

app.get('/api/stats', async (req, res) => {
  const hoy = now().toFormat('yyyy-MM-dd');
  const mesActual = now().toFormat('yyyy-MM');
  
  const citasHoy = CITAS.filter(c => c.fecha === hoy && c.estado !== 'cancelada');
  const citasMes = CITAS.filter(c => c.fecha.startsWith(mesActual) && c.estado !== 'cancelada');
  const canceladasMes = CITAS.filter(c => c.fecha.startsWith(mesActual) && c.estado === 'cancelada');
  
  // Servicios más pedidos
  const serviciosCount = {};
  for (const cita of citasMes) {
    serviciosCount[cita.servicio] = (serviciosCount[cita.servicio] || 0) + 1;
  }
  const serviciosMasPedidos = Object.entries(serviciosCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([servicio, count]) => ({ servicio, count }));
  
  // Clientes nuevos vs recurrentes
  const clientesUnicos = new Set(citasMes.map(c => c.telefono));
  const clientesNuevos = Array.from(clientesUnicos).filter(tel => {
    const cliente = CLIENTES[tel];
    return cliente && cliente.totalCitas === 1;
  }).length;
  const clientesRecurrentes = clientesUnicos.size - clientesNuevos;
  
  res.json({
    citasHoy: citasHoy.length,
    citasMes: citasMes.length,
    canceladasMes: canceladasMes.length,
    serviciosMasPedidos,
    clientesNuevos,
    clientesRecurrentes,
    totalClientes: Object.keys(CLIENTES).length
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor Express corriendo en puerto ${PORT}`);
});

// ========== WHATSAPP EVENTS ==========
client.on('qr', (qr) => {
  console.log('📱 Código QR generado!');
  console.log('🌐 Abre este link para escanear:');
  console.log(`\n   👉 http://localhost:${PORT}/qr\n`);
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Cliente de WhatsApp listo!');
  console.log(`💤 Notificaciones al dueño: ${OWNER_NUMBER}`);
  latestQR = null;
  
  await initDataFiles();
  await cargarConfigBarberia();
  
  console.log('📋 Estado del sistema:');
  console.log(`  - Barbería: ${BARBERIA_CONFIG?.negocio?.nombre || '❌'}`);
  console.log(`  - Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length}`);
  console.log(`  - Barberos: ${Object.keys(BARBEROS).length}`);
  console.log(`  - Citas activas: ${CITAS.filter(c => c.estado !== 'cancelada').length}`);
});

client.on('message', async (message) => {
  try {
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    const userMessage = (message.body || '').trim();
    
    if (!userMessage) return;
    
    console.log(`📩 Mensaje de ${userId}: ${userMessage}`);
    
    const respuesta = await chatWithAI(userMessage, userId, message.from);
    
    if (respuesta) {
      await humanDelay();
      await message.reply(respuesta);
    }
    
  } catch (e) {
    console.error('❌ Error procesando mensaje:', e.message);
    try {
      await notificarDueno(
        `❌ *ERROR HANDLER*\nUsuario: ${message.from}\nError: ${e.message}`,
        message.from
      );
    } catch (notifyError) {
      console.error('❌ Error notificando sobre error:', notifyError.message);
    }
  }
});

client.on('disconnected', (r) => { 
  console.log('❌ Cliente desconectado:', r); 
  latestQR = null;
});

client.on('auth_failure', (msg) => {
  console.error('❌ Fallo de autenticación:', msg);
  latestQR = null;
});

// ========== START ==========
console.log('🚀 Iniciando Cortex Barbershop Bot...');
console.log('🕐 Timezone:', TIMEZONE);
console.log('🕐 Hora actual:', now().toFormat('yyyy-MM-dd HH:mm:ss'));
console.log(`👤 Dueño: ${OWNER_NUMBER}`);
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => {
  console.error('❌ UNHANDLED REJECTION:', e);
});

process.on('uncaughtException', (e) => {
  console.error('❌ UNCAUGHT EXCEPTION:', e);
});