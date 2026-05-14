(function attachBrowserApi(root) {
  const getNativeApi = () => root.browser || root.chrome || null;

  const getLastErrorMessage = (api) => api?.runtime?.lastError?.message || api?.runtime?.lastError || "";

  function callbackToPromise(call, api = getNativeApi()) {
    return new Promise((resolve, reject) => {
      try {
        const maybePromise = call((reply) => {
          const message = getLastErrorMessage(api);
          if (message) reject(new Error(String(message)));
          else resolve(reply);
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function sendRuntimeMessage(message) {
    const api = getNativeApi();
    if (!api?.runtime?.sendMessage) return Promise.reject(new Error("Extension runtime API unavailable."));
    return callbackToPromise((done) => api.runtime.sendMessage(message, done), api);
  }

  function sendTabMessage(tabId, message) {
    const api = getNativeApi();
    if (!api?.tabs?.sendMessage) return Promise.reject(new Error("Extension tabs API unavailable."));
    return callbackToPromise((done) => api.tabs.sendMessage(tabId, message, done), api);
  }

  function queryTabs(queryInfo) {
    const api = getNativeApi();
    if (!api?.tabs?.query) return Promise.reject(new Error("Extension tabs query API unavailable."));
    return callbackToPromise((done) => api.tabs.query(queryInfo, done), api);
  }

  function getManifest() {
    return getNativeApi()?.runtime?.getManifest?.() || null;
  }

  function getURL(path) {
    return getNativeApi()?.runtime?.getURL?.(path) || path;
  }

  function addRuntimeMessageListener(listener) {
    const api = getNativeApi();
    api?.runtime?.onMessage?.addListener?.(listener);
    return () => api?.runtime?.onMessage?.removeListener?.(listener);
  }

  function setStorageAccessLevel(accessLevel) {
    const api = getNativeApi();
    return api?.storage?.local?.setAccessLevel?.({ accessLevel }) || Promise.resolve();
  }

  root.LumeoBrowserApi = {
    get native() { return getNativeApi(); },
    callbackToPromise,
    sendRuntimeMessage,
    sendTabMessage,
    queryTabs,
    getManifest,
    getURL,
    addRuntimeMessageListener,
    setStorageAccessLevel,
  };
})(globalThis);
