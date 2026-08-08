import client from './client';

// ── Pasajes ───────────────────────────────────────────────────────────────────
export const getPasajes = (params) =>
  client.get('/administracion/pasajes/', { params });

export const createPasaje = (data) =>
  client.post('/administracion/pasajes/', data);

export const updatePasaje = (id, data) =>
  client.patch(`/administracion/pasajes/${id}/`, data);

export const deletePasaje = (id) =>
  client.delete(`/administracion/pasajes/${id}/`);

export const getPasajesPorDni = (dni) =>
  client.get('/administracion/pasajes/por-dni/', { params: { dni } });

export const calcularDevolucion = (data) =>
  client.post('/administracion/pasajes/calcular-devolucion/', data);

export const marcarPagado = (id, data) =>
  client.post(`/administracion/pasajes/${id}/marcar-pagado/`, data);

export const exportPasajesUrl = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return `/api/v1/administracion/pasajes/export/${qs ? `?${qs}` : ''}`;
};

// ── Proveedores ───────────────────────────────────────────────────────────────
export const getProveedores = (params) =>
  client.get('/administracion/proveedores-pasajes/', { params });

export const buscarRuc = (ruc) =>
  client.get('/administracion/proveedores-pasajes/buscar-ruc/', { params: { ruc } });

export const createProveedor = (data) =>
  client.post('/administracion/proveedores-pasajes/', data);

// ── Politicas ─────────────────────────────────────────────────────────────────
export const getPoliticas = (params) =>
  client.get('/administracion/politicas-devolucion/', { params });

export const getPoliticasPorTipo = (tipo) =>
  client.get('/administracion/politicas-devolucion/por-tipo/', { params: { tipo } });

export const createPolitica = (data) =>
  client.post('/administracion/politicas-devolucion/', data);

export const updatePolitica = (id, data) =>
  client.patch(`/administracion/politicas-devolucion/${id}/`, data);

export const deletePolitica = (id) =>
  client.delete(`/administracion/politicas-devolucion/${id}/`);

// ── Tipo de Cambio ───────────────────────────────────────────────────────────
export const getTipoCambio = () =>
  client.get('/administracion/tipo-cambio/');

// ── Puestos ───────────────────────────────────────────────────────────────────
export const getPuestos = () =>
  client.get('/administracion/puestos/');

// ── Personal (DNI lookup) ─────────────────────────────────────────────────────
export const buscarPersonalPorDni = (dni) =>
  client.get('/personal/buscar-dni/', { params: { dni } });
