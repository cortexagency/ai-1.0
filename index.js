require('dotenv').config();
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const { DateTime } = require('luxon');
const express = require('express');

// ========== CONFIGURACIÓN ==========
const OWNER_NUMBER = process.env.OWNER_NUMBER || '573001234567'; // Número del dueño (formato: 57300...)
const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/TU_LINK_AQUI/review';
const TIMEZONE = 'America/Bogota';
const PORT = process.env.PORT || 3000;

// Cliente de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Cliente de WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

// Express server (keep-alive para Railway + servir QR)
const app = express();
let latestQR = null;

app.get('/', (req, res) => res.send('Cortex AI Bot is running! 🤖'));

app.get('/qr', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cortex AI Bot - QR Code</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="3">
          <style>
            body {
              font-family: monospace;
              background: #000;
              color: #0f0;
              padding: 20px;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div>
            <h2>⏳ Generando código QR...</h2>
            <p>La página se actualizará automáticamente</p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    // Generar QR como SVG (más confiable)
    const qrSVG = await QRCode.toString(latestQR, { 
      type: 'svg',
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cortex AI Bot - Escanea QR</title>
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
            .container {
              text-align: center;
              max-width: 500px;
            }
            h1 {
              color: #00ff00;
              margin-bottom: 20px;
              font-size: 24px;
            }
            .qr-box {
              background: white;
              padding: 30px;
              border-radius: 15px;
              display: inline-block;
              margin: 20px 0;
              box-shadow: 0 10px 40px rgba(0, 255, 0, 0.3);
            }
            .instructions {
              background: rgba(255, 255, 255, 0.1);
              padding: 20px;
              border-radius: 10px;
              margin-top: 20px;
              text-align: left;
              line-height: 1.8;
            }
            .instructions ol {
              padding-left: 20px;
            }
            .warning {
              background: rgba(255, 100, 0, 0.2);
              border-left: 4px solid #ff6400;
              padding: 15px;
              margin-top: 15px;
              border-radius: 5px;
              text-align: left;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 CORTEX AI BOT</h1>
            
            <div class="qr-box">
              ${qrSVG}
            </div>
            
            <div class="instructions">
              <strong>📋 Pasos para vincular:</strong>
              <ol>
                <li>Abre <strong>WhatsApp</strong> en tu celular</li>
                <li>Ve a <strong>Menú (⋮)</strong> → <strong>Dispositivos vinculados</strong></li>
                <li>Toca <strong>"Vincular un dispositivo"</strong></li>
                <li><strong>Escanea este QR</strong> directamente desde WhatsApp</li>
              </ol>
            </div>
            
            <div class="warning">
              <strong>⚠️ Si no funciona:</strong><br>
              Usa la app de <strong>Cámara</strong> de tu celular, apunta a la pantalla y abre el link que aparece
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: monospace;
              background: #000;
              color: #f00;
              padding: 20px;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <h1>❌ Error generando QR</h1>
          <p>${error.message}</p>
          <p><a href="/qr" style="color: #0f0;">Reintentar</a></p>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => console.log(`✅ HTTP server on port ${PORT}`));

// ========== ARCHIVOS DE DATOS ==========
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'user_bookings.json');
const RESERVAS_FILE = path.join(__dirname, 'demo_reservas.json');
const SCHEDULED_MESSAGES_FILE = path.join(DATA_DIR, 'scheduled_messages.json');

// ========== INICIALIZACIÓN DE ARCHIVOS ==========
async function initDataFiles() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // user_bookings.json
    try {
      await fs.access(BOOKINGS_FILE);
    } catch {
      await fs.writeFile(BOOKINGS_FILE, JSON.stringify([], null, 2));
      console.log('✅ Creado user_bookings.json');
    }
    
    // scheduled_messages.json
    try {
      await fs.access(SCHEDULED_MESSAGES_FILE);
    } catch {
      await fs.writeFile(SCHEDULED_MESSAGES_FILE, JSON.stringify([], null, 2));
      console.log('✅ Creado scheduled_messages.json');
    }
  } catch (error) {
    console.error('❌ Error inicializando archivos:', error);
  }
}

// ========== FUNCIONES DE LECTURA/ESCRITURA ==========
async function readBookings() {
  try {
    const data = await fs.readFile(BOOKINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeBookings(bookings) {
  await fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

async function readReservas() {
  try {
    const data = await fs.readFile(RESERVAS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeReservas(reservas) {
  await fs.writeFile(RESERVAS_FILE, JSON.stringify(reservas, null, 2));
}

async function readScheduledMessages() {
  try {
    const data = await fs.readFile(SCHEDULED_MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeScheduledMessages(messages) {
  await fs.writeFile(SCHEDULED_MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// ========== FUNCIONES DE SLOTS ==========
function calcularSlotsUsados(horaInicio, duracionMin) {
  const SLOT_BASE_MIN = 20;
  const numSlots = Math.ceil(duracionMin / SLOT_BASE_MIN);
  
  const [hora, minuto] = horaInicio.split(':').map(Number);
  const slots = [];
  
  for (let i = 0; i < numSlots; i++) {
    const totalMin = hora * 60 + minuto + (i * SLOT_BASE_MIN);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    slots.push(h * 3 + Math.floor(m / 20));
  }
  
  return slots;
}

function formatearHora(horaInicio) {
  const [h, m] = horaInicio.split(':').map(Number);
  const periodo = h >= 12 ? 'PM' : 'AM';
  const hora12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${hora12}:${m.toString().padStart(2, '0')} ${periodo}`;
}

// ========== CARGAR CONFIGURACIÓN DE BARBERÍA ==========
let BARBERIA_CONFIG = null;

async function cargarConfigBarberia() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'barberia_base.txt'), 'utf8');
    BARBERIA_CONFIG = JSON.parse(data);
    console.log('✅ Configuración de barbería cargada');
  } catch (error) {
    console.error('❌ Error cargando barberia_base.txt:', error);
    BARBERIA_CONFIG = { servicios: {} };
  }
}

// ========== CARGAR PROMPT DE VENTAS ==========
let VENTAS_PROMPT = '';

async function cargarVentasPrompt() {
  try {
    VENTAS_PROMPT = await fs.readFile(path.join(__dirname, 'ventas.txt'), 'utf8');
    console.log('✅ Prompt de ventas cargado');
  } catch (error) {
    console.error('❌ Error cargando ventas.txt:', error);
  }
}

// ========== ESTADO DE USUARIO ==========
const userStates = new Map();

function getUserState(userId) {
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      mode: 'sales', // 'sales' o 'demo'
      conversationHistory: [],
      botEnabled: true
    });
  }
  return userStates.get(userId);
}

// ========== PROCESAMIENTO DE TAGS ==========
async function procesarTags(mensaje, chatId) {
  const bookingMatch = mensaje.match(/<BOOKING:\s*({[^>]+})>/);
  const cancelMatch = mensaje.match(/<CANCELLED:\s*({[^>]+})>/);
  
  if (bookingMatch) {
    try {
      const bookingData = JSON.parse(bookingMatch[1]);
      
      // Agregar ID único y chatId
      bookingData.id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      bookingData.chatId = chatId;
      bookingData.createdAt = new Date().toISOString();
      bookingData.status = 'confirmed';
      
      // Guardar en user_bookings.json
      const bookings = await readBookings();
      bookings.push(bookingData);
      await writeBookings(bookings);
      
      // Actualizar demo_reservas.json
      const reservas = await readReservas();
      if (!reservas[bookingData.fecha]) {
        reservas[bookingData.fecha] = [];
      }
      
      const horaFormateada = formatearHora(bookingData.hora_inicio);
      if (!reservas[bookingData.fecha].includes(horaFormateada)) {
        reservas[bookingData.fecha].push(horaFormateada);
      }
      
      await writeReservas(reservas);
      
      // Programar confirmación 2 horas antes
      await programarConfirmacion(bookingData);
      
      // Programar recordatorio 30 minutos antes
      await programarRecordatorio(bookingData);
      
      // Programar solicitud de reseña (1 día después)
      await programarResena(bookingData);
      
      // Programar mensaje "Te extrañamos" (2 semanas después)
      await programarExtranamos(bookingData);
      
      console.log('✅ Booking guardado:', bookingData.id);
      
      // Notificar al dueño
      await notificarDueno(`📅 *Nueva cita agendada*\n\n👤 Cliente: ${bookingData.nombreCliente}\n🔧 Servicio: ${bookingData.servicio}\n📆 Fecha: ${bookingData.fecha}\n⏰ Hora: ${horaFormateada}`);
    } catch (error) {
      console.error('❌ Error procesando BOOKING:', error);
    }
    
    // Eliminar el tag del mensaje
    return mensaje.replace(/<BOOKING:[^>]+>/, '').trim();
  }
  
  if (cancelMatch) {
    try {
      const cancelData = JSON.parse(cancelMatch[1]);
      const bookings = await readBookings();
      
      const booking = bookings.find(b => b.id === cancelData.id);
      if (booking) {
        booking.status = 'cancelled';
        await writeBookings(bookings);
        
        // Actualizar demo_reservas.json
        const reservas = await readReservas();
        if (reservas[booking.fecha]) {
          const horaFormateada = formatearHora(booking.hora_inicio);
          reservas[booking.fecha] = reservas[booking.fecha].filter(h => h !== horaFormateada);
          await writeReservas(reservas);
        }
        
        console.log('✅ Booking cancelado:', cancelData.id);
        
        // Notificar al dueño
        await notificarDueno(`❌ *Cita cancelada*\n\n👤 Cliente: ${booking.nombreCliente}\n🔧 Servicio: ${booking.servicio}\n📆 Fecha: ${booking.fecha}\n⏰ Hora: ${formatearHora(booking.hora_inicio)}`);
      }
    } catch (error) {
      console.error('❌ Error procesando CANCELLED:', error);
    }
    
    return mensaje.replace(/<CANCELLED:[^>]+>/, '').trim();
  }
  
  return mensaje;
}

// ========== NOTIFICAR AL DUEÑO ==========
async function notificarDueno(mensaje) {
  try {
    const chatId = `${OWNER_NUMBER}@c.us`;
    await client.sendMessage(chatId, mensaje);
    console.log('✅ Notificación enviada al dueño');
  } catch (error) {
    console.error('❌ Error notificando al dueño:', error);
  }
}

// ========== PROGRAMAR CONFIRMACIÓN 2H ANTES ==========
async function programarConfirmacion(booking) {
  try {
    const [year, month, day] = booking.fecha.split('-').map(Number);
    const [hora, minuto] = booking.hora_inicio.split(':').map(Number);
    
    const fechaCita = DateTime.fromObject({
      year, month, day, hour: hora, minute: minuto
    }, { zone: TIMEZONE });
    
    const fechaConfirmacion = fechaCita.minus({ hours: 2 });
    
    if (fechaConfirmacion > DateTime.now()) {
      const messages = await readScheduledMessages();
      messages.push({
        id: `confirm_${booking.id}`,
        chatId: booking.chatId,
        scheduledFor: fechaConfirmacion.toISO(),
        type: 'confirmation',
        message: `👋 Hola ${booking.nombreCliente}! Te recordamos tu cita de *${booking.servicio}* hoy a las ${formatearHora(booking.hora_inicio)}.\n\n¿Confirmas que asistirás? Responde *SÍ* o *NO*.`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
      console.log('✅ Confirmación programada para', fechaConfirmacion.toISO());
    }
  } catch (error) {
    console.error('❌ Error programando confirmación:', error);
  }
}

// ========== PROGRAMAR RECORDATORIO 30MIN ANTES ==========
async function programarRecordatorio(booking) {
  try {
    const [year, month, day] = booking.fecha.split('-').map(Number);
    const [hora, minuto] = booking.hora_inicio.split(':').map(Number);
    
    const fechaCita = DateTime.fromObject({
      year, month, day, hour: hora, minute: minuto
    }, { zone: TIMEZONE });
    
    const fechaRecordatorio = fechaCita.minus({ minutes: 30 });
    
    if (fechaRecordatorio > DateTime.now()) {
      const messages = await readScheduledMessages();
      messages.push({
        id: `reminder_${booking.id}`,
        chatId: booking.chatId,
        scheduledFor: fechaRecordatorio.toISO(),
        type: 'reminder',
        message: `⏰ *Recordatorio*\n\nHola ${booking.nombreCliente}! Tu cita de *${booking.servicio}* es en 30 minutos (${formatearHora(booking.hora_inicio)}).\n\nNos vemos pronto! 💈`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
      console.log('✅ Recordatorio programado para', fechaRecordatorio.toISO());
    }
  } catch (error) {
    console.error('❌ Error programando recordatorio:', error);
  }
}

// ========== PROGRAMAR SOLICITUD DE RESEÑA (1 DÍA DESPUÉS) ==========
async function programarResena(booking) {
  try {
    const [year, month, day] = booking.fecha.split('-').map(Number);
    const [hora, minuto] = booking.hora_inicio.split(':').map(Number);
    
    const fechaCita = DateTime.fromObject({
      year, month, day, hour: hora, minute: minuto
    }, { zone: TIMEZONE });
    
    const fechaResena = fechaCita.plus({ days: 1, hours: 2 }); // 1 día + 2 horas después
    
    if (fechaResena > DateTime.now()) {
      const messages = await readScheduledMessages();
      messages.push({
        id: `review_${booking.id}`,
        chatId: booking.chatId,
        scheduledFor: fechaResena.toISO(),
        type: 'review',
        message: `⭐ Hola ${booking.nombreCliente}!\n\nEsperamos que hayas quedado muy contento con tu *${booking.servicio}* 😊\n\n¿Nos ayudas con una reseña en Google? Nos ayuda mucho a seguir creciendo:\n\n${GOOGLE_REVIEW_LINK}\n\n¡Gracias por tu apoyo! 💈`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
      console.log('✅ Solicitud de reseña programada para', fechaResena.toISO());
    }
  } catch (error) {
    console.error('❌ Error programando reseña:', error);
  }
}

// ========== PROGRAMAR MENSAJE "TE EXTRAÑAMOS" (2 SEMANAS DESPUÉS) ==========
async function programarExtranamos(booking) {
  try {
    const [year, month, day] = booking.fecha.split('-').map(Number);
    const [hora, minuto] = booking.hora_inicio.split(':').map(Number);
    
    const fechaCita = DateTime.fromObject({
      year, month, day, hour: hora, minute: minuto
    }, { zone: TIMEZONE });
    
    const fechaExtranamos = fechaCita.plus({ weeks: 2 });
    
    if (fechaExtranamos > DateTime.now()) {
      const messages = await readScheduledMessages();
      messages.push({
        id: `winback_${booking.id}`,
        chatId: booking.chatId,
        scheduledFor: fechaExtranamos.toISO(),
        type: 'winback',
        message: `👋 Hola ${booking.nombreCliente}! ¿Cómo vas?\n\nYa hace un tiempo que no te vemos por aquí 🙁\n\n*¡Tenemos un 10% de descuento especial para ti!* 🎉\n\n¿Agendamos tu próxima cita? 💈`,
        bookingId: booking.id
      });
      await writeScheduledMessages(messages);
      console.log('✅ Mensaje "Te extrañamos" programado para', fechaExtranamos.toISO());
    }
  } catch (error) {
    console.error('❌ Error programando mensaje "Te extrañamos":', error);
  }
}

// ========== ENVIAR MENSAJES PROGRAMADOS ==========
async function enviarMensajesProgramados() {
  try {
    const messages = await readScheduledMessages();
    const now = DateTime.now();
    const pendientes = [];
    
    for (const msg of messages) {
      const scheduledTime = DateTime.fromISO(msg.scheduledFor);
      
      if (scheduledTime <= now) {
        // Enviar mensaje
        try {
          await client.sendMessage(msg.chatId, msg.message);
          console.log(`✅ Mensaje ${msg.type} enviado:`, msg.id);
        } catch (error) {
          console.error(`❌ Error enviando mensaje ${msg.id}:`, error);
          // Si falla, lo guardamos para reintentar
          pendientes.push(msg);
        }
      } else {
        pendientes.push(msg);
      }
    }
    
    await writeScheduledMessages(pendientes);
  } catch (error) {
    console.error('❌ Error en enviarMensajesProgramados:', error);
  }
}

// Ejecutar cada minuto
setInterval(enviarMensajesProgramados, 60000);

// ========== COMANDO /show bookings ==========
async function mostrarReservas(chatId) {
  try {
    const bookings = await readBookings();
    const ahora = DateTime.now().setZone(TIMEZONE);
    
    const citasFuturas = bookings.filter(b => {
      if (b.status === 'cancelled') return false;
      const [year, month, day] = b.fecha.split('-').map(Number);
      const fechaCita = DateTime.fromObject({ year, month, day }, { zone: TIMEZONE });
      return fechaCita >= ahora.startOf('day');
    });
    
    if (citasFuturas.length === 0) {
      return '📅 *No hay citas programadas*\n\nNo tienes citas futuras en este momento.';
    }
    
    citasFuturas.sort((a, b) => {
      const dateA = new Date(a.fecha + 'T' + a.hora_inicio);
      const dateB = new Date(b.fecha + 'T' + b.hora_inicio);
      return dateA - dateB;
    });
    
    let mensaje = '📅 *CITAS PROGRAMADAS*\n\n';
    
    citasFuturas.forEach((cita, index) => {
      const [year, month, day] = cita.fecha.split('-').map(Number);
      const fechaDT = DateTime.fromObject({ year, month, day }, { zone: TIMEZONE });
      const fechaLegible = fechaDT.setLocale('es').toFormat('EEEE d \'de\' MMMM');
      
      mensaje += `${index + 1}. 👤 *${cita.nombreCliente}*\n`;
      mensaje += `   🔧 ${cita.servicio}\n`;
      mensaje += `   📆 ${fechaLegible}\n`;
      mensaje += `   ⏰ ${formatearHora(cita.hora_inicio)}\n\n`;
    });
    
    return mensaje.trim();
  } catch (error) {
    console.error('❌ Error en mostrarReservas:', error);
    return '❌ Error al cargar las reservas. Intenta de nuevo.';
  }
}

// ========== COMANDO /send later ==========
async function programarMensajePersonalizado(args, fromChatId) {
  try {
    // Formato esperado: /send later "numero" "fecha hora" "mensaje"
    // Ejemplo: /send later "573001234567" "2025-10-25 10:30" "Hola! Recordatorio de tu cotización"
    
    const regex = /"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/;
    const match = args.match(regex);
    
    if (!match) {
      return '❌ Formato incorrecto.\n\nUso correcto:\n`/send later "573001234567" "2025-10-25 10:30" "Tu mensaje aquí"`\n\n📝 Formato de fecha: YYYY-MM-DD HH:MM';
    }
    
    const [, numero, fechaHora, mensaje] = match;
    
    // Validar número (debe empezar con código de país)
    if (!/^\d{10,15}$/.test(numero)) {
      return '❌ Número inválido. Debe incluir código de país sin + (ej: 573001234567)';
    }
    
    // Parsear fecha y hora
    const fechaHoraDT = DateTime.fromFormat(fechaHora, 'yyyy-MM-dd HH:mm', { zone: TIMEZONE });
    
    if (!fechaHoraDT.isValid) {
      return '❌ Fecha/hora inválida.\n\nFormato correcto: YYYY-MM-DD HH:MM\nEjemplo: 2025-10-25 14:30';
    }
    
    if (fechaHoraDT <= DateTime.now()) {
      return '❌ La fecha/hora debe ser futura.';
    }
    
    // Guardar mensaje programado
    const messages = await readScheduledMessages();
    const nuevoMensaje = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      chatId: `${numero}@c.us`,
      scheduledFor: fechaHoraDT.toISO(),
      type: 'custom',
      message: mensaje,
      scheduledBy: fromChatId
    };
    
    messages.push(nuevoMensaje);
    await writeScheduledMessages(messages);
    
    const fechaLegible = fechaHoraDT.setLocale('es').toFormat('EEEE d \'de\' MMMM \'a las\' HH:mm');
    
    return `✅ *Mensaje programado*\n\n📱 Para: ${numero}\n📅 ${fechaLegible}\n💬 "${mensaje}"\n\n🔔 Se enviará automáticamente en la fecha indicada.`;
    
  } catch (error) {
    console.error('❌ Error en programarMensajePersonalizado:', error);
    return '❌ Error al programar el mensaje. Revisa el formato e intenta de nuevo.';
  }
}

// ========== CHAT CON OPENAI ==========
async function chatWithAI(userMessage, userId, chatId) {
  const state = getUserState(userId);

  // 👇 **BLOQUE MOVIDO AQUÍ** (antes estaba pegado al final y rompía el archivo)
  if (userMessage.toLowerCase().includes('/bot off')) {
    state.botEnabled = false;
    return '✅ Bot desactivado. Escribe `/bot on` para reactivarlo.';
  }
  
  if (userMessage.toLowerCase().includes('/bot on')) {
    state.botEnabled = true;
    return '✅ Bot reactivado. Estoy aquí para ayudarte 24/7 💪';
  }
  
  if (userMessage.toLowerCase().includes('/show bookings')) {
    return await mostrarReservas(chatId);
  }
  
  if (userMessage.toLowerCase().startsWith('/send later')) {
    const args = userMessage.replace('/send later', '').trim();
    return await programarMensajePersonalizado(args, chatId);
  }
  
  if (!state.botEnabled) {
    return null; // No responder si el bot está desactivado
  }
  
  // Cambiar entre modo ventas y demo
  if (userMessage.toLowerCase().includes('/start test')) {
    state.mode = 'demo';
    state.conversationHistory = [];
    return '✅ *Demo activada*\n\nAhora estás hablando con el Asistente Cortex Barbershop. Puedes probar agendar una cita, consultar servicios, horarios, etc.\n\n💡 Escribe `/end test` para volver al modo ventas.';
  }

  // Comandos especiales
  if (userMessage.toLowerCase().includes('/end test')) {
    state.mode = 'sales';
    state.conversationHistory = [];
    return '✅ *Demo finalizada*\n\n¿Qué tal la experiencia? 😊\n\nSi te gustó, el siguiente paso es dejar uno igual en tu WhatsApp (con tus horarios, precios y tono).\n\n¿Prefieres una llamada rápida de 10 min o te paso los pasos por aquí?';
  }
  
  // Detectar si el bot no sabe responder y alertar al dueño
  const palabrasEmergencia = ['urgente', 'emergencia', 'problema grave', 'queja seria'];
  const esEmergencia = palabrasEmergencia.some(p => userMessage.toLowerCase().includes(p));
  
  if (esEmergencia) {
    await notificarDueno(`🚨 *ALERTA DE EMERGENCIA*\n\nUsuario: ${chatId}\nMensaje: "${userMessage}"\n\n⚠️ Requiere atención inmediata.`);
  }
  
  // Construir contexto según el modo
  let systemPrompt = '';
  
  if (state.mode === 'demo') {
    // Modo Demo: Asistente de Barbería
    const hoy = DateTime.now().setZone(TIMEZONE);
    const diaSemanaTxt = hoy.setLocale('es').toFormat('EEEE');
    const fechaHoyTxt = hoy.toFormat('yyyy-MM-dd');
    
    // Leer reservas existentes
    const reservas = await readReservas();
    const reservasHoy = reservas[fechaHoyTxt] || [];
    
    // Construir system prompt desde barberia_base.txt
    if (BARBERIA_CONFIG && BARBERIA_CONFIG.system_prompt) {
      systemPrompt = BARBERIA_CONFIG.system_prompt
        .replace(/{hoy}/g, fechaHoyTxt)
        .replace(/{diaSemana}/g, diaSemanaTxt)
        .replace(/{nombreBarberia}/g, BARBERIA_CONFIG.negocio?.nombre || 'Barbería')
        .replace(/{direccionBarberia}/g, BARBERIA_CONFIG.negocio?.direccion || '')
        .replace(/{telefonoBarberia}/g, BARBERIA_CONFIG.negocio?.telefono || '')
        .replace(/{horarioLv}/g, BARBERIA_CONFIG.horario?.lun_vie || '')
        .replace(/{horarioS}/g, BARBERIA_CONFIG.horario?.sab || '')
        .replace(/{horarioD}/g, BARBERIA_CONFIG.horario?.dom || '')
        .replace(/{horarioHoy}/g, BARBERIA_CONFIG.horario?.lun_vie || '')
        .replace(/{serviciosTxt}/g, generarTextoServicios())
        .replace(/{faqsBarberia}/g, generarTextoFAQs())
        .replace(/{pagosBarberia}/g, BARBERIA_CONFIG.pagos?.join(', ') || '')
        .replace(/{upsellText}/g, BARBERIA_CONFIG.upsell || '')
        .replace(/{slotsTxt}/g, `Hoy hay ${reservasHoy.length} reservas: ${reservasHoy.join(', ')}`);
    }
  } else {
    // Modo Ventas
    systemPrompt = VENTAS_PROMPT || 'Eres Cortex IA, asistente de Cortex Agency (Colombia). Tu misión es ayudar a dueños de negocio a dejar de perder clientes por WhatsApp. Hablas como un parcero joven, profesional, claro y amable. Respuestas cortas: máximo 3-4 líneas. Emojis: 1 cada 2-3 mensajes máximo.';
  }
  
  // Agregar mensaje del usuario al historial
  state.conversationHistory.push({
    role: 'user',
    content: userMessage
  });
  
  // Limitar historial a últimos 20 mensajes
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
      temperature: state.mode === 'demo' ? 0.4 : 0.6,
      max_tokens: 500
    });
    
    let respuesta = completion.choices[0].message.content.trim();
    
    // Procesar tags (solo en modo demo)
    if (state.mode === 'demo') {
      respuesta = await procesarTags(respuesta, chatId);
    }
    
    // Detectar si el bot no sabe responder
    const frasesNoSabe = [
      'no estoy seguro',
      'no tengo esa información',
      'no puedo ayudarte con eso',
      'necesito confirmarlo',
      'no sé'
    ];
    
    const noSabeResponder = frasesNoSabe.some(frase => respuesta.toLowerCase().includes(frase));
    
    if (noSabeResponder) {
      await notificarDueno(`❓ *BOT NO SABE RESPONDER*\n\nUsuario: ${chatId}\nPregunta: "${userMessage}"\nRespuesta del bot: "${respuesta}"\n\n💡 Puede requerir tu atención.`);
    }
    
    // Agregar respuesta al historial
    state.conversationHistory.push({
      role: 'assistant',
      content: respuesta
    });
    
    return respuesta;
    
  } catch (error) {
    console.error('❌ Error en OpenAI:', error);
    await notificarDueno(`❌ *ERROR DEL BOT*\n\nUsuario: ${chatId}\nMensaje: "${userMessage}"\nError: ${error.message}\n\n⚠️ Sistema requiere revisión.`);
    return '❌ Disculpa, tuve un problema técnico. ¿Puedes repetir tu pregunta?';
  }
}

// ========== FUNCIONES AUXILIARES PARA SYSTEM PROMPT ==========
function generarTextoServicios() {
  if (!BARBERIA_CONFIG || !BARBERIA_CONFIG.servicios) return '';
  
  const servicios = Object.entries(BARBERIA_CONFIG.servicios);
  return servicios.map(([nombre, datos]) => {
    const emoji = datos.emoji || '✂️';
    return `${emoji} ${nombre} — ${datos.precio.toLocaleString()} — ${datos.min} min`;
  }).join('\n');
}

function generarTextoFAQs() {
  if (!BARBERIA_CONFIG || !BARBERIA_CONFIG.faqs) return '';
  
  return BARBERIA_CONFIG.faqs.map((faq, i) => {
    return `${i + 1}. ${faq.q}\n   → ${faq.a}`;
  }).join('\n\n');
}

// ========== EVENTOS DE WHATSAPP ==========
client.on('qr', (qr) => {
  console.log('📱 Código QR generado!');
  console.log('🌐 Abre este link para escanear:');
  console.log(`\n   👉 https://tu-app.up.railway.app/qr\n`);
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Cliente de WhatsApp listo!');
  latestQR = null; // Limpiar QR una vez conectado
  await initDataFiles();
  await cargarConfigBarberia();
  await cargarVentasPrompt();
});

client.on('message', async (message) => {
  try {
    // Ignorar mensajes de grupos y del propio bot
    if (message.from.includes('@g.us') || message.fromMe) return;
    
    const userId = message.from;
    const userMessage = message.body;
    
    console.log(`📩 Mensaje de ${userId}: ${userMessage}`);
    
    // Verificar si el bot está habilitado para este usuario
    const state = getUserState(userId);
    
    // Comandos que funcionan aunque el bot esté off
    const comandosEspeciales = ['/bot on', '/bot off', '/show bookings', '/send later'];
    const esComandoEspecial = comandosEspeciales.some(cmd => userMessage.toLowerCase().includes(cmd));
    
    if (!state.botEnabled && !esComandoEspecial) {
      return; // No responder
    }
    
    // Procesar con IA
    const respuesta = await chatWithAI(userMessage, userId, message.from);
    
    if (respuesta) {
      // NO mostrar "escribiendo..." - enviar directo
      await message.reply(respuesta);
    }
    
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    await notificarDueno(`❌ *ERROR CRÍTICO*\n\nError procesando mensaje de ${message.from}\n\nDetalles: ${error.message}`);
  }
});

client.on('disconnected', (reason) => {
  console.log('❌ Cliente desconectado:', reason);
  latestQR = null;
});

// ========== INICIAR CLIENTE ==========
console.log('🚀 Iniciando Cortex AI Bot...');
client.initialize();

// ========== MANEJO DE ERRORES GLOBAL ==========
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});
