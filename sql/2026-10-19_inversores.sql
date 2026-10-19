-- ─────────────────────────────────────────────────────────────────────────────
-- Acceso de inversores al Informe Comercial (vista simplificada, sin datos
-- personales). Proyecto Supabase del Informe Comercial.
--
-- Diseño:
--  * Rol nuevo `inversor` SIN filas en informe_permiso. Las políticas RLS de
--    ventas_pok, reservas_pok, promesas_pok, leads_pok, etc. exigen
--    puede('informe','ver'); como el inversor no tiene ese permiso, no puede
--    leer ninguna tabla con nombre, RUT, correo ni teléfono de clientes.
--  * Lo único que recibe es inversor_resumen(): cifras agregadas por proyecto
--    (SECURITY DEFINER), filtradas por informe_usuario_proyecto.
--  * Un inversor sin proyectos asignados recibe una lista vacía. En el modelo
--    actual "sin filas" significa "todos los proyectos", y eso aquí NO aplica.
--  * Alta/edición desde /accesos del portal vía inversor_guardar() e
--    inversor_listar(), solo para rol efectivo admin.
--
-- Es idempotente: se puede volver a correr.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.informe_rol (codigo, nombre, descripcion, orden)
values (
  'inversor',
  'Inversor',
  'Ve solo la vista simplificada del Informe Comercial, de los proyectos asignados, con cifras agregadas y sin datos personales de clientes.',
  5
)
on conflict (codigo) do nothing;

-- ── Resumen agregado ─────────────────────────────────────────────────────────
create or replace function public.inversor_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol    text := public.rol_efectivo(null);
  v_proy   text[];
  v_corte  date;
  v_ult    date;
  v_mes    date := date_trunc('month', timezone('America/Santiago', now()))::date;
  v_ppto   date;
begin
  if v_rol is null then
    raise exception 'sin-acceso' using errcode = '42501';
  end if;

  v_proy := public.mis_proyectos();   -- null = sin restricción (roles internos)

  -- Inversor sin proyectos asignados: nada. Nunca "todos".
  if v_rol = 'inversor' and (v_proy is null or cardinality(v_proy) = 0) then
    return jsonb_build_object('corte', null, 'mes_cierre', null, 'rol', v_rol,
                              'proyectos', '[]'::jsonb, 'serie', '[]'::jsonb);
  end if;

  select max(fecha_corte) into v_corte from public.ventas_pok;
  select max(periodo)     into v_ult   from public.cierre_mensual where estado = 'cerrado';
  select max(fecha_carga) into v_ppto  from public.presupuesto_comercial;

  return jsonb_build_object(
    'corte', v_corte,
    'mes_cierre', v_ult,
    'rol', v_rol,
    'proyectos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'proyecto',        p.nombre_pok,
          'nombre',          p.nombre_display,
          'unidades',        coalesce(s.total, 0),
          'vendidas',        coalesce(s.reservadas + s.promesadas + s.escrituradas, 0),
          'reservadas',      coalesce(s.reservadas, 0),
          'promesadas',      coalesce(s.promesadas, 0),
          'escrituradas',    coalesce(s.escrituradas, 0),
          'disponibles',     coalesce(s.disponibles, 0),
          'uf_vendidas',     round(coalesce(s.uf_vendidas, 0)),
          'cierre_promesas', coalesce(u.promesas, 0),
          'cierre_promesas_uf', round(coalesce(u.promesas_uf, 0)),
          'cierre_neto',     coalesce(u.neto, 0),
          'cierre_escrituras', coalesce(u.escrituras, 0),
          'cierre_desist',   coalesce(u.desist, 0),
          'ppto_promesas_uf', round(coalesce(b.ppto_uf, 0)),
          'velocidad',       round(coalesce(c.neto3, 0) / 3.0, 1),
          'meses_stock',     case when coalesce(c.neto3, 0) > 0 and coalesce(s.disponibles, 0) > 0
                                  then round(s.disponibles / (c.neto3 / 3.0), 1) end,
          'leads_mes',       coalesce(l.n, 0)
        )
        order by p.orden
      )
      from public.proyectos_pok p
      left join lateral (
        select count(distinct id_producto) as total,
               count(distinct id_producto) filter (where estado_corte = 'DISPONIBLE') as disponibles,
               count(distinct id_producto) filter (where estado_corte = 'RESERVADO')  as reservadas,
               count(distinct id_producto) filter (where estado_corte = 'PROMESADO')  as promesadas,
               count(distinct id_producto) filter (where estado_corte = 'ESCRITURADO') as escrituradas,
               sum(precio_total_operacion_uf) filter (where estado_corte <> 'DISPONIBLE') as uf_vendidas
        from public.ventas_pok v
        where v.fecha_corte = v_corte and v.proyecto = p.nombre_pok
      ) s on true
      left join lateral (
        select sum(promesas_cant) as promesas, sum(promesas_uf) as promesas_uf,
               sum(neto_cant) as neto, sum(escrituras_cant) as escrituras,
               sum(desistimientos_cant) as desist
        from public.cierre_mensual m
        where m.proyecto = p.nombre_pok and m.estado = 'cerrado' and m.periodo = v_ult
      ) u on true
      left join lateral (
        select sum(neto_cant) as neto3
        from public.cierre_mensual m
        where m.proyecto = p.nombre_pok and m.estado = 'cerrado'
          and v_ult is not null and m.periodo >= (v_ult - interval '2 months')::date
      ) c on true
      left join lateral (
        select sum(venta_ppto) as ppto_uf
        from public.presupuesto_comercial pc
        where pc.fecha_carga = v_ppto and pc.nombre_proyecto = p.nombre_pok
          and pc.tipo = 'Promesas' and date_trunc('month', pc.fecha)::date = v_ult
      ) b on true
      left join lateral (
        select count(distinct id_cliente) as n
        from public.leads_pok lp
        where lp.proyecto = p.nombre_pok and lp.fecha_ingreso >= v_mes
      ) l on true
      where p.vigente and (v_proy is null or p.nombre_pok = any (v_proy))
    ), '[]'::jsonb),
    'serie', coalesce((
      select jsonb_agg(
        jsonb_build_object('proyecto', t.proyecto, 'periodo', t.periodo,
                           'neto', t.neto, 'escrituras', t.escrituras)
        order by t.periodo
      )
      from (
        select m.proyecto, m.periodo,
               sum(m.neto_cant) as neto, sum(m.escrituras_cant) as escrituras
        from public.cierre_mensual m
        where m.estado = 'cerrado'
          and v_ult is not null
          and m.periodo > (v_ult - interval '6 months')::date
          and (v_proy is null or m.proyecto = any (v_proy))
        group by m.proyecto, m.periodo
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- ── Administración de inversores (solo admin) ────────────────────────────────
create or replace function public.inversor_listar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.informe_es_admin() then
    raise exception 'solo-admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'proyectos', coalesce((
      select jsonb_agg(jsonb_build_object('proyecto', p.nombre_pok, 'nombre', p.nombre_display) order by p.orden)
      from public.proyectos_pok p where p.vigente
    ), '[]'::jsonb),
    'inversores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', u.email, 'nombre', u.nombre, 'empresa', u.empresa,
        'activo', u.activo, 'vence_at', u.vence_at,
        'editado_at', u.editado_at, 'editado_por', u.editado_por,
        'proyectos', coalesce((select array_agg(up.proyecto order by up.proyecto)
                               from public.informe_usuario_proyecto up where up.email = u.email), '{}')
      ) order by u.activo desc, u.email)
      from public.informe_usuario u where u.rol = 'inversor'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.inversor_guardar(
  p_email     text,
  p_nombre    text,
  p_empresa   text,
  p_proyectos text[],
  p_vence     timestamptz,
  p_activo    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(trim(p_email));
  v_actor  text := public.mi_email();
  v_previo text;
  v_validos text[];
begin
  if not public.informe_es_admin() then
    raise exception 'solo-admin' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'correo-invalido' using errcode = '22023';
  end if;

  -- Nunca convertir a un usuario interno (admin/gestor/lectura) en inversor.
  select rol into v_previo from public.informe_usuario where email = v_email;
  if v_previo is not null and v_previo <> 'inversor' then
    raise exception 'ya-es-usuario-interno' using errcode = '22023';
  end if;

  select array_agg(nombre_pok) into v_validos
  from public.proyectos_pok where vigente and nombre_pok = any (coalesce(p_proyectos, '{}'));

  if coalesce(p_activo, true) and coalesce(cardinality(v_validos), 0) = 0 then
    raise exception 'sin-proyectos' using errcode = '22023';
  end if;

  insert into public.informe_usuario
    (email, nombre, rol, activo, externo, empresa, vence_at, creado_por, editado_at, editado_por)
  values
    (v_email, nullif(trim(p_nombre), ''), 'inversor', coalesce(p_activo, true), true,
     nullif(trim(p_empresa), ''), p_vence, v_actor, now(), v_actor)
  on conflict (email) do update set
    nombre = excluded.nombre, activo = excluded.activo, empresa = excluded.empresa,
    vence_at = excluded.vence_at, editado_at = now(), editado_por = v_actor
  where public.informe_usuario.rol = 'inversor';

  delete from public.informe_usuario_proyecto where email = v_email;
  insert into public.informe_usuario_proyecto (email, proyecto)
  select v_email, unnest(coalesce(v_validos, '{}'));

  return jsonb_build_object('email', v_email, 'proyectos', coalesce(v_validos, '{}'));
end;
$$;

revoke all on function public.inversor_resumen()  from public, anon;
revoke all on function public.inversor_listar()   from public, anon;
revoke all on function public.inversor_guardar(text, text, text, text[], timestamptz, boolean) from public, anon;
grant execute on function public.inversor_resumen()  to authenticated;
grant execute on function public.inversor_listar()   to authenticated;
grant execute on function public.inversor_guardar(text, text, text, text[], timestamptz, boolean) to authenticated;
