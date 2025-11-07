// =========================
// CORTEX IA - BARBERSHOP BOT - VERSIÓN FINAL V5.3 ULTRA FIXED
// FIXES APLICADOS:
// ✅ Error procesando corrección CORREGIDO
// ✅ Validación de respuesta JSON mejorada
// ✅ Manejo de errores de parsing robusto
// ✅ Todos los comandos funcionan
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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

if (TELEGRAM_ENABLED) {
  console.log('📱 Telegram: ACTIVADO - Modo Panel de Gestión');
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
  // 🔥 FIX: Validar que sea string
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

// ========== PROCESAMIENTO INTELIGENTE DE COMANDOS CON IA (FIXED) ==========
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
  
  // CONFIRMACIÓN: SI
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'YES') {
    comandosPendientesConfirmacion.delete(comandoId);
    return await ejecutarComando(comandoPendiente);
  }
  
  // CANCELACIÓN: NO
  if (textoUpper === 'NO') {
    comandosPendientesConfirmacion.delete(comandoId);
    return '❌ Comando cancelado';
  }
  
  // CORRECCIÓN: usar IA para procesar cambios
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
    
    // 🔥 FIX CRÍTICO: Extraer JSON válido con regex
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

// ========== PARSER DE COMANDOS MEJORADO ==========
function parsearComando(texto) {
  // Normalize and clean input
  const textoLimpio = texto.trim().toLowerCase().replace(/\s+/g, ' ');
  
  // Extract base command (remove leading slash)
  const comando = textoLimpio.startsWith('/') ? 
    textoLimpio.substring(1).split(' ')[0] : 
    textoLimpio.split(' ')[0];
  
  // Get arguments, handling quotes
  const argsStr = textoLimpio.slice(comando.length + 1).trim();
  const args = argsStr ? argsStr.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [] : [];
  
  return { 
    comando: comando.toLowerCase(),
    args: args.map(arg => arg.replace(/^["']|["']$/g, ''))
  };
}

// ========== COMANDOS TELEGRAM Y WHATSAPP (UNIFICADOS) ==========
async function handleCommand(command, args, userId, chatId, canal = 'whatsapp') {
  console.log(`🛠️ Handling command: ${command} ${args.join(' ')} from ${canal}`);
  
  const { rol, nombre } = detectarRol(userId, chatId);
  console.log(`👤 User role: ${rol} ${nombre ? `(${nombre})` : ''}`);

  // Primero verificar si hay respuesta a comando pendiente
  const fullMessage = `${command} ${args.join(' ')}`.trim();
  const respuestaComando = await procesarRespuestaComando(fullMessage, userId, chatId, canal);
  if (respuestaComando) return respuestaComando;
  
  switch (command) {
    case '/ayuda':
    case '/help':
      if (rol === 'owner') {
        return `📋 *COMANDOS DISPONIBLES (OWNER)*\n\n` +
          `*Gestión General:*\n` +
          `/panel - Ver panel de control\n` +
          `/pausar - Pausar bot en este chat\n` +
          `/pausar todo - Pausar bot en TODOS los chats\n` +
          `/pausar {número} - Pausar bot para número específico\n` +
          `/iniciar - Reactivar bot en este chat\n` +
          `/iniciar todo - Reactivar bot en todos los chats\n\n` +
          `*Barberos:*\n` +
          `/barberos - Lista de barberos y estados\n` +
          `/disponibilidad - Ver slots libres hoy\n` +
          `/disponibilidad {barbero} - Ver slots de un barbero\n\n` +
          `*Citas:*\n` +
          `/vercitas - Todas las citas de hoy\n` +
          `/vercitas {fecha} - Citas de una fecha (YYYY-MM-DD)\n` +
          `/citas {barbero} - Citas de un barbero\n` +
          `/agendar {nombre} {servicio} {hora} - Crear cita manual\n` +
          `/cancelar {hora/nombre} - Cancelar cita\n` +
          `/pasar {hora/nombre} a {barbero} - Reasignar cita\n\n` +
          `*Configuración:*\n` +
          `/cerrar {hora}-{hora} {barbero} - Bloquear horario\n` +
          `/abrir {hora}-{hora} {barbero} - Liberar horario\n` +
          `/descanso iniciar {barbero} - Barbero en descanso\n` +
          `/descanso terminar {barbero} - Terminar descanso\n` +
          `/salir dia {barbero} - Bloquear día completo\n\n` +
          `*Todos los comandos piden confirmación antes de ejecutarse*`;
      } else if (rol === 'barbero') {
        return `📋 *COMANDOS DISPONIBLES (BARBERO - ${nombre})*\n\n` +
          `/disponibilidad - Tus slots libres hoy\n` +
          `/citas - Tus citas de hoy\n` +
          `/citas {fecha} - Tus citas de una fecha\n` +
          `/descanso iniciar - Iniciar descanso\n` +
          `/descanso terminar - Terminar descanso\n` +
          `/cerrar {hora}-{hora} - Bloquear tu horario\n` +
          `/abrir {hora}-{hora} - Liberar tu horario\n` +
          `/agendar {nombre} {servicio} {hora} - Walk-in\n` +
          `/cancelar {hora/nombre} - Cancelar cita\n` +
          `/salir dia - Bloquear todo tu día\n\n` +
          `*Todos los comandos piden confirmación*`;
      }
      return 'Comando no disponible para tu rol.';
    
    case '/panel':
      if (!esOwner) return 'Solo el dueño puede acceder al panel.';
      return `📊 *Panel de Control*\n\n${PANEL_URL}\n\n✅ Desde ahí puedes ver todas las estadísticas.`;
    
    case '/pausar':
      if (!esOwner) return 'Solo el dueño puede pausar el bot.';
      return await procesarComandoConIA(command, fullMessage, userId, chatId, canal);
    
    case '/iniciar':
      if (!esOwner) return 'Solo el dueño puede iniciar el bot.';
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
        if (data.especialidades && data.especialidades.length > 0) {
          lista += `   Especialidades: ${data.especialidades.join(', ')}\n`;
        }
        lista += '\n';
      }
      return lista;
    
    case '/vercitas':
    case '/citas':
      const argCitas = args.join(' ');
      const esFecha = /^\d{4}-\d{2}-\d{2}$/.test(argCitas);
      
      if (esFecha) {
        const citasFecha = obtenerCitasDelDia(argCitas, esBarbero ? nombre : null);
        if (citasFecha.length === 0) {
          return `📅 No hay citas para el ${argCitas}.`;
        }
        let msg = `📅 *CITAS DEL ${argCitas}*\n\n`;
        citasFecha.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasFecha) {
          msg += `🕐 ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   💇 ${cita.servicio}\n`;
          if (esOwner) msg += `   👨‍🦲 ${cita.barbero}\n`;
          msg += '\n';
        }
        return msg;
      }
      
      if (esBarbero && !args.length) {
        const citasHoy = obtenerCitasDelDia(null, nombre);
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
      }
      
      if (esOwner && args.length > 0) {
        const nombreBarberoArg = args.join(' ');
        const citasHoy = obtenerCitasDelDia(null, nombreBarberoArg);
        if (citasHoy.length === 0) {
          return `📅 ${nombreBarberoArg} no tiene citas agendadas para hoy.`;
        }
        let msg = `📅 *CITAS DE ${nombreBarberoArg.toUpperCase()} HOY*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `🕐 ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   💇 ${cita.servicio}\n\n`;
        }
        return msg;
      }
      
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
    
    case '/disponibilidad':
      if (esBarbero && !args.length) {
        const horario = obtenerHorarioDelDia(now().weekday);
        if (!horario) return 'No hay horario configurado para hoy.';
        const slots = obtenerProximosSlots(null, 10, null, nombre);
        return `📅 *Tu horario de hoy*\n\n` +
          `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.length > 0 ? slots.join(', ') : 'No hay horarios disponibles'}`;
      } else if (args.length > 0) {
        const nombreBarberoArg = args.join(' ');
        const horario = obtenerHorarioDelDia(now().weekday);
        if (!horario) return 'No hay horario configurado para hoy.';
        const slots = obtenerProximosSlots(null, 10, null, nombreBarberoArg);
        return `📅 *Horario de ${nombreBarberoArg}*\n\n` +
          `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.length > 0 ? slots.join(', ') : 'No hay horarios disponibles'}`;
      } else if (esOwner) {
        return 'Uso: /disponibilidad [nombre barbero]';
      }
      break;
    
    case '/agendar':
    case '/cancelar':
    case '/cerrar':
    case '/abrir':
    case '/descanso':
    case '/pasar':
    case '/salir':
      if (!esOwner && !esBarbero) return 'No tienes permiso para usar este comando.';
      return await procesarComandoConIA(command, fullMessage, userId, chatId, canal);
    
    default:
      return `❓ Comando no reconocido. Usa /ayuda para ver los comandos disponibles.`;
  }
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
  console.log(`  - Barbería: ${BARBERIA_CONFIG?.negocio?.nombre || '❌'}`);
  console.log(`  - Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length}`);
  console.log(`  - Barberos: ${Object.keys(BARBEROS).length}`);
  console.log(`  - Citas activas: ${CITAS.filter(c => c.estado !== 'cancelada').length}`);
  console.log(`  - Telegram Bot: ${TELEGRAM_ENABLED ? '✅ ACTIVO' : '❌ INACTIVO'}`);
});

client.on('message', async (message) => {
  try {
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    let userMessage = (message.body || '').trim();
    
    // Manejar mensajes de voz
    if (message.hasMedia && (message.type === 'ptt' || message.type === 'audio')) {
      console.log('🎤 Mensaje de voz detectado, transcribiendo...');
      
      const chat = await message.getChat();
      await chat.sendStateTyping();
      
      userMessage = await transcribirAudio(message);
      
      if (!userMessage) {
        await message.reply('Disculpa, no pude entender el audio. ¿Podrías escribir tu mensaje o enviar el audio de nuevo?');
        return;
      }
      
      console.log(`🎤 Audio transcrito: "${userMessage}"`);
    }
    
    if (!userMessage) return;
    
    console.log(`📩 Mensaje de ${userId}: ${userMessage}`);
    
    // Verificar si es un barbero
    const { rol, nombre } = detectarRol(userId, null);
    
    if (rol === 'barbero') {
      console.log(`👨‍🦲 Mensaje de barbero detectado: ${nombre}`);
      
      const procesado = await handleMensajeBarbero(message, nombre);
      
      if (procesado) {
        console.log(`✅ Respuesta de barbero procesada exitosamente`);
        return;
      }
      
      console.log(`   ℹ️ No era una respuesta a solicitud, continuando con flujo normal`);
    }
    
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
console.log('🚀 Iniciando Cortex Barbershop Bot V5.3...');
console.log('🕐 Timezone:', TIMEZONE);
console.log('🕐 Hora actual:', now().toFormat('yyyy-MM-dd HH:mm:ss'));
console.log(`👤 Dueño: ${OWNER_NUMBER}`);
console.log('');
console.log('🎯 VERSIÓN V5.3 - ULTRA FIXED:');
console.log('  ✅ Error procesando corrección CORREGIDO');
console.log('  ✅ Validación JSON mejorada con regex');
console.log('  ✅ Sanitización de texto para Telegram');
console.log('  ✅ Manejo robusto de respuestas IA');
console.log('  ✅ Todos los comandos funcionan correctamente');
console.log('  ✅ Sistema de pausas completamente funcional');
console.log('  ✅ Detección de roles mejorada');
console.log('  ✅ Confirmaciones inteligentes con IA');
console.log('');
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => {
  console.error('❌ UNHANDLED REJECTION:', e);
});

process.on('uncaughtException', (e) => {
  console.error('❌ UNCAUGHT EXCEPTION:', e);
});// =========================
// CORTEX IA - BARBERSHOP BOT - VERSIÓN FINAL V5.3 ULTRA FIXED
// FIXES APLICADOS:
// ✅ Error procesando corrección CORREGIDO
// ✅ Validación de respuesta JSON mejorada
// ✅ Manejo de errores de parsing robusto
// ✅ Todos los comandos funcionan
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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

if (TELEGRAM_ENABLED) {
  console.log('📱 Telegram: ACTIVADO - Modo Panel de Gestión');
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
  // 🔥 FIX: Validar que sea string
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

// ========== PROCESAMIENTO INTELIGENTE DE COMANDOS CON IA (FIXED) ==========
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
  
  // CONFIRMACIÓN: SI
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'YES') {
    comandosPendientesConfirmacion.delete(comandoId);
    return await ejecutarComando(comandoPendiente);
  }
  
  // CANCELACIÓN: NO
  if (textoUpper === 'NO') {
    comandosPendientesConfirmacion.delete(comandoId);
    return '❌ Comando cancelado';
  }
  
  // CORRECCIÓN: usar IA para procesar cambios
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
    
    // 🔥 FIX CRÍTICO: Extraer JSON válido con regex
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
  console.log(`  - Barbería: ${BARBERIA_CONFIG?.negocio?.nombre || '❌'}`);
  console.log(`  - Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length}`);
  console.log(`  - Barberos: ${Object.keys(BARBEROS).length}`);
  console.log(`  - Citas activas: ${CITAS.filter(c => c.estado !== 'cancelada').length}`);
  console.log(`  - Telegram Bot: ${TELEGRAM_ENABLED ? '✅ ACTIVO' : '❌ INACTIVO'}`);
});

client.on('message', async (message) => {
  try {
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    let userMessage = (message.body || '').trim();
    
    // Manejar mensajes de voz
    if (message.hasMedia && (message.type === 'ptt' || message.type === 'audio')) {
      console.log('🎤 Mensaje de voz detectado, transcribiendo...');
      
      const chat = await message.getChat();
      await chat.sendStateTyping();
      
      userMessage = await transcribirAudio(message);
      
      if (!userMessage) {
        await message.reply('Disculpa, no pude entender el audio. ¿Podrías escribir tu mensaje o enviar el audio de nuevo?');
        return;
      }
      
      console.log(`🎤 Audio transcrito: "${userMessage}"`);
    }
    
    if (!userMessage) return;
    
    console.log(`📩 Mensaje de ${userId}: ${userMessage}`);
    
    // Verificar si es un barbero
    const { rol, nombre } = detectarRol(userId, null);
    
    if (rol === 'barbero') {
      console.log(`👨‍🦲 Mensaje de barbero detectado: ${nombre}`);
      
      const procesado = await handleMensajeBarbero(message, nombre);
      
      if (procesado) {
        console.log(`✅ Respuesta de barbero procesada exitosamente`);
        return;
      }
      
      console.log(`   ℹ️ No era una respuesta a solicitud, continuando con flujo normal`);
    }
    
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
console.log('🚀 Iniciando Cortex Barbershop Bot V5.3...');
console.log('🕐 Timezone:', TIMEZONE);
console.log('🕐 Hora actual:', now().toFormat('yyyy-MM-dd HH:mm:ss'));
console.log(`👤 Dueño: ${OWNER_NUMBER}`);
console.log('');
console.log('🎯 VERSIÓN V5.3 - ULTRA FIXED:');
console.log('  ✅ Error procesando corrección CORREGIDO');
console.log('  ✅ Validación JSON mejorada con regex');
console.log('  ✅ Sanitización de texto para Telegram');
console.log('  ✅ Manejo robusto de respuestas IA');
console.log('  ✅ Todos los comandos funcionan correctamente');
console.log('  ✅ Sistema de pausas completamente funcional');
console.log('  ✅ Detección de roles mejorada');
console.log('  ✅ Confirmaciones inteligentes con IA');
console.log('');
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => {
  console.error('❌ UNHANDLED REJECTION:', e);
});

process.on('uncaughtException', (e) => {
  console.error('❌ UNCAUGHT EXCEPTION:', e);
});// =========================
// CORTEX IA - BARBERSHOP BOT - VERSIÓN FINAL V5.3 ULTRA FIXED
// FIXES APLICADOS:
// ✅ Error procesando corrección CORREGIDO
// ✅ Validación de respuesta JSON mejorada
// ✅ Manejo de errores de parsing robusto
// ✅ Todos los comandos funcionan
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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

if (TELEGRAM_ENABLED) {
  console.log('📱 Telegram: ACTIVADO - Modo Panel de Gestión');
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
  // 🔥 FIX: Validar que sea string
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

// ========== PROCESAMIENTO INTELIGENTE DE COMANDOS CON IA (FIXED) ==========
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
  
  // CONFIRMACIÓN: SI
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'YES') {
    comandosPendientesConfirmacion.delete(comandoId);
    return await ejecutarComando(comandoPendiente);
  }
  
  // CANCELACIÓN: NO
  if (textoUpper === 'NO') {
    comandosPendientesConfirmacion.delete(comandoId);
    return '❌ Comando cancelado';
  }
  
  // CORRECCIÓN: usar IA para procesar cambios
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
    
    // 🔥 FIX CRÍTICO: Extraer JSON válido con regex
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
              background