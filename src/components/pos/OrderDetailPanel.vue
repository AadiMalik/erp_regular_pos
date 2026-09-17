<template>
  <div>
    <div class="d-flex justify-content-between align-items-start mb-2">
      <div>
        <h6 class="mb-0">{{ order.daily_order_id ? '#' + order.daily_order_id : 'Order ' + order.local_id.slice(-6) }}</h6>
        <small class="text-muted">{{ order.created_at }}</small>
      </div>
      <span class="badge" :class="orderSyncBadgeClass(order.sync_status)">{{ orderSyncLabel(order.sync_status) }}</span>
    </div>

    <p v-if="order.conflict_reason" class="small text-danger">{{ order.conflict_reason }}</p>
    <p v-if="order.sync_status === 'failed' && lastSyncError" class="small text-danger">{{ lastSyncError }}</p>

    <p class="mb-1"><strong>Customer:</strong> {{ order.customer?.name || 'Walk-in' }}</p>

    <div class="table-responsive mb-2">
      <table class="table table-sm">
        <thead><tr><th>Item</th><th class="text-end">Qty</th><th class="text-end">Price</th><th class="text-end">Total</th></tr></thead>
        <tbody>
          <tr v-for="line in order.items" :key="line.local_id">
            <td>{{ line.product_name }}<small v-if="line.variation_name" class="text-muted"> ({{ line.variation_name }})</small>
              <span v-if="line.payload?.is_complimentary || line.is_complimentary" class="badge bg-info text-dark ms-1">Complimentary</span>
            </td>
            <td class="text-end">{{ line.quantity }}</td>
            <td class="text-end">{{ money(line.unit_price) }}</td>
            <td class="text-end">{{ money(line.line_total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="table-responsive mb-2">
      <table class="table table-sm">
        <tbody>
          <tr><td>Subtotal</td><td class="text-end">{{ money(order.subtotal) }}</td></tr>
          <tr><td>Discount</td><td class="text-end">{{ money(order.discount_amount) }}</td></tr>
          <tr><td>Tax ({{ formatTaxPercent(order.tax) }}%) ({{ order.tax_type === 'inclusive' ? 'Inclusive' : 'Exclusive' }})</td><td class="text-end">{{ money(order.tax_amount) }}</td></tr>
          <tr v-if="Number(order.tax_discount_amount) > 0"><td>Tax Discount ({{ formatTaxPercent(order.tax_discount) }}%)</td><td class="text-end">{{ money(order.tax_discount_amount) }}</td></tr>
          <tr class="fw-bold"><td>Total</td><td class="text-end">{{ money(order.total) }}</td></tr>
          <tr><td>Paid</td><td class="text-end">{{ money(order.paid_amount) }}</td></tr>
          <tr><td>Change</td><td class="text-end">{{ money(order.change_amount) }}</td></tr>
        </tbody>
      </table>
    </div>

    <h6>Payments</h6>
    <ul class="list-group mb-3">
      <li v-for="p in order.payments" :key="p.local_id" class="list-group-item d-flex justify-content-between">
        <span>{{ paymentMethodName(p.payment_method_id) }}</span>
        <span>{{ money(p.amount) }}</span>
      </li>
    </ul>

    <button
      v-if="order.sync_status !== 'synced'"
      type="button"
      class="btn btn-sm btn-primary"
      :disabled="!online || syncing"
      @click="$emit('sync')"
    >
      <i class="fa fa-cloud-arrow-up"></i> Sync This Order
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { orderSyncBadgeClass, orderSyncLabel } from './orderSync';

const props = defineProps({
  order: { type: Object, required: true },
  paymentMethodName: { type: Function, required: true },
  syncing: { type: Boolean, default: false },
  online: { type: Boolean, default: false },
});

defineEmits(['sync']);

function money(v) {
  const n = Number(v || 0);
  return Number.isNaN(n) ? '0.00' : n.toFixed(2);
}

function formatTaxPercent(percent) {
  const n = Number(percent || 0);
  if (!Number.isFinite(n)) return '0';
  return String(parseFloat(n.toFixed(4)));
}

const lastSyncError = computed(() => {
  const rows = props.order.sync_history || [];
  return [...rows].reverse().find((r) => r.status === 'failed')?.last_error || '';
});
</script>
