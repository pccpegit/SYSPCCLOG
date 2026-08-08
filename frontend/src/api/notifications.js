import client from './client';

/** GET /notifications/ */
export const getNotifications = (params) =>
  client.get('/notifications/', { params });

/** POST /notifications/{id}/mark-read/ */
export const markAsRead = (id) =>
  client.post(`/notifications/${id}/mark-read/`);

/** POST /notifications/mark-all-read/ */
export const markAllAsRead = () =>
  client.post('/notifications/mark-all-read/');

/** GET /notifications/unread-count/ */
export const getUnreadCount = () =>
  client.get('/notifications/unread-count/');
