## Resumen
<!-- Una frase: qué hace este PR. -->

## Ticket
<!-- Ticket de TICKETS.md. Rama: <tipo>/SYSPCC-NNN-<slug>. -->
SYSPCC-

## Por qué
<!-- Contexto o problema que resuelve. -->

## Cambios
-

## Cómo probar
<!-- Pasos concretos: endpoints, pantallas, comandos. -->
1.

## Checklist
- [ ] La CI pasa (`backend-tests` y `frontend`); en local: `pytest`, `npm run lint`, `npm test`, `npm run build`.
- [ ] Estándares del proyecto aplicados (skill `code-review-syspcc`).
- [ ] Migraciones seguras si hay cambios de modelo (`makemigrations --check` limpio, probadas en PostgreSQL).
- [ ] Flujos de gerencia intactos (RQ y ciclo del almacén); `test_workflow_snapshot.py` en verde, o cambio justificado y confirmado.
- [ ] Sin secretos, `.env`, `db.sqlite3` ni `console.log`/`print` de depuración.
- [ ] Commits en Conventional Commits con `Refs SYSPCC-NNN`, sin `Co-Authored-By` ni firmas de herramientas de IA.
- [ ] `TICKETS.md` actualizado.
