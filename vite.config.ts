/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages는 https://<user>.github.io/<repo>/ 처럼 하위 경로에 올라간다.
  // 상대 경로로 빌드해 두면 저장소 이름이 무엇이든, 루트 도메인에 올려도 그대로 동작한다.
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
