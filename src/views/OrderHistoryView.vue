<template>
  <div class="order-history-page">
    <div class="order-history-header">
      <div class="d-flex align-items-center gap-2">
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="router.push('/pos')">
          <i class="fa fa-arrow-left"></i> Back to POS
        </button>
        <h5 class="mb-0 ms-2">
          <template v-if="orderDetail">Order Detail</template>
          <template v-else>Order History</template>
        </h5>
      </div>
      <template v-if="!orderDetail">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="!syncState?.online || !orderList.some((o) => o.sync_status !== 'synced') || syncing"
          @click="syncAll"
        >
          <i class="fa fa-cloud-arrow-up"></i> Sync All
        </button>
      </template>
      <button v-else type="button" class="btn btn-sm btn-outline-secondary" @click="orderDetail = null">
        <i class="fa fa-arrow-left"></i> Back to List
      </button>
    </div>

    <div class="order-history-body" :class="{ 'order-history-body-wide': !orderDetail }">
      <template v-if="!orderDetail">
        <p v-if="!syncState?.online" class="small text-danger mb-2">
          <i class="fa fa-triangle-exclamation"></i> Offline - sync is unavailable until the connection returns.
        </p>

        <div class="d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap">
          <div class="pos-search-input-wrap order-history-search">
            <i class="fa fa-magnifying-glass pos-search-icon"></i>
            <input v-model="searchTerm" type="text" class="form-control" placeholder="Search order #, customer..." />
          </div>
          <div class="d-flex align-items-center gap-2">
            <label class="small text-muted mb-0">Rows</label>
            <select v-model.number="pageSize" class="form-select form-select-sm" style="width: auto;">
              <option :value="10">10</option>
              <option :value="25">25</option>
              <option :value="50">50</option>
            </select>
          </div>
        </div>

        <div class="table-responsive order-history-table-wrap">
          <table class="table table-sm table-hover align-middle order-history-table">
            <thead>
              <tr>
                <th v-for="col in columns" :key="col.key" class="sortable" @click="toggleSort(col.key)">
                  {{ col.label }}
                  <i v-if="sortKey === col.key" class="fa" :class="sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'"></i>
                  <i v-else class="fa fa-sort text-muted opacity-50"></i>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!pagedOrders.length">
                <td :colspan="columns.length + 1" class="text-center text-muted py-4">
                  {{ orderList.length ? 'No orders match your search.' : 'No orders found.' }}
                </td>
              </tr>
              <tr v-for="row in pagedOrders" :key="row.local_id" class="order-history-row" @click="openDetail(row.local_id)">
                <td>{{ row.daily_order_id ? '#' + row.daily_order_id : row.local_id.slice(-6) }}</td>
                <td>{{ row.customer_name || 'Walk-in' }}</td>
                <td>{{ row.item_count }}</td>
                <td>{{ money(row.total) }}</td>
                <td><span class="badge" :class="orderSyncBadgeClass(row.sync_status)">{{ orderSyncLabel(row.sync_status) }}</span></td>
                <td class="text-nowrap">{{ row.created_at }}</td>
                <td class="text-end">
                  <button
                    v-if="row.sync_status !== 'synced'"
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    :disabled="!syncState?.online || syncing"
                    @click.stop="syncOne(row.local_id)"
                  >
                    <i class="fa fa-cloud-arrow-up"></i> Sync
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="sortedOrders.length" class="d-flex align-items-center justify-content-between mt-2">
          <small class="text-muted">
            Showing {{ pageStart + 1 }}-{{ Math.min(pageStart + pageSize, sortedOrders.length) }} of {{ sortedOrders.length }}
          </small>
          <nav>
            <ul class="pagination pagination-sm mb-0">
              <li class="page-item" :class="{ disabled: currentPage === 1 }">
                <a class="page-link" href="javascript:void(0);" @click="currentPage = Math.max(1, currentPage - 1)">Prev</a>
              </li>
              <li v-for="p in totalPages" :key="p" class="page-item" :class="{ active: p === currentPage }">
                <a class="page-link" href="javascript:void(0);" @click="currentPage = p">{{ p }}</a>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                <a class="page-link" href="javascript:void(0);" @click="currentPage = Math.min(totalPages, currentPage + 1)">Next</a>
              </li>
            </ul>
          </nav>
        </div>
      </template>

      <OrderDetailPanel
        v-else
        :order="orderDetail"
        :payment-method-name="paymentMethodName"
        :syncing="syncing"
        :online="!!syncState?.online"
        @sync="syncOne(orderDetail.local_id, true)"
      />
    </div>

    <div v-if="toastMessage" class="position-fixed bottom-0 end-0 p-3" style="z-index: 1080;">
      <div class="toast show text-bg-dark">
        <div class="d-flex">
          <div class="toast-body">{{ toastMessage }}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" @click="toastMessage = ''"></button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { invoke } from '@/services/ipc';
import OrderDetailPanel from '@/components/pos/OrderDetailPanel.vue';
import { describeSyncResult, orderSyncBadgeClass, orderSyncLabel } from '@/components/pos/orderSync';

const router = useRouter();
const syncState = inject('syncState', null);

const orderList = ref([]);
const orderDetail = ref(null);
const syncing = ref(false);
const paymentMethods = ref([]);

const toastMessage = ref('');
function toast(msg) {
  toastMessage.value = msg;
  setTimeout(() => { if (toastMessage.value === msg) toastMessage.value = ''; }, 3500);
}

function money(v) {
  const n = Number(v || 0);
  return Number.isNaN(n) ? '0.00' : n.toFixed(2);
}

function paymentMethodName(id) {
  return paymentMethods.value.find((m) => m.payment_method_id === id)?.name || 'Payment';
}

// ==============================
// Search / sort / pagination - all client-side: order:list is already
// capped at 200 rows server-side (electron/ipc/handlers.js), well within
// comfortable range for Array.filter/sort/slice, so there's no need for a
// datatable library or server-side paging for a single device's own orders.
// ==============================
const columns = [
  { key: 'daily_order_id', label: 'Order #' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'item_count', label: 'Items' },
  { key: 'total', label: 'Total' },
  { key: 'sync_status', label: 'Status' },
  { key: 'created_at', label: 'Date' },
];

const searchTerm = ref('');
const sortKey = ref('created_at');
const sortDir = ref('desc');
const pageSize = ref(10);
const currentPage = ref(1);

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
}

const filteredOrders = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  if (!term) return orderList.value;
  return orderList.value.filter((o) => [
    o.daily_order_id ? `#${o.daily_order_id}` : o.local_id,
    o.customer_name,
  ].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
});

const sortedOrders = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...filteredOrders.value].sort((a, b) => {
    const av = a[sortKey.value];
    const bv = b[sortKey.value];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(sortedOrders.value.length / pageSize.value)));
const pageStart = computed(() => (currentPage.value - 1) * pageSize.value);
const pagedOrders = computed(() => sortedOrders.value.slice(pageStart.value, pageStart.value + pageSize.value));

watch([searchTerm, pageSize, sortKey, sortDir], () => { currentPage.value = 1; });
watch(totalPages, (max) => { if (currentPage.value > max) currentPage.value = max; });

async function refreshList() {
  orderList.value = await invoke('order:list');
}

async function openDetail(localId) {
  orderDetail.value = await invoke('order:detail', { localId });
}

async function syncOne(localId, refreshDetail = false) {
  syncing.value = true;
  try {
    const res = await invoke('order:sync-one', { localId });
    await refreshList();
    if (refreshDetail) await openDetail(localId);
    toast(describeSyncResult(res, { singular: true }));
  } catch (e) {
    toast(e.message);
  } finally {
    syncing.value = false;
  }
}

async function syncAll() {
  syncing.value = true;
  try {
    const res = await invoke('order:sync-all');
    await refreshList();
    toast(describeSyncResult(res));
  } catch (e) {
    toast(e.message);
  } finally {
    syncing.value = false;
  }
}

onMounted(async () => {
  const bootstrap = await invoke('pos:get-bootstrap');
  paymentMethods.value = bootstrap.payment_methods || [];
  await refreshList();
});
</script>
