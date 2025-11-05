// =========================
// CORTEX IA - BARBERSHOP BOT - VERSIÓN CORREGIDA V2
// FIXES: 
// - Verificación correcta de disponibilidad antes de crear cita
// - Flujo de confirmación con barbero ANTES de confirmar al cliente
// - Notificaciones correctas (barbero recibe confirmación, owner recibe alertas)
// - El barbero puede sugerir otro horario
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
let BARBEROS = {};
let CITAS = [];
let WAITLIST = [];
let CLIENTES = {};
const userStates = new Map();
let BOT_PAUSED_GLOBAL = false;
let BOT_PAUSED_CHATS = new Set();

// Nuevo: Gestión de confirmaciones pendientes
const citasPendientesConfirmacion = new Map(); // { citaId: { datos, clienteChatId, barbero, timestamp, timeout } }
const respuestasBarberosPendientes = new Map(); // { barberoId: { citaId, tipo } } para saber qué espera el barbero

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
    console.error('⚠️  Verifica que barberia_base.txt esté en la raíz del proyecto');
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

/**
 * FUNCIÓN CRÍTICA: Verificar si un horario está disponible
 * Esta función verifica CORRECTAMENTE que no haya solapamiento de citas
 */
function verificarDisponibilidad(fecha, hora, duracion, barbero = null) {
  const horaSolicitada = parseDate(`${fecha}T${hora}`);
  const horaFin = horaSolicitada.plus({ minutes: duracion });
  
  console.log(`🔍 Verificando disponibilidad:`);
  console.log(`   - Fecha: ${fecha}`);
  console.log(`   - Hora solicitada: ${hora} (${horaSolicitada.toISO()})`);
  console.log(`   - Duración: ${duracion} min`);
  console.log(`   - Hora fin: ${horaFin.toFormat('HH:mm')}`);
  console.log(`   - Barbero: ${barbero || 'Cualquiera'}`);
  
  const citasDelDia = obtenerCitasDelDia(fecha, barbero);
  console.log(`   - Citas existentes: ${citasDelDia.length}`);
  
  for (const cita of citasDelDia) {
    const citaInicio = parseDate(`${cita.fecha}T${cita.hora_inicio}`);
    const citaFin = citaInicio.plus({ minutes: cita.duracion || 30 });
    
    console.log(`   - Comparando con cita existente: ${cita.hora_inicio} - ${citaFin.toFormat('HH:mm')} (${cita.nombreCliente})`);
    
    // Verificar si hay solapamiento
    // Hay conflicto SI: la hora solicitada es ANTES del fin de la cita existente
    // Y la hora de fin solicitada es DESPUÉS del inicio de la cita existente
    if (horaSolicitada < citaFin && horaFin > citaInicio) {
      console.log(`   ❌ CONFLICTO DETECTADO con cita de ${cita.nombreCliente}`);
      return false;
    }
  }
  
  console.log(`   ✅ Horario disponible`);
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
    console.log(`⚠️  No hay horario configurado para el día ${diaSemana}`);
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
  
  // Si es HOY, solo mostrar horarios futuros
  if (fechaBuscar === ahora.toFormat('yyyy-MM-dd')) {
    const minutoActual = ahora.hour * 60 + ahora.minute;
    const minutoApertura = aperturaH * 60 + aperturaM;
    
    if (minutoActual > minutoApertura) {
      // Redondear al próximo slot de 30 minutos
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
    
    // Respetar hora de almuerzo
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
  
  // VERIFICACIÓN CRÍTICA: Verificar disponibilidad JUSTO ANTES de crear
  console.log(`🔍 Verificación final antes de crear cita:`);
  const disponible = verificarDisponibilidad(fecha, hora_inicio, duracion, barbero);
  
  if (!disponible) {
    console.log(`❌ Horario NO disponible al intentar crear la cita`);
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
  
  console.log(`✅ Cita creada exitosamente: ${cita.id}`);
  
  const cliente = getOrCreateClient(telefono, nombreCliente);
  cliente.totalCitas++;
  if (barbero) cliente.preferencias.barbero = barbero;
  cliente.preferencias.servicio = servicio;
  registrarAccionCliente(telefono, 'cita_creada', { citaId: cita.id, servicio, fecha, hora_inicio });
  
  await programarRecordatorio(cita);
  
  // ✅ NOTIFICAR AL BARBERO sobre la cita confirmada
  if (barbero && barbero !== 'Cualquiera' && BARBEROS[barbero]) {
    const fechaDT = parseDate(fecha);
    const fechaLegible = formatDate(fechaDT);
    
    await notificarBarbero(barbero, 
      `✅ *CITA CONFIRMADA*\n\n` +
      `👤 Cliente: ${nombreCliente}\n` +
      `💇 Servicio: ${servicio}\n` +
      `📅 Fecha: ${fechaLegible}\n` +
      `🕐 Hora: ${hora_inicio}\n` +
      `⏱️ Duración: ${duracion} min`
    );
  }
  
  // ✅ NOTIFICAR AL OWNER sobre nueva cita
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
  
  // ✅ NOTIFICAR AL BARBERO sobre cancelación
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
  
  // ✅ NOTIFICAR AL OWNER sobre cancelación
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
    console.log(`✅ Notificación enviada a barbero ${nombreBarbero}`);
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
  } catch (error) {
    console.error('❌ Error notificando al dueño:', error.message);
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
      if (args.length < 3) return 'Uso: /agendar [nombre] [servicio] [hora]\nEjemplo: /agendar Juan "corte clásico" 4:30pm';
      
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
        return `❌ ${resultado.error}`;
      }
      
      return `✅ Cita creada:\n*${nombreCliente}* - ${servicio}\n📆 Hoy a las ${horaStr}`;
    
    case '/disponibilidad':
      if (esBarbero) {
        const nombreBarbero = Object.keys(BARBEROS).find(n => BARBEROS[n].telefono === userId);
        const horario = obtenerHorarioDelDia(now().weekday);
        if (!horario) return 'No hay horario configurado para hoy.';
        const slots = obtenerProximosSlots(null, 10, null, nombreBarbero);
        return `📅 *Tu horario de hoy*\n\n` +
          `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.length > 0 ? slots.join('\n') : 'No hay horarios disponibles'}`;
      } else if (esOwner && args.length > 0) {
        const nombreBarbero = args.join(' ');
        const horario = obtenerHorarioDelDia(now().weekday);
        if (!horario) return 'No hay horario configurado para hoy.';
        const slots = obtenerProximosSlots(null, 10, null, nombreBarbero);
        return `📅 *Horario de ${nombreBarbero}*\n\n` +
          `🕐 ${horario.inicio} - ${horario.fin}\n\n` +
          `*Horarios disponibles:*\n${slots.length > 0 ? slots.join('\n') : 'No hay horarios disponibles'}`;
      }
      return 'Uso: /disponibilidad [nombre barbero]';
    
    default:
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
  
  if (userMessage.startsWith('/')) {
    const [command, ...args] = userMessage.split(' ');
    const respuesta = await handleCommand(command, args, chatId);
    if (respuesta) return respuesta;
  }
  
  if (!BARBERIA_CONFIG) {
    return 'Sistema en mantenimiento. Por favor intenta más tarde.';
  }
  
  let contextoCliente = '';
  if (esClienteRecurrente(userId)) {
    contextoCliente = `\n\n📝 CLIENTE RECURRENTE: ${cliente.nombre} (${cliente.totalCitas} citas anteriores)`;
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
    .map(([nombre, data]) => `• ${nombre} - $${data.precio.toLocaleString()} (${data.min} min)`)
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
    systemPrompt += '\n\n🌐 RESPONDE EN INGLÉS. El cliente está escribiendo en inglés.';
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
6. Si no hay barbero específico: "Cualquiera"

🚨 CRÍTICO: SIEMPRE VERIFICA QUE LA HORA ESTÉ EN LA LISTA DE HORARIOS DISPONIBLES ANTES DE EMITIR EL TAG.
Si el cliente pide una hora que NO está en {slotsDisponiblesHoy}, NO emitas el tag y ofrece las horas disponibles.

IMPORTANTE: Después de emitir el tag, el sistema automáticamente contacta al barbero para confirmar. NO menciones esto al cliente.
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
      'Uy, se me enredó algo aquí. ¿Me repites porfa? 🙏';
  }
}

/**
 * FUNCIÓN CRÍTICA: Procesar tags de booking y cancelación
 * NUEVO FLUJO:
 * 1. Se detecta <BOOKING:...>
 * 2. Si hay barbero específico: se le pregunta PRIMERO
 * 3. El barbero puede responder: SI, NO, o sugerir otra hora
 * 4. Solo si el barbero dice SI, se crea la cita
 * 5. Se notifica al cliente con la confirmación
 */
async function procesarTags(respuesta, userId, nombreCliente) {
  const bookingMatch = respuesta.match(/<BOOKING:(.+?)>/);
  if (bookingMatch) {
    try {
      let jsonStr = bookingMatch[1].trim();
      
      // Limpieza agresiva del JSON
      jsonStr = jsonStr.replace(/\\\\/g, '');
      jsonStr = jsonStr.replace(/\\"/g, '"');
      jsonStr = jsonStr.replace(/\\'/g, "'");
      jsonStr = jsonStr.replace(/'/g, '"');
      
      console.log('📋 JSON limpio para parsear:', jsonStr);
      
      const datos = JSON.parse(jsonStr);
      
      datos.telefono = userId;
      datos.nombreCliente = datos.nombreCliente || nombreCliente;
      
      // ✅ NUEVO FLUJO: Si hay barbero específico, preguntar PRIMERO
      if (datos.barbero && datos.barbero !== 'Cualquiera' && BARBEROS[datos.barbero]) {
        console.log(`📞 Iniciando flujo de confirmación con barbero: ${datos.barbero}`);
        
        const citaId = `PEND-${Date.now()}`;
        
        // Guardar la solicitud pendiente
        citasPendientesConfirmacion.set(citaId, {
          datos,
          clienteChatId: userId,
          timestamp: Date.now()
        });
        
        const barbero = BARBEROS[datos.barbero];
        try {
          const barberoChat = await client.getChatById(barbero.telefono);
          
          const fechaDT = parseDate(datos.fecha);
          const fechaLegible = formatDate(fechaDT);
          
          // Enviar solicitud al barbero
          await sendWithTyping(barberoChat,
            `🔔 *SOLICITUD DE CITA*\n\n` +
            `👤 Cliente: ${datos.nombreCliente}\n` +
            `💇 Servicio: ${datos.servicio}\n` +
            `📅 Fecha: ${fechaLegible}\n` +
            `🕐 Hora: ${datos.hora_inicio}\n\n` +
            `¿Puedes atender esta cita?\n\n` +
            `Responde:\n` +
            `✅ *SI* para confirmar\n` +
            `❌ *NO* si no puedes\n` +
            `⏰ O sugiere otra hora (ej: "3:00 PM mejor")\n\n` +
            `ID: ${citaId}`
          );
          
          // Marcar que este barbero está esperando respuesta
          respuestasBarberosPendientes.set(barbero.telefono, { citaId, tipo: 'confirmacion' });
          
          // Timeout: si no responde en 2 minutos
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
          }, 120000); // 2 minutos
          
          citasPendientesConfirmacion.get(citaId).timeout = timeout;
          
          // Reemplazar el tag en la respuesta al cliente
          respuesta = respuesta.replace(/<BOOKING:.+?>/, 
            `\n\n⏳ Estoy consultando con ${datos.barbero} si puede atenderte. Te confirmo en un momentito...`
          );
          
        } catch (e) {
          console.error('❌ Error notificando a barbero:', e);
          // Si falla la notificación al barbero, crear la cita directamente
          const resultado = await crearCita(datos);
          if (resultado.error) {
            respuesta = respuesta.replace(/<BOOKING:.+?>/, `\n\n❌ ${resultado.error}`);
          } else {
            respuesta = respuesta.replace(/<BOOKING:.+?>/, '');
          }
        }
      } else {
        // Sin barbero específico o barbero = "Cualquiera": crear directamente
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
      console.error('JSON problemático:', bookingMatch[1]);
      respuesta = respuesta.replace(/<BOOKING:.+?>/, '\n\n❌ Error al procesar la cita (formato incorrecto)');
      
      // Notificar al owner sobre el error
      await notificarDueno(
        `❌ *ERROR PROCESANDO BOOKING*\n\nUsuario: ${userId}\nJSON: ${bookingMatch[1]}\nError: ${e.message}`
      );
    }
  }
  
  // Procesar cancelaciones
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

/**
 * FUNCIÓN CRÍTICA: Manejar mensajes de barberos
 * Este handler se ejecuta ANTES que el chatWithAI para barberos
 * Detecta respuestas a solicitudes de citas pendientes
 */
async function handleMensajeBarbero(message, nombreBarbero) {
  const barberoTelefono = message.from;
  const texto = message.body.trim();
  
  console.log(`📞 Mensaje de barbero ${nombreBarbero}: "${texto}"`);
  
  // Verificar si este barbero tiene una respuesta pendiente
  const pendiente = respuestasBarberosPendientes.get(barberoTelefono);
  
  if (!pendiente) {
    console.log(`   ℹ️ No hay respuestas pendientes para este barbero`);
    return false; // No hay nada pendiente, continuar con flujo normal
  }
  
  const { citaId, tipo } = pendiente;
  const solicitud = citasPendientesConfirmacion.get(citaId);
  
  if (!solicitud) {
    console.log(`   ⚠️ Solicitud ${citaId} ya no existe`);
    respuestasBarberosPendientes.delete(barberoTelefono);
    return false;
  }
  
  const textoUpper = texto.toUpperCase();
  
  // ✅ CASO 1: Barbero confirma con SI
  if (textoUpper === 'SI' || textoUpper === 'SÍ' || textoUpper === 'SÃ' || textoUpper === 'YES') {
    console.log(`   ✅ Barbero confirmó la cita`);
    
    // Limpiar timeout y mapas
    clearTimeout(solicitud.timeout);
    citasPendientesConfirmacion.delete(citaId);
    respuestasBarberosPendientes.delete(barberoTelefono);
    
    // Crear la cita
    const resultado = await crearCita(solicitud.datos);
    
    if (resultado.error) {
      // Error al crear la cita
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
      // Cita creada exitosamente
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
          `¡Te esperamos! 💈`
        );
      } catch (e) {
        console.error('Error notificando cliente:', e);
      }
    }
    
    return true; // Mensaje procesado, no continuar con chatWithAI
  }
  
  // ❌ CASO 2: Barbero rechaza con NO
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
    
    return true; // Mensaje procesado
  }
  
  // ⏰ CASO 3: Barbero sugiere otra hora
  // Detectar patrones como "3:00 PM mejor", "mejor a las 4", "10:30 am"
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
    
    return true; // Mensaje procesado
  }
  
  // Si no es ninguno de los casos anteriores, podría ser otra cosa
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
  console.log(`\n   👉 http://localhost:${PORT}/qr\n`);
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Cliente de WhatsApp listo!');
  console.log(`👤 Notificaciones al dueño: ${OWNER_NUMBER}`);
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
    
    // ✅ CRÍTICO: Verificar si es un barbero y si tiene respuestas pendientes
    const esBarbero = Object.entries(BARBEROS).find(([nombre, data]) => data.telefono === userId);
    
    if (esBarbero) {
      const [nombreBarbero, dataBarbero] = esBarbero;
      console.log(`👨‍🦲 Mensaje de barbero detectado: ${nombreBarbero}`);
      
      // Intentar procesar como respuesta a solicitud pendiente
      const procesado = await handleMensajeBarbero(message, nombreBarbero);
      
      if (procesado) {
        console.log(`✅ Respuesta de barbero procesada exitosamente`);
        return; // No continuar con chatWithAI
      }
      
      console.log(`   ℹ️ No era una respuesta a solicitud, continuando con flujo normal`);
    }
    
    // Procesar mensaje normalmente con IA
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
console.log('');
console.log('🔧 VERSIÓN V2 - CORRECCIONES APLICADAS:');
console.log('  ✅ Fix verificación de disponibilidad mejorada con logs');
console.log('  ✅ Fix flujo de confirmación con barbero ANTES de crear cita');
console.log('  ✅ Fix barbero puede sugerir otra hora');
console.log('  ✅ Fix notificaciones correctas (barbero = confirmación, owner = alertas)');
console.log('  ✅ Fix detección de conflictos de horarios');
console.log('  ✅ Fix validación de horarios disponibles antes de emitir BOOKING tag');
console.log('');
client.initialize();

// ========== GLOBAL ERRORS ==========
process.on('unhandledRejection', (e) => {
  console.error('❌ UNHANDLED REJECTION:', e);
});

process.on('uncaughtException', (e) => {
  console.error('❌ UNCAUGHT EXCEPTION:', e);
});