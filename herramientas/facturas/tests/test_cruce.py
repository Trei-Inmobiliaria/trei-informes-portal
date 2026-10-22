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
assert por[901]['sii'] == 'Sin pronunciamiento'   # recibida hace 2 días: aún dentro del plazo de 8
assert por[902]['sii'] == 'Sin consulta'
# vencido el plazo de 8 días sin eventos ⇒ aceptación tácita
viejo = dte(904, '55555555-5'); viejo['fi'] = pd.Timestamp('2026-09-20'); viejo['fe'] = pd.Timestamp('2026-09-19')
sii_v = pd.concat([sii, pd.DataFrame([ev('55555555-5', 904, 'SIN', 'Sin eventos', None)])], ignore_index=True)
assert cr.cruzar(pd.DataFrame([viejo]), sf, pay, opn, f9, '2026-10-07', sii_v)[0]['sii'] == 'Aceptada (Aut)'
# rechazo manual en IConstruye NO altera el estado SII
ic2 = pd.DataFrame([dte(903, '44444444-4', est='Factura Documento Rechazado')])
o2 = cr.cruzar(ic2, sf, pay, opn, f9, '2026-10-07', sii)[0]
assert o2['eic'] == 'Rechazado' and o2['sii'] == 'Sin consulta' and o2['sf'] == 'Pendiente de contabilizar', o2
# sin tabla SII: todo «Sin consulta», no falla
assert all(o['sii'] == 'Sin consulta' for o in cr.cruzar(ic, sf, pay, opn, f9, '2026-10-07', pd.DataFrame()))

# Solo Softland: facturas ene-abr contabilizadas sin DTE en iConstruye (no la constructora IVCB1)
sf2 = pd.DataFrame([
    dict(e='IVCB5', t='33', n=2754, a='76713281', c='00000300', f=pd.Timestamp('2026-04-10'), s='V', m=-119000, gc='5-1', gd='Gasto', ccd='Obra', fd=pd.Timestamp('2026-04-08'), nomaux='LIDZ SPA'),
    dict(e='IVCB5', t='61', n=77, a='76713281', c='00000301', f=pd.Timestamp('2026-04-12'), s='V', m=11900, gc='5-1', gd='Gasto', ccd='Obra', fd=pd.Timestamp('2026-04-12'), nomaux='LIDZ SPA'),
    dict(e='IVCB1', t='33', n=5, a='11111111', c='00000302', f=pd.Timestamp('2026-04-10'), s='V', m=-5000, gc='5-1', gd='G', ccd='O', fd=pd.Timestamp('2026-04-08'), nomaux='X'),
    dict(e='IVCB5', t='33', n=3000, a='76713281', c='00000400', f=pd.Timestamp('2026-06-10'), s='V', m=-5000, gc='5-1', gd='G', ccd='O', fd=pd.Timestamp('2026-06-08'), nomaux='LIDZ SPA')])
o3 = {(o['fo'], o['t']): o for o in cr.cruzar(ic, sf2, pay, opn, f9, '2026-10-07', sii, '2026')}
ss = o3[(2754, 'Factura')]
assert ss['eic'] == 'Solo Softland' and ss['sii'] == 'Aceptada (Hist)' and ss['sf'] == 'Contabilizada' and ss['tot'] == 119000 and ss['rut'] == '76713281-6', ss
assert 'neto' not in ss and ss['fe'] == '2026-04-08' and ss['rs'] == 'Trei Inmobiliaria SpA'
assert o3[(77, 'Nota de crédito')]['tot'] == -11900 and 'sii' not in o3[(77, 'Nota de crédito')]
assert (5, 'Factura') not in o3 and (3000, 'Factura') not in o3, 'ni IVCB1 ni fuera del rango ene-abr'

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
