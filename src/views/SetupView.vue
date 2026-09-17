<template>
  <div class="setup-page">
    <div class="card">
      <div class="steps">
        <span :class="{ active: step === 'connection' }">1. Business</span>
        <span :class="{ active: step === 'login' }">2. Login</span>
        <span :class="{ active: step === 'location' }">3. Location</span>
        <span :class="{ active: step === 'syncing' }">4. Sync</span>
      </div>

      <!-- Step 1: ERP URL + Business ID (locked forever) -->
      <div v-if="step === 'connection'">
        <h2>Connect to ERP</h2>
        <p class="muted">Enter your ERP URL and Business ID. The Business ID is locked to this PC after setup.</p>

        <label>ERP API Base URL</label>
        <input v-model="apiUrl" placeholder="https://your-erp.example.com" :disabled="businessLocked" />

        <label>Business ID</label>
        <input v-model="businessId" placeholder="Business UUID from ERP" :disabled="businessLocked" />
        <p v-if="businessName" class="hint">Business: <strong>{{ businessName }}</strong></p>

        <button class="primary" @click="saveConnection" :disabled="loading || !apiUrl || !businessId">
          Download Business Data
        </button>
        <p v-if="userCount" class="hint">{{ userCount }} POS staff account(s) saved locally.</p>
      </div>

      <!-- Step 2: Staff login (local) -->
      <div v-else-if="step === 'login'">
        <h2>Staff Login</h2>
        <p class="muted">
          Login locally with a POS staff account downloaded for
          <strong>{{ businessName || businessId }}</strong>.
        </p>

        <label>Email</label>
        <input v-model="email" type="email" autocomplete="username" />

        <label>Password</label>
        <input v-model="password" type="password" autocomplete="current-password" />

        <button class="primary" @click="doLogin" :disabled="loading">Login & Continue</button>
      </div>

      <!-- Step 3: Branch / Register -->
      <div v-else-if="step === 'location'">
        <h2>Branch & Register</h2>
        <p class="muted">Select where this counter will operate. Stock from every warehouse linked to the branch is combined automatically.</p>

        <label>Device Name</label>
        <input v-model="deviceName" placeholder="Counter 1 POS" />

        <label>Branch</label>
        <select v-model="branchId" @change="onBranchChange">
          <option value="">Select branch</option>
          <option v-for="b in branches" :key="b.branch_id" :value="b.branch_id">{{ b.name }}</option>
        </select>

        <label>Register (optional)</label>
        <select v-model="registerId">
          <option value="">No specific register</option>
          <option v-for="r in filteredRegisters" :key="r.pos_register_id" :value="r.pos_register_id">{{ r.name }}</option>
        </select>

        <button class="primary" @click="completeSetup" :disabled="loading || !branchId">
          Register Device & Download Data
        </button>
      </div>

      <!-- Step 4: Syncing -->
      <div v-else-if="step === 'syncing'">
        <h2>Downloading POS Data</h2>
        <p class="muted">Products, customers, users, payment methods, stock, and settings are being saved locally…</p>
        <div class="spinner" />
      </div>

      <p v-if="message" class="message">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="databasePath" class="db-info">
        <p class="muted small">SQLite: <code>{{ databasePath }}</code></p>
        <button type="button" class="link-btn" @click="openDatabaseFolder">Open database folder</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { invoke } from '@/services/ipc';

const router = useRouter();

const step = ref('connection');
const apiUrl = ref('http://localhost/erp');
const businessId = ref('');
const businessName = ref('');
const businessLocked = ref(false);
const email = ref('');
const password = ref('');
const deviceName = ref('Desktop POS');
const branchId = ref('');
const registerId = ref('');
const branches = ref([]);
const registers = ref([]);
const loading = ref(false);
const message = ref('');
const error = ref('');
const userCount = ref(0);
const databasePath = ref('');

const filteredRegisters = computed(() => {
  if (!branchId.value) return registers.value;
  return registers.value.filter((r) => r.branch_id === branchId.value);
});

async function loadState() {
  const state = await invoke('setup:get-state');
  const dbInfo = await invoke('app:get-database-path').catch(() => ({}));
  databasePath.value = dbInfo.path || '';
  userCount.value = dbInfo.user_count || 0;
  step.value = state.step || 'connection';
  if (state.config?.api_base_url) apiUrl.value = state.config.api_base_url;
  if (state.config?.business_id) businessId.value = state.config.business_id;
  if (state.config?.business_name) businessName.value = state.config.business_name;
  businessLocked.value = !!state.config?.business_id_locked;
  if (state.initialized) {
    router.replace('/pos');
    return;
  }
  if (step.value === 'location') {
    await loadLocations();
  }
}

async function saveConnection() {
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    const res = await invoke('setup:save-connection', {
      apiBaseUrl: apiUrl.value,
      businessId: businessId.value.trim(),
    });
    businessName.value = res.business?.name || '';
    businessLocked.value = true;
    userCount.value = res.user_count || 0;
    databasePath.value = res.database_path || databasePath.value;
    step.value = 'login';
    message.value = `Business data downloaded. ${userCount.value} staff account(s) saved locally.`;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function doLogin() {
  loading.value = true;
  error.value = '';
  try {
    await invoke('setup:login', { email: email.value, password: password.value });
    step.value = 'location';
    await loadLocations();
    message.value = 'Login successful.';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadLocations() {
  const data = await invoke('setup:fetch-locations');
  branches.value = data.branches || [];
  registers.value = data.registers || [];

  if (branches.value.length === 1) {
    branchId.value = branches.value[0].branch_id;
    onBranchChange();
  }
}

function onBranchChange() {
  registerId.value = '';
  const regs = filteredRegisters.value;
  if (regs.length === 1) registerId.value = regs[0].pos_register_id;
}

async function completeSetup() {
  loading.value = true;
  error.value = '';
  step.value = 'syncing';
  try {
    await invoke('setup:complete', {
      branchId: branchId.value,
      registerId: registerId.value || null,
      deviceName: deviceName.value,
      fingerprint: crypto.randomUUID(),
      email: email.value,
      password: password.value,
    });
    message.value = 'Setup complete. POS is ready offline.';
    router.push('/pos');
  } catch (e) {
    step.value = 'location';
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function openDatabaseFolder() {
  const info = await invoke('app:open-database-folder');
  databasePath.value = info.path;
}

onMounted(loadState);
</script>

<style scoped>
.setup-page { display: grid; place-items: center; min-height: calc(100vh - 52px); padding: 24px; }
.card { width: min(560px, 100%); background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
.steps { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; font-size: 12px; }
.steps span { padding: 4px 10px; border-radius: 999px; background: #f3f4f6; color: #6b7280; }
.steps span.active { background: #2563eb; color: #fff; }
label { display: block; margin-top: 12px; font-size: 13px; font-weight: 600; }
input, select { width: 100%; margin-top: 6px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; }
button.primary { width: 100%; margin-top: 16px; border: 0; border-radius: 8px; padding: 12px; background: #2563eb; color: #fff; cursor: pointer; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
.muted { color: #6b7280; font-size: 14px; }
.hint { font-size: 13px; color: #374151; margin-top: 6px; }
.message { color: #059669; margin-top: 12px; }
.error { color: #dc2626; margin-top: 12px; }
.db-info { margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
.link-btn { margin-top: 8px; border: 0; background: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 12px; }
.small { font-size: 12px; word-break: break-all; }
code { font-size: 11px; }
.spinner { width: 36px; height: 36px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 24px auto; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
