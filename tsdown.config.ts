import { defineConfig } from 'tsdown';

const packageId = 'dsh-agent-toolkit';

// DSH 使用两套不同的加载器：宿主入口是普通的 Node ESM 模块，浏览器入口
// 则必须是通过 `window.__ModuleLoader__` 注册的延迟 CJS 工厂。这里拆成两个
// 独立配置，避免把普通的 browser/ESM bundle 当成 DSH 客户端模块。
export default defineConfig([
  {
    name: packageId,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: { sourcemap: true },
    sourcemap: true,
    clean: true,
    external: [
      /^@deepseek-ai\//,
      'react',
      'react-dom',
      /^react\//,
      /^react-dom\//,
    ],
  },
  {
    name: `${packageId}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    // react 与 ui-primitives 必须保持 external：__ModuleLoader__ 工厂的 require
    // 会把它们解析到宿主模块图里的同一份（react 打进来就是第二个实例，hooks
    // 直接失效；primitives 打进来的副本则丢掉宿主的主题与 i18n 上下文）。
    // dsh-client-runtime/client 同理（createSnapshotStore 要与宿主 store 引擎同实例）。
    external: [
      'react',
      'react-dom',
      /^react\//,
      /^react-dom\//,
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-runtime/client',
    ],
    // Base UI leaves development guards as `process.env.NODE_ENV` checks.
    // DSH's browser module runtime does not provide Node's `process` global,
    // so replace them at build time instead of shipping a process shim.
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    sourcemap: true,
    // 两个入口共用 lib 目录；这里不能清理，否则会删掉上面生成的 lib/index.js，
    // 使插件缺少宿主侧入口。
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
]);
