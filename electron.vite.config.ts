import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

// 本机用户环境变量设置了 ELECTRON_RUN_AS_NODE=1，
// 会导致 electron.exe 以纯 Node 模式运行（内置模块不可用）。
// 必须在 electron-vite 启动 Electron 前清除。
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'shared')
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'shared')
      }
    }
  }
})
