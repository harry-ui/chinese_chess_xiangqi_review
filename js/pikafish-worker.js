// 皮卡鱼（Pikafish）引擎线程。经典 Worker（非模块），因为引擎的胶水代码要用 importScripts 加载。
// 主线程把 wasm 和权重文件的字节直接传进来，这样多个线程不必各自重复下载。

let engine = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      const data = new Uint8Array(msg.data);
      importScripts(msg.script);
      /* global Pikafish */
      Pikafish({
        wasmBinary: new Uint8Array(msg.wasm),
        // 权重文件已在内存里，交给 emscripten 的文件打包器，避免再发一次请求
        getPreloadedPackage: (name, size) => {
          if (data.byteLength !== size) throw new Error(`权重文件大小不符：期望 ${size}，实际 ${data.byteLength}`);
          return data.buffer;
        },
        print: (text) => self.postMessage({ type: 'line', text: String(text) }),
        printErr: () => {},
        onAbort: (what) => self.postMessage({ type: 'error', text: 'abort: ' + what }),
      }).then((instance) => {
        engine = instance;
        self.postMessage({ type: 'ready' });
      }).catch((err) => self.postMessage({ type: 'error', text: String((err && err.message) || err) }));
    } catch (err) {
      self.postMessage({ type: 'error', text: String((err && err.message) || err) });
    }
  } else if (msg.type === 'cmd' && engine) {
    // 搜索命令用异步调用：引擎会在检查时间时让出线程，这样随时能收到 stop
    if (msg.text.startsWith('go')) engine.ccall('command', null, ['string'], [msg.text], { async: true });
    else engine.ccall('command', null, ['string'], [msg.text]);
  }
};
