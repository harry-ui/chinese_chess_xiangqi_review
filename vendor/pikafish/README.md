# Pikafish（皮卡鱼）WebAssembly 构建

这个目录里是第三方引擎的预编译文件，本项目没有修改它们。

| 文件 | 大小（字节） | SHA-256 |
| --- | --- | --- |
| `pikafish.js` | 76704 | `cd1e3e23f737f6dfa3ac798a4bf4c6bb364749ae4076d919bba3b65d42151484` |
| `pikafish.wasm` | 789696 | `c80f9d408c762d50835c6f042aac3bdf91454ebbd72d79fa03f718c1f562ad35` |
| `pikafish.data` | 12646031 | `316da3939d66edacc730a313a1bdddb0619ad1b8158b1dc5bd8244af335c552b` |

- 引擎自报版本：`Pikafish 2026-10-18-w256`（单线程 Asyncify 构建，使用蒸馏过的小网络）。
- 下载自 <https://github.com/west-shell/obsidian-xiangqi/releases/tag/pikafish-mobile-2.0.0>，校验和与该插件源码里登记的一致。
- WebAssembly 移植的源码：<https://github.com/west-shell/Pikafish-wasm>
- 上游引擎：<https://github.com/official-pikafish/Pikafish>

Pikafish 以 GNU GPL v3 发布，许可证全文见 [COPYING.txt](COPYING.txt)，作者名单见 [AUTHORS](AUTHORS)。
