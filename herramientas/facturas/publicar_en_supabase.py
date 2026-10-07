#!/usr/bin/env python3
"""Sube los HTML del informe al bucket privado de Supabase Storage (reemplaza el archivo del día).

Variables de entorno:
  SUPABASE_URL          https://<ref>.supabase.co   (proyecto «BBDD IConstruye»)
  SUPABASE_SERVICE_KEY  llave service_role (secreta; solo como secreto de GitHub, nunca en la repo)
  BUCKET                opcional, por defecto informes-privados
Uso: python publicar_en_supabase.py salida/Facturas_Recibidas.html salida/Facturas_Recibidas_VCB.html
"""
import os, sys
import requests

def main(rutas):
    url, key = os.environ.get('SUPABASE_URL', '').rstrip('/'), os.environ.get('SUPABASE_SERVICE_KEY')
    bucket = os.environ.get('BUCKET', 'informes-privados')
    if not url or not key: sys.exit('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY')
    if not rutas: sys.exit('Indica los archivos a subir')
    for ruta in rutas:
        nombre = os.path.basename(ruta)
        with open(ruta, 'rb') as f:
            r = requests.post(f'{url}/storage/v1/object/{bucket}/{nombre}', data=f.read(), timeout=120,
                              headers={'Authorization': f'Bearer {key}', 'apikey': key, 'x-upsert': 'true',
                                       'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'})
        if r.status_code >= 300: sys.exit(f'Error {r.status_code} subiendo {nombre}: {r.text[:200]}')
        print('Publicado', nombre, f'({os.path.getsize(ruta) // 1024} KB)')

if __name__ == '__main__':
    main(sys.argv[1:])
