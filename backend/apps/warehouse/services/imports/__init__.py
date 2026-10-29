"""
Importer of the real "INVENTARIO PCC - ALM" workbook (SYSPCC-025).

Pipeline (the same for the REST endpoints and the management command)::

    parser.inspect_upload / parse_workbook   bytes -> rows        (no database)
    validators                               row   -> clean row  (DRF serializers)
    planner.build_plan                       rows + DB state -> ImportPlan (read-only)
    applier.apply_plan                       ImportPlan -> DB     (one transaction)
    service                                  preview / confirm / cancel / purge

The workbook is UNTRUSTED input and contains personal data (worker names). Nothing in
this package logs cell values, names or destinations; problem messages never echo
free text from the workbook.
"""
