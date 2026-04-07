import client from './client';

/** GET /acquisition-type-configs/ */
export const getAcquisitionTypes = () =>
  client.get('/acquisition-type-configs/');

/**
 * GET /workflow-steps/?flow={flow}
 * @param {string} flow - e.g. 'standard', 'emergency', 'direct'
 */
export const getWorkflowSteps = (flow) =>
  client.get('/workflow-steps/', { params: { flow } });
