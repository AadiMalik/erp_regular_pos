<template>
  <div class="list-group-item pos-order-row" @click="$emit('open')">
    <div class="d-flex justify-content-between align-items-start">
      <div>
        <div class="fw-semibold">
          {{ order.daily_order_id ? '#' + order.daily_order_id : 'Order ' + order.local_id.slice(-6) }}
        </div>
        <small class="text-muted">
          {{ order.customer_name || 'Walk-in' }} - {{ order.item_count }} item{{ order.item_count === 1 ? '' : 's' }}
        </small>
        <div class="small text-muted">{{ order.created_at }}</div>
      </div>
      <div class="text-end">
        <div class="fw-bold">{{ money(order.total) }}</div>
        <span class="badge" :class="orderSyncBadgeClass(order.sync_status)">{{ orderSyncLabel(order.sync_status) }}</span>
      </div>
    </div>
    <button
      v-if="order.sync_status !== 'synced'"
      type="button"
      class="btn btn-sm btn-outline-primary mt-2"
      :disabled="!online || syncing"
      @click.stop="$emit('sync')"
    >
      <i class="fa fa-cloud-arrow-up"></i> Sync This Order
    </button>
  </div>
</template>

<script setup>
import { orderSyncBadgeClass, orderSyncLabel } from './orderSync';

defineProps({
  order: { type: Object, required: true },
  syncing: { type: Boolean, default: false },
  online: { type: Boolean, default: false },
});

defineEmits(['open', 'sync']);

function money(v) {
  const n = Number(v || 0);
  return Number.isNaN(n) ? '0.00' : n.toFixed(2);
}
</script>
