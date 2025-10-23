#!/bin/bash

# ==============================================
# SCRIPT DE LIMPIEZA DE DATOS - CORTEX AI BOT
# ==============================================
#
# Este script limpia los archivos de datos corruptos
# y los reinicia con valores por defecto.
#
# USO:
#   chmod +x limpiar_datos.sh
#   ./limpiar_datos.sh
#
# ==============================================

echo "🧹 LIMPIEZA DE DATOS - CORTEX AI BOT"
echo "===================================="
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar que estamos en el directorio correcto
if [ ! -f "index.js" ]; then
    echo -e "${RED}❌ Error: index.js no encontrado${NC}"
    echo "Asegúrate de ejecutar este script desde el directorio del bot"
    exit 1
fi

echo -e "${YELLOW}⚠️  ADVERTENCIA: Este script borrará los siguientes archivos:${NC}"
echo "   - data/user_bookings.json"
echo "   - data/demo_reservas.json"
echo "   - data/scheduled_messages.json"
echo ""
echo -e "${YELLOW}Los archivos se recrearán automáticamente cuando inicies el bot.${NC}"
echo ""

# Pedir confirmación
read -p "¿Continuar? (s/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo -e "${YELLOW}❌ Operación cancelada${NC}"
    exit 0
fi

echo ""
echo "🔄 Limpiando archivos..."
echo ""

# Función para limpiar un archivo
limpiar_archivo() {
    local archivo=$1
    local contenido=$2
    
    if [ -f "$archivo" ]; then
        echo -e "${YELLOW}📁 Limpiando: $archivo${NC}"
        
        # Hacer backup
        cp "$archivo" "${archivo}.backup.$(date +%Y%m%d_%H%M%S)"
        echo -e "${GREEN}   ✓ Backup creado${NC}"
        
        # Eliminar y recrear
        rm "$archivo"
        echo "$contenido" > "$archivo"
        echo -e "${GREEN}   ✓ Archivo reiniciado${NC}"
    else
        echo -e "${YELLOW}📁 Creando: $archivo${NC}"
        mkdir -p "$(dirname "$archivo")"
        echo "$contenido" > "$archivo"
        echo -e "${GREEN}   ✓ Archivo creado${NC}"
    fi
    echo ""
}

# Limpiar cada archivo
limpiar_archivo "data/user_bookings.json" "[]"
limpiar_archivo "data/demo_reservas.json" "{}"
limpiar_archivo "data/scheduled_messages.json" "[]"

echo -e "${GREEN}✅ ¡Limpieza completada!${NC}"
echo ""
echo "📋 Próximos pasos:"
echo "   1. Reinicia el bot: npm start"
echo "   2. Verifica en los logs que todo esté OK"
echo "   3. Prueba agendar una cita"
echo ""
echo "💾 Los backups están guardados con timestamp en el nombre"
echo ""