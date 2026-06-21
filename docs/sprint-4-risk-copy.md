# Sprint 4 — Copy de riesgo y responsible use

## Terminología
Usar: **Margen neto estimado · Tamaño ejecutable estimado · Beneficio neto estimado · Calidad de ejecución
estimada · Equivalencia de reglas · Última validación · Precio observado · Precio límite · Arbitraje ejecutable estimado**.

Prohibido (verificado en tests, 0 ocurrencias en payload/UI): **ganancia garantizada · retorno garantizado ·
dinero gratis · apuesta segura · sin riesgo · riesgo cero · ganas pase lo que pase**.

`confidence` se presenta como **"Calidad de ejecución estimada"** (alta/media/baja), no como probabilidad de ganar el evento.

## Disclaimer compacto (card/detalle)
> Estimación basada en precios y profundidad observados. Las condiciones pueden cambiar antes de completar ambas
> operaciones. Verifica fees, reglas y elegibilidad directamente con cada plataforma.

## Riesgos estructurales (siempre visibles, `presentation.STRUCTURAL_RISKS`)
- El precio puede cambiar antes de completar ambas operaciones.
- La profundidad observada puede desaparecer.
- Cada pata se ejecuta por separado: riesgo de ejecución parcial.
- La elegibilidad depende de tu jurisdicción.
- Plataformas de terceros; fees y reglas pueden variar.
- Suspensión o anulación (void) del mercado puede afectar el resultado.

## Aviso ampliado (pie de la experiencia)
GP Simulador **no acepta apuestas, no custodia fondos y no ejecuta operaciones**. No garantiza resultados, no
controla plataformas externas. Disponibilidad por jurisdicción. Riesgos de ejecución parcial, settlement y cambio
de precios. Los deep links son externos. Posibles relaciones de afiliación se divulgarían.

"No es consejo financiero" **no** sustituye el diseño responsable del producto: la UI no convierte una estimación
técnica en una promesa comercial.
