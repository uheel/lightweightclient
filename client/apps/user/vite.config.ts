import { defineConfig } from "vite";
import { createViteConfig } from "@radar/core/vite";

// 用户端：1430（HMR 1431），与运维端可同时运行
export default defineConfig(createViteConfig(1430));
