import { createRouter, createWebHashHistory } from 'vue-router';
import SetupView from '@/views/SetupView.vue';
import LoginView from '@/views/LoginView.vue';
import PosScreen from '@/views/PosScreen.vue';
import OrderHistoryView from '@/views/OrderHistoryView.vue';
import { invoke } from '@/services/ipc';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/setup', component: SetupView },
    { path: '/login', component: LoginView },
    { path: '/pos', component: PosScreen },
    { path: '/orders', component: OrderHistoryView },
  ],
});

router.beforeEach(async (to) => {
  if (!window.desktopPos?.invoke) {
    return to.path === '/setup' ? true : '/setup';
  }

  try {
    const state = await invoke('app:get-state');
    const config = state.config || {};

    if (!config.initialized_at) {
      if (to.path !== '/setup') return '/setup';
      return true;
    }

    if (to.path === '/setup') return '/login';

    return true;
  } catch {
    return to.path === '/setup' ? true : '/setup';
  }
});

export default router;
