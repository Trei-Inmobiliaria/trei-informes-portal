"""Prueba del cruce con datos sintéticos (sin conexión a bases). Ejecutar: python -m pytest herramientas/facturas/tests  o  python tests/test_cruce.py"""
import importlib.util, os, sys, json, tempfile
import pandas as pd
aqui = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('cruce', os.path.join(aqui, '..', 'cruce_facturas_iconstruye_softland.py'))
cr = importlib.util.module_from_spec(spec); spec.loader.exec_module(cr)

RUT = '76689694-4'
def dte(folio, rut_em, tipo=33, ref=None, fref=None, ocs=None, est='Factura Documento Aprobado'):
    return dict(tipo_dte=tipo, folio=folio, tax_id_emisor=rut_em, razon_social_emisor='Prov ' + str(folio), tax_id_receptor=RUT,
                fe=pd.Timestamp('2026-10-05'), fi=pd.Timestamp('2026-10-05'), fv=pd.Timestamp('2026-11-05'),
                monto_neto=100000, monto_exento=0, monto_iva=19000, monto_total=119000, tiene_cesion=False, razon_social_cesionario=None,
                tipo_documento_referencia=ref, folio_documento_referencia=fref, dte_sii='DOK', ocs=ocs,
                cg_cod='1700', cg='1700 Casas', est_ic=est, asoc=None, pago=None, acept=None, aprobadores=None, pg='NO', fp=None, fep=None)

ic = pd.DataFrame([dte(618, '77886603-K'), dte(1324, '77547560-9', ref=803, fref='1700-30'), dte(900, '11111111-1', ref=801, fref='1000-19', ocs='1000-19'),
                   dte(901, '22222222-2'), dte(902, '33333333-3')])
sf = pd.DataFrame(columns=['e', 't', 'n', 'a', 'c', 'f', 's', 'm', 'gc', 'gd', 'ccd'])
pay = pd.DataFrame(columns=['e', 'a', 't', 'n', 'k', 'c', 'f', 'm', 'b'])
opn = pd.DataFrame(columns=['e', 'a', 't', 'n', 'amt', 'pe', 'pt', 'pf', 'abierto'])
f9 = pd.DataFrame(columns=['e', 'c', 'k', 'f', 'p', 'a', 't', 'n', 'd', 'h', 'g', 'nom'])
def ev(rut, folio, cod, desc, fe, cons='2026-10-07 07:40:00'):
    return dict(rut_emisor=rut, tipo_dte=33, folio=folio, rut_receptor=RUT, codigo_evento=cod, descripcion_evento=desc, fecha_evento=fe, fecha_consulta=cons)
sii = pd.DataFrame([ev('77886603-K', 618, 'RCD', 'Reclamo al contenido', '2026-10-05 10:00:00'),
                    ev('77547560-9', 1324, 'ACD', 'Acepta contenido', '2026-10-05 09:00:00'),
                    ev('77547560-9', 1324, 'RCD', 'Reclamo al contenido', '2026-10-06 09:00:00'),   # el último evento manda
                    ev('11111111-1', 900, 'ACD', 'Acepta contenido', '2026-10-05 12:00:00'),
                    ev('22222222-2', 901, 'SIN', 'Sin eventos', None)])
out = cr.cruzar(ic, sf, pay, opn, f9, '2026-10-07', sii)
por = {o['fo']: o for o in out}
assert por[618]['sii'] == 'Rechazada' and por[618]['siim'] == 'Mal referencia OC-EEPP', por[618]
assert por[618]['sf'] == 'Rechazada en SII' and por[618]['ps'] == 'Rechazada en SII', 'no debe ser pendiente de contabilizar'
assert por[1324]['sii'] == 'Rechazada' and por[1324]['refp'] == 'Contrato 1700-30', por[1324]
assert por[900]['sii'] == 'Aceptada' and por[900]['oc'] == '1000-19' and por[900]['sf'] == 'Pendiente de contabilizar'
assert por[901]['sii'] == 'Sin pronunciamiento'
assert por[902]['sii'] == 'Sin consulta'
# rechazo manual en IConstruye NO altera el estado SII
ic2 = pd.DataFrame([dte(903, '44444444-4', est='Factura Documento Rechazado')])
o2 = cr.cruzar(ic2, sf, pay, opn, f9, '2026-10-07', sii)[0]
assert o2['eic'] == 'Rechazado' and o2['sii'] == 'Sin consulta' and o2['sf'] == 'Pendiente de contabilizar', o2
# sin tabla SII: todo «Sin consulta», no falla
assert all(o['sii'] == 'Sin consulta' for o in cr.cruzar(ic, sf, pay, opn, f9, '2026-10-07', pd.DataFrame()))

# render de las dos variantes
class A: desde = '2026-01-01'; hasta = '2026-10-08'; corte = '2026-10-07'
from datetime import datetime
meta = cr.armar_meta(out, A, datetime(2026, 10, 7, 8, 15))
assert meta['sii_ultimo'].startswith('2026-10-07T07:40'), meta
plantilla = os.path.join(aqui, '..', 'plantilla_facturas.html')
d = tempfile.mkdtemp()
for nombre in cr.VARIANTES:
    h = cr.render(plantilla, out, meta, nombre)
    import re
    assert not re.search(r'__(DATA|SCOPE|META|TITULO|MARCA|H1|UNIVERSO)__', h), 'marcadores sin reemplazar'
    open(os.path.join(d, nombre), 'w', encoding='utf-8').write(h)
print('TODO OK', d)
