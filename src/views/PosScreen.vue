<template>
  <div class="pos-screen-wrapper" id="posScreen">
    <PosHeader
      :shop-name="bootstrap.shop_name"
      :user-name="bootstrap.current_user?.name || ''"
      :branch-name="bootstrap.branch_name"
      :session="session"
      :register-name="registerName"
      :held-count="heldOrders.length"
      :pending-order-count="pendingOrderCount"
      :sync-status="syncState?.status"
      @cash-in="openCashMovement('in')"
      @cash-out="openCashMovement('out')"
      @add-expense="openAddExpense"
      @reports="openReports"
      @held-orders="openHeldOrders"
      @close-register="openCloseSession"
      @orders-sync="openOrdersPanel"
      @change-branch="openChangeBranch"
      @logout="logout"
    />

    <div v-if="!session" id="posNoSessionArea" class="card">
      <div class="card-body pos-disabled-overlay text-center">
        <i class="fa fa-cash-register fs-1 text-muted mb-2"></i>
        <p class="mb-1 fw-semibold">No register session is open</p>
        <p class="text-muted mb-3">Open a register before placing orders.</p>
        <button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#openSessionModal">
          <i class="fa fa-lock-open"></i> Open Register
        </button>
      </div>
    </div>

    <div v-else class="pos-screen-body">
      <div class="pos-layout">
        <!-- ================= Left column ================= -->
        <div class="pos-left-col">
          <div class="pos-row pos-row-top">
            <div class="pos-field pos-field-search" style="position: relative;">
              <span class="pos-field-label">Search Product</span>
              <div class="pos-search-input-wrap">
                <i class="fa fa-magnifying-glass pos-search-icon"></i>
                <input
                  v-model="searchTerm"
                  type="text"
                  class="form-control"
                  placeholder="Search by name, SKU or scan barcode..."
                  autocomplete="off"
                  @keyup.enter="runSearch"
                />
                <button type="button" class="btn pos-scan-btn" title="Scan barcode" @click="runSearch">
                  <i class="fa fa-barcode"></i>
                </button>
              </div>
              <div v-if="searchResults.length" class="list-group pos-search-results">
                <a
                  v-for="item in searchResults"
                  :key="item.product_variation_id"
                  href="javascript:void(0);"
                  class="list-group-item list-group-item-action"
                  :class="{ 'pos-search-result-out-of-stock': isOutOfStock(item) }"
                  @click="pickFromSearch(item)"
                >
                  <div class="d-flex justify-content-between">
                    <span>{{ item.product_name }}<small v-if="item.name" class="text-muted"> ({{ item.name }})</small></span>
                    <strong>{{ money(item.resolved_price ?? item.sale_price) }}</strong>
                  </div>
                </a>
              </div>
            </div>

            <div class="pos-field pos-field-ordertype pos-pill-group">
              <span class="pos-field-label">Order Type</span>
              <div class="pos-pill-buttons">
                <button
                  v-for="t in bootstrap.order_types"
                  :key="t.order_type_id"
                  type="button"
                  class="pos-pill"
                  :class="{ active: orderTypeId === t.order_type_id }"
                  @click="orderTypeId = t.order_type_id"
                >{{ t.name }}</button>
              </div>
            </div>

            <div class="pos-field pos-field-branch">
              <span class="pos-field-label">Branch</span>
              <div class="pos-branch-switch">
                <span class="pos-branch-current"><i class="fa fa-code-branch"></i> {{ bootstrap.branch_name || 'Branch' }}</span>
                <button type="button" class="btn pos-header-btn" title="Change Branch" @click="openChangeBranch">
                  <i class="fa fa-exchange-alt"></i>
                </button>
              </div>
            </div>
          </div>

          <div class="pos-row pos-row-products">
            <div class="pos-category-rail">
              <button type="button" class="category-rail-item" :class="{ active: !categoryId }" @click="loadCategory('')">
                <span class="category-rail-icon"><i class="fa fa-th-large"></i></span>
                <span class="category-rail-label">All Products</span>
              </button>
              <button
                v-for="c in bootstrap.categories"
                :key="c.category_id"
                type="button"
                class="category-rail-item"
                :class="{ active: categoryId === c.category_id }"
                @click="loadCategory(c.category_id)"
              >
                <span class="category-rail-icon">
                  <img v-if="c.logo_url" :src="c.logo_url" alt="" />
                  <i v-else class="fa fa-tag"></i>
                </span>
                <span class="category-rail-label">{{ c.name }}</span>
              </button>
            </div>

            <div class="pos-main-col" :class="{ 'checkout-open': checkoutOpen }">
              <div class="pos-product-panel">
                <div class="pos-product-results">
                  <div v-if="productResults.length" class="product-grid">
                    <button
                      v-for="product in productResults"
                      :key="product.product_id"
                      type="button"
                      class="product-card"
                      :class="{ 'product-card-out-of-stock': isSingleVariationOutOfStock(product) }"
                      @click="handleGridProductClick(product)"
                    >
                      <div class="product-card-img-wrap">
                        <img v-if="productImage(product)" class="product-card-img" :src="productImage(product)" alt="" />
                        <div v-else class="product-card-img d-flex align-items-center justify-content-center text-muted">
                          <i class="fa fa-image"></i>
                        </div>
                        <span v-if="(product.variations || []).length > 1" class="product-card-variations-badge">
                          {{ product.variations.length }} options
                        </span>
                      </div>
                      <div class="product-card-body">
                        <span class="product-card-add-btn"><i class="fa fa-plus"></i></span>
                        <div class="product-card-name">{{ product.name }}</div>
                        <div class="product-card-sku">{{ product.variations?.[0]?.sku || '' }}</div>
                        <div class="product-card-footer">
                          <span class="product-card-price">{{ money(firstVariationPrice(product)) }}</span>
                        </div>
                        <span v-if="(product.variations || []).length === 1" v-html="stockHintHtml(product.variations[0])"></span>
                      </div>
                    </button>
                  </div>
                  <div v-else class="pos-empty-state">
                    <i class="fa fa-box-open fs-1 text-muted mb-2"></i>
                    <p class="text-muted mb-0">No products found</p>
                  </div>
                </div>

                <button type="button" class="pos-checkout-clip" :aria-expanded="checkoutOpen ? 'true' : 'false'" title="Payment &amp; Options" @click="checkoutOpen = !checkoutOpen">
                  <i class="fa fa-bookmark"></i>
                  <span>{{ checkoutSummaryLabel }}</span>
                </button>
              </div>

              <div class="pos-checkout-wrap" :class="{ 'is-collapsed': !checkoutOpen }">
                <div class="pos-row pos-row-meta">
                  <div class="pos-checkout-body">
                    <div class="pos-meta-row pos-delivery-payment-row">
                      <div v-if="isDeliveryOrderType" class="pos-field pos-field-delivery">
                        <label class="pos-field-label" for="delivery_address">Delivery Address <span class="text-danger">*</span></label>
                        <input id="delivery_address" v-model="deliveryAddress" type="text" class="form-control form-control-sm" placeholder="Enter address" />
                      </div>

                      <div class="pos-field pos-field-payment">
                        <span class="pos-field-label">Payment Method</span>
                        <div class="pos-pill-group">
                          <div class="pos-pill-buttons pos-payment-pills">
                            <button
                              v-for="m in bootstrap.payment_methods"
                              :key="m.payment_method_id"
                              type="button"
                              class="pos-pill"
                              :class="{ active: paymentMode === 'single' && selectedPaymentMethodId === m.payment_method_id }"
                              @click="selectPaymentMethod(m.payment_method_id)"
                            >{{ m.name }}</button>
                            <button
                              type="button"
                              class="pos-pill"
                              :class="{ active: paymentMode === 'multi' }"
                              @click="paymentMode = 'multi'"
                            >Multi Pay</button>
                          </div>
                        </div>

                        <div v-if="paymentMode === 'multi' || creditCustomerSummary || singleMethodRequiresBank" class="pos-payment-extra">
                          <div class="pos-payment-extra-summary">
                            <span>Entered</span><span>{{ money(paymentEntered) }}</span>
                          </div>

                          <div v-if="paymentMode === 'multi'">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                              <span class="fw-semibold">Split Payment</span>
                              <button type="button" class="btn btn-sm btn-outline-primary" @click="addPaymentRow">
                                <i class="fa fa-plus"></i> Add
                              </button>
                            </div>
                            <div v-for="(row, idx) in paymentRows" :key="idx" class="d-flex gap-2 align-items-center mb-2">
                              <select v-model="row.payment_method_id" class="form-select form-select-sm">
                                <option v-for="m in bootstrap.payment_methods" :key="m.payment_method_id" :value="m.payment_method_id">{{ m.name }}</option>
                              </select>
                              <input v-model.number="row.amount" type="number" step="0.01" min="0" class="form-control form-control-sm" style="max-width: 110px;" />
                              <select v-if="requiresBank(methodType(row.payment_method_id))" v-model="row.bank_id" class="form-select form-select-sm" style="max-width: 140px;">
                                <option value="">-- Select Bank --</option>
                                <option v-for="b in bootstrap.banks" :key="b.bank_id" :value="b.bank_id">{{ b.name }}</option>
                              </select>
                              <button type="button" class="btn btn-sm btn-outline-danger" @click="paymentRows.splice(idx, 1)">
                                <i class="fa fa-xmark"></i>
                              </button>
                            </div>
                          </div>

                          <div v-if="singleMethodRequiresBank" class="mb-2">
                            <select v-model="singlePaymentBankId" class="form-select form-select-sm">
                              <option value="">-- Select Bank --</option>
                              <option v-for="b in bootstrap.banks" :key="b.bank_id" :value="b.bank_id">{{ b.name }}</option>
                            </select>
                          </div>

                          <div v-if="creditCustomerSummary">
                            <div class="d-flex justify-content-between align-items-center pos-credit-summary">
                              <span>{{ creditCustomerSummary }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="pos-meta-row">
                      <div v-if="settings.pos_setting?.enable_discount && ['order', 'both'].includes(settings.pos_setting?.discount_level)" class="pos-field pos-field-discount">
                        <span class="pos-field-label">Discount</span>
                        <select v-model="discountId" class="form-select form-select-sm">
                          <option value="">--No Discount--</option>
                          <option v-for="d in bootstrap.discounts" :key="d.discount_id" :value="d.discount_id">
                            {{ d.name }} ({{ d.type === 'percent' ? d.value + '%' : d.value }})
                          </option>
                        </select>
                      </div>
                      <div class="pos-field pos-field-voucher" style="position: relative;">
                        <span class="pos-field-label">Voucher / Coupon</span>
                        <div class="input-group input-group-sm">
                          <input v-model="voucherCode" type="text" class="form-control" placeholder="Search or enter code" autocomplete="off" />
                          <button class="btn btn-outline-primary" type="button" @click="applyVoucher">Apply</button>
                        </div>
                        <div v-if="voucherFeedback" class="small mt-1" :class="appliedVoucher ? 'text-success' : 'text-danger'">{{ voucherFeedback }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ================= Right column ================= -->
        <div class="pos-right-col">
          <div class="pos-cart-card">
            <div class="pos-cart-header">
              <h6 class="mb-0">Cart <span class="pos-cart-count">({{ cart.length }} Item{{ cart.length === 1 ? '' : 's' }})</span></h6>
              <div class="pos-cart-header-select pos-cart-header-select-customer">
                <select v-model="customerId" class="form-select form-select-sm" title="Customer">
                  <option v-for="c in bootstrap.customers" :key="c.user_id" :value="c.user_id">{{ customerLabel(c) }}</option>
                </select>
                <div v-if="creditLimitHint" class="pos-cart-credit-hint">{{ creditLimitHint }}</div>
              </div>
              <button type="button" class="btn btn-sm pos-cart-icon-btn" title="Add Customer" data-bs-toggle="modal" data-bs-target="#addCustomerModal">
                <i class="fa fa-user-plus"></i>
              </button>
              <div class="pos-cart-header-select">
                <select v-model="saleTypeId" class="form-select form-select-sm" title="Sale Type">
                  <option v-for="s in bootstrap.sale_types" :key="s.sale_type_id" :value="s.sale_type_id">{{ s.name }}</option>
                </select>
              </div>
              <span v-if="currentOrderLocalId" class="pos-cart-order-no">Held Order</span>
              <button
                v-if="canCreateComplimentary && cart.length"
                type="button"
                class="btn btn-sm pos-cart-icon-btn"
                :class="{ active: complimentaryStatus === 'full', 'is-partial': complimentaryStatus === 'partial' }"
                :title="complimentaryHeaderTitle"
                @click="toggleOrderComplimentary"
              >
                <i class="fa fa-gift"></i>
              </button>
              <button v-if="cart.length" type="button" class="btn btn-sm pos-clear-cart-btn" @click="clearCart">
                <i class="fa fa-trash"></i> Clear
              </button>
            </div>

            <div class="pos-cart-columns">
              <span class="pos-cart-col-items">Items</span>
              <span class="pos-cart-col-price">Price</span>
              <span v-if="showLineDiscount" class="pos-cart-col-discount">Discount</span>
              <span class="pos-cart-col-qty">Qty</span>
              <span class="pos-cart-col-total">Total</span>
            </div>

            <div class="pos-cart-scroll">
              <div v-if="!cart.length" class="pos-cart-empty">
                <i class="fa fa-cart-shopping fs-1 text-muted mb-2"></i>
                <p class="text-muted mb-0">Cart is empty</p>
              </div>
              <div v-for="line in cart" :key="line.line_key" class="cart-line" :class="{ 'cart-line-complimentary': line.is_complimentary }">
                <img v-if="line.image" class="cart-line-img" :src="line.image" alt="" />
                <div v-else class="cart-line-img-placeholder"><i class="fa fa-image"></i></div>
                <div class="cart-line-info">
                  <div class="cart-line-name">
                    {{ line.product_name }}<template v-if="line.variation_name"> ({{ line.variation_name }})</template>
                    <span v-if="line.is_complimentary" class="badge bg-info text-dark ms-1">Complimentary</span>
                  </div>
                  <span v-html="stockHintHtml(line)"></span>
                </div>
                <div class="cart-line-price">{{ money(line.unit_price) }}</div>
                <div v-if="showLineDiscount" class="cart-line-discount">
                  <input v-model.number="line.discount" type="number" step="0.01" min="0" max="100" class="line-discount" /><span>%</span>
                </div>
                <div v-else class="cart-line-discount"></div>
                <div class="cart-line-qty-stepper">
                  <button type="button" class="qty-dec" @click="stepQty(line, -1)">-</button>
                  <input v-model.number="line.quantity" type="number" step="0.01" min="0.01" class="line-qty" @change="clampQty(line)" />
                  <button type="button" class="qty-inc" @click="stepQty(line, 1)">+</button>
                </div>
                <div class="line-total">{{ money(lineTotal(line).total) }}</div>
                <button
                  v-if="canCreateComplimentary"
                  type="button"
                  class="line-complimentary"
                  :class="{ 'is-active': line.is_complimentary }"
                  :title="line.is_complimentary ? 'Unmark complimentary' : 'Mark complimentary'"
                  @click="toggleLineComplimentary(line)"
                >
                  <i class="fa fa-gift"></i>
                </button>
                <button type="button" class="line-remove" @click="removeLine(line.line_key)"><i class="fa fa-xmark"></i></button>
              </div>
            </div>
          </div>

          <div class="pos-totals-card">
            <div class="pos-totals-row"><span>Subtotal</span><span>{{ money(totals.subtotal) }}</span></div>
            <div class="pos-totals-row"><span>Item Discounts</span><span>{{ money(totals.itemDiscount) }}</span></div>
            <div class="pos-totals-row"><span>Order Discount</span><span>{{ money(totals.orderDiscount) }}</span></div>
            <div class="pos-totals-row"><span>{{ taxLineLabel }}</span><span>{{ money(totals.tax) }}</span></div>
            <div v-if="totals.taxDiscount > 0" class="pos-totals-row"><span>{{ taxDiscountLineLabel }}</span><span>{{ money(totals.taxDiscount) }}</span></div>
            <div v-if="isDeliveryOrderType" class="pos-totals-row pos-totals-row-input">
              <span>Delivery Charge <small v-if="isFreeDeliveryEligible" class="pos-delivery-free-badge">Free</small></span>
              <input
                id="delivery_charge"
                v-model.number="deliveryCharge"
                type="number"
                step="0.01"
                min="0"
                class="pos-totals-input"
                placeholder="0.00"
                :disabled="isFreeDeliveryEligible"
              />
            </div>
            <div class="pos-totals-row pos-grand-total"><span>Total</span><span>{{ money(totals.total) }}</span></div>
          </div>
        </div>
      </div>

      <div class="pos-sticky-footer">
        <div class="pos-footer-field pos-footer-paid">
          <label for="paidAmountInput">Paid Amount</label>
          <input
            id="paidAmountInput"
            v-model.number="paidAmountInput"
            type="number"
            step="0.01"
            min="0"
            class="form-control"
            placeholder="0.00"
            :disabled="paymentMode === 'multi'"
          />
        </div>

        <div class="pos-footer-field pos-footer-due">
          <label>{{ dueChangeLabel }}</label>
          <span class="pos-footer-due-value">{{ money(Math.abs(dueChangeAmount)) }}</span>
        </div>

        <div class="pos-footer-actions">
          <button type="button" class="btn pos-hold-btn" :disabled="!cart.length" @click="holdOrder">
            <i class="fa fa-pause"></i> {{ currentOrderLocalId ? 'Update Hold' : 'Hold' }} <span class="pos-key-hint">(F6)</span>
          </button>
          <button type="button" class="btn pos-pay-btn" :disabled="!cart.length" @click="payClicked">
            <i class="fa fa-check"></i> Pay <span class="pos-key-hint">(F9)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ================= Product Picker Modal ================= -->
    <div class="modal fade" id="productPickerModal" tabindex="-1" ref="productPickerModalEl">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Select a variation{{ picker.product ? ' for ' + picker.product.name : '' }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="product-grid product-picker-grid">
              <button
                v-for="v in picker.variations"
                :key="v.product_variation_id"
                type="button"
                class="product-card"
                :class="{ 'product-card-out-of-stock': isOutOfStock(v) }"
                @click="pickVariation(v)"
              >
                <div class="product-card-img-wrap">
                  <img v-if="productImage(picker.product)" class="product-card-img" :src="productImage(picker.product)" alt="" />
                  <div v-else class="product-card-img d-flex align-items-center justify-content-center text-muted"><i class="fa fa-image"></i></div>
                </div>
                <div class="product-card-body">
                  <div class="product-card-name">{{ v.name || picker.product?.name }}</div>
                  <div v-if="v.sku" class="product-card-sku">{{ v.sku }}</div>
                  <div class="product-card-footer">
                    <span class="product-card-price">{{ money(v.resolved_price ?? v.sale_price) }}</span>
                  </div>
                  <span v-html="stockHintHtml(v)"></span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Change Branch Modal ================= -->
    <div class="modal fade" id="changeBranchModal" tabindex="-1" ref="changeBranchModalEl">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Change Branch</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-1">
              <label class="form-label">Branch <span class="text-danger">*</span></label>
              <select v-model="changeBranchForm.branchId" class="form-select" required>
                <option value="">--Select Branch--</option>
                <option v-for="b in contextOptions.branches" :key="b.branch_id" :value="b.branch_id">{{ b.name }}</option>
              </select>
              <small class="text-muted">Stock from every warehouse linked to this branch is combined automatically - there is no warehouse to pick.</small>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" @click="submitChangeBranch">Switch Branch</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Add Customer Modal ================= -->
    <div class="modal fade" id="addCustomerModal" tabindex="-1" ref="addCustomerModalEl">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add Customer</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Name <span class="text-danger">*</span></label>
              <input v-model="newCustomer.name" type="text" class="form-control" />
            </div>
            <div class="mb-3">
              <label class="form-label">Email <span class="text-danger">*</span></label>
              <input v-model="newCustomer.email" type="email" class="form-control" />
            </div>
            <div class="mb-1">
              <label class="form-label">Phone</label>
              <input v-model="newCustomer.phone" type="text" class="form-control" />
            </div>
            <p v-if="customerError" class="text-danger small mb-0 mt-2">{{ customerError }}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" @click="submitAddCustomer">Save Customer</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Credit Payment Modal ================= -->
    <div class="modal fade" id="creditPaymentModal" tabindex="-1" ref="creditPaymentModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Credit Sale - Customer Payment Details</h5>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Customer</label>
              <div class="form-control-plaintext fw-bold">{{ selectedCustomer ? customerLabel(selectedCustomer) : '' }}</div>
            </div>
            <div class="mb-3">
              <label class="form-label">Due Date</label>
              <input v-model="creditForm.dueDate" type="date" class="form-control" />
            </div>
            <div class="mb-1">
              <label class="form-label">Note</label>
              <textarea v-model="creditForm.note" class="form-control" rows="2" placeholder="Optional reference note"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" @click="finalizeCreditAndComplete">Skip</button>
            <button type="button" class="btn btn-primary" @click="finalizeCreditAndComplete">Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="complimentaryReasonModal" tabindex="-1" ref="complimentaryReasonModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ complimentaryModalScope === 'order' ? 'Mark order complimentary' : 'Mark complimentary' }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted small">A complimentary reason is required. The selling amount charged to the customer becomes zero; inventory cost is kept for accounting.</p>
            <div class="mb-3">
              <label class="form-label">Reason <span class="text-danger">*</span></label>
              <select v-model="complimentaryForm.reasonId" class="form-select">
                <option value="">Select reason</option>
                <option v-for="r in bootstrap.complimentary_reasons" :key="r.complimentary_reason_id" :value="r.complimentary_reason_id">{{ r.name }}</option>
              </select>
            </div>
            <div class="mb-0">
              <label class="form-label">Notes</label>
              <textarea v-model="complimentaryForm.notes" class="form-control" rows="2" maxlength="500"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-info" @click="submitComplimentaryReason">Apply</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Open Register Session Modal ================= -->
    <div class="modal fade" id="openSessionModal" tabindex="-1" ref="openSessionModalEl">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Open Register Session</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Register <span class="text-danger">*</span></label>
              <select v-model="openForm.registerId" class="form-select">
                <option value="">--Select Register--</option>
                <option v-for="r in bootstrap.registers" :key="r.pos_register_id" :value="r.pos_register_id">{{ r.name }}</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label">Opening Cash <span class="text-danger">*</span></label>
              <input v-model.number="openForm.openingCash" type="number" step="0.01" min="0" class="form-control" />
            </div>
            <div class="mb-3">
              <label class="form-label">Opening Notes</label>
              <textarea v-model="openForm.notes" class="form-control" rows="2"></textarea>
            </div>
            <p v-if="openSessionError" class="text-danger small mb-0">{{ openSessionError }}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" @click="submitOpenSession">Open Session</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Close Register Session Modal ================= -->
    <div class="modal fade" id="closeSessionModal" tabindex="-1" ref="closeSessionModalEl">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Close Register Session</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <table class="table table-sm">
              <tbody>
                <tr><th>Opening Cash</th><td class="text-end">{{ money(closeSummary.opening_cash) }}</td></tr>
                <tr><th>Sales</th><td class="text-end">{{ money(closeSummary.total_sales_amount) }}</td></tr>
                <tr><th>Cash In</th><td class="text-end">{{ money(closeSummary.cash_movements_in) }}</td></tr>
                <tr><th>Cash Out</th><td class="text-end">{{ money(closeSummary.cash_movements_out) }}</td></tr>
                <tr><th>Expenses</th><td class="text-end">{{ money(closeSummary.total_expenses) }}</td></tr>
                <tr class="fw-bold"><th>Expected Cash</th><td class="text-end">{{ money(closeSummary.expected_cash) }}</td></tr>
              </tbody>
            </table>
            <div class="mb-3">
              <label class="form-label">Actual Cash <span class="text-danger">*</span></label>
              <input v-model.number="closeForm.actualCash" type="number" step="0.01" min="0" class="form-control" />
            </div>
            <div class="mb-3">
              <label class="form-label">Closing Notes</label>
              <textarea v-model="closeForm.notes" class="form-control" rows="2"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-danger" @click="submitCloseSession">Close Session</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Cash Movement Modal ================= -->
    <div class="modal fade" id="cashMovementModal" tabindex="-1" ref="cashMovementModalEl">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ cashMovementForm.type === 'in' ? 'Add Cash (In)' : 'Remove Cash (Out)' }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Amount <span class="text-danger">*</span></label>
              <input v-model.number="cashMovementForm.amount" type="number" step="0.01" min="0.01" class="form-control" />
            </div>
            <div class="mb-3">
              <label class="form-label">Reason</label>
              <input v-model="cashMovementForm.reason" type="text" class="form-control" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" @click="submitCashMovement">Save</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Add Expense Modal ================= -->
    <div class="modal fade" id="addExpenseModal" tabindex="-1" ref="addExpenseModalEl">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add Expense</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Category <span class="text-danger">*</span></label>
              <select v-model="expenseForm.categoryId" class="form-select">
                <option value="">--Select Category--</option>
                <option v-for="c in bootstrap.expense_categories" :key="c.expense_category_id" :value="c.expense_category_id">{{ c.name }}</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label">Amount <span class="text-danger">*</span></label>
              <input v-model.number="expenseForm.amount" type="number" step="0.01" min="0.01" class="form-control" />
            </div>
            <div class="mb-1">
              <label class="form-label">Description</label>
              <input v-model="expenseForm.description" type="text" class="form-control" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" @click="submitAddExpense">Save Expense</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Held Orders Offcanvas ================= -->
    <div class="offcanvas offcanvas-end" tabindex="-1" id="heldOrdersOffcanvas" ref="heldOrdersOffcanvasEl">
      <div class="offcanvas-header">
        <h5 class="offcanvas-title">Hold Orders</h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body">
        <div class="list-group">
          <div v-if="!heldOrders.length" class="text-muted text-center py-3">No hold orders</div>
          <a
            v-for="row in heldOrders"
            :key="row.local_id"
            href="javascript:void(0);"
            class="list-group-item list-group-item-action"
            @click="resumeHeldOrder(row.local_id)"
          >
            <div class="d-flex justify-content-between">
              <span>Held #{{ row.local_id.slice(-6) }}</span>
              <span class="fw-bold">{{ money(row.total) }}</span>
            </div>
          </a>
        </div>
      </div>
    </div>

    <!-- ================= Reports Offcanvas ================= -->
    <div class="offcanvas offcanvas-end" tabindex="-1" id="posReportsOffcanvas" ref="reportsOffcanvasEl">
      <div class="offcanvas-header">
        <h5 class="offcanvas-title">My Register Sessions</h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body">
        <div class="list-group mb-3">
          <div v-if="!reportSessions.length" class="text-muted text-center py-3">No sessions found</div>
          <a
            v-for="row in reportSessions"
            :key="row.local_id"
            href="javascript:void(0);"
            class="list-group-item list-group-item-action"
            @click="loadReportSummary(row.local_id)"
          >
            <div class="d-flex justify-content-between">
              <span>{{ row.register_name }}</span>
              <span class="badge" :class="row.status === 'open' ? 'bg-success' : 'bg-secondary'">{{ row.status }}</span>
            </div>
            <small class="text-muted">{{ row.opening_datetime }}</small>
          </a>
        </div>
        <div v-if="reportSummary">
          <hr />
          <h6>Session Summary</h6>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr><th>Detail</th><th class="text-end">Orders</th><th class="text-end">Amount</th></tr></thead>
              <tbody>
                <tr class="fw-bold"><td>Total</td><td class="text-end">{{ reportSummary.total_orders }}</td><td class="text-end">{{ money(reportSummary.total_sales_amount) }}</td></tr>
                <tr v-for="row in reportSummary.payment_method_totals" :key="row.payment_method_id">
                  <td>{{ paymentMethodName(row.payment_method_id) }}</td>
                  <td class="text-end">{{ row.order_count }}</td>
                  <td class="text-end">{{ money(row.total) }}</td>
                </tr>
                <tr><td>Discount</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.total_discount) }}</td></tr>
                <tr><td>Tax</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.total_tax) }}</td></tr>
                <tr><td>Opening Amount</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.opening_cash) }}</td></tr>
                <tr><td>Cash In</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.cash_movements_in) }}</td></tr>
                <tr><td>Cash Out</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.cash_movements_out) }}</td></tr>
                <tr><td>Expenses</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.total_expenses) }}</td></tr>
                <tr class="fw-bold"><td>Cash Amount</td><td class="text-end">-</td><td class="text-end">{{ money(reportSummary.expected_cash) }}</td></tr>
                <tr><td>Actual</td><td class="text-end">-</td><td class="text-end">{{ reportSummary.actual_cash != null ? money(reportSummary.actual_cash) : '-' }}</td></tr>
              </tbody>
            </table>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="printSessionSummary">
            <i class="fa fa-print"></i> Thermal Print
          </button>
        </div>
      </div>
    </div>

    <!-- ================= Pending Sync Offcanvas ================= -->
    <div class="offcanvas offcanvas-end pos-orders-offcanvas" tabindex="-1" id="posOrdersOffcanvas" ref="ordersOffcanvasEl">
      <div class="offcanvas-header">
        <h5 class="offcanvas-title">
          <template v-if="orderDetail">
            <button type="button" class="btn btn-sm btn-link p-0 me-2" @click="orderDetail = null">
              <i class="fa fa-arrow-left"></i>
            </button>
            Order Detail
          </template>
          <template v-else>Pending Sync</template>
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body">
        <!-- ===== List view ===== -->
        <template v-if="!orderDetail">
          <div class="d-flex align-items-center justify-content-end mb-2 gap-2">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="!syncState?.online || !orderList.length || ordersSyncing"
              @click="syncAllOrders"
            >
              <i class="fa fa-cloud-arrow-up"></i> Sync All
            </button>
          </div>
          <p v-if="!syncState?.online" class="small text-danger mb-2">
            <i class="fa fa-triangle-exclamation"></i> Offline - sync is unavailable until the connection returns.
          </p>

          <div class="list-group">
            <div v-if="!orderList.length" class="text-muted text-center py-3">Nothing waiting to sync.</div>
            <OrderListRow
              v-for="row in orderList"
              :key="row.local_id"
              :order="row"
              :syncing="ordersSyncing"
              :online="!!syncState?.online"
              @open="openOrderDetail(row.local_id)"
              @sync="syncOneOrder(row.local_id)"
            />
          </div>
        </template>

        <!-- ===== Detail view ===== -->
        <OrderDetailPanel
          v-else
          :order="orderDetail"
          :payment-method-name="paymentMethodName"
          :syncing="ordersSyncing"
          :online="!!syncState?.online"
          @sync="syncOneOrder(orderDetail.local_id, true)"
        />
      </div>
    </div>

    <!-- ================= Thermal print area (print-only, see @media print) ================= -->
    <div
      v-if="reportSummary"
      class="thermal-print-area thermal-receipt"
      :style="{ maxWidth: (settings.thermal_print_setting?.paper_width_mm || 80) + 'mm' }"
    >
      <div class="tr-center">
        <p v-if="bootstrap.shop_name" class="tr-name">{{ bootstrap.shop_name }}</p>
        <p class="tr-meta-line">Register Session Summary</p>
      </div>
      <hr class="tr-divider" />

      <div class="tr-meta">
        <div v-if="selectedReportSession" class="tr-row">
          <span class="tr-label">Register:</span>
          <span class="tr-value">{{ selectedReportSession.register_name }}</span>
        </div>
        <div v-if="selectedReportSession" class="tr-row">
          <span class="tr-label">Opened:</span>
          <span class="tr-value">{{ selectedReportSession.opening_datetime }}</span>
        </div>
        <div v-if="selectedReportSession?.closing_datetime" class="tr-row">
          <span class="tr-label">Closed:</span>
          <span class="tr-value">{{ selectedReportSession.closing_datetime }}</span>
        </div>
        <div class="tr-row">
          <span class="tr-label">Printed On:</span>
          <span class="tr-value">{{ new Date().toLocaleString() }}</span>
        </div>
      </div>
      <hr class="tr-divider" />

      <div class="tr-totals">
        <div class="tr-row tr-grand-total">
          <span class="tr-label">Total ({{ reportSummary.total_orders }})</span>
          <span class="tr-value">{{ money(reportSummary.total_sales_amount) }}</span>
        </div>
      </div>

      <hr class="tr-divider" />
      <p class="tr-meta-line" style="font-weight:700;">Payments</p>
      <div class="tr-totals">
        <div v-for="row in reportSummary.payment_method_totals" :key="row.payment_method_id" class="tr-row">
          <span class="tr-label">{{ paymentMethodName(row.payment_method_id) }} ({{ row.order_count }})</span>
          <span class="tr-value">{{ money(row.total) }}</span>
        </div>
      </div>

      <hr class="tr-divider" />
      <div class="tr-totals">
        <div class="tr-row">
          <span class="tr-label">Discount</span>
          <span class="tr-value">{{ money(reportSummary.total_discount) }}</span>
        </div>
        <div class="tr-row">
          <span class="tr-label">Tax</span>
          <span class="tr-value">{{ money(reportSummary.total_tax) }}</span>
        </div>
      </div>

      <hr class="tr-divider" />
      <div class="tr-totals">
        <div class="tr-row">
          <span class="tr-label">Opening Amount</span>
          <span class="tr-value">{{ money(reportSummary.opening_cash) }}</span>
        </div>
        <div class="tr-row">
          <span class="tr-label">Cash In</span>
          <span class="tr-value">{{ money(reportSummary.cash_movements_in) }}</span>
        </div>
        <div class="tr-row">
          <span class="tr-label">Cash Out</span>
          <span class="tr-value">{{ money(reportSummary.cash_movements_out) }}</span>
        </div>
        <div class="tr-row">
          <span class="tr-label">Expenses</span>
          <span class="tr-value">{{ money(reportSummary.total_expenses) }}</span>
        </div>
        <div class="tr-row tr-grand-total">
          <span class="tr-label">Cash Amount</span>
          <span class="tr-value">{{ money(reportSummary.expected_cash) }}</span>
        </div>
        <div class="tr-row">
          <span class="tr-label">Actual</span>
          <span class="tr-value">{{ reportSummary.actual_cash != null ? money(reportSummary.actual_cash) : '-' }}</span>
        </div>
      </div>

      <hr class="tr-divider" />
      <div class="tr-footer">
        <p class="tr-powered-by">Powered by Dukanaz</p>
      </div>
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
import { computed, inject, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Modal, Offcanvas } from 'bootstrap';
import { invoke } from '@/services/ipc';
import PosHeader from '@/components/pos/PosHeader.vue';
import OrderListRow from '@/components/pos/OrderListRow.vue';
import OrderDetailPanel from '@/components/pos/OrderDetailPanel.vue';
import { describeSyncResult } from '@/components/pos/orderSync';

const router = useRouter();
const syncState = inject('syncState', null);

const bootstrap = reactive({
  categories: [],
  order_types: [],
  payment_methods: [],
  sale_types: [],
  discounts: [],
  complimentary_reasons: [],
  expense_categories: [],
  branches: [],
  warehouses: [],
  banks: [],
  registers: [],
  customers: [],
  current_user: null,
  shop_name: '',
  branch_name: '',
  warehouse_name: '',
});
const settings = reactive({ pos_setting: {}, business_setting: {}, tax_rates_setting: {} });

const session = ref(null);
const searchTerm = ref('');
const searchResults = ref([]);
const categoryId = ref('');
const productResults = ref([]);
const cart = ref([]);
let lineSeq = 0;

const orderTypeId = ref('');
const saleTypeId = ref('');
const customerId = ref('');
const deliveryAddress = ref('');
const deliveryCharge = ref(0);
const lastDeliveryFee = ref(0);
const checkoutOpen = ref(false);
const currentOrderLocalId = ref(null);

const paymentMode = ref('single');
const selectedPaymentMethodId = ref('');
const paymentRows = ref([]);
const singlePaymentBankId = ref('');

function methodType(id) {
  return bootstrap.payment_methods.find((m) => m.payment_method_id === id)?.type;
}
// Card/Bank payments must be tied to a specific Bank - mirrors the same
// PaymentMethod.type check the server enforces in OrderService::saveLinePayments().
function requiresBank(type) {
  return type === 'card' || type === 'bank';
}
const singleMethodRequiresBank = computed(() => paymentMode.value === 'single' && requiresBank(methodType(selectedPaymentMethodId.value)));
const paidAmountInput = ref(0);

const discountId = ref('');
const voucherCode = ref('');
const appliedVoucher = ref(null);
const complimentaryReasonId = ref('');
const complimentaryNotes = ref('');
const complimentaryModalScope = ref('line');
const complimentaryTargetLine = ref(null);
const complimentaryForm = reactive({ reasonId: '', notes: '' });
const complimentaryReasonModalEl = ref(null);
const voucherFeedback = ref('');

const heldOrders = ref([]);
const picker = reactive({ product: null, variations: [] });

const toastMessage = ref('');
function toast(msg) {
  toastMessage.value = msg;
  setTimeout(() => { if (toastMessage.value === msg) toastMessage.value = ''; }, 3500);
}

// -------- modal / offcanvas refs --------
const productPickerModalEl = ref(null);
const changeBranchModalEl = ref(null);
const addCustomerModalEl = ref(null);
const creditPaymentModalEl = ref(null);
const openSessionModalEl = ref(null);
const closeSessionModalEl = ref(null);
const cashMovementModalEl = ref(null);
const addExpenseModalEl = ref(null);
const heldOrdersOffcanvasEl = ref(null);
const reportsOffcanvasEl = ref(null);
const ordersOffcanvasEl = ref(null);

function modalOf(el) { return Modal.getOrCreateInstance(el); }
function offcanvasOf(el) { return Offcanvas.getOrCreateInstance(el); }

function money(v) {
  const n = Number(v || 0);
  return Number.isNaN(n) ? '0.00' : n.toFixed(2);
}

// ==============================
// BOOTSTRAP / SESSION
// ==============================
async function loadBootstrap() {
  const data = await invoke('pos:get-bootstrap');
  Object.assign(bootstrap, data);
  Object.assign(settings, data.settings || {});
  orderTypeId.value = bootstrap.order_types.find((t) => t.is_default)?.order_type_id || bootstrap.order_types[0]?.order_type_id || '';
  saleTypeId.value = bootstrap.sale_types.find((t) => t.is_default)?.sale_type_id || bootstrap.sale_types[0]?.sale_type_id || '';
  customerId.value = bootstrap.customers.find((c) => c.is_walkin)?.user_id || bootstrap.customers[0]?.user_id || '';
  openForm.registerId = bootstrap.registers[0]?.pos_register_id || '';
}

async function refreshSession() {
  session.value = await invoke('session:get-current');
  if (session.value) {
    await loadCategory('');
    await refreshHeldCount();
  }
}

async function refreshHeldCount() {
  heldOrders.value = await invoke('order:held-list', { sessionLocalId: session.value?.local_id });
}

const registerName = computed(() => {
  const reg = bootstrap.registers.find((r) => r.pos_register_id === session.value?.pos_register_id);
  return reg?.name || 'Register';
});

// ==============================
// PRODUCTS
// ==============================
async function runSearch() {
  if (!searchTerm.value.trim()) { searchResults.value = []; return; }
  searchResults.value = await invoke('pos:search-products', { term: searchTerm.value.trim() });
}

async function loadCategory(id) {
  categoryId.value = id;
  searchTerm.value = '';
  searchResults.value = [];
  productResults.value = await invoke('pos:get-products-by-category', { categoryId: id });
}

function productImage(product) {
  return product?.image_url || product?.images?.[0]?.image_url || product?.product_images?.[0]?.image_url || null;
}

function firstVariationPrice(product) {
  const v = product.variations?.[0];
  return v ? (v.resolved_price ?? v.sale_price) : 0;
}

function isOutOfStock(v) {
  return v?.is_track_stock && Number(v.available_stock || 0) <= 0;
}

function isSingleVariationOutOfStock(product) {
  return (product.variations || []).length === 1 && isOutOfStock(product.variations[0]);
}

function stockHintHtml(v) {
  if (v?.available_stock === null || v?.available_stock === undefined) return '';
  return v.available_stock > 0
    ? `<span class="pos-stock-hint">${v.available_stock} in stock</span>`
    : '<span class="pos-stock-hint pos-stock-hint-out">Out of stock</span>';
}

function handleGridProductClick(product) {
  const variations = product.variations || [];
  if (!variations.length) { toast('This product has no sellable variation.'); return; }
  if (variations.length === 1) {
    addLineToCart(variations[0], product, productImage(product));
    return;
  }
  picker.product = product;
  picker.variations = variations;
  nextTick(() => modalOf(productPickerModalEl.value).show());
}

function pickVariation(v) {
  addLineToCart(v, picker.product, productImage(picker.product));
  modalOf(productPickerModalEl.value).hide();
}

function pickFromSearch(item) {
  addLineToCart(item, { name: item.product_name }, null);
  searchTerm.value = '';
  searchResults.value = [];
}

// Client-side convenience mirror of the server's authoritative enforcement
// (OrderService::saveLinesAndComputeTotals()/post(), re-checked again at
// sync time) - matches allowsOutOfStockSale()/stockBlockMessage() in the web
// POS's pos-screen.js. Skipped entirely when negative-stock selling is on.
const allowsOutOfStockSale = computed(() => !!settings.inventory_setting?.negative_stock);

function maxAllowedQty(line) {
  if (!line.is_track_stock || allowsOutOfStockSale.value) return Infinity;
  return Number(line.available_stock || 0);
}

function addLineToCart(variation, product, image) {
  const name = product?.name || variation.product_name || '';
  if (variation.is_track_stock && !allowsOutOfStockSale.value) {
    const available = Number(variation.available_stock || 0);
    if (available <= 0) {
      toast(`"${name}" is out of stock.`);
      return;
    }
    const existingQty = cart.value
      .filter((l) => l.product_variation_id === variation.product_variation_id)
      .reduce((s, l) => s + Number(l.quantity || 0), 0);
    if (existingQty + 1 > available) {
      toast(`Only ${available} of "${name}" available in stock.`);
      return;
    }
  }

  lineSeq += 1;
  cart.value.push({
    line_key: `line_${lineSeq}`,
    product_variation_id: variation.product_variation_id,
    product_name: name,
    variation_name: variation.name || '',
    unit_id: variation.unit_id || variation.base_unit_id || null,
    quantity: 1,
    unit_price: Number(variation.resolved_price ?? variation.sale_price ?? 0),
    discount: 0,
    sale_type_id: null,
    is_track_stock: !!variation.is_track_stock,
    available_stock: variation.available_stock,
    image,
    is_complimentary: false,
    complimentary_reason_id: null,
    complimentary_notes: '',
  });
}

function stepQty(line, delta) {
  const next = Math.max(0.01, Number((line.quantity + delta).toFixed(2)));
  const max = maxAllowedQty(line);
  if (delta > 0 && next > max) {
    toast(`Only ${max} of "${line.product_name}" available in stock.`);
    return;
  }
  line.quantity = next;
}

function clampQty(line) {
  if (!line.quantity || line.quantity <= 0) line.quantity = 1;
  const max = maxAllowedQty(line);
  if (line.quantity > max) {
    line.quantity = max > 0 ? max : 1;
    toast(`Only ${max} of "${line.product_name}" available in stock.`);
  }
}

function removeLine(key) {
  cart.value = cart.value.filter((l) => l.line_key !== key);
}

function clearCart() {
  cart.value = [];
  currentOrderLocalId.value = null;
  complimentaryReasonId.value = '';
  complimentaryNotes.value = '';
  paymentRows.value = [];
  singlePaymentBankId.value = '';
  paidAmountInput.value = 0;
  discountId.value = '';
  voucherCode.value = '';
  appliedVoucher.value = null;
  voucherFeedback.value = '';
  deliveryAddress.value = '';
  deliveryCharge.value = 0;
  lastDeliveryFee.value = 0;
}

// ==============================
// TOTALS
// ==============================
const showLineDiscount = computed(() => settings.pos_setting?.enable_discount && ['line', 'both'].includes(settings.pos_setting?.discount_level));

// Falls back to the old business-wide business_setting rates if this device
// hasn't re-synced since tax_rates_setting was introduced (bootstrap always
// sends both - see OfflineSyncService::exportSettings()).
const effectiveTaxPercent = computed(() => {
  const rates = (settings.tax_rates_setting && (settings.tax_rates_setting.overall_tax_rate !== undefined))
    ? settings.tax_rates_setting
    : (settings.business_setting || {});
  const overall = Number(rates.overall_tax_rate || 0);
  const card = Number(rates.card_tax_rate || 0);
  const payments = paymentMode.value === 'multi' ? paymentRows.value : (selectedPaymentMethodId.value ? [{ payment_method_id: selectedPaymentMethodId.value }] : []);
  if (!payments.length) return overall;
  const allCard = payments.every((p) => bootstrap.payment_methods.find((m) => m.payment_method_id === p.payment_method_id)?.type === 'card');
  return allCard ? card : overall;
});

// Mirrors TaxCalculator on the server - exclusive (default, also used when
// this device hasn't synced tax_type yet) adds tax on top; inclusive backs
// it out of a price that already contains it.
const effectiveTaxType = computed(() => settings.tax_rates_setting?.tax_type || 'exclusive');

const effectiveTaxDiscountPercent = computed(() => {
  if (effectiveTaxType.value !== 'inclusive') return 0;
  const rates = (settings.tax_rates_setting && (settings.tax_rates_setting.overall_tax_rate !== undefined))
    ? settings.tax_rates_setting
    : (settings.business_setting || {});
  const overall = Number(rates.overall_tax_rate || 0);
  const card = Number(rates.card_tax_rate || 0);
  return Math.max(0, Math.max(overall, card) - effectiveTaxPercent.value);
});

function formatTaxPercent(percent) {
  const n = Number(percent || 0);
  if (!Number.isFinite(n)) return '0';
  return String(parseFloat(n.toFixed(4)));
}

const taxLineLabel = computed(() => {
  const mode = effectiveTaxType.value === 'inclusive' ? 'Inclusive' : 'Exclusive';
  return `Tax (${formatTaxPercent(effectiveTaxPercent.value)}%) (${mode})`;
});

const taxDiscountLineLabel = computed(() => `Tax Discount (${formatTaxPercent(effectiveTaxDiscountPercent.value)}%)`);

const isDeliveryOrderType = computed(() => {
  const t = bootstrap.order_types.find((o) => o.order_type_id === orderTypeId.value);
  return (t?.code || '').toLowerCase() === 'delivery';
});

const freeDeliveryThreshold = computed(() => {
  const branch = (bootstrap.branches || []).find((b) => b.branch_id === bootstrap.branch_id);
  const value = Number(branch?.free_delivery_min_order_amount);
  return !Number.isNaN(value) && value > 0 ? value : null;
});

function taxBreakdown(taxable, percent) {
  const taxType = effectiveTaxType.value;
  const discPct = effectiveTaxDiscountPercent.value;
  if (taxType !== 'inclusive') {
    return { taxAmt: percent > 0 ? taxable * percent / 100 : 0, taxDiscAmt: 0 };
  }
  if (discPct <= 0) {
    return {
      taxAmt: percent > 0 ? (taxable - taxable / (1 + percent / 100)) : 0,
      taxDiscAmt: 0,
    };
  }
  const combined = percent + discPct;
  if (combined <= 0) return { taxAmt: 0, taxDiscAmt: 0 };
  const base = taxable / (1 + combined / 100);
  const taxAmt = base * percent / 100;
  return { taxAmt, taxDiscAmt: Math.max(0, taxable - base - taxAmt) };
}

function lineTotal(line) {
  if (line?.is_complimentary) {
    return { base: 0, discAmt: 0, taxAmt: 0, taxDiscAmt: 0, total: 0 };
  }
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unit_price) || 0;
  const base = qty * price;
  const discAmt = base * (Number(line.discount) || 0) / 100;
  const taxable = base - discAmt;
  const percent = effectiveTaxPercent.value;
  const split = taxBreakdown(taxable, percent);
  const total = effectiveTaxType.value === 'inclusive' ? taxable : taxable + split.taxAmt;
  return { base, discAmt, taxAmt: split.taxAmt, taxDiscAmt: split.taxDiscAmt, total };
}

const isFreeDeliveryEligible = computed(() => {
  if (!isDeliveryOrderType.value || freeDeliveryThreshold.value === null) return false;
  let subtotal = 0, lineDiscount = 0, tax = 0;
  for (const line of cart.value) {
    const t = lineTotal(line);
    subtotal += t.base;
    lineDiscount += t.discAmt;
    tax += t.taxAmt;
  }
  const merchandise = effectiveTaxType.value === 'inclusive'
    ? (subtotal - lineDiscount)
    : (subtotal - lineDiscount + tax);
  return merchandise >= freeDeliveryThreshold.value;
});

watch(isFreeDeliveryEligible, (isFree) => {
  if (isFree) {
    if (deliveryCharge.value > 0) lastDeliveryFee.value = deliveryCharge.value;
    deliveryCharge.value = 0;
  } else if (isDeliveryOrderType.value && (Number(deliveryCharge.value) || 0) <= 0 && lastDeliveryFee.value > 0) {
    deliveryCharge.value = lastDeliveryFee.value;
  }
});

watch(deliveryCharge, (value) => {
  if (!isFreeDeliveryEligible.value && Number(value) > 0) {
    lastDeliveryFee.value = Number(value);
  }
});

const selectedDiscount = computed(() => bootstrap.discounts.find((d) => d.discount_id === discountId.value) || null);

const totals = computed(() => {
  let subtotal = 0, itemDiscount = 0, tax = 0, taxDiscount = 0;
  for (const line of cart.value) {
    const t = lineTotal(line);
    subtotal += t.base;
    itemDiscount += t.discAmt;
    tax += t.taxAmt;
    taxDiscount += t.taxDiscAmt;
  }

  const netAfterLineDiscount = subtotal - itemDiscount;
  let orderDiscount = 0;
  if (selectedDiscount.value) {
    orderDiscount = selectedDiscount.value.type === 'percent'
      ? netAfterLineDiscount * Number(selectedDiscount.value.value || 0) / 100
      : Number(selectedDiscount.value.value || 0);
  } else if (appliedVoucher.value) {
    orderDiscount = appliedVoucher.value.type === 'percent'
      ? netAfterLineDiscount * Number(appliedVoucher.value.value || 0) / 100
      : Number(appliedVoucher.value.value || 0);
  }
  orderDiscount = Math.min(orderDiscount, netAfterLineDiscount);

  const isFullComplimentary = cart.value.length > 0 && cart.value.every((l) => l.is_complimentary);
  const deliveryChargeAmount = isDeliveryOrderType.value && !isFullComplimentary && !isFreeDeliveryEligible.value
    ? Math.max(0, Number(deliveryCharge.value) || 0)
    : 0;

  // Inclusive tax is already inside subtotal, so it isn't added again here.
  const total = effectiveTaxType.value === 'inclusive'
    ? (subtotal - itemDiscount - orderDiscount + deliveryChargeAmount)
    : (subtotal - itemDiscount - orderDiscount + tax + deliveryChargeAmount);
  return {
    subtotal,
    itemDiscount,
    orderDiscount,
    tax,
    taxDiscount,
    taxPercent: effectiveTaxPercent.value,
    taxDiscountPercent: effectiveTaxDiscountPercent.value,
    taxType: effectiveTaxType.value,
    deliveryCharge: deliveryChargeAmount,
    total,
  };
});

const paymentEntered = computed(() => paymentRows.value.reduce((s, r) => s + (Number(r.amount) || 0), 0));

const paidAmount = computed(() => (paymentMode.value === 'multi' ? paymentEntered.value : (Number(paidAmountInput.value) || 0)));

const dueChangeAmount = computed(() => totals.value.total - paidAmount.value);
const dueChangeLabel = computed(() => (dueChangeAmount.value > 0 ? 'Due' : 'Change'));

watch(() => totals.value.total, (t) => {
  if (paymentMode.value === 'single') paidAmountInput.value = Number(t.toFixed(2));
});

// ==============================
// CHECKOUT PANEL
// ==============================
watch(isDeliveryOrderType, (isDelivery) => {
  if (isDelivery) checkoutOpen.value = true;
});

const checkoutSummaryLabel = computed(() => {
  if (paymentMode.value === 'multi') return 'Multi Pay';
  const m = bootstrap.payment_methods.find((x) => x.payment_method_id === selectedPaymentMethodId.value);
  return m?.name || 'Cash';
});

function selectPaymentMethod(id) {
  paymentMode.value = 'single';
  selectedPaymentMethodId.value = id;
  singlePaymentBankId.value = '';
}

function addPaymentRow() {
  paymentRows.value.push({ payment_method_id: bootstrap.payment_methods[0]?.payment_method_id || '', amount: 0, bank_id: '' });
}

async function applyVoucher() {
  if (!voucherCode.value.trim()) { voucherFeedback.value = ''; appliedVoucher.value = null; return; }
  const voucher = await invoke('voucher:lookup', { code: voucherCode.value.trim() });
  if (!voucher) {
    appliedVoucher.value = null;
    voucherFeedback.value = 'Voucher not found.';
    return;
  }
  discountId.value = '';
  appliedVoucher.value = voucher;
  voucherFeedback.value = `Applied: ${voucher.name || voucher.code}`;
}

// ==============================
// CUSTOMER
// ==============================
const selectedCustomer = computed(() => bootstrap.customers.find((c) => c.user_id === customerId.value) || null);

function customerLabel(c) {
  let label = (c.code ? `${c.code} - ` : '') + (c.name || '');
  if (c.is_walkin) label += ' (Walk-in)';
  return label;
}

const creditLimitHint = computed(() => {
  const limit = Number(selectedCustomer.value?.credit_limit || 0);
  return limit > 0 ? `Credit limit: ${money(limit)}` : '';
});

const creditCustomerSummary = computed(() => {
  const method = bootstrap.payment_methods.find((m) => m.payment_method_id === selectedPaymentMethodId.value);
  if (paymentMode.value !== 'single' || method?.type !== 'credit' || !selectedCustomer.value || selectedCustomer.value.is_walkin) return '';
  return `${customerLabel(selectedCustomer.value)} — Credit limit ${money(selectedCustomer.value.credit_limit)}`;
});

const newCustomer = reactive({ name: '', email: '', phone: '' });
const customerError = ref('');
async function submitAddCustomer() {
  customerError.value = '';
  if (!newCustomer.name.trim() || !newCustomer.email.trim()) {
    customerError.value = 'Name and Email are required.';
    return;
  }
  try {
    const customer = await invoke('customer:add', { name: newCustomer.name.trim(), email: newCustomer.email.trim(), phone: newCustomer.phone.trim() });
    bootstrap.customers.push(customer);
    customerId.value = customer.user_id;
    newCustomer.name = '';
    newCustomer.email = '';
    newCustomer.phone = '';
    modalOf(addCustomerModalEl.value).hide();
    toast('Customer added.');
  } catch (e) {
    customerError.value = e.message;
  }
}

const canCreateComplimentary = computed(() => !!bootstrap.current_user?.permissions?.['order.complimentary.create']);
const canApproveComplimentary = computed(() => !!bootstrap.current_user?.permissions?.['order.complimentary.approve']);
const complimentaryStatus = computed(() => {
  if (!cart.value.length) return 'none';
  const count = cart.value.filter((l) => l.is_complimentary).length;
  if (count <= 0) return 'none';
  return count >= cart.value.length ? 'full' : 'partial';
});
const complimentaryHeaderTitle = computed(() => {
  if (complimentaryStatus.value === 'full') return 'Full Complimentary';
  if (complimentaryStatus.value === 'partial') return 'Partial Complimentary';
  return 'Mark order complimentary';
});

function openComplimentaryModal(scope, line = null) {
  if (!canCreateComplimentary.value) {
    toast('You do not have permission to create complimentary orders.');
    return;
  }
  if (scope === 'order' && !canApproveComplimentary.value) {
    toast('You do not have permission to mark the entire order complimentary.');
    return;
  }
  if (!(bootstrap.complimentary_reasons || []).length) {
    toast('No complimentary reasons are configured.');
    return;
  }
  complimentaryModalScope.value = scope;
  complimentaryTargetLine.value = line;
  complimentaryForm.reasonId = complimentaryReasonId.value || '';
  complimentaryForm.notes = complimentaryNotes.value || '';
  modalOf(complimentaryReasonModalEl.value).show();
}

function toggleOrderComplimentary() {
  if (complimentaryStatus.value === 'full') {
    cart.value.forEach((line) => {
      line.is_complimentary = false;
      line.complimentary_reason_id = null;
      line.complimentary_notes = '';
    });
    complimentaryReasonId.value = '';
    complimentaryNotes.value = '';
    return;
  }
  openComplimentaryModal('order');
}

function toggleLineComplimentary(line) {
  if (line.is_complimentary) {
    line.is_complimentary = false;
    line.complimentary_reason_id = null;
    line.complimentary_notes = '';
    return;
  }
  openComplimentaryModal('line', line);
}

function submitComplimentaryReason() {
  if (!complimentaryForm.reasonId) {
    toast('A complimentary reason is required.');
    return;
  }
  if (complimentaryModalScope.value === 'order') {
    if (!window.confirm('Mark the entire order as complimentary? Customer payable will become zero.')) {
      return;
    }
    complimentaryReasonId.value = complimentaryForm.reasonId;
    complimentaryNotes.value = complimentaryForm.notes;
    cart.value.forEach((line) => {
      line.is_complimentary = true;
      line.complimentary_reason_id = complimentaryForm.reasonId;
      line.complimentary_notes = complimentaryForm.notes;
    });
  } else if (complimentaryTargetLine.value) {
    complimentaryTargetLine.value.is_complimentary = true;
    complimentaryTargetLine.value.complimentary_reason_id = complimentaryForm.reasonId;
    complimentaryTargetLine.value.complimentary_notes = complimentaryForm.notes;
    if (!complimentaryReasonId.value) {
      complimentaryReasonId.value = complimentaryForm.reasonId;
      complimentaryNotes.value = complimentaryForm.notes;
    }
  }
  modalOf(complimentaryReasonModalEl.value).hide();
}

// ==============================
// HOLD / RESUME
// ==============================
function buildCartPayload() {
  return {
    local_id: currentOrderLocalId.value || undefined,
    register_session_local_id: session.value.local_id,
    order_type_id: orderTypeId.value,
    sale_type_id: saleTypeId.value,
    customer_id: customerId.value,
    delivery_address: isDeliveryOrderType.value ? deliveryAddress.value : '',
    delivery_charge: isDeliveryOrderType.value ? (Number(deliveryCharge.value) || 0) : 0,
    discount_id: discountId.value || null,
    voucher_id: appliedVoucher.value?.voucher_id || null,
    products: cart.value.map((l) => ({
      product_variation_id: l.product_variation_id,
      product_name: l.product_name,
      variation_name: l.variation_name,
      unit_id: l.unit_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount: l.discount || 0,
      line_total: lineTotal(l).total,
      base_quantity: l.quantity,
      is_complimentary: l.is_complimentary ? 1 : 0,
      complimentary_reason_id: l.complimentary_reason_id || complimentaryReasonId.value || null,
      complimentary_notes: l.complimentary_notes || complimentaryNotes.value || null,
    })),
    complimentary_status: complimentaryStatus.value,
    complimentary_reason_id: complimentaryReasonId.value || null,
    complimentary_notes: complimentaryNotes.value || null,
    subtotal: totals.value.subtotal,
    discount_amount: totals.value.itemDiscount + totals.value.orderDiscount,
    tax: totals.value.taxPercent,
    tax_amount: totals.value.tax,
    tax_type: totals.value.taxType,
    tax_discount: totals.value.taxDiscountPercent,
    tax_discount_amount: totals.value.taxDiscount,
    total: totals.value.total,
  };
}

async function holdOrder() {
  if (!session.value) { toast('Open a register session before placing an order.'); return; }
  if (!cart.value.length) return;
  if (isDeliveryOrderType.value && !deliveryAddress.value.trim()) { toast('Delivery address is required for delivery orders.'); return; }

  const res = await invoke('order:hold', buildCartPayload());
  currentOrderLocalId.value = res.local_id;
  await refreshHeldCount();
  toast('Order held. Keep editing to update it, or use Clear Cart to start a new sale.');
}

async function openHeldOrders() {
  await refreshHeldCount();
  offcanvasOf(heldOrdersOffcanvasEl.value).show();
}

async function resumeHeldOrder(localId) {
  const data = await invoke('order:resume', { localId });
  cart.value = data.items.map((i) => {
    lineSeq += 1;
    return {
      line_key: `line_${lineSeq}`,
      product_variation_id: i.product_variation_id,
      product_name: i.product_name,
      variation_name: i.variation_name,
      unit_id: i.unit_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      discount: i.discount || 0,
      sale_type_id: null,
      is_track_stock: false,
      available_stock: null,
      image: null,
      is_complimentary: !!(i.payload?.is_complimentary || i.is_complimentary),
      complimentary_reason_id: i.payload?.complimentary_reason_id || i.complimentary_reason_id || null,
      complimentary_notes: i.payload?.complimentary_notes || '',
    };
  });
  currentOrderLocalId.value = data.local_id;
  const p = data.payload || {};
  if (p.order_type_id) orderTypeId.value = p.order_type_id;
  if (p.sale_type_id) saleTypeId.value = p.sale_type_id;
  if (p.customer_id) customerId.value = p.customer_id;
  complimentaryReasonId.value = p.complimentary_reason_id || '';
  complimentaryNotes.value = p.complimentary_notes || '';
  deliveryAddress.value = p.delivery_address || '';
  deliveryCharge.value = Number(p.delivery_charge || 0);
  if (deliveryCharge.value > 0) lastDeliveryFee.value = deliveryCharge.value;
  offcanvasOf(heldOrdersOffcanvasEl.value).hide();
  toast(`Resumed held order into cart.`);
}

// ==============================
// COMPLETE SALE
// ==============================
const creditForm = reactive({ dueDate: '', note: '' });

function payClicked() {
  if (!session.value) { toast('Open a register session before placing an order.'); return; }
  if (!cart.value.length) return;
  if (isDeliveryOrderType.value && !deliveryAddress.value.trim()) { toast('Delivery address is required for delivery orders.'); return; }

  if (totals.value.total <= 0.01) {
    proceedComplete();
    return;
  }

  if (paymentMode.value === 'single' && !selectedPaymentMethodId.value) {
    toast('Please select a payment method.');
    return;
  }
  if (paymentMode.value === 'multi' && !paymentRows.value.some((r) => r.payment_method_id && r.amount > 0)) {
    toast('Please add at least one payment method with an amount.');
    return;
  }
  if (singleMethodRequiresBank.value && !singlePaymentBankId.value) {
    toast('Please select a bank for this payment.');
    return;
  }
  if (paymentMode.value === 'multi') {
    const missingBank = paymentRows.value.find((r) => r.amount > 0 && requiresBank(methodType(r.payment_method_id)) && !r.bank_id);
    if (missingBank) {
      const name = bootstrap.payment_methods.find((m) => m.payment_method_id === missingBank.payment_method_id)?.name;
      toast(`Please select a bank for the "${name}" payment.`);
      return;
    }
  }

  const method = bootstrap.payment_methods.find((m) => m.payment_method_id === selectedPaymentMethodId.value);
  if (paymentMode.value === 'single' && method?.type === 'credit') {
    if (!selectedCustomer.value || selectedCustomer.value.is_walkin) {
      toast('Select a non-walk-in customer for a credit sale.');
      return;
    }
    creditForm.dueDate = '';
    creditForm.note = '';
    modalOf(creditPaymentModalEl.value).show();
    return;
  }

  proceedComplete();
}

function finalizeCreditAndComplete() {
  modalOf(creditPaymentModalEl.value).hide();
  proceedComplete();
}

async function proceedComplete() {
  const payload = buildCartPayload();
  const method = bootstrap.payment_methods.find((m) => m.payment_method_id === selectedPaymentMethodId.value);

  payload.payments = totals.value.total <= 0.01
    ? []
    : (paymentMode.value === 'multi'
      ? paymentRows.value.filter((r) => r.amount > 0).map((r) => ({ payment_method_id: r.payment_method_id, amount: r.amount, bank_id: r.bank_id || null, type: bootstrap.payment_methods.find((m) => m.payment_method_id === r.payment_method_id)?.type }))
      : [{ payment_method_id: selectedPaymentMethodId.value, amount: totals.value.total, bank_id: singlePaymentBankId.value || null, type: method?.type }]);

  payload.paid_amount = paidAmount.value;
  payload.change_amount = Math.max(0, paidAmount.value - totals.value.total);
  if (method?.type === 'credit') {
    payload.credit_due_date = creditForm.dueDate || null;
    payload.credit_note = creditForm.note || null;
  }

  await invoke('order:complete', payload);
  clearCart();
  await refreshHeldCount();
  await refreshPendingOrderCount();
  toast('Order saved locally and queued for sync.');
}

// ==============================
// CASH MOVEMENT / EXPENSE
// ==============================
const cashMovementForm = reactive({ type: 'in', amount: null, reason: '' });
function openCashMovement(type) {
  cashMovementForm.type = type;
  cashMovementForm.amount = null;
  cashMovementForm.reason = '';
  modalOf(cashMovementModalEl.value).show();
}
async function submitCashMovement() {
  if (!cashMovementForm.amount || cashMovementForm.amount <= 0) { toast('Please enter a valid amount.'); return; }
  await invoke('session:cash-movement', {
    sessionLocalId: session.value.local_id,
    type: cashMovementForm.type,
    amount: cashMovementForm.amount,
    reason: cashMovementForm.reason,
  });
  modalOf(cashMovementModalEl.value).hide();
  toast('Cash movement recorded.');
}

const expenseForm = reactive({ categoryId: '', amount: null, description: '' });
function openAddExpense() {
  expenseForm.categoryId = '';
  expenseForm.amount = null;
  expenseForm.description = '';
  modalOf(addExpenseModalEl.value).show();
}
async function submitAddExpense() {
  if (!expenseForm.categoryId) { toast('Please select an expense category.'); return; }
  if (!expenseForm.amount || expenseForm.amount <= 0) { toast('Please enter a valid amount.'); return; }
  await invoke('expense:add', {
    sessionLocalId: session.value.local_id,
    categoryId: expenseForm.categoryId || null,
    amount: expenseForm.amount,
    description: expenseForm.description,
  });
  modalOf(addExpenseModalEl.value).hide();
  toast('Expense recorded.');
}

// ==============================
// CHANGE BRANCH
// ==============================
// No warehouse to pick any more - a branch's combined stock comes from
// every warehouse linked to it (see stock_levels queries in
// electron/ipc/handlers.js), resolved server-side and synced locally.
const contextOptions = reactive({ branches: [], registers: [] });
const changeBranchForm = reactive({ branchId: '' });
async function openChangeBranch() {
  const opts = await invoke('context:get-options');
  Object.assign(contextOptions, opts);
  changeBranchForm.branchId = bootstrap.branch_id || '';
  modalOf(changeBranchModalEl.value).show();
}
async function submitChangeBranch() {
  if (!changeBranchForm.branchId) { toast('Please select a branch.'); return; }
  await invoke('context:switch', { branchId: changeBranchForm.branchId });
  await loadBootstrap();
  if (session.value) await loadCategory(categoryId.value);
  modalOf(changeBranchModalEl.value).hide();
  toast('Branch updated.');
}

// ==============================
// OPEN / CLOSE SESSION
// ==============================
const openForm = reactive({ registerId: '', openingCash: 0, notes: '' });
const openSessionError = ref('');
async function submitOpenSession() {
  openSessionError.value = '';
  if (!openForm.registerId) { openSessionError.value = 'Please select a register.'; return; }
  if (openForm.openingCash === '' || Number.isNaN(Number(openForm.openingCash))) {
    openSessionError.value = 'Please enter a valid opening cash amount.';
    return;
  }
  try {
    await invoke('session:open', {
      registerId: openForm.registerId,
      openingCash: openForm.openingCash,
      notes: openForm.notes,
      cashierId: bootstrap.current_user?.id || 'local',
    });
    modalOf(openSessionModalEl.value).hide();
    await refreshSession();
    toast('Register session opened.');
  } catch (e) {
    openSessionError.value = e.message;
  }
}

const closeSummary = reactive({ opening_cash: 0, total_sales_amount: 0, cash_movements_in: 0, cash_movements_out: 0, total_expenses: 0, expected_cash: 0 });
const closeForm = reactive({ actualCash: 0, notes: '' });
async function openCloseSession() {
  if (!session.value) return;
  Object.assign(closeSummary, await invoke('session:close-summary', { sessionLocalId: session.value.local_id }));
  closeForm.actualCash = closeSummary.expected_cash;
  closeForm.notes = '';
  modalOf(closeSessionModalEl.value).show();
}
async function submitCloseSession() {
  await invoke('session:close', { sessionLocalId: session.value.local_id, actualCash: closeForm.actualCash, notes: closeForm.notes });
  modalOf(closeSessionModalEl.value).hide();
  session.value = null;
  toast('Register session closed.');
}

// ==============================
// REPORTS
// ==============================
const reportSessions = ref([]);
const reportSummary = ref(null);
const selectedReportSession = ref(null);
async function openReports() {
  reportSessions.value = await invoke('session:list');
  reportSummary.value = null;
  selectedReportSession.value = null;
  offcanvasOf(reportsOffcanvasEl.value).show();
}
async function loadReportSummary(sessionLocalId) {
  selectedReportSession.value = reportSessions.value.find((r) => r.local_id === sessionLocalId) || null;
  reportSummary.value = await invoke('session:close-summary', { sessionLocalId });
}
function printSessionSummary() {
  nextTick(() => window.print());
}
function paymentMethodName(id) {
  return bootstrap.payment_methods.find((m) => m.payment_method_id === id)?.name || 'Payment';
}

// ==============================
// ORDERS - Pending Sync panel (see OrderHistoryView.vue for the full,
// all-orders screen; this one only ever lists unsynced orders)
// ==============================
const orderList = ref([]);
const orderDetail = ref(null);
const ordersSyncing = ref(false);
const pendingOrderCount = ref(0);

async function refreshPendingOrderCount() {
  const pending = await invoke('order:list', { onlyPending: true });
  pendingOrderCount.value = pending.length;
}

async function refreshOrderList() {
  orderList.value = await invoke('order:list', { onlyPending: true });
}

async function openOrdersPanel() {
  orderDetail.value = null;
  await refreshOrderList();
  offcanvasOf(ordersOffcanvasEl.value).show();
}

async function openOrderDetail(localId) {
  orderDetail.value = await invoke('order:detail', { localId });
}

async function syncOneOrder(localId, refreshDetail = false) {
  ordersSyncing.value = true;
  try {
    const res = await invoke('order:sync-one', { localId });
    await refreshOrderList();
    await refreshPendingOrderCount();
    if (refreshDetail) await openOrderDetail(localId);
    toast(describeSyncResult(res, { singular: true }));
  } catch (e) {
    toast(e.message);
  } finally {
    ordersSyncing.value = false;
  }
}

async function syncAllOrders() {
  ordersSyncing.value = true;
  try {
    const res = await invoke('order:sync-all');
    await refreshOrderList();
    await refreshPendingOrderCount();
    toast(describeSyncResult(res));
  } catch (e) {
    toast(e.message);
  } finally {
    ordersSyncing.value = false;
  }
}

// Keeps the header's Pending Sync badge current after the periodic/manual
// sync cycle runs (App.vue pushes fresh syncState on every 'sync:status'
// IPC event), not just when this panel happens to be open.
watch(() => syncState?.status, () => { refreshPendingOrderCount(); });

// ==============================
// AUTH
// ==============================
async function logout() {
  await invoke('auth:logout');
  router.push('/login');
}

onMounted(async () => {
  await loadBootstrap();
  await refreshSession();
  await refreshPendingOrderCount();
  if (!session.value) {
    nextTick(() => modalOf(openSessionModalEl.value).show());
  }
});
</script>
