import client from './client';

/** GET /projects/ */
export const getProjects = (params) =>
  client.get('/projects/', { params });

/** GET /projects/{id}/ */
export const getProject = (id) =>
  client.get(`/projects/${id}/`);

/** GET /departments/ */
export const getDepartments = (params) =>
  client.get('/departments/', { params });

/** GET /project-budget-lines/?project={projectId} */
export const getBudgetLines = (projectId) =>
  client.get('/project-budget-lines/', { params: { project: projectId } });

/** GET /annual-plans/ */
export const getAnnualPlans = (params) =>
  client.get('/annual-plans/', { params });

/** GET /annual-plan-lines/?annual_plan={planId} */
export const getAnnualPlanLines = (planId) =>
  client.get('/annual-plan-lines/', { params: { annual_plan: planId } });

/** GET /users/ */
export const getUsers = (params) =>
  client.get('/users/', { params });
