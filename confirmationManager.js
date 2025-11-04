// confirmationManager.js
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIRMATIONS_FILE = path.join(DATA_DIR, 'pending_confirmations.json');
const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

class ConfirmationManager {
  constructor() {
    this.client = null; // Se inyecta después
    this.confirmations = [];
    this.checkExpiredInterval = null;
    this.initialized = false;
  }

  /**
   * Inicializar con el cliente de WhatsApp
   * @param {object} whatsappClient - Cliente de whatsapp-web.js
   */
  setClient(whatsappClient) {
    this.client = whatsappClient;
    console.log('✅ [ConfirmationManager] Cliente WhatsApp inyectado');
  }

  /**
   * Cargar confirmaciones pendientes
   */
  async loadConfirmations() {
    try {
      const data = await fs.readFile(CONFIRMATIONS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      this.confirmations = parsed.confirmations || [];
      this.initialized = true;
      
      console.log(`✅ [ConfirmationManager] ${this.confirmations.length} confirmaciones pendientes cargadas`);
      
      // Limpiar confirmaciones viejas (más de 1 hora)
      await this.cleanOldConfirmations();
      
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log('⚠️  [ConfirmationManager] No existe pending_confirmations.json, creando...');
        await this.saveConfirmations();
        this.initialized = true;
      } else {
        console.error('❌ [ConfirmationManager] Error cargando:', e.message);
      }
    }
  }

  /**
   * Guardar confirmaciones
   */
  async saveConfirmations() {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(
        CONFIRMATIONS_FILE,
        JSON.stringify({ confirmations: this.confirmations }, null, 2)
      );
    } catch (e) {
      console.error('❌ [ConfirmationManager] Error guardando:', e.message);
    }
  }

  /**
   * Limpiar confirmaciones viejas (más de 1 hora)
   */
  async cleanOldConfirmations() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const initialCount = this.confirmations.length;
    
    this.confirmations = this.confirmations.filter(conf => {
      const createdAt = new Date(conf.created_at);
      return createdAt > oneHourAgo;
    });
    
    const removed = initialCount - this.confirmations.length;
    if (removed > 0) {
      console.log(`🧹 [ConfirmationManager] Limpiadas ${removed} confirmaciones viejas`);
      await this.saveConfirmations();
    }
  }

  /**
   * Crear nueva confirmación pendiente
   * @param {object} booking - Datos de la cita
   * @param {object} barber - Barbero asignado
   * @param {string} clientChatId - ID del chat del cliente
   * @returns {object} - Confirmación creada
   */
  async createConfirmation(booking, barber, clientChatId) {
    const confirmation = {
      id: `conf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      booking,
      barber_id: barber.id,
      barber_name: barber.name,
      barber_chatId: barber.chatId,
      client_chatId: clientChatId,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + TIMEOUT_MS).toISOString(),
      status: 'pending' // pending, confirmed, rejected, expired
    };

    this.confirmations.push(confirmation);
    await this.saveConfirmations();

    console.log(`📋 [ConfirmationManager] Confirmación creada: ${confirmation.id}`);
    console.log(`   ↳ Cliente: ${booking.nombreCliente}`);
    console.log(`   ↳ Barbero: ${barber.name}`);
    console.log(`   ↳ Servicio: ${booking.servicio}`);
    console.log(`   ↳ Fecha/Hora: ${booking.fecha} ${booking.hora_inicio}`);

    // Enviar solicitud al barbero
    await this.sendConfirmationRequest(confirmation, barber);

    return confirmation;
  }

  /**
   * Enviar solicitud de confirmación al barbero
   * @param {object} confirmation - Confirmación
   * @param {object} barber - Barbero
   */
  async sendConfirmationRequest(confirmation, barber) {
    if (!this.client) {
      console.error('❌ [ConfirmationManager] Cliente WhatsApp no disponible');
      return;
    }

    const { booking } = confirmation;
    
    const mensaje = `
🔔 *NUEVA CITA PENDIENTE*

👤 Cliente: *${booking.nombreCliente}*
💈 Servicio: ${booking.servicio}
📅 Fecha: ${booking.fecha}
🕐 Hora: ${booking.hora_inicio}

¿Puedes atender esta cita?

Responde:
✅ *SI* para confirmar
❌ *NO* para rechazar

⏰ Tienes 2 minutos para responder.
    `.trim();

    try {
      await this.client.sendMessage(barber.chatId, mensaje);
      console.log(`📤 [ConfirmationManager] Solicitud enviada a ${barber.name} (${barber.phone})`);
    } catch (e) {
      console.error(`❌ [ConfirmationManager] Error enviando a ${barber.name}:`, e.message);
      
      // Si falla el envío, marcar como expirada y buscar alternativa
      confirmation.status = 'expired';
      confirmation.error = 'failed_to_send';
      await this.saveConfirmations();
      await this.reassignBooking(confirmation);
    }
  }

  /**
   * Procesar respuesta del barbero
   * @param {string} barberChatId - Chat ID del barbero
   * @param {string} message - Mensaje del barbero
   * @returns {object|null} - Resultado de la confirmación
   */
  async processBarberResponse(barberChatId, message) {
    // Buscar barbero
    const barberManager = require('./barberManager');
    const barber = barberManager.barbers.find(b => b.chatId === barberChatId);

    if (!barber) {
      return null; // No es un barbero registrado
    }

    // Buscar confirmación pendiente para este barbero
    const pending = this.confirmations.find(
      c => c.barber_id === barber.id && c.status === 'pending'
    );

    if (!pending) {
      return null; // No hay confirmaciones pendientes para este barbero
    }

    const msgLower = message.toLowerCase().trim();
    let confirmed = false;
    let isValidResponse = false;

    // Detectar respuestas afirmativas
    if (
      msgLower === 'si' || 
      msgLower === 'sí' || 
      msgLower === 'yes' || 
      msgLower === 'ok' ||
      msgLower === '✅' ||
      msgLower.includes('confirm') ||
      msgLower.includes('dale') ||
      msgLower.includes('listo')
    ) {
      pending.status = 'confirmed';
      confirmed = true;
      isValidResponse = true;
    } 
    // Detectar respuestas negativas
    else if (
      msgLower === 'no' || 
      msgLower === 'nop' ||
      msgLower === 'nope' ||
      msgLower === '❌' ||
      msgLower.includes('cancel') ||
      msgLower.includes('rechaz')
    ) {
      pending.status = 'rejected';
      confirmed = false;
      isValidResponse = true;
    }

    if (!isValidResponse) {
      return null; // Mensaje no relacionado con confirmación
    }

    pending.responded_at = new Date().toISOString();
    await this.saveConfirmations();

    console.log(`${confirmed ? '✅' : '❌'} [ConfirmationManager] ${barber.name} ${confirmed ? 'CONFIRMÓ' : 'RECHAZÓ'} cita`);

    return { 
      confirmation: pending, 
      confirmed,
      barber 
    };
  }

  /**
   * Notificar al cliente sobre el resultado
   * @param {object} confirmation - Confirmación
   * @param {boolean} confirmed - Si fue confirmada o rechazada
   */
  async notifyClient(confirmation, confirmed) {
    if (!this.client) {
      console.error('❌ [ConfirmationManager] Cliente WhatsApp no disponible');
      return;
    }

    const { booking, client_chatId, barber_name } = confirmation;

    let mensaje;

    if (confirmed) {
      mensaje = `
✅ *CITA CONFIRMADA*

${barber_name} confirmó tu cita:

👤 Cliente: ${booking.nombreCliente}
💈 Servicio: ${booking.servicio}
📅 Fecha: ${booking.fecha}
🕐 Hora: ${booking.hora_inicio}

¡Te esperamos! 30 min antes te enviaremos un recordatorio.
      `.trim();
    } else {
      mensaje = `
⚠️ *CAMBIO DE CITA*

Lamentablemente ${barber_name} no está disponible en ese horario.

¿Quieres que busquemos otra hora disponible o prefieres otro barbero?
      `.trim();
    }

    try {
      await this.client.sendMessage(client_chatId, mensaje);
      console.log(`📤 [ConfirmationManager] Cliente notificado (${confirmed ? 'confirmada' : 'rechazada'})`);
    } catch (e) {
      console.error('❌ [ConfirmationManager] Error notificando cliente:', e.message);
    }
  }

  /**
   * Iniciar verificación de confirmaciones expiradas
   */
  startExpirationCheck() {
    if (this.checkExpiredInterval) {
      console.log('⚠️  [ConfirmationManager] Expiration check ya está corriendo');
      return;
    }

    console.log('⏰ [ConfirmationManager] Iniciando verificación de expiraciones (cada 30s)');

    this.checkExpiredInterval = setInterval(async () => {
      const now = new Date();
      let expiredCount = 0;

      for (const conf of this.confirmations) {
        if (conf.status !== 'pending') continue;

        const expiresAt = new Date(conf.expires_at);

        if (now > expiresAt) {
          conf.status = 'expired';
          expiredCount++;
          
          console.log(`⏰ [ConfirmationManager] Confirmación ${conf.id} EXPIRÓ`);
          console.log(`   ↳ Barbero: ${conf.barber_name} no respondió a tiempo`);

          // Buscar alternativa
          await this.reassignBooking(conf);
        }
      }

      if (expiredCount > 0) {
        await this.saveConfirmations();
      }
    }, 30000); // cada 30 segundos
  }

  /**
   * Reasignar cita a otro barbero o notificar al cliente
   * @param {object} expiredConf - Confirmación expirada
   */
  async reassignBooking(expiredConf) {
    const { booking, client_chatId, barber_name } = expiredConf;
    const barberManager = require('./barberManager');

    console.log(`🔄 [ConfirmationManager] Reasignando cita de ${booking.nombreCliente}...`);

    // Buscar otro barbero disponible (excluyendo el que no respondió)
    const newBarber = barberManager.barbers
      .filter(b => 
        b.id !== expiredConf.barber_id && 
        b.available &&
        barberManager.isBarberAvailable(
          b, 
          booking.fecha, 
          booking.hora_inicio,
          barberManager.getDayOfWeekFromDate(booking.fecha)
        )
      )
      .sort((a, b) => (a.bookingsToday || 0) - (b.bookingsToday || 0))[0];

    if (newBarber) {
      console.log(`   ↳ Reasignando a ${newBarber.name}`);
      
      // Crear nueva confirmación con el nuevo barbero
      await this.createConfirmation(booking, newBarber, client_chatId);
      
    } else {
      // No hay barberos disponibles
      console.log('   ↳ No hay más barberos disponibles');
      
      const mensaje = `
⚠️ *PROBLEMA CON TU CITA*

No pudimos confirmar tu cita de *${booking.servicio}* para el ${booking.fecha} a las ${booking.hora_inicio}.

${barber_name} no pudo responder a tiempo y no hay otros barberos disponibles en ese horario.

¿Te gustaría:
• Cambiar de hora
• Cambiar de día
• Ver otros horarios disponibles

¿Qué prefieres?
      `.trim();

      try {
        await this.client.sendMessage(client_chatId, mensaje);
      } catch (e) {
        console.error('❌ Error enviando mensaje de reasignación:', e.message);
      }
    }
  }

  /**
   * Detener verificación de expiraciones
   */
  stopExpirationCheck() {
    if (this.checkExpiredInterval) {
      clearInterval(this.checkExpiredInterval);
      this.checkExpiredInterval = null;
      console.log('⏹️  [ConfirmationManager] Verificación de expiraciones detenida');
    }
  }

  /**
   * Obtener estadísticas de confirmaciones
   * @returns {object}
   */
  getStats() {
    const total = this.confirmations.length;
    const pending = this.confirmations.filter(c => c.status === 'pending').length;
    const confirmed = this.confirmations.filter(c => c.status === 'confirmed').length;
    const rejected = this.confirmations.filter(c => c.status === 'rejected').length;
    const expired = this.confirmations.filter(c => c.status === 'expired').length;

    return {
      total,
      pending,
      confirmed,
      rejected,
      expired,
      confirmationRate: total > 0 ? ((confirmed / total) * 100).toFixed(1) : 0
    };
  }

  /**
   * Obtener confirmación por ID
   * @param {string} id - ID de la confirmación
   * @returns {object|null}
   */
  getConfirmationById(id) {
    return this.confirmations.find(c => c.id === id) || null;
  }

  /**
   * Obtener todas las confirmaciones pendientes
   * @returns {array}
   */
  getPendingConfirmations() {
    return this.confirmations.filter(c => c.status === 'pending');
  }
}

// Export singleton instance
module.exports = new ConfirmationManager();
