export async function invoke(channel, payload) {
  if (!window.desktopPos?.invoke) {
    throw new Error('Desktop bridge unavailable. Please restart the application.');
  }
  // Electron's IPC uses the structured-clone algorithm, which a Vue
  // reactive object/Proxy (e.g. a row pulled straight out of a ref/reactive
  // array in a template binding) can fail against with the opaque "An
  // object could not be cloned" error - round-tripping through JSON here
  // strips any reactivity before it ever reaches ipcRenderer.invoke().
  const safePayload = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
  const res = await window.desktopPos.invoke(channel, safePayload);
  if (!res?.success) {
    throw new Error(res?.error || 'Request failed');
  }
  return res.data;
}
