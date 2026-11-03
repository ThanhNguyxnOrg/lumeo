(function attachBrowserApi(root) {
  const getNativeApi = () => root.browser || root.chrome || null;

  const getLastErrorMessage = (api) => api?.runtime?.lastError?.message || api?.runtime?.lastError || "";
  const isPromiseNamespace = (api) => !!(root.browser && api === root.browser);

  function callbackToPromise(call, api = getNativeApi()) {
    return new Promise((resolve, reject) => {
      try {
        if (isPromiseNamespace(api)) {
          const maybePromise = call();
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(resolve, reject);
          } else {
            reject(new Error("Promise-style browser API did not return a promise."));
          }
          return;
        }
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
    return callbackToPromise(
      (done) => done ? api.runtime.sendMessage(message, done) : api.runtime.sendMessage(message),
      api,
    );
  }

  function sendTabMessage(tabId, message) {
    const api = getNativeApi();
    if (!api?.tabs?.sendMessage) return Promise.reject(new Error("Extension tabs API unavailable."));
    return callbackToPromise(
      (done) => done ? api.tabs.sendMessage(tabId, message, done) : api.tabs.sendMessage(tabId, message),
      api,
    );
  }

  function queryTabs(queryInfo) {
    const api = getNativeApi();
    if (!api?.tabs?.query) return Promise.reject(new Error("Extension tabs query API unavailable."));
    return callbackToPromise(
      (done) => done ? api.tabs.query(queryInfo, done) : api.tabs.query(queryInfo),
      api,
    );
  }

  function storageGet(keys) {
    const api = getNativeApi();
    if (!api?.storage?.local?.get) return Promise.reject(new Error("Extension storage API unavailable."));
    return callbackToPromise(
      (done) => done ? api.storage.local.get(keys, done) : api.storage.local.get(keys),
      api,
    );
  }

  function storageSet(items) {
    const api = getNativeApi();
    if (!api?.storage?.local?.set) return Promise.reject(new Error("Extension storage API unavailable."));
    return callbackToPromise(
      (done) => done ? api.storage.local.set(items, done) : api.storage.local.set(items),
      api,
    );
  }

  function requestPermissions(permissions) {
    const api = getNativeApi();
    if (!api?.permissions?.request) return Promise.resolve(false);
    return callbackToPromise(
      (done) => done ? api.permissions.request(permissions, done) : api.permissions.request(permissions),
      api,
    );
  }

  function containsPermissions(permissions) {
    const api = getNativeApi();
    if (!api?.permissions?.contains) return Promise.resolve(false);
    return callbackToPromise(
      (done) => done ? api.permissions.contains(permissions, done) : api.permissions.contains(permissions),
      api,
    );
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
    storageGet,
    storageSet,
    requestPermissions,
    containsPermissions,
    getManifest,
    getURL,
    addRuntimeMessageListener,
    setStorageAccessLevel,
  };
})(globalThis);
