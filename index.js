// =========================
// CORTEX IA - BARBERSHOP BOT - VERSIÃ“N CORREGIDA V3
// FIXES: 
// - Notificaciones consolidadas (sin duplicados)
// - ID interno oculto en mensajes de barberos
// - Telegram bidireccional con asistencia para owner/barberos
// - Telegram puede ejecutar comandos y gestionar citas
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

// ========== CONFIGURACIÃ“N ==========
let OWNER_NUMBER = process.env.OWNER_NUMBER || '573223698554';
let OWNER_CHAT_ID = process.env.OWNER_WHATSAPP_ID || `${OWNER_NUMBER}@c.us`;

// ========== TELEGRAM CONFIGURATION ==========
const TELEGRAM_ENABLED = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Telegram Bot API (si estÃ¡ habilitado)
let telegramBot = null;

if (TELEGRAM_ENABLED) {
  console.log('ðŸ“± Telegram: ACTIVADO - Modo Panel de GestiÃ³n');
  console.log(`   Owner Chat ID: ${TELEGRAM_CHAT_ID}`);
} else {
  console.log('ðŸ“± Telegram: DESACTIVADO');
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
  console.error("âŒ FALTA OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== ðŸ›¡ï¸ ANTI-BAN: HUMAN-LIKE DELAYS ==========
const MIN_RESPONSE_DELAY = 2000;
const MAX_RESPONSE_DELAY = 5000;

function humanDelay() {
  const delay = Math.floor(Math.random() * (MAX_RESPONSE_DELAY - MIN_RESPONSE_DELAY + 1)) + MIN_RESPONSE_DELAY;
  console.log(`[ðŸ• ANTI-BAN] Waiting ${(delay/1000).toFixed(1)}s before responding...`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function sendWithTyping(chat, message) {
  try {
    await chat.sendStateTyping();
    await humanDelay();
    await chat.sendMessage(message);
    await chat.clearState();
  } catch (error) {
    console.log('[âš ï¸ ANTI-BAN] Typing state failed, using simple delay');
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

// GestiÃ³n de confirmaciones pendientes
const citasPendientesConfirmacion = new Map();
const respuestasBarberosPendientes = new Map();

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

// ========== INICIALIZACIÃ“N DE ARCHIVOS ==========
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
      console.log(`âœ… Creado: ${path.basename(file)}`);
    }
  }
  
  const uploadsBarbers = path.join(ROOT_DIR, 'barberos.json');
  if (fssync.existsSync(uploadsBarbers)) {
    try {
      const barbersData = await fs.readFile(uploadsBarbers, 'utf-8');
      const barbersObj = JSON.parse(barbersData);
      
      if (Object.keys(barbersObj).length > 0) {
        console.log('ðŸ“‹ Copiando barberos.json desde raÃ­z al directorio de datos...');
        await fs.writeFile(BARBERS_FILE, barbersData, 'utf-8');
        console.log(`âœ… ${Object.keys(barbersObj).length} barberos copiados: ${Object.keys(barbersObj).join(', ')}`);
      }
    } catch (e) {
      console.error('âŒ Error copiando barberos.json:', e.message);
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
    console.log('âœ… Datos cargados correctamente');
    console.log(`   - Citas: ${CITAS.length}`);
    console.log(`   - Barberos: ${Object.keys(BARBEROS).length}`);
    console.log(`   - Clientes: ${Object.keys(CLIENTES).length}`);
  } catch (error) {
    console.error('âŒ Error cargando datos:', error.message);
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
    console.log(`âœ… Config barberÃ­a cargada: ${BARBERIA_CONFIG.negocio.nombre}`);
  } catch (error) {
    console.error('âŒ Error cargando config barberÃ­a:', error.message);
  }
}

// ========== GESTIÃ“N DE CLIENTES ==========
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

// ========== GESTIÃ“N DE BARBEROS ==========
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

// ========== GESTIÃ“N DE CITAS ==========
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
  
  console.log(`ðŸ” Verificando disponibilidad:`);
  console.log(`   - Fecha: ${fecha}`);
  console.log(`   - Hora solicitada: ${hora} (${horaSolicitada.toISO()})`);
  console.log(`   - DuraciÃ³n: ${duracion} min`);
  console.log(`   - Hora fin: ${horaFin.toFormat('HH:mm')}`);
  console.log(`   - Barbero: ${barbero || 'Cualquiera'}`);
  
  const citasDelDia = obtenerCitasDelDia(fecha, barbero);
  console.log(`   - Citas existentes: ${citasDelDia.length}`);
  
  for (const cita of citasDelDia) {
    const citaInicio = parseDate(`${cita.fecha}T${cita.hora_inicio}`);
    const citaFin = citaInicio.plus({ minutes: cita.duracion || 30 });
    
    console.log(`   - Comparando con cita existente: ${cita.hora_inicio} - ${citaFin.toFormat('HH:mm')} (${cita.nombreCliente})`);
    
    if (horaSolicitada < citaFin && horaFin > citaInicio) {
      console.log(`   âŒ CONFLICTO DETECTADO con cita de ${cita.nombreCliente}`);
      return false;
    }
  }
  
  console.log(`   âœ… Horario disponible`);
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
    console.log(`âš ï¸ No hay horario configurado para el dÃ­a ${diaSemana}`);
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
    return { error: 'Error de configuraciÃ³n del sistema' };
  }
  
  const duracion = BARBERIA_CONFIG.servicios[servicio]?.min || 30;
  
  console.log(`ðŸ” VerificaciÃ³n final antes de crear cita:`);
  const disponible = verificarDisponibilidad(fecha, hora_inicio, duracion, barbero);
  
  if (!disponible) {
    console.log(`âŒ Horario NO disponible al intentar crear la cita`);
    return { error: 'Ese horario ya no estÃ¡ disponible' };
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
  
  console.log(`âœ… Cita creada exitosamente: ${cita.id}`);
  
  const cliente = getOrCreateClient(telefono, nombreCliente);
  cliente.totalCitas++;
  if (barbero) cliente.preferencias.barbero = barbero;
  cliente.preferencias.servicio = servicio;
  registrarAccionCliente(telefono, 'cita_creada', { citaId: cita.id, servicio, fecha, hora_inicio });
  
  await programarRecordatorio(cita);
  
  // âœ… Notificar al owner sobre nueva cita
  await notificarDueno(`ðŸ“… *NUEVA CITA*\n\nðŸ‘¤ Cliente: ${nombreCliente}\nðŸ’‡ Servicio: ${servicio}\nðŸ“† Fecha: ${fecha}\nðŸ• Hora: ${hora_inicio}\nðŸ‘¨â€ðŸ¦² Barbero: ${barbero || 'Cualquiera'}`);
  
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
    return { error: 'No encontrÃ© esa cita' };
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
  
  // âœ… Notificar al barbero sobre cancelaciÃ³n
  if (cita.barbero && cita.barbero !== 'Cualquiera' && BARBEROS[cita.barbero]) {
    const fechaDT = parseDate(cita.fecha);
    const fechaLegible = formatDate(fechaDT);
    
    await notificarBarbero(cita.barbero, 
      `âŒ *CITA CANCELADA*\n\n` +
      `ðŸ‘¤ Cliente: ${nombreCliente}\n` +
      `ðŸ“… Fecha: ${fechaLegible}\n` +
      `ðŸ• Hora: ${hora_inicio}`
    );
  }
  
  await notificarDueno(`âŒ *CITA CANCELADA*\n\nðŸ‘¤ Cliente: ${nombreCliente}\nðŸ“† Fecha: ${fecha}\nðŸ• Hora: ${hora_inicio}`);
  
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
      `Â¡Hola ${primero.nombreCliente}! ðŸŽ‰\n\nSe liberÃ³ un espacio para *${primero.servicio}* hoy a las *${horaDisponible}*.\n\nÂ¿Lo tomas? Responde *SÃ­* o *No*`
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
          `ðŸ”” *Recordatorio*\n\nHola ${cita.nombreCliente}! Te esperamos en 1 hora para tu *${cita.servicio}*.\n\nðŸ“ ${BARBERIA_CONFIG.negocio.direccion}\nðŸ• ${cita.hora_inicio}\n\nÂ¡Nos vemos pronto! ðŸ˜Š`
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
          `Â¡Hola ${cita.nombreCliente}! ðŸ˜Š\n\nEsperamos que hayas quedado contento con tu ${cita.servicio}.\n\nÂ¿Nos ayudas con una reseÃ±a? â­ï¸\n${GOOGLE_REVIEW_LINK}\n\nÂ¡Gracias por preferirnos!`
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
    console.error(`âš ï¸ No se pudo notificar a ${nombreBarbero}: sin telÃ©fono configurado`);
    return;
  }
  
  try {
    const chat = await client.getChatById(barbero.telefono);
    await sendWithTyping(chat, mensaje);
    console.log(`âœ… NotificaciÃ³n enviada a barbero ${nombreBarbero} por WhatsApp`);
    
    // TambiÃ©n enviar por Telegram si el barbero lo tiene configurado
    await notificarBarberoTelegram(nombreBarbero, mensaje);
  } catch (error) {
    console.error(`âŒ Error notificando a barbero ${nombreBarbero}:`, error.message);
  }
}

async function notificarDueno(mensaje, contextChatId = null) {
  try {
    const chat = await client.getChatById(OWNER_CHAT_ID);
    let fullMsg = mensaje;
    if (contextChatId) {
      fullMsg += `\n\nðŸ’¬ Chat: ${contextChatId}`;
    }
    await sendWithTyping(chat, fullMsg);
    
    // TambiÃ©n enviar a Telegram si estÃ¡ configurado
    if (TELEGRAM_ENABLED) {
      await enviarTelegram(fullMsg);
    }
  } catch (error) {
    console.error('âŒ Error notificando al dueÃ±o:', error.message);
  }
}

// ========== TELEGRAM NOTIFICATIONS ==========
async function enviarTelegram(mensaje, chatId = null) {
  if (!TELEGRAM_ENABLED) return;
  
  try {
    const https = require('https');
    const targetChatId = chatId || TELEGRAM_CHAT_ID;
    
    // Convertir markdown de WhatsApp a HTML de Telegram
    let telegramMsg = mensaje
      .replace(/\*(.*?)\*/g, '<b>$1</b>') // *texto* -> <b>texto</b>
      .replace(/_(.*?)_/g, '<i>$1</i>'); // _texto_ -> <i>texto</i>
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
      chat_id: targetChatId,
      text: telegramMsg,
      parse_mode: 'HTML'
    });
    
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('ðŸ“± NotificaciÃ³n enviada a Telegram');
            resolve(JSON.parse(responseData));
          } else {
            console.error('âŒ Error Telegram:', responseData);
            reject(new Error(`Telegram API error: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (err) => {
        console.error('âŒ Error enviando a Telegram:', err.message);
        reject(err);
      });
      
      req.write(data);
      req.end();
    });
  } catch (error) {
    console.error('âŒ Error en enviarTelegram:', error.message);
  }
}

async function notificarBarberoTelegram(nombreBarbero, mensaje) {
  const barbero = BARBEROS[nombreBarbero];
  if (barbero && barbero.telegram_chat_id && TELEGRAM_BOT_TOKEN) {
    try {
      await enviarTelegram(mensaje, barbero.telegram_chat_id);
      console.log(`ðŸ“± NotificaciÃ³n enviada a ${nombreBarbero} por Telegram`);
    } catch (error) {
      console.error(`âŒ Error notificando a ${nombreBarbero} por Telegram:`, error.message);
    }
  }
}

// ========== TELEGRAM BOT (BIDIRECCIONAL) - FIXED ==========
async function iniciarTelegramBot() {
  if (!TELEGRAM_ENABLED) return;
  
  const https = require('https');
  
  console.log('🤖 Iniciando Telegram Bot en modo Polling...');
  console.log(`   Bot Token: ${TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
  console.log(`   Chat ID: ${TELEGRAM_CHAT_ID}`);
  
  // Test inicial para verificar que el bot funciona
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
    const userId = update.message.from.id.toString();
    const userName = update.message.from.first_name || 'Usuario';
    
    console.log(`📱 [TELEGRAM] Mensaje de ${userName} (${chatId}): ${mensaje}`);
    
    // Verificar si es el owner
    const esOwner = chatId === TELEGRAM_CHAT_ID;
    
    // Verificar si es un barbero
    const esBarbero = Object.entries(BARBEROS).find(([nombre, data]) => 
      data.telegram_chat_id && data.telegram_chat_id.toString() === chatId
    );
    
    if (!esOwner && !esBarbero) {
      await enviarTelegram('❌ No tienes autorización para usar este bot.', chatId);
      return;
    }
    
    // Si es barbero, verificar si tiene respuesta pendiente
    if (esBarbero) {
      const [nombreBarbero, dataBarbero] = esBarbero;
      const procesado = await handleMensajeBarberoTelegram(mensaje, nombreBarbero, chatId);
      if (procesado) return;
    }
    
    // Procesar comandos
    if (mensaje.startsWith('/')) {
      const [command, ...args] = mensaje.split(' ');
      let respuesta;
      
      if (esBarbero && !esOwner) {
        // Comandos permitidos para barberos
        respuesta = await handleCommandTelegram(command, args, chatId, esBarbero[0], false);
      } else {
        // Owner tiene acceso a todos los comandos
        respuesta = await handleCommandTelegram(command, args, chatId, null, true);
      }
      
      if (respuesta) {
        await enviarTelegram(respuesta, chatId);
      }
    } else {
      // Mensaje no comando - asistencia
      const rolTxt = esOwner ? 'Owner' : esBarbero ? `Barbero (${esBarbero[0]})` : 'Usuario';
      await enviarTelegram(
        `👋 Hola ${userName}!\n\n` +
        `Soy el asistente del sistema de citas.\n\n` +
        `📋 Comandos disponibles:\n` +
        `/ayuda - Ver todos los comandos\n` +
        `/citas - Ver citas de hoy\n` +
        `/barberos - Ver estado de barberos\n\n` +
        `Tu rol: ${rolTxt}`,
        chatId
      );
    }
  };
  
  const getUpdates = async () => {
    if (isPolling) return; // Prevenir múltiples polling simultáneos
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
              console.log(`📬 Recibidos ${json.result.length} updates de Telegram`);
              for (const update of json.result) {
                await procesarActualizacion(update);
                offset = update.update_id + 1;
              }
            }
            
            // Continuar polling inmediatamente
            setImmediate(getUpdates);
          } catch (e) {
            console.error('❌ Error procesando updates de Telegram:', e.message);
            setTimeout(getUpdates, 5000);
          }
        });
      });
      
      req.on('error', (err) => {
        isPolling = false;
        console.error('❌ Error en Telegram polling:', err.message);
        setTimeout(getUpdates, 5000); // Reintentar en 5 segundos
      });
      
      // Timeout de 35 segundos (5 segundos más que el timeout del servidor)
      req.setTimeout(35000, () => {
        isPolling = false;
        req.destroy();
        console.log('⏱️ Timeout en polling, reintentando...');
        setImmediate(getUpdates);
      });
      
    } catch (error) {
      isPolling = false;
      console.error('❌ Error en getUpdates:', error.message);
      setTimeout(getUpdates, 5000);
    }
  };
  
  // Iniciar polling
  console.log('✅ Telegram Bot polling iniciado');
  getUpdates();
}

// Nueva función para testear la conexión
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

// Función mejorada para enviar mensajes
async function enviarTelegram(mensaje, chatId = null) {
  if (!TELEGRAM_ENABLED) return;
  
  try {
    const https = require('https');
    const targetChatId = chatId || TELEGRAM_CHAT_ID;
    
    // Convertir markdown de WhatsApp a HTML de Telegram
    let telegramMsg = mensaje
      .replace(/\*(.*?)\*/g, '<b>$1</b>') // *texto* -> <b>texto</b>
      .replace(/_(.*?)_/g, '<i>$1</i>'); // _texto_ -> <i>texto</i>
    
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

// ========== TRANSCRIPCIÃ“N DE AUDIO ==========
async function transcribirAudio(message) {
  try {
    const media = await message.downloadMedia();
    
    if (!media) {
      console.error('âŒ No se pudo descargar el audio');
      return null;
    }
    
    const audioBuffer = Buffer.from(media.data, 'base64');
    const tempPath = path.join(DATA_DIR, `temp_audio_${Date.now()}.ogg`);
    await fs.writeFile(tempPath, audioBuffer);
    
    console.log('ðŸŽ¤ Transcribiendo audio con Whisper...');
    
    const transcription = await openai.audio.transcriptions.create({
      file: require('fs').createReadStream(tempPath),
      model: 'whisper-1',
      language: 'es'
    });
    
    await fs.unlink(tempPath);
    
    console.log('âœ… Audio transcrito:', transcription.text);
    return transcription.text;
    
  } catch (error) {
    console.error('âŒ Error transcribiendo audio:', error.message);
    return null;
  }
}

// ========== COMANDOS ==========
async function handleCommand(command, args, userId) {
  const esOwner = userId === OWNER_CHAT_ID;
  const esBarbero = Object.values(BARBEROS).some(b => b.telefono === userId);
  
  switch (command) {
    case '/ayuda':
    case '/help':
      if (esOwner) {
        return `ðŸ“‹ *COMANDOS DISPONIBLES*\n\n` +
          `*GestiÃ³n General:*\n` +
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
          `/citas [nombre] - Citas de un barbero especÃ­fico\n` +
          `/agendar [nombre] [servicio] [hora] - Crear cita manual (walk-in)\n\n` +
          `*ConfiguraciÃ³n:*\n` +
          `/cerrar [hora inicial]-[hora final] - Bloquear horario\n` +
          `/abrir [hora inicial]-[hora final] - Liberar horario bloqueado`;
      } else if (esBarbero) {
        return `ðŸ“‹ *COMANDOS DISPONIBLES (Barbero)*\n\n` +
          `/citas - Tus citas de hoy\n` +
          `/disponibilidad - Tu horario de hoy\n` +
          `/descanso iniciar - Iniciar descanso\n` +
          `/descanso terminar - Terminar descanso\n` +
          `/cerrar [hora]-[hora] - Bloquear horario\n` +
          `/abrir [hora]-[hora] - Liberar horario`;
      }
      return 'Comando no disponible para tu rol.';
    
    case '/panel':
      if (!esOwner) return 'Solo el dueÃ±o puede acceder al panel.';
      return `ðŸ“Š *Panel de Control*\n\n${PANEL_URL}\n\nâœ… Desde ahÃ­ puedes ver todas las estadÃ­sticas y gestionar citas.`;
    
    case '/pausar':
      if (!esOwner) return 'Solo el dueÃ±o puede pausar el bot.';
      if (args[0] === 'todo') {
        return 'âš ï¸ *Â¿EstÃ¡s seguro?*\n\nEsto pausarÃ¡ el bot en *TODOS* los chats.\n\nResponde *SÃ­* para confirmar o *No* para cancelar.';
      } else {
        BOT_PAUSED_CHATS.add(userId);
        return 'â¸® Bot pausado en este chat. Usa /iniciar para reactivarlo.';
      }
    
    case '/iniciar':
      if (!esOwner) return 'Solo el dueÃ±o puede iniciar el bot.';
      if (args[0] === 'todo') {
        BOT_PAUSED_GLOBAL = false;
        BOT_PAUSED_CHATS.clear();
        return 'â–¶ï¸ Bot reactivado en todos los chats.';
      } else {
        BOT_PAUSED_CHATS.delete(userId);
        return 'â–¶ï¸ Bot reactivado en este chat.';
      }
    
    case '/barberos':
      let lista = '*ðŸ‘¨â€ðŸ¦² BARBEROS*\n\n';
      for (const [nombre, data] of Object.entries(BARBEROS)) {
        const estado = obtenerEstadoBarbero(nombre);
        const emoji = estado === 'disponible' ? 'ðŸŸ¢' : 
                      estado === 'en_cita' ? 'ðŸ”´' : 
                      estado === 'descanso' ? 'ðŸŸ¡' : 'âš«';
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
          return 'ðŸ“… No hay citas agendadas para hoy.';
        }
        let msg = `ðŸ“… *CITAS DE HOY (${now().toFormat('d/M/yyyy')})*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `ðŸ• ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   ðŸ’‡ ${cita.servicio}\n`;
          msg += `   ðŸ‘¨â€ðŸ¦² ${cita.barbero}\n\n`;
        }
        return msg;
      } else if (esBarbero) {
        const nombreBarbero = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
        const citasHoy = obtenerCitasDelDia(null, nombreBarbero);
        if (citasHoy.length === 0) {
          return 'ðŸ“… No tienes citas agendadas para hoy.';
        }
        let msg = `ðŸ“… *TUS CITAS DE HOY*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `ðŸ• ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   ðŸ’‡ ${cita.servicio}\n\n`;
        }
        return msg;
      } else if (esOwner && args.length > 0) {
        const nombreBarbero = args.join(' ');
        const citasHoy = obtenerCitasDelDia(null, nombreBarbero);
        if (citasHoy.length === 0) {
          return `ðŸ“… ${nombreBarbero} no tiene citas agendadas para hoy.`;
        }
        let msg = `ðŸ“… *CITAS DE ${nombreBarbero.toUpperCase()} HOY*\n\n`;
        citasHoy.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
        for (const cita of citasHoy) {
          msg += `ðŸ• ${cita.hora_inicio} - ${cita.nombreCliente}\n`;
          msg += `   ðŸ’‡ ${cita.servicio}\n\n`;
        }
        return msg;
      }
      return 'Uso: /citas general o /citas [nombre barbero]';
    
    case '/agendar':
      if (!esOwner && !esBarbero) return 'No tienes permiso para usar este comando.';
      if (args.length < 3) return 'Uso: /agendar [nombre] [servicio] [hora]\nEjemplo: /agendar Juan "corte clÃ¡sico" 4:30pm';
      
      const nombreCliente = args[0];
      const servicio = args[1];
      const horaStr = args[2];
      
      const hora24 = convertirA24h(horaStr);
      const fechaHoy = now().toFormat('yyyy-MM-dd');
      
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
        telefono: `WALKIN-${Date.now()}@c.us`
      });
      
      if (resultado.error) {
        return `âŒ ${resultado.error}`;
      }
      
      return `âœ… Cita creada:\n*${nombreCliente}* - ${servicio}\nðŸ“† Hoy a las ${horaStr}`;
    
    case '/disponibilidad':
      if (esBarbero) {
        const nombreBarbero = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
        const horario = obtenerHorarioDelDia(now().weekday);
        if (!horario) return 'No hay horario configurado para hoy.';
        const slots = obtenerProximosSlots(null, 10, null, nombreBarbero);
        return `ðŸ“… *Tu horario de hoy*\n\n` +
          `ðŸ• ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.length > 0 ? slots.join('\n') : 'No hay horarios disponibles'}`;
      } else if (esOwner && args.length > 0) {
        const nombreBarbero = args.join(' ');
        const horario = obtenerHorarioDelDia(now().weekday);
        if (!horario) return 'No hay horario configurado para hoy.';
        const slots = obtenerProximosSlots(null, 10, null, nombreBarbero);
        return `ðŸ“… *Horario de ${nombreBarbero}*\n\n` +
          `ðŸ• ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.length > 0 ? slots.join('\n') : 'No hay horarios disponibles'}`;
      }
      return 'Uso: /disponibilidad [nombre barbero]';
    
    default:
      return null;
  }
}

function detectarIdioma(texto) {
  const palabrasEsp = ['hola', 'gracias', 'por favor', 'quÃ©', 'cÃ³mo', 'cuÃ¡ndo', 'dÃ³nde', 'quiero', 'necesito'];
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
  
  if (userMessage.startsWith('/')) {
    const [command, ...args] = userMessage.split(' ');
    const respuesta = await handleCommand(command, args, chatId);
    if (respuesta) return respuesta;
  }
  
  if (!BARBERIA_CONFIG) {
    return 'Sistema en mantenimiento. Por favor intenta mÃ¡s tarde.';
  }
  
  let contextoCliente = '';
  if (esClienteRecurrente(userId)) {
    contextoCliente = `\n\nðŸ” CLIENTE RECURRENTE: ${cliente.nombre} (${cliente.totalCitas} citas anteriores)`;
    if (cliente.preferencias.servicio) {
      contextoCliente += `\nÃšltimo servicio: ${cliente.preferencias.servicio}`;
    }
    if (cliente.preferencias.barbero) {
      contextoCliente += `\nBarbero preferido: ${cliente.preferencias.barbero}`;
    }
  }
  
  const slotsHoy = obtenerProximosSlots(null, 5);
  const slotsTxt = slotsHoy.length > 0 ? slotsHoy.join(', ') : 'No hay horarios disponibles hoy';
  
  const serviciosTxt = Object.entries(BARBERIA_CONFIG.servicios)
    .map(([nombre, data]) => `â€¢ ${nombre} - ${data.precio.toLocaleString()} (${data.min} min)`)
    .join('\n');
  
  const barberosTxt = Object.entries(BARBEROS)
    .map(([nombre, data]) => {
      const estado = obtenerEstadoBarbero(nombre);
      const especialidades = data.especialidades ? ` (${data.especialidades.join(', ')})` : '';
      return `â€¢ ${nombre}${especialidades} - ${estado}`;
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
    systemPrompt += '\n\nðŸŒ RESPONDE EN INGLÃ‰S. El cliente estÃ¡ escribiendo en inglÃ©s.';
  }
  
  const jsonInstructions = `

ðŸš¨ðŸš¨ðŸš¨ FORMATO JSON CRÃTICO ðŸš¨ðŸš¨ðŸš¨

Cuando uses <BOOKING:...> o <CANCELLED:...>, el JSON DEBE ser VÃLIDO.

âœ… FORMATO CORRECTO (copia exactamente este patrÃ³n):
<BOOKING:{"nombreCliente":"JosÃ©","servicio":"corte clÃ¡sico","fecha":"2025-11-05","hora_inicio":"09:00","barbero":"Liliana"}>

âŒ NUNCA HAGAS ESTO:
- NO uses backslashes: {\\"nombreCliente\\":\\"JosÃ©\\"}
- NO uses comillas simples: {'nombreCliente':'JosÃ©'}
- NO pongas espacios extras
- NO rompas el JSON en mÃºltiples lÃ­neas

REGLAS OBLIGATORIAS:
1. Comillas dobles DIRECTAS (") para claves y valores
2. Sin espacios innecesarios
3. Fecha siempre: YYYY-MM-DD
4. Hora siempre en 24h: HH:MM (ej: 09:00, 14:30, 16:00)
5. Nombre EXACTO del servicio como aparece en la lista
6. BARBERO: MUY IMPORTANTE
   - Si el cliente menciona un barbero especÃ­fico (ej: "con Liliana", "que me atienda Mafe"), usa ESE nombre EXACTO
   - Si NO menciona ningÃºn barbero, usa "Cualquiera"
   - Nombres vÃ¡lidos: ${Object.keys(BARBEROS).join(', ')}

ðŸš¨ CRÃTICO: SIEMPRE VERIFICA QUE LA HORA ESTÃ‰ EN LA LISTA DE HORARIOS DISPONIBLES ANTES DE EMITIR EL TAG.
Si el cliente pide una hora que NO estÃ¡ en {slotsDisponiblesHoy}, NO emitas el tag y ofrece las horas disponibles.

ðŸš¨ DETECCIÃ“N DE BARBERO ESPECÃFICO:
- "con Liliana" / "Liliana" â†’ barbero: "Liliana"
- "con Mafe" / "Mafe" â†’ barbero: "Mafe"  
- "con Ani" / "Ani" â†’ barbero: "Ani"
- "me da igual" / no menciona â†’ barbero: "Cualquiera"

IMPORTANTE: DespuÃ©s de emitir el tag con barbero especÃ­fico, el sistema automÃ¡ticamente contacta al barbero para confirmar disponibilidad. NO menciones esto al cliente hasta que haya confirmaciÃ³n.
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
      'Â¿Te ayudo con algo mÃ¡s?';
    
    respuesta = await procesarTags(respuesta, userId, cliente.nombre);
    
    state.conversationHistory.push({ role: 'assistant', content: respuesta });
    
    return respuesta;
    
  } catch (e) {
    console.error('OpenAI error:', e.message);
    await notificarDueno(
      `âŒ *ERROR OPENAI*\nUsuario: ${chatId}\nMsg: "${userMessage}"\n${e.message}`,
      chatId
    );
    return state.idioma === 'en' ? 
      'Sorry, something went wrong. Can you repeat that?' :
      'Uy, se me enredÃ³ algo aquÃ­. Â¿Me repites porfa? ðŸ™';
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
      
      console.log('ðŸ“‹ JSON limpio para parsear:', jsonStr);
      
      const datos = JSON.parse(jsonStr);
      
      datos.telefono = userId;
      datos.nombreCliente = datos.nombreCliente || nombreCliente;
      
      // âœ… NUEVO FLUJO: Si hay barbero especÃ­fico, preguntar PRIMERO
      if (datos.barbero && datos.barbero !== 'Cualquiera' && BARBEROS[datos.barbero]) {
        console.log(`ðŸ“ž Iniciando flujo de confirmaciÃ³n con barbero: ${datos.barbero}`);
        
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
          
          // âœ… FIX: Mensaje consolidado SIN ID visible
          const mensajeSolicitud = 
            `ðŸ”” *SOLICITUD DE CITA*\n\n` +
            `ðŸ‘¤ Cliente: ${datos.nombreCliente}\n` +
            `ðŸ’‡ Servicio: ${datos.servicio}\n` +
            `ðŸ“… Fecha: ${fechaLegible}\n` +
            `ðŸ• Hora: ${datos.hora_inicio}\n\n` +
            `Â¿Puedes atender esta cita?\n\n` +
            `âœ… *SI* para confirmar\n` +
            `âŒ *NO* si no puedes\n` +
            `â° O sugiere otra hora (ej: "3:00 PM mejor")`;
          
          // Enviar por WhatsApp
          const barberoChat = await client.getChatById(barbero.telefono);
          await sendWithTyping(barberoChat, mensajeSolicitud);
          
          // Enviar por Telegram si estÃ¡ configurado
          if (barbero.telegram_chat_id) {
            await enviarTelegram(mensajeSolicitud, barbero.telegram_chat_id);
          }
          
          // Marcar que este barbero estÃ¡ esperando respuesta
          respuestasBarberosPendientes.set(barbero.telefono, { citaId, tipo: 'confirmacion' });
          
          // Timeout: si no responde en 2 minutos
          const timeout = setTimeout(async () => {
            if (citasPendientesConfirmacion.has(citaId)) {
              citasPendientesConfirmacion.delete(citaId);
              respuestasBarberosPendientes.delete(barbero.telefono);
              
              try {
                const clientChat = await client.getChatById(userId);
                await sendWithTyping(clientChat,
                  `â° ${datos.barbero} no respondiÃ³ a tiempo. Â¿QuerÃ©s agendar con otro barbero o intentar mÃ¡s tarde?`
                );
              } catch (e) {
                console.error('Error notificando timeout:', e);
              }
            }
          }, 120000);
          
          citasPendientesConfirmacion.get(citaId).timeout = timeout;
          
          respuesta = respuesta.replace(/<BOOKING:.+?>/, 
            `\n\nâ³ Estoy consultando con ${datos.barbero} si puede atenderte. Te confirmo en un momentito...`
          );
          
        } catch (e) {
          console.error('âŒ Error notificando a barbero:', e);
          const resultado = await crearCita(datos);
          if (resultado.error) {
            respuesta = respuesta.replace(/<BOOKING:.+?>/, `\n\nâŒ ${resultado.error}`);
          } else {
            respuesta = respuesta.replace(/<BOOKING:.+?>/, '');
          }
        }
      } else {
        console.log(`ðŸ”“ Creando cita sin confirmaciÃ³n previa (barbero: ${datos.barbero || 'Cualquiera'})`);
        const resultado = await crearCita(datos);
        
        if (resultado.error) {
          console.error('âŒ Error al crear la cita:', resultado.error);
          respuesta = respuesta.replace(/<BOOKING:.+?>/, `\n\nâŒ ${resultado.error}`);
        } else {
          console.log('âœ… Cita creada exitosamente:', resultado.cita.id);
          respuesta = respuesta.replace(/<BOOKING:.+?>/, '');
        }
      }
      
    } catch (e) {
      console.error('âŒ Error procesando BOOKING:', e.message);
      respuesta = respuesta.replace(/<BOOKING:.+?>/, '\n\nâŒ Error al procesar la cita (formato incorrecto)');
      
      await notificarDueno(
        `âŒ *ERROR PROCESANDO BOOKING*\n\nUsuario: ${userId}\nJSON: ${bookingMatch[1]}\nError: ${e.message}`
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
        respuesta = respuesta.replace(/<CANCELLED:.+?>/, `\n\nâŒ ${resultado.error}`);
      } else {
        respuesta = respuesta.replace(/<CANCELLED:.+?>/, '');
      }
    } catch (e) {
      console.error('âŒ Error procesando CANCELLED:', e.message);
      respuesta = respuesta.replace(/<CANCELLED:.+?>/, '\n\nâŒ Error al cancelar la cita');
    }
  }
  
  return respuesta;
}

async function handleMensajeBarbero(message, nombreBarbero) {
  const barberoTelefono = message.from;
  const texto = message.body.trim();
  
  console.log(`ðŸ“ž Mensaje de barbero ${nombreBarbero}: "${texto}"`);
  
  const pendiente = respuestasBarberosPendientes.get(barberoTelefono);
  
  if (!pendiente) {
    console.log(`   â„¹ï¸ No hay respuestas pendientes para este barbero`);
    return false;
  }
  
  const { citaId, tipo } = pendiente;
  const solicitud = citasPendientesConfirmacion.get(citaId);
  
  if (!solicitud) {
    console.log(`   âš ï¸ Solicitud ${citaId} ya no existe`);
    respuestasBarberosPendientes.delete(barberoTelefono);
    return false;
  }
  
  const textoUpper = texto.toUpperCase();
  
  // âœ… CASO 1: Barbero confirma con SI
  if (textoUpper === 'SI' || textoUpper === 'SÃ' || textoUpper === 'YES') {
    console.log(`   âœ… Barbero confirmÃ³ la cita`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    const resultado = await crearCita(solicitud.datos);
    
    if (resultado.error) {
      await message.reply(`âŒ Error al confirmar: ${resultado.error}`);
      
      try {
        const clientChat = await client.getChatById(solicitud.clienteChatId);
        await sendWithTyping(clientChat, 
          `âŒ Hubo un problema al confirmar tu cita. ${resultado.error}\n\nÂ¿QuerÃ©s intentar con otro horario?`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    } else {
      const fechaDT = parseDate(resultado.cita.fecha);
      const fechaLegible = formatDate(fechaDT);
      
      // âœ… FIX: Respuesta consolidada sin duplicados
      await message.reply(
        `âœ… *Cita confirmada*\n\n` +
        `ðŸ‘¤ ${resultado.cita.nombreCliente}\n` +
        `ðŸ’‡ ${resultado.cita.servicio}\n` +
        `ðŸ“… ${fechaLegible}\n` +
        `ðŸ• ${resultado.cita.hora_inicio}`
      );
      
      try {
        const clientChat = await client.getChatById(solicitud.clienteChatId);
        await sendWithTyping(clientChat,
          `âœ… *Â¡Confirmado!*\n\n` +
          `${nombreBarbero} aceptÃ³ tu cita:\n\n` +
          `ðŸ’‡ ${resultado.cita.servicio}\n` +
          `ðŸ“… ${fechaLegible}\n` +
          `ðŸ• ${resultado.cita.hora_inicio}\n\n` +
          `Â¡Te esperamos! ðŸ’ˆ`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    }
    
    return true;
  }
  
  // âŒ CASO 2: Barbero rechaza con NO
  if (textoUpper === 'NO') {
    console.log(`   âŒ Barbero rechazÃ³ la cita`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    await message.reply(
      `âŒ Entendido. La cita fue rechazada.\n\nEl cliente serÃ¡ notificado.`
    );
    
    try {
      const clientChat = await client.getChatById(solicitud.clienteChatId);
      await sendWithTyping(clientChat,
        `ðŸ˜” ${nombreBarbero} no estÃ¡ disponible en ese horario.\n\n` +
        `Â¿Te ofrezco otro horario o preferÃ­s con otro barbero?`
      );
    } catch (e) {
      console.error('Error notificando cliente:', e);
    }
    
    return true;
  }
  
  // â° CASO 3: Barbero sugiere otra hora
  const horaMatch = texto.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/i);
  if (horaMatch) {
    console.log(`   â° Barbero sugiriÃ³ otra hora: ${texto}`);
    
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    const horaSugerida = horaMatch[0];
    
    await message.reply(
      `ðŸ‘ Perfecto, voy a ofrecerle al cliente el horario de ${horaSugerida}.`
    );
    
    try {
      const clientChat = await client.getChatById(solicitud.clienteChatId);
      await sendWithTyping(clientChat,
        `${nombreBarbero} sugiere mejor a las *${horaSugerida}* para tu ${solicitud.datos.servicio}.\n\n` +
        `Â¿Te sirve ese horario?`
      );
    } catch (e) {
      console.error('Error notificando cliente:', e);
    }
    
    return true;
  }
  
  console.log(`   â„¹ï¸ Respuesta no reconocida, continuando con flujo normal`);
  return false;
}

// ========== EXPRESS SERVER ==========
const app = express();
app.use(express.json());

let latestQR = null;

app.get('/', (req, res) => res.send('âœ… Cortex Barbershop Bot is running! ðŸ’ˆ'));

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
            <h1>âœ… CORTEX BARBERSHOP BOT</h1>
            <div class="status">
              <div class="checkmark">âœ”</div>
              <h2 style="color: #00ff00; margin: 0;">SesiÃ³n Activa</h2>
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
          <h2>â³ Iniciando Bot...</h2>
          <p>Generando cÃ³digo QR...</p>
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
          <h1>ðŸ’ˆ Cortex Barbershop Bot</h1>
          <p>Escanea el QR con WhatsApp:</p>
          <div class="qr-container">
            ${qrSVG}
          </div>
          <p><small>La pÃ¡gina se actualizarÃ¡ automÃ¡ticamente</small></p>
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
  console.log(`ðŸŒ Servidor Express corriendo en puerto ${PORT}`);
});

// ========== WHATSAPP EVENTS ==========
client.on('qr', (qr) => {
  console.log('ðŸ“± CÃ³digo QR generado!');
  console.log('ðŸŒ Abre este link para escanear:');
  console.log(`\n   ðŸ‘‰ http://localhost:${PORT}/qr\n`);
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('âœ… Cliente de WhatsApp listo!');
  console.log(`ðŸ‘¤ Notificaciones al dueÃ±o: ${OWNER_NUMBER}`);
  latestQR = null;
  
  await initDataFiles();
  await cargarConfigBarberia();
  
  // Iniciar Telegram Bot si estÃ¡ habilitado
  if (TELEGRAM_ENABLED) {
    await iniciarTelegramBot();
  }
  
  console.log('ðŸ“‹ Estado del sistema:');
  console.log(`  - BarberÃ­a: ${BARBERIA_CONFIG?.negocio?.nombre || 'âŒ'}`);
  console.log(`  - Servicios: ${Object.keys(BARBERIA_CONFIG?.servicios || {}).length}`);
  console.log(`  - Barberos: ${Object.keys(BARBEROS).length}`);
  console.log(`  - Citas activas: ${CITAS.filter(c => c.estado !== 'cancelada').length}`);
  console.log(`  - Telegram Bot: ${TELEGRAM_ENABLED ? 'âœ… ACTIVO' : 'âŒ INACTIVO'}`);
});

client.on('message', async (message) => {
  try {
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    let userMessage = (message.body || '').trim();
    
    // ðŸŽ¤ Manejar mensajes de voz
    if (message.hasMedia && (message.type === 'ptt' || message.type === 'audio')) {
      console.log('ðŸŽ¤ Mensaje de voz detectado, transcribiendo...');
      
      const chat = await message.getChat();
      await chat.sendStateTyping();
      
      userMessage = await transcribirAudio(message);
      
      if (!userMessage) {
        await message.reply('Disculpa, no pude entender el audio. Â¿PodrÃ­as escribir tu mensaje o enviar el audio de nuevo?');
        return;
      }
      
      console.log(`ðŸŽ¤ Audio transcrito: "${userMessage}"`);
    }
    
    if (!userMessage) return;
    
    console.log(`ðŸ“© Mensaje de ${userId}: ${userMessage}`);
    
    // âœ… Verificar si es un barbero con respuestas pendientes
    const esBarbero = Object.entries(BARBEROS).find(([nombre, data]) => data.telefono === userId);
    
    if (esBarbero) {
      const [nombreBarbero, dataBarbero] = esBarbero;
      console.log(`ðŸ‘¨â€ðŸ¦² Mensaje de barbero detectado: ${nombreBarbero}`);
      
      const procesado = await handleMensajeBarbero(message, nombreBarbero);
      
      if (procesado) {
        console.log(`âœ… Respuesta de barbero procesada exitosamente`);
        return;
      }
      
      console.log(`   â„¹ï¸ No era una respuesta a solicitud, continuando con flujo normal`);
    }
    
    const respuesta = await chatWithAI(userMessage, userId, message.from);
    
    if (respuesta) {
      await humanDelay();
      await message.reply(respuesta);
    }
    
  } catch (e) {
    console.error('âŒ Error procesando mensaje:', e.message);
    try {
      await notificarDueno(
        `âŒ *ERROR HANDLER*\nUsuario: ${message.from}\nError: ${e.message}`,
        message.from
      );
    } catch (notifyError) {
      console.error('âŒ Error notificando sobre error:', notifyError.message);
    }
  }
});

client.on('disconnected', (r) => { 
  console.log('âŒ Cliente desconectado:', r); 
  latestQR = null;
});

client.on('auth_failure', (msg) => {
  console.error('âŒ Fallo de autenticaciÃ³n:', msg);
  latestQR = null;
});

// ========== START ==========
console.log('ðŸš€ Iniciando Cortex Barbershop Bot...');
console.log('ðŸ• Timezone:', TIMEZONE);
console.log('ðŸ• Hora actual:', now().toFormat('yyyy-MM-dd HH:mm:ss'));
console.log(`ðŸ‘¤ DueÃ±o: ${OWNER_NUMBER}`);
console.log('');
console.log('ðŸ”§ VERSIÃ“N V3 - CORRECCIONES APLICADAS:');
console.log('  âœ… Notificaciones consolidadas (sin duplicados)');
console.log('  âœ… ID interno oculto en mensajes de barberos');
console.log('  âœ… Telegram bidireccional (owner + barberos)');
console.log('  âœ… Telegram puede ejecutar comandos');
console.log('  âœ… ConfirmaciÃ³n de citas desde Telegram');
console.log('');
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => {
  console.error('âŒ UNHANDLED REJECTION:', e);
});

process.on('uncaughtException', (e) => {
  console.error('âŒ UNCAUGHT EXCEPTION:', e);
});