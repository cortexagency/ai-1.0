// barberManager.js
const fs = require('fs').promises;
const path = require('path');
const { DateTime } = require('luxon');

const DATA_DIR = path.join(__dirname, 'data');
const BARBERS_FILE = path.join(DATA_DIR, 'barbers.json');
const TIMEZONE = process.env.TZ || 'America/Bogota';

class BarberManager {
  constructor() {
    this.barbers = [];
    this.initialized = false;
  }

  /**
   * Cargar barberos desde archivo
   */
  async loadBarbers() {
    try {
      const data = await fs.readFile(BARBERS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      this.barbers = parsed.barbers || [];
      this.initialized = true;
      console.log(`✅ [BarberManager] Cargados ${this.barbers.length} barberos`);
      
      // Log de barberos disponibles
      this.barbers.forEach(b => {
        const status = b.available ? '🟢' : '🔴';
        console.log(`   ${status} ${b.name} - ${b.phone}`);
      });
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log('⚠️  [BarberManager] No existe barbers.json, creando archivo inicial...');
        await this.createInitialFile();
      } else {
        console.error('❌ [BarberManager] Error cargando:', e.message);
      }
    }
  }

  /**
   * Crear archivo inicial con estructura vacía
   */
  async createInitialFile() {
    const initialData = {
      barbers: [
        {
          id: 'barber_001',
          name: 'Mike',
          nicknames: ['Mike', 'Michael', 'Maikol', 'el Mike'],
          phone: '+573001234567',
          chatId: '573001234567@c.us',
          available: true,
          workingHours: {
            lun: { start: '09:00', end: '20:00' },
            mar: { start: '09:00', end: '20:00' },
            mie: { start: '09:00', end: '20:00' },
            jue: { start: '09:00', end: '20:00' },
            vie: { start: '09:00', end: '20:00' },
            sab: { start: '09:00', end: '18:00' },
            dom: { start: '10:00', end: '16:00' }
          },
          daysOff: [],
          specialties: ['corte clásico', 'degradado', 'diseño'],
          bookingsToday: 0,
          stats: {
            totalBookings: 0,
            averageRating: 5.0,
            completedBookings: 0,
            cancelledBookings: 0
          }
        }
      ]
    };

    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(BARBERS_FILE, JSON.stringify(initialData, null, 2));
    this.barbers = initialData.barbers;
    this.initialized = true;
    console.log('✅ [BarberManager] Archivo barbers.json creado');
  }

  /**
   * Guardar barberos en archivo
   */
  async saveBarbers() {
    try {
      await fs.writeFile(
        BARBERS_FILE,
        JSON.stringify({ barbers: this.barbers }, null, 2)
      );
      console.log('💾 [BarberManager] Barberos guardados');
    } catch (e) {
      console.error('❌ [BarberManager] Error guardando:', e.message);
    }
  }

  /**
   * Detectar barbero preferido en el mensaje del cliente
   * @param {string} message - Mensaje del cliente
   * @returns {object|null} - Barbero encontrado o null
   */
  detectPreferredBarber(message) {
    if (!message || typeof message !== 'string') return null;

    const msgLower = message.toLowerCase();
    
    // Patrones comunes: "con Mike", "quiero con Mike", "Mike puede", etc.
    for (const barber of this.barbers) {
      if (!barber.available) continue; // Skip barberos no disponibles
      
      const allNames = [
        barber.name.toLowerCase(),
        ...barber.nicknames.map(n => n.toLowerCase())
      ];
      
      for (const name of allNames) {
        // Buscar menciones del nombre
        const patterns = [
          new RegExp(`\\bcon\\s+${name}\\b`, 'i'),
          new RegExp(`\\b${name}\\s+puede\\b`, 'i'),
          new RegExp(`\\bquiero\\s+(con\\s+)?${name}\\b`, 'i'),
          new RegExp(`\\b${name}\\s+tiene\\b`, 'i'),
          new RegExp(`\\b${name}\\s+está\\b`, 'i'),
          new RegExp(`\\b${name}\\s+disponible\\b`, 'i')
        ];
        
        if (patterns.some(pattern => pattern.test(msgLower))) {
          console.log(`🎯 [BarberManager] Barbero preferido detectado: ${barber.name}`);
          return barber;
        }
      }
    }
    
    return null;
  }

  /**
   * Obtener barbero disponible para fecha/hora específica
   * @param {string} fecha - Fecha en formato YYYY-MM-DD
   * @param {string} hora - Hora en formato HH:MM (24h)
   * @param {string|null} preferredBarberId - ID del barbero preferido (opcional)
   * @returns {object|null} - Barbero asignado o null
   */
  getAvailableBarber(fecha, hora, preferredBarberId = null) {
    const dayOfWeek = this.getDayOfWeekFromDate(fecha);
    
    console.log(`🔍 [BarberManager] Buscando barbero para ${fecha} (${dayOfWeek}) a las ${hora}`);
    
    // Si hay preferencia, verificar disponibilidad
    if (preferredBarberId) {
      const barber = this.barbers.find(b => b.id === preferredBarberId);
      
      if (!barber) {
        console.log(`⚠️  [BarberManager] Barbero ${preferredBarberId} no encontrado`);
        return null;
      }
      
      if (this.isBarberAvailable(barber, fecha, hora, dayOfWeek)) {
        console.log(`✅ [BarberManager] ${barber.name} (preferido) disponible`);
        return barber;
      } else {
        console.log(`❌ [BarberManager] ${barber.name} (preferido) NO disponible`);
        return null;
      }
    }
    
    // Buscar cualquier barbero disponible (load balancing por citas del día)
    const available = this.barbers
      .filter(b => this.isBarberAvailable(b, fecha, hora, dayOfWeek))
      .sort((a, b) => (a.bookingsToday || 0) - (b.bookingsToday || 0));
    
    if (available.length === 0) {
      console.log('❌ [BarberManager] No hay barberos disponibles');
      return null;
    }
    
    console.log(`✅ [BarberManager] Asignando a ${available[0].name} (${available[0].bookingsToday || 0} citas hoy)`);
    return available[0];
  }

  /**
   * Verificar si un barbero está disponible
   * @param {object} barber - Objeto barbero
   * @param {string} fecha - Fecha YYYY-MM-DD
   * @param {string} hora - Hora HH:MM
   * @param {string} dayOfWeek - Día de la semana (lun, mar, etc)
   * @returns {boolean}
   */
  isBarberAvailable(barber, fecha, hora, dayOfWeek) {
    // 1. Check available flag
    if (!barber.available) {
      console.log(`   ↳ ${barber.name}: no disponible (flag OFF)`);
      return false;
    }
    
    // 2. Check days off
    if (barber.daysOff && barber.daysOff.includes(fecha)) {
      console.log(`   ↳ ${barber.name}: día libre (${fecha})`);
      return false;
    }
    
    // 3. Check working hours for that day
    const schedule = barber.workingHours && barber.workingHours[dayOfWeek];
    
    if (!schedule || schedule === 'OFF') {
      console.log(`   ↳ ${barber.name}: no trabaja los ${dayOfWeek}`);
      return false;
    }
    
    // 4. Check if hora is within working hours
    try {
      const [horaNum, minNum] = hora.split(':').map(Number);
      const [startHour, startMin] = schedule.start.split(':').map(Number);
      const [endHour, endMin] = schedule.end.split(':').map(Number);
      
      const horaMinutes = horaNum * 60 + minNum;
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;
      
      if (horaMinutes < startMinutes || horaMinutes >= endMinutes) {
        console.log(`   ↳ ${barber.name}: fuera de horario (${schedule.start}-${schedule.end})`);
        return false;
      }
      
      console.log(`   ↳ ${barber.name}: ✅ disponible`);
      return true;
      
    } catch (e) {
      console.error(`   ↳ ${barber.name}: error parseando horario - ${e.message}`);
      return false;
    }
  }

  /**
   * Obtener día de la semana desde fecha ISO
   * @param {string} fechaISO - Fecha YYYY-MM-DD
   * @returns {string} - 'lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'
   */
  getDayOfWeekFromDate(fechaISO) {
    try {
      const dt = DateTime.fromISO(fechaISO, { zone: TIMEZONE });
      const dayNum = dt.weekday; // 1=Monday, 7=Sunday
      const days = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
      return days[dayNum - 1];
    } catch (e) {
      console.error('[BarberManager] Error parseando fecha:', e.message);
      return 'lun'; // Default fallback
    }
  }

  /**
   * Incrementar contador de citas del barbero
   * @param {string} barberId - ID del barbero
   */
  async incrementBookingCount(barberId) {
    const barber = this.barbers.find(b => b.id === barberId);
    
    if (barber) {
      barber.bookingsToday = (barber.bookingsToday || 0) + 1;
      barber.stats = barber.stats || {};
      barber.stats.totalBookings = (barber.stats.totalBookings || 0) + 1;
      
      await this.saveBarbers();
      console.log(`📈 [BarberManager] ${barber.name}: ${barber.bookingsToday} citas hoy`);
    }
  }

  /**
   * Reset contadores diarios (ejecutar a medianoche)
   */
  async resetDailyCounters() {
    this.barbers.forEach(b => {
      b.bookingsToday = 0;
    });
    
    await this.saveBarbers();
    console.log('🔄 [BarberManager] Contadores diarios reseteados');
  }

  /**
   * Obtener barbero por ID
   * @param {string} id - ID del barbero
   * @returns {object|null}
   */
  getBarberById(id) {
    return this.barbers.find(b => b.id === id) || null;
  }

  /**
   * Obtener barbero por nombre
   * @param {string} name - Nombre o nickname
   * @returns {object|null}
   */
  getBarberByName(name) {
    if (!name) return null;
    
    const nameLower = name.toLowerCase().trim();
    return this.barbers.find(b => 
      b.name.toLowerCase() === nameLower ||
      (b.nicknames && b.nicknames.some(n => n.toLowerCase() === nameLower))
    ) || null;
  }

  /**
   * Agregar nuevo barbero
   * @param {object} barberData - Datos del barbero
   * @returns {object} - Barbero creado
   */
  async addBarber(barberData) {
    const newBarber = {
      id: `barber_${Date.now()}`,
      name: barberData.name,
      nicknames: barberData.nicknames || [],
      phone: barberData.phone,
      chatId: `${barberData.phone.replace(/\+/g, '')}@c.us`,
      available: true,
      workingHours: barberData.workingHours || {
        lun: { start: '09:00', end: '20:00' },
        mar: { start: '09:00', end: '20:00' },
        mie: { start: '09:00', end: '20:00' },
        jue: { start: '09:00', end: '20:00' },
        vie: { start: '09:00', end: '20:00' },
        sab: { start: '09:00', end: '18:00' },
        dom: 'OFF'
      },
      daysOff: [],
      specialties: barberData.specialties || [],
      bookingsToday: 0,
      stats: {
        totalBookings: 0,
        averageRating: 5.0,
        completedBookings: 0,
        cancelledBookings: 0
      }
    };

    this.barbers.push(newBarber);
    await this.saveBarbers();
    
    console.log(`✅ [BarberManager] Nuevo barbero agregado: ${newBarber.name}`);
    return newBarber;
  }

  /**
   * Toggle disponibilidad de barbero
   * @param {string} barberId - ID del barbero
   * @returns {boolean} - Nuevo estado
   */
  async toggleAvailability(barberId) {
    const barber = this.getBarberById(barberId);
    
    if (!barber) {
      console.log(`❌ [BarberManager] Barbero ${barberId} no encontrado`);
      return false;
    }

    barber.available = !barber.available;
    await this.saveBarbers();
    
    const status = barber.available ? 'DISPONIBLE' : 'NO DISPONIBLE';
    console.log(`🔄 [BarberManager] ${barber.name} → ${status}`);
    
    return barber.available;
  }

  /**
   * Obtener estadísticas generales
   * @returns {object}
   */
  getStats() {
    const totalBarbers = this.barbers.length;
    const availableBarbers = this.barbers.filter(b => b.available).length;
    const totalBookingsToday = this.barbers.reduce((sum, b) => sum + (b.bookingsToday || 0), 0);
    const totalBookingsAll = this.barbers.reduce((sum, b) => sum + (b.stats?.totalBookings || 0), 0);

    return {
      totalBarbers,
      availableBarbers,
      totalBookingsToday,
      totalBookingsAll,
      barbers: this.barbers.map(b => ({
        id: b.id,
        name: b.name,
        available: b.available,
        bookingsToday: b.bookingsToday || 0,
        totalBookings: b.stats?.totalBookings || 0
      }))
    };
  }
}

// Export singleton instance
module.exports = new BarberManager();
