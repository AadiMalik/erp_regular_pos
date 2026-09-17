<template>
  <div class="login-page">
    <div class="card">
      <h2>Cashier Login</h2>
      <p class="muted">Login uses staff accounts saved locally on this device.</p>

      <label>Email</label>
      <input v-model="email" type="email" autocomplete="username" />

      <label>Password</label>
      <input v-model="password" type="password" autocomplete="current-password" />

      <button class="primary" @click="login" :disabled="loading">Login</button>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="databasePath" class="db-info">
        <p class="muted small">SQLite database: <code>{{ databasePath }}</code></p>
        <button type="button" class="link-btn" @click="openDatabaseFolder">Open database folder</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { invoke } from '@/services/ipc';

const router = useRouter();
const email = ref('');
const password = ref('');
const databasePath = ref('');
const loading = ref(false);
const error = ref('');

onMounted(async () => {
  const state = await invoke('app:get-state');
  databasePath.value = state.database_path || '';
  if (!state.config?.initialized_at) {
    router.replace('/setup');
  }
});

async function openDatabaseFolder() {
  const info = await invoke('app:open-database-folder');
  databasePath.value = info.path;
}

async function login() {
  loading.value = true;
  error.value = '';
  try {
    await invoke('auth:login', { email: email.value, password: password.value });
    router.push('/pos');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page { display: grid; place-items: center; min-height: calc(100vh - 52px); padding: 24px; }
.card { width: min(420px, 100%); background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
label { display: block; margin-top: 12px; font-size: 13px; font-weight: 600; }
input { width: 100%; margin-top: 6px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; }
button.primary { width: 100%; margin-top: 16px; border: 0; border-radius: 8px; padding: 12px; background: #2563eb; color: #fff; cursor: pointer; }
.muted { color: #6b7280; }
.small { font-size: 12px; margin-top: 16px; word-break: break-all; }
.error { color: #dc2626; margin-top: 12px; }
.db-info { margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
.link-btn { margin-top: 8px; border: 0; background: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 12px; }
code { font-size: 11px; }
</style>
