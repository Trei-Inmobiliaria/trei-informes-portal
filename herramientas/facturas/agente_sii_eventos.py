#!/usr/bin/env python3
"""
Agente SII — eventos de aceptación / reclamo (Ley 20.956) de los DTE recibidos
Trei Inmobiliaria / VCB — Control de Gestión

Qué hace
--------
1. Lee de Supabase «BBDD IConstruye» (iconstruye.dte_chile) los DTE recibidos tipo 33, 34 y 43 de las
   razones sociales del grupo. Las notas (56, 61) no son reclamables ante el SII y se omiten.
2. Se autentica en el SII con el certificado digital (semilla firmada → TOKEN).
3. Por cada DTE consulta listarEventosHistDoc (servicio de registro de reclamo) y guarda el resultado en
   iconstruye.sii_eventos_reclamo (una fila por evento; una fila con codigo_evento = 'SIN' cuando el SII
   responde que el documento no presenta eventos, para dejar registrada la consulta).
4. Es incremental: no vuelve a consultar documentos con más de --dias-ventana días desde su recepción
   que ya fueron consultados. Los recientes se reconsultan en cada corrida porque sus eventos cambian.

Qué NO hace
-----------
Guarda códigos de evento, no motivos. El SII no almacena el texto del motivo de un reclamo: solo el código
(RCD = reclamo al contenido, etc.). El motivo que muestra el informe sale de las reglas de aceptación.

Uso
---
    pip install requests lxml cryptography psycopg2-binary zeep python-dotenv
    # archivo .env junto al script (NO versionado, ver .gitignore):
    #   IC_DB_URL=postgresql://postgres.jyrbujcnqsemwhkcnwkj:<clave>@<pooler>.pooler.supabase.com:5432/postgres
    #   SII_PFX_PATH=C:\\ruta\\certificado.pfx
    #   SII_PFX_PASS=<clave del certificado>
    python agente_sii_eventos.py --probar 77886603-K 33 618         # RUT EMISOR, tipo, folio: imprime la respuesta cruda
                                                                    # (hacer esta prueba primero: valida certificado, token y formato)
    python agente_sii_eventos.py --desde 2026-01-01                  # corrida normal / incremental

El certificado y su clave se usan solo en este equipo; no se envían a ningún otro servicio.
"""
import argparse, base64, hashlib, os, re, sys, time
from datetime import date, datetime, timedelta

PALENA = 'https://palena.sii.cl/DTEWS'
WSDL_RECLAMO = 'https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice?wsdl'
TIPOS_RECLAMABLES = (33, 34, 43)
RUTS_RECEPTORES = ['76689694-4', '77108223-8', '76856039-0', '77098757-1', '76660193-6',
                   '77495781-2', '77944356-6', '77944379-5', '77532191-1', '77911822-3']
SIN_EVENTOS = 'SIN'  # codigo_evento que usamos cuando el SII responde «sin eventos» (la tabla exige llave única)
C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
DS = 'http://www.w3.org/2000/09/xmldsig#'


# ------------------------------------------------------------------ certificado y firma
def cargar_pfx(ruta, clave):
    from cryptography.hazmat.primitives.serialization import pkcs12
    with open(ruta, 'rb') as f:
        key, cert, _ = pkcs12.load_key_and_certificates(f.read(), clave.encode() if clave else None)
    if key is None or cert is None:
        sys.exit('El .pfx no trae clave privada o certificado.')
    return key, cert


def _b64(b): return base64.b64encode(b).decode()


def firmar_semilla(semilla, key, cert):
    """XMLDSig enveloped (RSA-SHA1, C14N 1.0) sobre <getToken><item><Semilla>…, tal como lo exige el SII."""
    from lxml import etree
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    base = f'<getToken><item><Semilla>{semilla}</Semilla></item></getToken>'
    # 1) Digest del documento SIN firma (transformación enveloped: al calcularlo la firma aún no existe)
    digest = hashlib.sha1(etree.tostring(etree.fromstring(base.encode()), method='c14n')).digest()
    pub = key.public_key().public_numbers()
    entero = lambda n: _b64(n.to_bytes((n.bit_length() + 7) // 8, 'big'))

    # 2) SignedInfo. OJO: lxml canoniza mal un subárbol que no es raíz (agrega xmlns="" falsos), por eso se
    #    canoniza como DOCUMENTO PROPIO con el namespace ds por defecto, que es exactamente su forma canónica
    #    dentro de <Signature xmlns="…xmldsig#"> (único namespace en alcance).
    interior = (f'<CanonicalizationMethod Algorithm="{C14N}"/><SignatureMethod Algorithm="{DS}rsa-sha1"/>'
                f'<Reference URI=""><Transforms><Transform Algorithm="{DS}enveloped-signature"/></Transforms>'
                f'<DigestMethod Algorithm="{DS}sha1"/><DigestValue>{_b64(digest)}</DigestValue></Reference>')
    canonico = etree.tostring(etree.fromstring(f'<SignedInfo xmlns="{DS}">{interior}</SignedInfo>'.encode()), method='c14n')
    firma = key.sign(canonico, padding.PKCS1v15(), hashes.SHA1())

    # 3) Documento final por concatenación de texto (no se vuelve a pasar por el serializador de lxml)
    return (f'<getToken><item><Semilla>{semilla}</Semilla></item><Signature xmlns="{DS}"><SignedInfo>{interior}</SignedInfo>'
            f'<SignatureValue>{_b64(firma)}</SignatureValue><KeyInfo><KeyValue><RSAKeyValue>'
            f'<Modulus>{entero(pub.n)}</Modulus><Exponent>{entero(pub.e)}</Exponent></RSAKeyValue></KeyValue>'
            f'<X509Data><X509Certificate>{_b64(cert.public_bytes(serialization.Encoding.DER))}</X509Certificate></X509Data>'
            f'</KeyInfo></Signature></getToken>')


def _soap(session, url, ns, op, params=None):
    cuerpo = ''.join(f'<{k} xsi:type="xsd:string">{v}</{k}>' for k, v in (params or {}).items())
    env = ('<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" '
           'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
           f'<SOAP-ENV:Body><m:{op} xmlns:m="{ns}">{cuerpo}</m:{op}></SOAP-ENV:Body></SOAP-ENV:Envelope>')
    r = session.post(url, data=env.encode('utf-8'), headers={'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""'}, timeout=30)
    r.raise_for_status()
    return r.text


def _retorno(xml, op):
    """El SII devuelve el XML de respuesta escapado dentro de <{op}Return> (con o sin prefijo de namespace).
    Si no aparece ese elemento, se usa la respuesta completa desescapada y se deja que el llamador valide."""
    import html
    m = re.search(rf'<(?:[\w.-]+:)?{op}Return\b[^>]*>(.*?)</(?:[\w.-]+:)?{op}Return>', xml, re.S)
    texto = html.unescape(m.group(1)) if m else html.unescape(xml)
    if not re.search(r'(SEMILLA|TOKEN|ESTADO)', texto):
        raise RuntimeError(f'Respuesta inesperada del SII en {op}: {xml[:2000]}')
    return texto


def obtener_token(session, key, cert):
    ns_seed, ns_tok = f'{PALENA}/CrSeed.jws', f'{PALENA}/GetTokenFromSeed.jws'
    sem = re.search(r'<(?:[\w.-]+:)?SEMILLA>\s*(\d+)\s*</(?:[\w.-]+:)?SEMILLA>', _retorno(_soap(session, ns_seed, ns_seed, 'getSeed'), 'getSeed'))
    if not sem: raise RuntimeError('El SII no entregó semilla')
    firmado = firmar_semilla(sem.group(1), key, cert)
    import html
    resp = _retorno(_soap(session, ns_tok, ns_tok, 'getToken', {'pszXml': html.escape(firmado, quote=False)}), 'getToken')
    est = re.search(r'<(?:[\w.-]+:)?ESTADO>\s*(\d+)\s*</(?:[\w.-]+:)?ESTADO>', resp); tok = re.search(r'<(?:[\w.-]+:)?TOKEN>\s*([^<\s]+)\s*</(?:[\w.-]+:)?TOKEN>', resp)
    if not tok:
        glosa = re.search(r'<GLOSA>([^<]*)</GLOSA>', resp)
        raise RuntimeError(f'El SII rechazó la autenticación (estado {est.group(1) if est else "?"}: {glosa.group(1) if glosa else resp[:200]})')
    return tok.group(1)


# ------------------------------------------------------------------ consulta de eventos
class ClienteSII:
    def __init__(self, pfx, clave):
        import requests
        from zeep import Client
        from zeep.transports import Transport
        self.key, self.cert = cargar_pfx(pfx, clave)
        self.sess = requests.Session()
        self.token_ts = 0
        self._renovar()
        self.cli = Client(WSDL_RECLAMO, transport=Transport(session=self.sess, timeout=30))

    def _renovar(self):
        tok = obtener_token(self.sess, self.key, self.cert)
        self.sess.cookies.set('TOKEN', tok, domain='.sii.cl')
        self.token_ts = time.time()

    def eventos(self, rut_emisor, tipo, folio):
        """Devuelve (codResp, descResp, [eventos]). Reautentica si pasaron ~50 min (el TOKEN dura una hora)."""
        if time.time() - self.token_ts > 3000: self._renovar()
        from zeep.helpers import serialize_object
        cuerpo, dv = rut_emisor.split('-')
        r = serialize_object(self.cli.service.listarEventosHistDoc(rutEmisor=cuerpo.lstrip('0'), dvEmisor=dv.upper(), tipoDoc=int(tipo), folio=int(folio)))
        if isinstance(r, dict) and 'codResp' not in r and len(r) == 1:   # algunos WSDL envuelven la respuesta en <return>
            r = next(iter(r.values()))
        r = r or {}
        evs = []
        for e in (r.get('listaEventosDoc') or []):
            evs.append(dict(codigo=e.get('codEvento'), descripcion=e.get('descEvento'),
                            responsable=f"{e.get('rutResponsable')}-{e.get('dvResponsable')}", fecha=_parse_fecha(e.get('fechaEvento'))))
        return r.get('codResp'), r.get('descResp'), evs

    def crudo(self, rut_emisor, tipo, folio):
        """XML tal como lo devuelve el SII (para verificar la estructura en la primera corrida)."""
        cuerpo, dv = rut_emisor.split('-')
        with self.cli.settings(raw_response=True):
            resp = self.cli.service.listarEventosHistDoc(rutEmisor=cuerpo.lstrip('0'), dvEmisor=dv.upper(), tipoDoc=int(tipo), folio=int(folio))
        return resp.text


def _parse_fecha(s):
    if not s: return None
    if isinstance(s, datetime): return s
    for f in ('%d-%m-%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%d/%m/%Y %H:%M:%S'):
        try: return datetime.strptime(str(s)[:19], f)
        except ValueError: pass
    return None


# ------------------------------------------------------------------ base de datos
SQL_PENDIENTES = """
with d as (
  select tax_id_receptor rr, tax_id_emisor re, tipo_dte t, folio f, razon_social_emisor rs, fecha_ingreso fi
  from iconstruye.dte_chile
  where tipo_dte = any(%(tipos)s) and tax_id_receptor = any(%(ruts)s) and fecha_emision >= %(desde)s
),
c as (
  select rut_receptor, rut_emisor, tipo_dte, folio, max(fecha_consulta) ult
  from iconstruye.sii_eventos_reclamo group by 1,2,3,4
)
select d.* from d left join c on c.rut_receptor=d.rr and c.rut_emisor=d.re and c.tipo_dte=d.t and c.folio=d.f
where c.ult is null                                              -- nunca consultado
   or d.fi >= %(reciente)s                                       -- recepción reciente: los eventos aún cambian
   or c.ult < d.fi + make_interval(days => %(ventana)s)          -- se consultó antes de cerrar la ventana de reclamo
order by d.fi desc
"""

SQL_UPSERT = """
insert into iconstruye.sii_eventos_reclamo
  (rut_receptor, nombre_receptor, rut_emisor, razon_social_emisor, tipo_dte, folio, codigo_evento, descripcion_evento,
   fecha_evento, codigo_respuesta, descripcion_respuesta, fecha_consulta, fecha_recepcion_sii)
values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now(), %s)
on conflict (rut_receptor, rut_emisor, tipo_dte, folio, codigo_evento)
do update set descripcion_evento=excluded.descripcion_evento, fecha_evento=excluded.fecha_evento,
              codigo_respuesta=excluded.codigo_respuesta, descripcion_respuesta=excluded.descripcion_respuesta,
              fecha_consulta=now(), fecha_recepcion_sii=coalesce(excluded.fecha_recepcion_sii, iconstruye.sii_eventos_reclamo.fecha_recepcion_sii)
"""


def guardar(cn, rr, re_, rs, tipo, folio, cod_resp, desc_resp, evs):
    with cn.cursor() as cur:
        if evs:
            for e in evs:
                cur.execute(SQL_UPSERT, (rr, None, re_, rs, tipo, folio, e['codigo'], e['descripcion'], e['fecha'], cod_resp, desc_resp, None))
        else:
            cur.execute(SQL_UPSERT, (rr, None, re_, rs, tipo, folio, SIN_EVENTOS, desc_resp, None, cod_resp, desc_resp, None))
    cn.commit()


def main():
    try:
        from dotenv import load_dotenv; load_dotenv()
    except ImportError:
        pass
    ap = argparse.ArgumentParser(description='Consulta eventos de aceptación/reclamo al SII y los guarda en Supabase')
    ap.add_argument('--desde', default=f'{date.today().year}-01-01', help='emisión desde (incluida)')
    ap.add_argument('--dias-ventana', type=int, default=15, help='días tras la recepción en que se sigue reconsultando')
    ap.add_argument('--pausa', type=float, default=0.3, help='segundos entre consultas')
    ap.add_argument('--max', type=int, default=0, help='límite de documentos (0 = todos), útil para pruebas')
    ap.add_argument('--probar', nargs=3, metavar=('RUT_EMISOR', 'TIPO', 'FOLIO'), help='consulta un solo documento e imprime la respuesta, sin tocar la base')
    a = ap.parse_args()

    pfx, clave = os.environ.get('SII_PFX_PATH'), os.environ.get('SII_PFX_PASS', '')
    if not pfx: sys.exit('Falta SII_PFX_PATH (ruta del .pfx) en el entorno o en el .env')
    sii = ClienteSII(pfx, clave)

    if a.probar:
        print('--- respuesta cruda del SII ---'); print(sii.crudo(*a.probar))
        cod, desc, evs = sii.eventos(*a.probar)
        print('--- interpretada ---'); print('codResp:', cod, '| descResp:', desc)
        for e in evs: print('  ', e)
        return

    url = os.environ.get('IC_DB_URL')
    if not url: sys.exit('Falta IC_DB_URL (cadena de conexión de BBDD IConstruye)')
    import psycopg2
    cn = psycopg2.connect(url)
    with cn.cursor() as cur:
        cur.execute(SQL_PENDIENTES, dict(tipos=list(TIPOS_RECLAMABLES), ruts=[r for r in RUTS_RECEPTORES], desde=a.desde,
                                         reciente=date.today() - timedelta(days=a.dias_ventana), ventana=a.dias_ventana))
        pend = cur.fetchall()
    if a.max: pend = pend[:a.max]
    print(f'{len(pend)} documentos por consultar')
    ok = err = rech = 0
    for i, (rr, re_, tipo, folio, rs, fi) in enumerate(pend, 1):
        try:
            cod, desc, evs = sii.eventos(re_, tipo, folio)
            guardar(cn, rr, re_, rs, int(tipo), int(folio), cod, desc, evs)
            ok += 1; rech += any(e['codigo'] in ('RCD', 'RFP', 'RFT') for e in evs)
        except Exception as ex:  # un documento con error no detiene la corrida
            cn.rollback(); err += 1
            print(f'  ! {re_} tipo {tipo} folio {folio}: {ex}', file=sys.stderr)
        if i % 100 == 0: print(f'  {i}/{len(pend)} (reclamados: {rech}, errores: {err})')
        time.sleep(a.pausa)
    print(f'Listo: {ok} consultados, {rech} con reclamo, {err} con error. Hora: {datetime.now():%d-%m-%Y %H:%M}')


if __name__ == '__main__':
    main()
