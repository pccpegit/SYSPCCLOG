import client from './client';

export const getInventory = (params) => client.get('/warehouse/inventory/', { params });

export const checkStock = (projectId, descriptions) =>
  client.get('/warehouse/inventory/check-stock/', {
    params: {
      project_id: projectId,
      descriptions: descriptions.join(','),
    },
  });
