import axios from 'axios';
import { getDb } from '../database/index.js';

function getConfig() {
  const row = getDb().prepare('SELECT * FROM device_config WHERE id = 1').get();
  return row || {};
}

function extractApiErrorMessage(error) {
  const data = error?.response?.data;
  if (data?.Message) return String(data.Message);
  if (data?.ErrorMessage) return String(data.ErrorMessage);
  if (typeof data?.message === 'string') return data.message;

  const status = error?.response?.status;
  if (status === 401) return 'Invalid email or password.';
  if (status === 500) return data?.Message || data?.message || 'Server error. Please try again or contact support.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'Requested resource was not found on the server.';
  if (status === 422) return 'Please check the information you entered.';

  if (error?.code === 'ECONNABORTED') {
    return 'Request timed out. Check your internet connection.';
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return 'Cannot connect to ERP server. Check the URL and ensure the server is running.';
  }

  if (error?.message && !/request failed with status code/i.test(error.message)) {
    return error.message;
  }

  return 'Unable to complete the request. Please try again.';
}

function attachApiErrorInterceptor(client) {
  client.interceptors.response.use(
    (response) => response,
    (error) => Promise.reject(new Error(extractApiErrorMessage(error))),
  );
  return client;
}

function createOfflineAxios(baseURL, options = {}) {
  const client = axios.create({
    baseURL,
    timeout: options.timeout ?? 30000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return attachApiErrorInterceptor(client);
}

export function createApiClient() {
  const config = getConfig();
  const client = createOfflineAxios(config.api_base_url || '', { timeout: 60000 });

  client.interceptors.request.use((req) => {
    const cfg = getConfig();
    if (cfg.auth_token) {
      req.headers.Authorization = `Bearer ${cfg.auth_token}`;
    }
    if (cfg.pos_device_id && cfg.device_token) {
      req.headers['X-Pos-Device-Id'] = cfg.pos_device_id;
      req.headers['X-Pos-Device-Token'] = cfg.device_token;
    }
    return req;
  });

  return client;
}

export async function pingServer(apiBaseUrl) {
  const client = createOfflineAxios(apiBaseUrl, { timeout: 10000 });
  const res = await client.post('/api/offline/auth/ping');
  return res.data;
}

export async function validateBusiness(apiBaseUrl) {
  const client = createOfflineAxios(apiBaseUrl, { timeout: 15000 });
  const res = await client.post('/api/offline/setup/validate-business');
  return res.data;
}

export async function bootstrapBusiness(apiBaseUrl) {
  const client = createOfflineAxios(apiBaseUrl, { timeout: 120000 });
  const res = await client.post('/api/offline/setup/bootstrap-business');
  return res.data;
}

export async function registerDeviceSetup(apiBaseUrl, payload) {
  const client = createOfflineAxios(apiBaseUrl, { timeout: 60000 });
  const res = await client.post('/api/offline/setup/register-device', payload);
  return res.data;
}

export async function loginOnline(apiBaseUrl, email, password) {
  const client = createOfflineAxios(apiBaseUrl, { timeout: 30000 });
  const res = await client.post('/api/offline/auth/login', {
    email,
    password,
  });
  return res.data;
}

export async function fetchLocationOptions(apiBaseUrl, authToken) {
  const client = createOfflineAxios(apiBaseUrl, {
    timeout: 30000,
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const res = await client.get('/api/offline/setup/location-options');
  return res.data;
}

export async function registerDevice(apiBaseUrl, authToken, payload) {
  const client = createOfflineAxios(apiBaseUrl, {
    timeout: 30000,
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const res = await client.post('/api/offline/device/register', payload);
  return res.data;
}

export async function bootstrapSync(client, warehouseId) {
  const res = await client.get('/api/offline/sync/bootstrap', {
    params: { warehouse_id: warehouseId },
  });
  return res.data;
}

export async function pullSync(client, cursors, warehouseId) {
  const res = await client.post('/api/offline/sync/pull', {
    cursors,
    warehouse_id: warehouseId,
  });
  return res.data;
}

export async function pushSync(client, transactions) {
  const res = await client.post('/api/offline/sync/push', { transactions });
  return res.data;
}

export async function healthCheck(client) {
  const res = await client.get('/api/offline/sync/health');
  return res.data;
}
