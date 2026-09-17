<template>
  <div class="app-shell">
    <header v-if="!isPosRoute" class="pos-topbar">
      <div class="brand">ERP Desktop POS</div>
      <div class="sync-indicators">
        <span class="badge" :class="syncBadgeClass">{{ syncLabel }}</span>
        <span v-if="sync.pending_count" class="badge badge-warning">Pending: {{ sync.pending_count }}</span>
        <button class="btn btn-sm" type="button" @click="syncNow" :disabled="sync.syncing">Sync Now</button>
      </div>
    </header>
    <router-view />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, provide, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { invoke } from '@/services/ipc';

const route = useRoute();
const router = useRouter();
// Both the POS screen and Order History have their own header - the generic
// topbar (with its own Sync Now / pending badge) would just double up.
const isPosRoute = computed(() => route.path === '/pos' || route.path === '/orders');

const sync = reactive({
  online: false,
  syncing: false,
  status: 'offline',
  pending_count: 0,
  failed_count: 0,
  initialized: false,
});

const syncLabel = computed(() => {
  if (sync.syncing) return 'Syncing';
  if (!sync.online) return 'Offline';
  if (sync.failed_count) return 'Sync Error';
  if (sync.pending_count) return 'Pending Orders';
  return 'Synced';
});

const syncBadgeClass = computed(() => ({
  'badge-success': syncLabel.value === 'Synced',
  'badge-warning': ['Pending Orders', 'Syncing'].includes(syncLabel.value),
  'badge-danger': syncLabel.value === 'Sync Error',
  'badge-muted': syncLabel.value === 'Offline',
}));

async function refreshSync() {
  const res = await invoke('sync:status');
  Object.assign(sync, res);
}

async function syncNow() {
  await invoke('sync:now');
  await refreshSync();
}

provide('syncState', sync);

let unsubscribeSync = null;
let unsubscribeNavigate = null;

onMounted(async () => {
  if (!window.desktopPos?.invoke) {
    return;
  }
  await refreshSync();
  unsubscribeSync = window.desktopPos.on('sync:status', (data) => Object.assign(sync, data));
  // Native "View > Order History" menu item (see electron/main.js buildAppMenu) -
  // a menu click only ever runs in the main process, so it reaches the
  // renderer as an event rather than a direct router call.
  unsubscribeNavigate = window.desktopPos.on('navigate', (path) => router.push(path));
});

onUnmounted(() => {
  unsubscribeSync?.();
  unsubscribeNavigate?.();
});
</script>

<style scoped>
.app-shell { height: 100%; overflow: hidden; display: flex; flex-direction: column; background: #f4f6f8; }
.pos-topbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: #1f2937; color: #fff; }
.brand { font-weight: 700; }
.sync-indicators { display: flex; gap: 8px; align-items: center; }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 12px; background: #374151; }
.badge-success { background: #059669; }
.badge-warning { background: #d97706; }
.badge-danger { background: #dc2626; }
.badge-muted { background: #6b7280; }
.btn { border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn-sm { font-size: 12px; background: #3b82f6; color: #fff; }
</style>
