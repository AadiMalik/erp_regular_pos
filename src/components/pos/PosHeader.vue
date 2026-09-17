<template>
  <nav class="navbar navbar-expand pos-navbar px-3">
    <span class="navbar-brand d-flex align-items-center mb-0 pos-brand">
      <span class="pos-brand-logo d-flex align-items-center justify-content-center">
        <i class="fa fa-store"></i>
      </span>
      <span class="pos-brand-text">
        <span class="pos-brand-name" :title="shopName">{{ shopName || 'POS' }}</span>
        <span class="pos-brand-welcome">Welcome, {{ userName }}</span>
      </span>
    </span>

    <div v-if="session" class="pos-context-cluster">
      <span v-if="branchName" class="pos-context-chip" title="Selected Branch">
        <i class="fa fa-code-branch"></i>
        <span class="pos-context-label d-none d-md-inline">Branch:</span>
        {{ branchName }}
      </span>
    </div>

    <div class="d-flex align-items-center ms-auto gap-2 flex-wrap pos-header-actions">
      <template v-if="session">
        <span class="pos-register-badge" :title="syncTooltip">
          {{ registerName }} <span class="pos-register-status-pill">OPEN</span>
          <i class="fa fa-circle ms-1" :class="syncDotClass" style="font-size:0.5rem;"></i>
        </span>

        <button type="button" class="btn btn-icon btn-sm btn-outline-success" title="Cash In" @click="$emit('cash-in')">
          <i class="fa fa-plus"></i>
        </button>
        <button type="button" class="btn btn-icon btn-sm btn-outline-warning" title="Cash Out" @click="$emit('cash-out')">
          <i class="fa fa-minus"></i>
        </button>
        <button type="button" class="btn btn-icon btn-sm btn-outline-danger" title="Add Expense" @click="$emit('add-expense')">
          <i class="fa fa-receipt"></i>
        </button>

        <button type="button" class="btn btn-sm pos-header-btn" title="Reports" @click="$emit('reports')">
          <i class="fa fa-chart-bar"></i> <span class="pos-header-btn-label">Reports</span>
        </button>
        <button type="button" class="btn btn-sm pos-header-btn position-relative" title="Hold Orders" @click="$emit('held-orders')">
          <i class="fa fa-pause"></i> <span class="pos-header-btn-label">Hold Orders</span>
          <span v-if="heldCount" class="badge rounded-pill bg-danger pos-held-count">{{ heldCount }}</span>
        </button>
        <button type="button" class="btn btn-sm pos-header-btn" title="Close Register" @click="$emit('close-register')">
          <i class="fa fa-lock"></i> <span class="pos-header-btn-label">Close Register</span>
        </button>
      </template>

      <button
        type="button"
        class="btn btn-sm pos-header-btn position-relative"
        :class="{ 'pos-header-btn-alert': pendingOrderCount > 0 }"
        title="Orders pending sync"
        @click="$emit('orders-sync')"
      >
        <i class="fa fa-cloud-arrow-up"></i> <span class="pos-header-btn-label">Pending Sync</span>
        <span v-if="pendingOrderCount" class="badge rounded-pill bg-danger pos-held-count">{{ pendingOrderCount }}</span>
      </button>

      <div class="nav-item navbar-dropdown dropdown-user dropdown" ref="userMenuEl">
        <a
          class="nav-link dropdown-toggle hide-arrow d-flex align-items-center pos-user-toggle"
          href="javascript:void(0);"
          @click.stop="userMenuOpen = !userMenuOpen"
        >
          <div class="avatar avatar-online pos-user-avatar">
            <span class="avatar-initial rounded-circle">{{ userInitials }}</span>
          </div>
          <span class="pos-user-info d-none d-md-flex">
            <span class="pos-user-name">{{ userName }}</span>
            <span class="pos-user-role">Cashier</span>
          </span>
        </a>
        <ul class="dropdown-menu dropdown-menu-end" :class="{ show: userMenuOpen }">
          <li>
            <span class="dropdown-item-text">
              <span class="fw-semibold d-block">{{ userName }}</span>
            </span>
          </li>
          <li><div class="dropdown-divider"></div></li>
          <li>
            <a href="javascript:void(0);" class="dropdown-item" @click="closeMenuThen('change-branch')">
              <i class="fa fa-code-branch me-2"></i> Change Branch
            </a>
          </li>
          <li>
            <a href="javascript:void(0);" class="dropdown-item" @click="closeMenuThen('logout')">
              <i class="fa fa-power-off me-2"></i> Logout
            </a>
          </li>
        </ul>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  shopName: { type: String, default: '' },
  userName: { type: String, default: '' },
  branchName: { type: String, default: '' },
  session: { type: Object, default: null },
  registerName: { type: String, default: 'Register' },
  heldCount: { type: Number, default: 0 },
  pendingOrderCount: { type: Number, default: 0 },
  syncStatus: { type: String, default: 'offline' },
});

const emit = defineEmits([
  'cash-in',
  'cash-out',
  'add-expense',
  'reports',
  'held-orders',
  'close-register',
  'orders-sync',
  'change-branch',
  'logout',
]);

const userInitials = computed(() => {
  const words = (props.userName || '').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return initials || 'U';
});

const syncDotClass = computed(() => ({
  'text-success': props.syncStatus === 'synced',
  'text-warning': props.syncStatus === 'pending' || props.syncStatus === 'syncing',
  'text-danger': props.syncStatus === 'sync_error',
  'text-muted': props.syncStatus === 'offline',
}));

const syncTooltip = computed(() => {
  const labels = { synced: 'Synced', pending: 'Pending sync', syncing: 'Syncing', sync_error: 'Sync error', offline: 'Offline' };
  return labels[props.syncStatus] || 'Offline';
});

// The user menu is Vue-controlled (not Bootstrap's data-bs-toggle) so it
// doesn't depend on Bootstrap's dropdown JS/Popper positioning actually
// initializing correctly for this toggle - a plain ref + click-outside is
// simpler and was more reliable in practice.
const userMenuOpen = ref(false);
const userMenuEl = ref(null);

function closeMenuThen(eventName) {
  userMenuOpen.value = false;
  emit(eventName);
}

function onDocumentClick(e) {
  if (userMenuOpen.value && userMenuEl.value && !userMenuEl.value.contains(e.target)) {
    userMenuOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>
