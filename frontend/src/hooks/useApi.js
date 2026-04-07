import { useState, useCallback } from 'react';

/**
 * Generic hook for API calls with loading and error states.
 *
 * Usage:
 *   const { data, loading, error, execute } = useApi(requestsApi.getRequests);
 *   // then call: execute({ status: 'pending' })
 *
 * @param {Function} apiFunction - An API function that returns an axios Promise.
 * @param {*} initialData - Optional initial value for `data`.
 */
export default function useApi(apiFunction, initialData = null) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(
    async (...args) => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFunction(...args);
        setData(response.data);
        return response.data;
      } catch (err) {
        const message =
          err.response?.data?.detail ||
          err.response?.data?.message ||
          err.message ||
          'An unexpected error occurred.';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [apiFunction],
  );

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setLoading(false);
  }, [initialData]);

  return { data, loading, error, execute, reset };
}
