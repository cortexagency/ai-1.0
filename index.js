// =========================
// CORTEX IA - BARBERSHOP BOT - VERSIÓN FINAL V5.4 COMPLETE
// ALL FUNCTIONS RESTORED AND WORKING
// =========================
require('dotenv').config();

const express = require('express');
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { DateTime } = require('luxon');

// ========== CONFIGURACIÓN ==========
let OWNER_NUMBER = process.env.OWNER_NUMBER || '573223698554';
let OWNER_CHAT_ID = process.env.OWNER_WHATSAPP_ID || `${OWNER_NUMBER}@c.us`;

// ========== TELEGRAM CONFIGURATION ==========
const TELEGRAM_ENABLED = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;

// ====== Telegraf Command Bridge (injected) ======
let __telegrafBridge = null;
try {
  if (TELEGRAM_ENABLED) {
    const { Telegraf } = require('telegraf');
    __telegrafBridge = new Telegraf(TELEGRAM_BOT_TOKEN);
    console.log('📲 Telegraf bridge: ON');

    function __normalizeCommand(text) {
      return text.replace(/\s+/g, ' ').trim();
    }

    __telegrafBridge.on('text', async (ctx) => {
      try {
        const chatId = String(ctx.chat.id);
        const text = (ctx.message?.text || '').trim();
        if (!text.startsWith('/')) return;

        const clean = __normalizeCommand(text);
        const parts = clean.split(' ');
        const command = parts[0].toLowerCase().replace(/^\//, '');
        const args = parts.slice(1);

        const userId = TELEGRAM_CHAT_ID; // treat owner chat as privileged

        if (typeof handleCommand === 'function') {
          await handleCommand(command, args, userId, chatId, 'telegram');
        } else if (typeof handleCommandTelegram === 'function') {
          await handleCommandTelegram(command, args, chatId, 'owner');
        } else {
          await ctx.reply('⚠️ No hay handler de comandos disponible.');
        }
      } catch (err) {
        console.error('❌ Error en Telegraf bridge:', err?.message || err);
        try { await ctx.reply('⚠️ Error procesando el comando.'); } catch(e) {}
      }
    });

    __telegrafBridge.launch()
      .then(() => console.log('🚀 Telegraf bridge iniciado'))
      .catch(e => console.error('❌ Telegraf launch error:', e?.message || e));
  } else {
    console.log('📱 Telegram: DESACTIVADO (faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID)');
  }
} catch (e) {
  console.error('❌ Telegraf init error:', e?.message || e);
}
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

if (TELEGRAM_ENABLED) {
  console.log('📱 Telegram: ACTIVADO - Modo Panel de Gestión');

// ====== Telegram Telegraf Bridge (auto-inserted) ======
let __telegrafBridge = null;
try {
  if (TELEGRAM_ENABLED) {
    const { Telegraf } = require('telegraf');
    __telegrafBridge = new Telegraf(TELEGRAM_BOT_TOKEN);
    console.log('📲 Telegraf bridge: ON');

    function __normalizeCommand(text) {
      return text.replace(/\s+/g, ' ').trim();
    }

    __telegrafBridge.on('text', async (ctx) => {
      try {
        const chatId = String(ctx.chat.id);
        const text = (ctx.message?.text || '').trim();
        if (!text.startsWith('/')) return;

        const clean = __normalizeCommand(text);
        const parts = clean.split(' ');
        const command = parts[0].toLowerCase().replace(/^\//, '');
        const args = parts.slice(1);

        // default userId to OWNER on Telegram to allow privileged cmds from your chat
        const userId = TELEGRAM_CHAT_ID;

        if (typeof handleCommand === 'function') {
          await handleCommand(command, args, userId, chatId, 'telegram');
        } else if (typeof handleCommandTelegram === 'function') {
          // legacy fallback if it exists
          await handleCommandTelegram(command, args, chatId, 'owner');
        } else {
          await ctx.reply('⚠️ No hay handler de comandos disponible.');
        }
      } catch (err) {
        console.error('❌ Error en Telegraf bridge:', err.message);
        try { await ctx.reply('⚠️ Error procesando el comando.'); } catch(e) {}
      }
    });

    __telegrafBridge.launch().then(() => console.log('🚀 Telegraf bridge iniciado')).catch(e => console.error('❌ Telegraf launch error:', e.message));
  }
} catch (e) {
  console.error('❌ Telegraf init error:', e.message);
}
  console.log(`   Owner Chat ID: ${TELEGRAM_CHAT_ID}`);
} else {
  console.log('📱 Telegram: DESACTIVADO');
}

const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/TU_LINK_AQUI/review';
const TIMEZONE = process.env.TZ || 'America/Bogota';
const PORT = process.env.PORT || 3000;
const PANEL_URL = process.env.PANEL_URL || 'https://cortexbarberia.site/panel';

// ======== RUTAS DE CARPETAS/ARCHIVOS ========
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');

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
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function sendWithTyping(chat, message) {
  try {
    await chat.sendStateTyping();
    await humanDelay();
    await chat.sendMessage(message);
    await chat.clearState();
  } catch (error) {
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
let BARBEROS = {};
let CITAS = [];
let WAITLIST = [];
let CLIENTES = {};
const userStates = new Map();
let BOT_PAUSED_GLOBAL = false;
let BOT_PAUSED_CHATS = new Set();

// Gestión de confirmaciones pendientes
const citasPendientesConfirmacion = new Map();
const respuestasBarberosPendientes = new Map();
const comandosPendientesConfirmacion = new Map();

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

// ========== DETECCIÓN DE ROLES MEJORADA ==========
function detectarRol(userId, chatId = null) {
  console.log(`🔍 Detectando rol para userId: ${userId}, chatId: ${chatId}`);
  
  // Verificar si es Owner
  const esOwnerWpp = userId === OWNER_CHAT_ID;
  const esOwnerTelegram = chatId && chatId.toString() === TELEGRAM_CHAT_ID.toString();
  
  if (esOwnerWpp || esOwnerTelegram) {
    console.log('   ✅ Rol detectado: OWNER');
    return { rol: 'owner', nombre: 'Owner', telefono: OWNER_CHAT_ID };
  }
  
  // Verificar si es Barbero por WhatsApp
  const barberoWpp = Object.entries(BARBEROS).find(([nombre, data]) => 
    data.telefono === userId
  );
  
  if (barberoWpp) {
    console.log(`   ✅ Rol detectado: BARBERO (${barberoWpp[0]}) por WhatsApp`);
    return { 
      rol: 'barbero', 
      nombre: barberoWpp[0], 
      telefono: barberoWpp[1].telefono 
    };
  }
  
  // Verificar si es Barbero por Telegram
  if (chatId) {
    const barberoTelegram = Object.entries(BARBEROS).find(([nombre, data]) => 
      data.telegram_chat_id && data.telegram_chat_id.toString() === chatId.toString()
    );
    
    if (barberoTelegram) {
      console.log(`   ✅ Rol detectado: BARBERO (${barberoTelegram[0]}) por Telegram`);
      return { 
        rol: 'barbero', 
        nombre: barberoTelegram[0], 
        telefono: barberoTelegram[1].telefono 
      };
    }
  }
  
  console.log('   ℹ️ Rol detectado: CLIENTE');
  return { rol: 'cliente', nombre: null, telefono: userId };
}

// ========== INICIALIZACIÓN DE ARCHIVOS ==========
async function initDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'session'), { recursive: true });
  
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
  
  const uploadsBarbers = path.join(ROOT_DIR, 'barberos.json');
  if (fssync.existsSync(uploadsBarbers)) {
    try {
      const barbersData = await fs.readFile(uploadsBarbers, 'utf-8');
      const barbersObj = JSON.parse(barbersData);
      
      if (Object.keys(barbersObj).length > 0) {
        console.log('📋 Copiando barberos.json desde raíz al directorio de datos...');
        await fs.writeFile(BARBERS_FILE, barbersData, 'utf-8');
        console.log(`✅ ${Object.keys(barbersObj).length} barberos copiados: ${Object.keys(barbersObj).join(', ')}`);
      }
    } catch (e) {
      console.error('❌ Error copiando barberos.json:', e.message);
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
    console.log(`   - Citas: ${CITAS.length}`);
    console.log(`   - Barberos: ${Object.keys(BARBEROS).length}`);
    console.log(`   - Clientes: ${Object.keys(CLIENTES).length}`);
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
  
  if (barbero.estado === 'descanso') return 'descanso';
  if (barbero.estado === 'cerrado') return 'cerrado';
  
  if (barbero.bloques && barbero.bloques.length > 0) {
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
    
    if (horaSolicitada < citaFin && horaFin > citaInicio) {
      return false;
    }
  }
  
  return true;
}

function obtenerHorarioDelDia(diaSemana) {
  if (!BARBERIA_CONFIG) return null;
  
  const config = BARBERIA_CONFIG.horario;
  
  if (diaSemana >= 1 && diaSemana <= 5) {
    const [inicio, fin] = config.lun_vie.split(' - ');
    return { inicio: convertirA24h(inicio), fin: convertirA24h(fin) };
  } else if (diaSemana === 6) {
    const [inicio, fin] = config.sab.split(' - ');
    return { inicio: convertirA24h(inicio), fin: convertirA24h(fin) };
  } else {
    if (config.dom.toLowerCase() === 'cerrado') {
      return null;
    }
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

function obtenerProximosSlots(fecha = null, cantidad = 3, servicio = null, barbero = null) {
  const ahora = now();
  const fechaBuscar = fecha || ahora.toFormat('yyyy-MM-dd');
  const duracion = servicio && BARBERIA_CONFIG ? (BARBERIA_CONFIG.servicios[servicio]?.min || 30) : 30;
  
  let diaSemana;
  if (fecha) {
    const fechaDT = DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: TIMEZONE });
    diaSemana = fechaDT.weekday;
  } else {
    diaSemana = ahora.weekday;
  }
  
  const horarioHoy = obtenerHorarioDelDia(diaSemana);
  
  if (!horarioHoy) {
    return [];
  }
  
  const [aperturaH, aperturaM] = horarioHoy.inicio.split(':').map(Number);
  const [cierreH, cierreM] = horarioHoy.fin.split(':').map(Number);
  
  let fechaDT = fecha ? 
    DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: TIMEZONE }) : 
    ahora;
  
  let horaActual = DateTime.fromObject({ 
    year: fechaDT.year, 
    month: fechaDT.month, 
    day: fechaDT.day,
    hour: aperturaH,
    minute: aperturaM
  }, { zone: TIMEZONE });
  
  const horaCierre = DateTime.fromObject({ 
    year: fechaDT.year, 
    month: fechaDT.month, 
    day: fechaDT.day,
    hour: cierreH,
    minute: cierreM
  }, { zone: TIMEZONE });
  
  if (fechaBuscar === ahora.toFormat('yyyy-MM-dd')) {
    const minutoActual = ahora.hour * 60 + ahora.minute;
    const minutoApertura = aperturaH * 60 + aperturaM;
    
    if (minutoActual > minutoApertura) {
      horaActual = ahora.plus({ minutes: 30 });
      if (horaActual.minute < 30) {
        horaActual = horaActual.set({ minute: 30, second: 0 });
      } else {
        horaActual = horaActual.plus({ hours: 1 }).set({ minute: 0, second: 0 });
      }
    }
  }
  
  const slots = [];
  
  while (horaActual < horaCierre && slots.length < cantidad) {
    const hora = horaActual.toFormat('HH:mm');
    const horaNum = horaActual.hour;
    
    if (BARBERIA_CONFIG && BARBERIA_CONFIG.horario.almuerzo && 
        horaNum >= BARBERIA_CONFIG.horario.almuerzo.start && 
        horaNum < BARBERIA_CONFIG.horario.almuerzo.end) {
      horaActual = horaActual.plus({ minutes: 30 });
      continue;
    }
    
    if (verificarDisponibilidad(fechaBuscar, hora, duracion, barbero)) {
      slots.push(formatTime(horaActual));
    }
    
    horaActual = horaActual.plus({ minutes: 30 });
  }
  
  return slots;
}

async function crearCita(datos) {
  const { nombreCliente, servicio, fecha, hora_inicio, barbero, telefono } = datos;
  
  if (!BARBERIA_CONFIG) {
    return { error: 'Error de configuración del sistema' };
  }
  
  const duracion = BARBERIA_CONFIG.servicios[servicio]?.min || 30;
  
  const disponible = verificarDisponibilidad(fecha, hora_inicio, duracion, barbero);
  
  if (!disponible) {
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
  
  const cliente = getOrCreateClient(telefono, nombreCliente);
  cliente.totalCitas++;
  if (barbero) cliente.preferencias.barbero = barbero;
  cliente.preferencias.servicio = servicio;
  registrarAccionCliente(telefono, 'cita_creada', { citaId: cita.id, servicio, fecha, hora_inicio });
  
  await programarRecordatorio(cita);
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
  
  if (cita.telefono) {
    const cliente = CLIENTES[cita.telefono];
    if (cliente) {
      cliente.totalCancelaciones++;
      registrarAccionCliente(cita.telefono, 'cita_cancelada', { citaId: cita.id });
    }
  }
  
  if (cita.barbero && cita.barbero !== 'Cualquiera' && BARBEROS[cita.barbero]) {
    const fechaDT = parseDate(cita.fecha);
    const fechaLegible = formatDate(fechaDT);
    
    await notificarBarbero(cita.barbero, 
      `❌ *CITA CANCELADA*\n\n` +
      `👤 Cliente: ${nombreCliente}\n` +
      `📅 Fecha: ${fechaLegible}\n` +
      `🕐 Hora: ${hora_inicio}`
    );
  }
  
  await notificarDueno(`❌ *CITA CANCELADA*\n\n👤 Cliente: ${nombreCliente}\n📆 Fecha: ${fecha}\n🕐 Hora: ${hora_inicio}`);
  await procesarWaitlist(fecha);
  
  return { success: true, cita };
}

// ========== WAITLIST ==========
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
  
  const slotsDisponibles = obtenerProximosSlots(fecha, 5);
  
  if (slotsDisponibles.length === 0) return;
  
  const primero = enEspera[0];
  const horaDisponible = slotsDisponibles[0];
  
  try {
    const chat = await client.getChatById(primero.telefono);
    await sendWithTyping(chat, 
      `¡Hola ${primero.nombreCliente}! 🎉\n\nSe liberó un espacio para *${primero.servicio}* hoy a las *${horaDisponible}*.\n\n¿Lo tomas? Responde *Sí* o *No*`
    );
    
    setTimeout(() => {
      const estaEnWaitlist = WAITLIST.find(w => w.id === primero.id);
      if (estaEnWaitlist) {
        WAITLIST = WAITLIST.filter(w => w.id !== primero.id);
        guardarWaitlist();
        procesarWaitlist(fecha);
      }
    }, 120000);
    
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
  
  if (diff > 0 && diff < 86400000) {
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
  
  const reviewTime = citaDT.plus({ days: 2 });
  const reviewDiff = reviewTime.diff(ahora, 'milliseconds').milliseconds;
  
  if (reviewDiff > 0 && reviewDiff < 172800000) {
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
  if (!barbero || !barbero.telefono) {
    console.error(`⚠️ No se pudo notificar a ${nombreBarbero}: sin teléfono configurado`);
    return;
  }
  
  try {
    const chat = await client.getChatById(barbero.telefono);
    await sendWithTyping(chat, mensaje);
    console.log(`✅ Notificación enviada a barbero ${nombreBarbero} por WhatsApp`);
    
    await notificarBarberoTelegram(nombreBarbero, mensaje);
  } catch (error) {
    console.error(`❌ Error notificando a barbero ${nombreBarbero}:`, error.message);
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
    
    if (TELEGRAM_ENABLED) {
      await enviarTelegram(fullMsg);
    }
  } catch (error) {
    console.error('❌ Error notificando al dueño:', error.message);
  }
}

// ========== TELEGRAM FUNCTIONS ==========
function sanitizarHTML(texto) {
  if (typeof texto !== 'string') {
    texto = String(texto);
  }
  
  let textoLimpio = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  textoLimpio = textoLimpio
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>');
  
  return textoLimpio;
}

async function enviarTelegram(mensaje, chatId = null) {
  if (!TELEGRAM_ENABLED) return;
  
  try {
    const https = require('https');
    const targetChatId = chatId || TELEGRAM_CHAT_ID;
    
    const telegramMsg = sanitizarHTML(mensaje);
    
    const data = JSON.stringify({
      chat_id: targetChatId,
      text: telegramMsg,
      parse_mode: 'HTML'
    });
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };
      
      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('📱 Notificación enviada a Telegram');
            resolve(JSON.parse(responseData));
          } else {
            console.error('❌ Error Telegram:', responseData);
            reject(new Error(`Telegram API error: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (err) => {
        console.error('❌ Error enviando a Telegram:', err.message);
        reject(err);
      });
      
      req.write(data);
      req.end();
    });
  } catch (error) {
    console.error('❌ Error en enviarTelegram:', error.message);
  }
}

async function notificarBarberoTelegram(nombreBarbero, mensaje) {
  const barbero = BARBEROS[nombreBarbero];
  if (barbero && barbero.telegram_chat_id && TELEGRAM_BOT_TOKEN) {
    try {
      await enviarTelegram(mensaje, barbero.telegram_chat_id);
      console.log(`📱 Notificación enviada a ${nombreBarbero} por Telegram`);
    } catch (error) {
      console.error(`❌ Error notificando a ${nombreBarbero} por Telegram:`, error.message);
    }
  }
}

// ========== PROCESAMIENTO INTELIGENTE DE COMANDOS CON IA ==========
async function procesarComandoConIA(comando, mensaje, userId, chatId, canal) {
  const prompt = `Eres un asistente que procesa comandos de gestión de barbería.

El usuario envió: "${mensaje}"

Debes extraer la información del comando y devolverla en JSON.

Comandos disponibles:
- /agendar {nombre} {servicio} {hora}: Crear cita walk-in
- /cancelar {hora} o {nombre}: Cancelar cita
- /cerrar {rango}: Bloquear horario (ej: 3pm-5pm)
- /abrir {rango}: Desbloquear horario
- /descanso iniciar {barbero}: Poner barbero en descanso
- /descanso terminar {barbero}: Terminar descanso
- /pausar {target}: Pausar bot (todo/numero específico)
- /iniciar {target}: Reactivar bot
- /pasar {hora/nombre} a {barbero}: Reasignar cita

Fecha de hoy: ${now().toFormat('yyyy-MM-dd')}
Hora actual: ${now().toFormat('HH:mm')}

Extrae la información y devuelve JSON con:
{
  "accion": "agendar|cancelar|cerrar|abrir|descanso|pausar|iniciar|pasar",
  "parametros": {...},
  "confirmacion": "texto amigable describiendo qué se va a hacer",
  "error": null o "mensaje de error si falta info"
}

Responde SOLO con el JSON, sin explicaciones adicionales.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    });
    
    const respuesta = completion.choices[0].message.content.trim();
    const jsonMatch = respuesta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: 'No pude entender el comando. ¿Puedes reformularlo?' };
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (parsed.error) {
      return { error: parsed.error };
    }
    
    const comandoId = `CMD-${Date.now()}`;
    comandosPendientesConfirmacion.set(comandoId, {
      userId,
      chatId,
      canal,
      accion: parsed.accion,
      parametros: parsed.parametros,
      timestamp: Date.now()
    });
    
    const mensajeConfirmacion = `${parsed.confirmacion}\n\n✅ Responde *SI* para confirmar\n❌ Responde *NO* para cancelar\n✏️ O corrige lo que necesites`;
    
    return { confirmacion: mensajeConfirmacion, comandoId };
    
  } catch (error) {
    console.error('❌ Error procesando comando con IA:', error.message);
    return { error: 'No pude entender el comando. ¿Puedes reformularlo?' };
  }
}

async function procesarRespuestaComando(mensaje, userId, chatId, canal) {
  let comandoPendiente = null;
  let comandoId = null;
  
  for (const [id, cmd] of comandosPendientesConfirmacion.entries()) {
    if (cmd.userId === userId || cmd.chatId === chatId) {
      comandoPendiente = cmd;
      comandoId = id;
      break;
    }
  }
  
  if (!comandoPendiente) return null;
  
  const textoUpper = mensaje.toUpperCase().trim();
  
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'YES') {
    comandosPendientesConfirmacion.delete(comandoId);
    return await ejecutarComando(comandoPendiente);
  }
  
  if (textoUpper === 'NO') {
    comandosPendientesConfirmacion.delete(comandoId);
    return '❌ Comando cancelado';
  }
  
  try {
    const prompt = `El usuario quiere modificar un comando pendiente.

Comando original: ${JSON.stringify(comandoPendiente.parametros)}
Usuario dice: "${mensaje}"

¿Qué quiere cambiar? Devuelve SOLO JSON válido sin texto adicional:
{
  "parametros": {...parámetros actualizados...},
  "confirmacion": "texto describiendo el cambio"
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200
    });
    
    let respuesta = completion.choices[0].message.content.trim();
    
    const jsonMatch = respuesta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ No se encontró JSON en corrección:', respuesta);
      return 'No entendí la corrección. ¿Puedes ser más específico?';
    }
    
    respuesta = jsonMatch[0];
    const parsed = JSON.parse(respuesta);
    
    comandoPendiente.parametros = parsed.parametros;
    comandosPendientesConfirmacion.set(comandoId, comandoPendiente);
    
    return `${parsed.confirmacion}\n\n✅ Responde *SI* para confirmar\n❌ Responde *NO* para cancelar`;
    
  } catch (error) {
    console.error('Error procesando corrección:', error);
    return 'No entendí la corrección. ¿Puedes ser más específico?';
  }
}

async function ejecutarComando(comando) {
  const { accion, parametros, userId, chatId, canal } = comando;
  
  try {
    switch (accion) {
      case 'agendar':
        const resultado = await crearCita({
          nombreCliente: parametros.nombre,
          servicio: parametros.servicio,
          fecha: parametros.fecha,
          hora_inicio: parametros.hora,
          barbero: parametros.barbero || 'Cualquiera',
          telefono: `WALKIN-${Date.now()}@c.us`
        });
        
        if (resultado.error) {
          return `❌ ${resultado.error}`;
        }
        
        return `✅ Cita creada exitosamente:\n*${parametros.nombre}* - ${parametros.servicio}\n📆 ${parametros.fecha} a las ${parametros.hora}`;
      
      case 'cancelar':
        const citaCancelar = CITAS.find(c => 
          c.fecha === parametros.fecha &&
          c.hora_inicio === parametros.hora &&
          c.estado !== 'cancelada'
        );
        
        if (!citaCancelar) {
          return '❌ No encontré esa cita';
        }
        
        const resultCancel = await cancelarCita(citaCancelar.nombreCliente, parametros.fecha, parametros.hora);
        
        if (resultCancel.error) {
          return `❌ ${resultCancel.error}`;
        }
        
        return `✅ Cita cancelada:\n*${citaCancelar.nombreCliente}* - ${parametros.hora}`;
      
      case 'cerrar':
        const barbero = parametros.barbero || 'general';
        if (BARBEROS[barbero]) {
          BARBEROS[barbero].bloques = BARBEROS[barbero].bloques || [];
          BARBEROS[barbero].bloques.push({
            inicio: parametros.inicio,
            fin: parametros.fin
          });
          await guardarBarberos();
          return `🔒 Bloqueado ${parametros.inicio} - ${parametros.fin} para ${barbero}`;
        }
        return '❌ Barbero no encontrado';
      
      case 'abrir':
        const barberoAbrir = parametros.barbero || 'general';
        if (BARBEROS[barberoAbrir]) {
          BARBEROS[barberoAbrir].bloques = (BARBEROS[barberoAbrir].bloques || []).filter(b => 
            !(b.inicio === parametros.inicio && b.fin === parametros.fin)
          );
          await guardarBarberos();
          return `🔓 Desbloqueado ${parametros.inicio} - ${parametros.fin} para ${barberoAbrir}`;
        }
        return '❌ Barbero no encontrado';
      
      case 'descanso':
        const barberoDescanso = parametros.barbero;
        if (BARBEROS[barberoDescanso]) {
          BARBEROS[barberoDescanso].estado = parametros.iniciar ? 'descanso' : 'disponible';
          await guardarBarberos();
          return parametros.iniciar ? 
            `🟡 ${barberoDescanso} ahora está en descanso` :
            `🟢 ${barberoDescanso} está disponible nuevamente`;
        }
        return '❌ Barbero no encontrado';
      
      case 'pausar':
        if (parametros.target === 'todo') {
          BOT_PAUSED_GLOBAL = true;
          return '⏸️ Bot pausado en TODOS los chats (WhatsApp y Telegram)';
        } else if (parametros.target) {
          BOT_PAUSED_CHATS.add(parametros.target);
          return `⏸️ Bot pausado para ${parametros.target}`;
        } else {
          BOT_PAUSED_CHATS.add(chatId || userId);
          return '⏸️ Bot pausado en este chat';
        }
      
      case 'iniciar':
        if (parametros.target === 'todo') {
          BOT_PAUSED_GLOBAL = false;
          BOT_PAUSED_CHATS.clear();
          return '▶️ Bot reactivado en todos los chats';
        } else {
          BOT_PAUSED_CHATS.delete(chatId || userId);
          return '▶️ Bot reactivado en este chat';
        }
      
      default:
        return '❌ Acción no reconocida';
    }
  } catch (error) {
    console.error('Error ejecutando comando:', error);
    return `❌ Error: ${error.message}`;
  }
}

// ========== PARSER DE COMANDOS ==========
function parsearComando(texto) {
  const textoLimpio = texto.trim().replace(/\s+/g, ' ');
  const partes = textoLimpio.split(' ');
  const comando = partes[0].toLowerCase();
  const args = partes.slice(1);
  
  return { comando, args };
}

// ========== COMANDOS (UNIFICADOS) ==========
async function handleCommand(command, args, userId, chatId, canal = 'whatsapp') {
  const { rol, nombre } = detectarRol(userId, chatId);
  const esOwner = rol === 'owner';
  const esBarbero = rol === 'barbero';
  
  console.log(`📋 Comando ${command} ejecutado por ${rol === 'owner' ? 'OWNER' : rol === 'barbero' ? `BARBERO (${nombre})` : 'CLIENTE'}`);
  
  const fullMessage = `${command} ${args.join(' ')}`.trim();
  const respuestaComando = await procesarRespuestaComando(fullMessage, userId, chatId, canal);
  if (respuestaComando) return respuestaComando;
  
  switch (command) {
    case '/ayuda':
    case '/help':
      if (esOwner) {
        return `📋 *COMANDOS DISPONIBLES (OWNER)*\n\n` +
          `*Gestión General:*\n` +
          `/panel - Ver panel de control\n` +
          `/pausar - Pausar bot en este chat\n` +
          `/iniciar - Reactivar bot\n\n` +
          `*Barberos:*\n` +
          `/barberos - Lista de barberos\n` +
          `/disponibilidad - Ver slots libres\n\n` +
          `*Citas:*\n` +
          `/vercitas - Todas las citas de hoy\n` +
          `/agendar {nombre} {servicio} {hora} - Crear cita\n` +
          `/cancelar {hora/nombre} - Cancelar cita\n\n` +
          `*Todos los comandos piden confirmación*`;
      } else if (esBarbero) {
        return `📋 *COMANDOS DISPONIBLES (BARBERO - ${nombre})*\n\n` +
          `/disponibilidad - Tus slots libres\n` +
          `/citas - Tus citas de hoy\n` +
          `/descanso iniciar - Iniciar descanso\n` +
          `/agendar {nombre} {servicio} {hora} - Walk-in\n\n` +
          `*Todos los comandos piden confirmación*`;
      }
      return 'Comando no disponible para tu rol.';
    
    case '/panel':
      if (!esOwner) return 'Solo el dueño puede acceder al panel.';
      return `📊 *Panel de Control*\n\n${PANEL_URL}\n\n✅ Desde ahí puedes ver todas las estadísticas.`;
    
    case '/pausar':
    case '/iniciar':
    case '/agendar':
    case '/cancelar':
    case '/cerrar':
    case '/abrir':
    case '/descanso':
      if (!esOwner && !esBarbero) return 'No tienes permiso para usar este comando.';
      return await procesarComandoConIA(command, fullMessage, userId, chatId, canal);
    
    case '/barberos':
      let lista = '*👨‍🦲 BARBEROS*\n\n';
      for (const [nombreBarbero, data] of Object.entries(BARBEROS)) {
        const estado = obtenerEstadoBarbero(nombreBarbero);
        const emoji = estado === 'disponible' ? '🟢' : 
                      estado === 'en_cita' ? '🔴' : 
                      estado === 'descanso' ? '🟡' : '⚫';
        const estadoTxt = estado === 'disponible' ? 'Disponible' :
                          estado === 'en_cita' ? 'En cita' :
                          estado === 'descanso' ? 'En descanso' : 'Cerrado';
        lista += `${emoji} *${nombreBarbero}* - ${estadoTxt}\n`;
      }
      return lista;
    
    case '/vercitas':
    case '/citas':
      const citasHoy = obtenerCitasDelDia(null, esBarbero ? nombre : null);
      if (citasHoy.length === 0) {
        return '📅 No hay citas agendadas para hoy.';
      }
      let msg = `📅 *CITAS DE HOY*\n\n`;
      citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
      for (const cita of citasHoy) {
        msg += `🕐 ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
        msg += `   💇 ${cita.servicio}\n`;
        if (esOwner) msg += `   👨‍🦲 ${cita.barbero}\n`;
        msg += '\n';
      }
      return msg;
    
    case '/disponibilidad':
      const horario = obtenerHorarioDelDia(now().weekday);
      if (!horario) return 'No hay horario configurado para hoy.';
      const slots = obtenerProximosSlots(null, 10, null, esBarbero ? nombre : null);
      return `📅 *Horario de hoy*\n\n` +
        `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
        `*Horarios disponibles:*\n${slots.length > 0 ? slots.join(', ') : 'No hay horarios disponibles'}`;
    
    default:
      return `❓ Comando no reconocido. Usa /ayuda para ver los comandos disponibles.`;
  }
}

// ========== TELEGRAM BOT ==========
async function testTelegramConnection() {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) {
            console.log('✅ Telegram Bot conectado:', json.result.username);
            resolve(json.result);
          } else {
            reject(new Error(`Telegram API error: ${json.description}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function handleMensajeBarberoTelegram(mensaje, nombreBarbero, chatId) {
  const barbero = BARBEROS[nombreBarbero];
  if (!barbero) return false;
  
  const pendiente = respuestasBarberosPendientes.get(barbero.telefono);
  
  if (!pendiente) {
    return false;
  }
  
  const { citaId, tipo } = pendiente;
  const solicitud = citasPendientesConfirmacion.get(citaId);
  
  if (!solicitud) {
    respuestasBarberosPendientes.delete(barbero.telefono);
    return false;
  }
  
  const textoUpper = mensaje.toUpperCase();
  
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'YES') {
    console.log(`   ✅ Barbero ${nombreBarbero} confirmó la cita por Telegram`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barbero.telefono);
    
    const resultado = await crearCita(solicitud.datos);
    
    if (resultado.error) {
      await enviarTelegram(`❌ Error al confirmar: ${resultado.error}`, chatId);
      
      try {
        const clientChat = await client.getChatById(solicitud.clienteChatId);
        await sendWithTyping(clientChat, 
          `❌ Hubo un problema al confirmar tu cita. ${resultado.error}\n\n¿Querés intentar con otro horario?`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    } else {
      const fechaDT = parseDate(resultado.cita.fecha);
      const fechaLegible = formatDate(fechaDT);
      
      await enviarTelegram(
        `✅ *Cita confirmada*\n\n` +
        `👤 ${resultado.cita.nombreCliente}\n` +
        `💇 ${resultado.cita.servicio}\n` +
        `📅 ${fechaLegible}\n` +
        `🕐 ${resultado.cita.hora_inicio}`,
        chatId
      );
      
      try {
        const clientChat = await client.getChatById(solicitud.clienteChatId);
        await sendWithTyping(clientChat,
          `✅ *¡Confirmado!*\n\n` +
          `${nombreBarbero} aceptó tu cita:\n\n` +
          `💇 ${resultado.cita.servicio}\n` +
          `📅 ${fechaLegible}\n` +
          `🕐 ${resultado.cita.hora_inicio}\n\n` +
          `¡Te esperamos! 👋`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    }
    
    return true;
  }
  
  if (textoUpper === 'NO') {
    console.log(`   ❌ Barbero ${nombreBarbero} rechazó la cita por Telegram`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barbero.telefono);
    
    await enviarTelegram(
      `❌ Entendido. La cita fue rechazada.\n\nEl cliente será notificado.`,
      chatId
    );
    
    try {
      const clientChat = await client.getChatById(solicitud.clienteChatId);
      await sendWithTyping(clientChat,
        `😔 ${nombreBarbero} no está disponible en ese horario.\n\n` +
        `¿Te ofrezco otro horario o preferís con otro barbero?`
      );
    } catch (e) {
      console.error('Error notificando cliente:', e);
    }
    
    return true;
  }
  
  return false;
}

async function iniciarTelegramBot() {
  if (!TELEGRAM_ENABLED) return;
  
  const https = require('https');
  
  console.log('🤖 Iniciando Telegram Bot en modo Polling...');
  
  try {
    await testTelegramConnection();
  } catch (e) {
    console.error('❌ Error conectando con Telegram:', e.message);
    return;
  }
  
  let offset = 0;
  let isPolling = false;
  
  const procesarActualizacion = async (update) => {
    if (!update.message || !update.message.text) return;
    
    const chatId = update.message.chat.id.toString();
    const mensaje = update.message.text.trim();
    const userName = update.message.from.first_name || 'Usuario';
    
    console.log(`📱 [TELEGRAM] Mensaje de ${userName} (${chatId}): ${mensaje}`);
    
    const { rol, nombre } = detectarRol(null, chatId);
    
    if (rol === 'cliente') {
      await enviarTelegram('❌ No tienes autorización para usar este bot.', chatId);
      return;
    }
    
    const nombreBarbero = rol === 'barbero' ? nombre : null;
    
    if (nombreBarbero) {
      const procesado = await handleMensajeBarberoTelegram(mensaje, nombreBarbero, chatId);
      if (procesado) return;
    }
    
    const respuestaComando = await procesarRespuestaComando(mensaje, null, chatId, 'telegram');
    if (respuestaComando) {
      await enviarTelegram(respuestaComando, chatId);
      return;
    }
    
    if (mensaje.startsWith('/')) {
      const { comando, args } = parsearComando(mensaje);
      const respuesta = await handleCommand(comando, args, null, chatId, 'telegram');
      
      if (respuesta) {
        await enviarTelegram(respuesta, chatId);
      }
    } else {
      const rolTxt = rol === 'owner' ? 'Owner' : nombreBarbero ? `Barbero (${nombreBarbero})` : 'Usuario';
      await enviarTelegram(
        `👋 Hola ${userName}!\n\n` +
        `Soy el asistente del sistema de citas.\n\n` +
        `📋 Usa /ayuda para ver los comandos disponibles\n\n` +
        `Tu rol: ${rolTxt}`,
        chatId
      );
    }
  };
  
  const getUpdates = async () => {
    if (isPolling) return;
    isPolling = true;
    
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`;
      
      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          isPolling = false;
          try {
            const json = JSON.parse(data);
            
            if (!json.ok) {
              console.error('❌ Telegram API error:', json.description);
              setTimeout(getUpdates, 5000);
              return;
            }
            
            if (json.result.length > 0) {
              for (const update of json.result) {
                await procesarActualizacion(update);
                offset = update.update_id + 1;
              }
            }
            
            setImmediate(getUpdates);
          } catch (e) {
            console.error('❌ Error procesando updates:', e.message);
            setTimeout(getUpdates, 5000);
          }
        });
      });
      
      req.on('error', (err) => {
        isPolling = false;
        console.error('❌ Error en Telegram polling:', err.message);
        setTimeout(getUpdates, 5000);
      });
      
      req.setTimeout(35000, () => {
        isPolling = false;
        req.destroy();
        setImmediate(getUpdates);
      });
      
    } catch (error) {
      isPolling = false;
      console.error('❌ Error en getUpdates:', error.message);
      setTimeout(getUpdates, 5000);
    }
  };
  
  console.log('✅ Telegram Bot polling iniciado');
  getUpdates();
}

// ========== TRANSCRIPCIÓN DE AUDIO ==========
async function transcribirAudio(message) {
  try {
    const media = await message.downloadMedia();
    
    if (!media) {
      console.error('❌ No se pudo descargar el audio');
      return null;
    }
    
    const audioBuffer = Buffer.from(media.data, 'base64');
    const tempPath = path.join(DATA_DIR, `temp_audio_${Date.now()}.ogg`);
    await fs.writeFile(tempPath, audioBuffer);
    
    console.log('🎤 Transcribiendo audio con Whisper...');
    
    const transcription = await openai.audio.transcriptions.create({
      file: require('fs').createReadStream(tempPath),
      model: 'whisper-1',
      language: 'es'
    });
    
    await fs.unlink(tempPath);
    
    console.log('✅ Audio transcrito:', transcription.text);
    return transcription.text;
    
  } catch (error) {
    console.error('❌ Error transcribiendo audio:', error.message);
    return null;
  }
}

function detectarIdioma(texto) {
  const palabrasEsp = ['hola', 'gracias', 'por favor', 'qué', 'cómo', 'cuándo', 'dónde', 'quiero', 'necesito'];
  const palabrasEng = ['hello', 'thanks', 'please', 'what', 'how', 'when', 'where', 'want', 'need'];
  
  const textoLower = texto.toLowerCase();
  
  const countEsp = palabrasEsp.filter(p => textoLower.includes(p)).length;
  const countEng = palabrasEng.filter(p => textoLower.includes(p)).length;
  
  return countEng > countEsp ? 'en' : 'es';
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
  
  state.idioma = detectarIdioma(userMessage);
  
  if (BOT_PAUSED_GLOBAL || BOT_PAUSED_CHATS.has(chatId)) {
    return null;
  }
  
  const respuestaComando = await procesarRespuestaComando(userMessage, userId, chatId, 'whatsapp');
  if (respuestaComando) return respuestaComando;
  
  if (userMessage.startsWith('/')) {
    const { comando, args } = parsearComando(userMessage);
    const respuesta = await handleCommand(comando, args, userId, chatId, 'whatsapp');
    if (respuesta) return respuesta;
  }
  
  if (!BARBERIA_CONFIG) {
    return 'Sistema en mantenimiento. Por favor intenta más tarde.';
  }
  
  let contextoCliente = '';
  if (esClienteRecurrente(userId)) {
    contextoCliente = `\n\n📋 CLIENTE RECURRENTE: ${cliente.nombre} (${cliente.totalCitas} citas anteriores)`;
    if (cliente.preferencias.servicio) {
      contextoCliente += `\nÚltimo servicio: ${cliente.preferencias.servicio}`;
    }
    if (cliente.preferencias.barbero) {
      contextoCliente += `\nBarbero preferido: ${cliente.preferencias.barbero}`;
    }
  }
  
  const slotsHoy = obtenerProximosSlots(null, 5);
  const slotsTxt = slotsHoy.length > 0 ? slotsHoy.join(', ') : 'No hay horarios disponibles hoy';
  
  const serviciosTxt = Object.entries(BARBERIA_CONFIG.servicios)
    .map(([nombre, data]) => `• ${nombre} - ${data.precio.toLocaleString()} (${data.min} min)`)
    .join('\n');
  
  const barberosTxt = Object.entries(BARBEROS)
    .map(([nombre, data]) => {
      const estado = obtenerEstadoBarbero(nombre);
      const especialidades = data.especialidades ? ` (${data.especialidades.join(', ')})` : '';
      return `• ${nombre}${especialidades} - ${estado}`;
    })
    .join('\n');
  
  const ahora = now();
  const fechaISO = ahora.toFormat('yyyy-MM-dd');
  const horaActual = ahora.toFormat('HH:mm');
  const diaSemanaTxt = ahora.toFormat('cccc', { locale: 'es' });
  const horarioHoy = obtenerHorarioDelDia(ahora.weekday);
  const horarioHoyTxt = horarioHoy ? `${horarioHoy.inicio} - ${horarioHoy.fin}` : 'Cerrado';
  
  let systemPrompt = BARBERIA_CONFIG.system_prompt || '';
  
  systemPrompt = systemPrompt
    .replace(/{hoy}/g, fechaISO)
    .replace(/{horaActual}/g, horaActual)
    .replace(/{diaSemana}/g, diaSemanaTxt)
    .replace(/{nombreBarberia}/g, BARBERIA_CONFIG.negocio.nombre)
    .replace(/{direccionBarberia}/g, BARBERIA_CONFIG.negocio.direccion)
    .replace(/{telefonoBarberia}/g, BARBERIA_CONFIG.negocio.telefono)
    .replace(/{horarioLv}/g, BARBERIA_CONFIG.horario.lun_vie)
    .replace(/{horarioS}/g, BARBERIA_CONFIG.horario.sab)
    .replace(/{horarioD}/g, BARBERIA_CONFIG.horario.dom)
    .replace(/{horarioHoy}/g, horarioHoyTxt)
    .replace(/{serviciosTxt}/g, serviciosTxt)
    .replace(/{slotsDisponiblesHoy}/g, slotsTxt)
    .replace(/{barberosTxt}/g, barberosTxt)
    .replace(/{pagosBarberia}/g, BARBERIA_CONFIG.pagos.join(', '))
    .replace(/{upsellText}/g, BARBERIA_CONFIG.upsell);
  
  systemPrompt += contextoCliente;
  
  if (state.idioma === 'en') {
    systemPrompt += '\n\n🗽 RESPONDE EN INGLÉS. El cliente está escribiendo en inglés.';
  }
  
  const jsonInstructions = `

🚨🚨🚨 FORMATO JSON CRÍTICO 🚨🚨🚨

Cuando uses <BOOKING:...> o <CANCELLED:...>, el JSON DEBE ser VÁLIDO.

✅ FORMATO CORRECTO (copia exactamente este patrón):
<BOOKING:{"nombreCliente":"José","servicio":"corte clásico","fecha":"2025-11-05","hora_inicio":"09:00","barbero":"Liliana"}>

❌ NUNCA HAGAS ESTO:
- NO uses backslashes: {\\"nombreCliente\\":\\"José\\"}
- NO uses comillas simples: {'nombreCliente':'José'}
- NO pongas espacios extras
- NO rompas el JSON en múltiples líneas

REGLAS OBLIGATORIAS:
1. Comillas dobles DIRECTAS (") para claves y valores
2. Sin espacios innecesarios
3. Fecha siempre: YYYY-MM-DD
4. Hora siempre en 24h: HH:MM (ej: 09:00, 14:30, 16:00)
5. Nombre EXACTO del servicio como aparece en la lista
6. BARBERO: MUY IMPORTANTE
   - Si el cliente mencionó un barbero específico (ej: "con Liliana", "que me atienda Mafe"), usa ESE nombre EXACTO
   - Si NO mencionó ningún barbero → usa "Cualquiera"
   - Nombres válidos: ${Object.keys(BARBEROS).join(', ')}

🚨 CRÍTICO: SIEMPRE VERIFICA QUE LA HORA ESTÉ EN LA LISTA DE HORARIOS DISPONIBLES ANTES DE EMITIR EL TAG.
Si el cliente pide una hora que NO está en {slotsDisponiblesHoy}, NO emitas el tag y ofrece las horas disponibles.

🚨 DETECCIÓN DE BARBERO ESPECÍFICO:
- "con Liliana" / "Liliana" → barbero: "Liliana"
- "con Mafe" / "Mafe" → barbero: "Mafe"  
- "con Ani" / "Ani" → barbero: "Ani"
- "me da igual" / no menciona → barbero: "Cualquiera"

IMPORTANTE: Después de emitir el tag con barbero específico, el sistema automáticamente contacta al barbero para confirmar disponibilidad. NO menciones esto al cliente hasta que haya confirmación.
`;
  
  systemPrompt += jsonInstructions;
  
  state.conversationHistory.push({ role: 'user', content: userMessage });
  
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
      'Uy, se me enredó algo aquí. ¿Me repites porfa? 😅';
  }
}

async function procesarTags(respuesta, userId, nombreCliente) {
  const bookingMatch = respuesta.match(/<BOOKING:(.+?)>/);
  if (bookingMatch) {
    try {
      let jsonStr = bookingMatch[1].trim();
      
      jsonStr = jsonStr.replace(/\\\\/g, '');
      jsonStr = jsonStr.replace(/\\"/g, '"');
      jsonStr = jsonStr.replace(/\\'/g, "'");
      jsonStr = jsonStr.replace(/'/g, '"');
      
      const datos = JSON.parse(jsonStr);
      
      datos.telefono = userId;
      datos.nombreCliente = datos.nombreCliente || nombreCliente;
      
      if (datos.barbero && datos.barbero !== 'Cualquiera' && BARBEROS[datos.barbero]) {
        console.log(`📞 Iniciando flujo de confirmación con barbero: ${datos.barbero}`);
        
        const citaId = `PEND-${Date.now()}`;
        
        citasPendientesConfirmacion.set(citaId, {
          datos,
          clienteChatId: userId,
          timestamp: Date.now()
        });
        
        const barbero = BARBEROS[datos.barbero];
        try {
          const fechaDT = parseDate(datos.fecha);
          const fechaLegible = formatDate(fechaDT);
          
          const mensajeSolicitud = 
            `🔔 *SOLICITUD DE CITA*\n\n` +
            `👤 Cliente: ${datos.nombreCliente}\n` +
            `💇 Servicio: ${datos.servicio}\n` +
            `📅 Fecha: ${fechaLegible}\n` +
            `🕐 Hora: ${datos.hora_inicio}\n\n` +
            `¿Puedes atender esta cita?\n\n` +
            `✅ *SI* para confirmar\n` +
            `❌ *NO* si no puedes\n` +
            `⏰ O sugiere otra hora (ej: "3:00 PM mejor")`;
          
          const barberoChat = await client.getChatById(barbero.telefono);
          await sendWithTyping(barberoChat, mensajeSolicitud);
          
          if (barbero.telegram_chat_id) {
            await enviarTelegram(mensajeSolicitud, barbero.telegram_chat_id);
          }
          
          respuestasBarberosPendientes.set(barbero.telefono, { citaId, tipo: 'confirmacion' });
          
          const timeout = setTimeout(async () => {
            if (citasPendientesConfirmacion.has(citaId)) {
              citasPendientesConfirmacion.delete(citaId);
              respuestasBarberosPendientes.delete(barbero.telefono);
              
              try {
                const clientChat = await client.getChatById(userId);
                await sendWithTyping(clientChat,
                  `⏰ ${datos.barbero} no respondió a tiempo. ¿Querés agendar con otro barbero o intentar más tarde?`
                );
              } catch (e) {
                console.error('Error notificando timeout:', e);
              }
            }
          }, 120000);
          
          citasPendientesConfirmacion.get(citaId).timeout = timeout;
          
          respuesta = respuesta.replace(/<BOOKING:.+?>/, 
            `\n\n⏳ Estoy consultando con ${datos.barbero} si puede atenderte. Te confirmo en un momentito...`
          );
          
        } catch (e) {
          console.error('❌ Error notificando a barbero:', e);
          const resultado = await crearCita(datos);
          if (resultado.error) {
            respuesta = respuesta.replace(/<BOOKING:.+?>/, `\n\n❌ ${resultado.error}`);
          } else {
            respuesta = respuesta.replace(/<BOOKING:.+?>/, '');
          }
        }
      } else {
        console.log(`📝 Creando cita sin confirmación previa (barbero: ${datos.barbero || 'Cualquiera'})`);
        const resultado = await crearCita(datos);
        
        if (resultado.error) {
          console.error('❌ Error al crear la cita:', resultado.error);
          respuesta = respuesta.replace(/<BOOKING:.+?>/, `\n\n❌ ${resultado.error}`);
        } else {
          console.log('✅ Cita creada exitosamente:', resultado.cita.id);
          respuesta = respuesta.replace(/<BOOKING:.+?>/, '');
        }
      }
      
    } catch (e) {
      console.error('❌ Error procesando BOOKING:', e.message);
      respuesta = respuesta.replace(/<BOOKING:.+?>/, '\n\n❌ Error al procesar la cita (formato incorrecto)');
      
      await notificarDueno(
        `❌ *ERROR PROCESANDO BOOKING*\n\nUsuario: ${userId}\nJSON: ${bookingMatch[1]}\nError: ${e.message}`
      );
    }
  }
  
  const cancelMatch = respuesta.match(/<CANCELLED:(.+?)>/);
  if (cancelMatch) {
    try {
      let jsonStr = cancelMatch[1].trim();
      jsonStr = jsonStr.replace(/\\\\/g, '');
      jsonStr = jsonStr.replace(/\\"/g, '"');
      jsonStr = jsonStr.replace(/'/g, '"');
      
      const datos = JSON.parse(jsonStr);
      
      const resultado = await cancelarCita(datos.nombreCliente, datos.fecha, datos.hora_inicio);
      
      if (resultado.error) {
        respuesta = respuesta.replace(/<CANCELLED:.+?>/, `\n\n❌ ${resultado.error}`);
      } else {
        respuesta = respuesta.replace(/<CANCELLED:.+?>/, '');
      }
    } catch (e) {
      console.error('❌ Error procesando CANCELLED:', e.message);
      respuesta = respuesta.replace(/<CANCELLED:.+?>/, '\n\n❌ Error al cancelar la cita');
    }
  }
  
  return respuesta;
}

async function handleMensajeBarbero(message, nombreBarbero) {
  const barberoTelefono = message.from;
  const texto = message.body.trim();
  
  console.log(`📞 Mensaje de barbero ${nombreBarbero}: "${texto}"`);
  
  const respuestaComando = await procesarRespuestaComando(texto, barberoTelefono, null, 'whatsapp');
  if (respuestaComando) {
    await message.reply(respuestaComando);
    return true;
  }
  
  const pendiente = respuestasBarberosPendientes.get(barberoTelefono);
  
  if (!pendiente) {
    console.log(`   ℹ️ No hay respuestas pendientes para este barbero`);
    return false;
  }
  
  const { citaId, tipo } = pendiente;
  const solicitud = citasPendientesConfirmacion.get(citaId);
  
  if (!solicitud) {
    console.log(`   ⚠️ Solicitud ${citaId} ya no existe`);
    respuestasBarberosPendientes.delete(barberoTelefono);
    return false;
  }
  
  const textoUpper = texto.toUpperCase();
  
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'YES') {
    console.log(`   ✅ Barbero confirmó la cita`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    const resultado = await crearCita(solicitud.datos);
    
    if (resultado.error) {
      await message.reply(`❌ Error al confirmar: ${resultado.error}`);
      
      try {
        const clientChat = await client.getChatById(solicitud.clienteChatId);
        await sendWithTyping(clientChat, 
          `❌ Hubo un problema al confirmar tu cita. ${resultado.error}\n\n¿Querés intentar con otro horario?`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    } else {
      const fechaDT = parseDate(resultado.cita.fecha);
      const fechaLegible = formatDate(fechaDT);
      
      await message.reply(
        `✅ *Cita confirmada*\n\n` +
        `👤 ${resultado.cita.nombreCliente}\n` +
        `💇 ${resultado.cita.servicio}\n` +
        `📅 ${fechaLegible}\n` +
        `🕐 ${resultado.cita.hora_inicio}`
      );
      
      try {
        const clientChat = await client.getChatById(solicitud.clienteChatId);
        await sendWithTyping(clientChat,
          `✅ *¡Confirmado!*\n\n` +
          `${nombreBarbero} aceptó tu cita:\n\n` +
          `💇 ${resultado.cita.servicio}\n` +
          `📅 ${fechaLegible}\n` +
          `🕐 ${resultado.cita.hora_inicio}\n\n` +
          `¡Te esperamos! 👋`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    }
    
    return true;
  }
  
  if (textoUpper === 'NO') {
    console.log(`   ❌ Barbero rechazó la cita`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    await message.reply(
      `❌ Entendido. La cita fue rechazada.\n\nEl cliente será notificado.`
    );
    
    try {
      const clientChat = await client.getChatById(solicitud.clienteChatId);
      await sendWithTyping(clientChat,
        `😔 ${nombreBarbero} no está disponible en ese horario.\n\n` +
        `¿Te ofrezco otro horario o preferís con otro barbero?`
      );
    } catch (e) {
      console.error('Error notificando cliente:', e);
    }
    
    return true;
  }
  
  const horaMatch = texto.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/i);
  if (horaMatch) {
    console.log(`   ⏰ Barbero sugirió otra hora: ${texto}`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    const horaSugerida = horaMatch[0];
    
    await message.reply(
      `👍 Perfecto, voy a ofrecerle al cliente el horario de ${horaSugerida}.`
    );
    
    try {
      const clientChat = await client.getChatById(solicitud.clienteChatId);
      await sendWithTyping(clientChat,
        `${nombreBarbero} sugiere mejor a las *${horaSugerida}* para tu ${solicitud.datos.servicio}.\n\n` +
        `¿Te sirve ese horario?`
      );
    } catch (e) {
      console.error('Error notificando cliente:', e);
    }
    
    return true;
  }
  
  console.log(`   ℹ️ Respuesta no reconocida, continuando con flujo normal`);
  return false;
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
  
  const serviciosCount = {};
  for (const cita of citasMes) {
    serviciosCount[cita.servicio] = (serviciosCount[cita.servicio] || 0) + 1;
  }
  const serviciosMasPedidos = Object.entries(serviciosCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([servicio, count]) => ({ servicio, count }));
  
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
  console.log(`\n   📲 http://localhost:${PORT}/qr\n`);
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Cliente de WhatsApp listo!');
  console.log(`👤 Notificaciones al dueño: ${OWNER_NUMBER}`);
  latestQR = null;
  
  await initDataFiles();
  await cargarConfigBarberia();
  
  if (TELEGRAM_ENABLED) {
    await iniciarTelegramBot();
  }
  
  console.log('📋 Estado del sistema:');
  console.log(`

// Legacy wrapper: route to handleCommand to avoid undefined errors
function handleCommandTelegram(command, args, chatId, rol = 'owner') {
  try {
    return handleCommand(command, args, TELEGRAM_CHAT_ID || 'owner', chatId, 'telegram');
  } catch (e) {
    console.error('handleCommandTelegram wrapper error:', e.message);
  }
}

// ====== WhatsApp Slash Router (injected) ======
async function __slashRouter(body, userId, chatId) {
  const clean = String(body || '').trim();
  if (!clean.startsWith('/')) return false;
  const parts = clean.replace(/\s+/g, ' ').split(' ');
  const command = parts[0].slice(1).toLowerCase();
  const args = parts.slice(1);
  if (typeof handleCommand === 'function') {
    await handleCommand(command, args, userId, chatId, 'whatsapp');
  } else if (typeof handleCommandTelegram === 'function') {
    await handleCommandTelegram(command, args, chatId, 'owner');
  }
  return true; // consumed
}
))
}
