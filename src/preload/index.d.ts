import type { LuobiApi } from './index'

declare global {
  interface Window {
    luobi: LuobiApi
  }
}

export {}
