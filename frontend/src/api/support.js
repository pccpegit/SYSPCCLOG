import client from './client';

export const getTickets = (params) => client.get('/support/tickets/', { params });
export const getTicket = (id) => client.get(`/support/tickets/${id}/`);
export const createTicket = (data) => client.post('/support/tickets/', data);
export const addComment = (id, data) => client.post(`/support/tickets/${id}/add-comment/`, data);
export const changeStatus = (id, data) => client.post(`/support/tickets/${id}/change-status/`, data);
export const getMyStats = () => client.get('/support/tickets/my-stats/');
