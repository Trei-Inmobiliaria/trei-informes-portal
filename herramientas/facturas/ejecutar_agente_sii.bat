@echo off
REM Consulta diaria de eventos del SII (certificado digital). Pensado para el Programador de tareas de Windows.
REM Requiere las variables de entorno permanentes IC_DB_URL, SII_PFX_PATH y SII_PFX_PASS (ver README).
cd /d "%~dp0"
python agente_sii_eventos.py >> agente_sii.log 2>&1
