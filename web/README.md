## 概述

新版前端，采用了 React 和 shadcn/ui 技术栈，旨在提供更现代化、响应式和美观的用户界面。


## 技术栈

*   React
*   TypeScript
*   shadcn/ui (基于 Radix UI 和 Tailwind CSS)
*   pnpm (包管理器)
*   axios (HTTP 请求)
*   react-router-dom (路由)
*   xterm.js (终端模拟)
*   react-dropzone (文件上传拖放)
*   sonner (通知)

## 项目结构

```
ansible-react-frontend/
├── public/             # 静态资源 (favicon等)
├── src/
│   ├── components/     # 可复用的UI组件 (包括 shadcn/ui 生成的组件)
│   │   ├── ui/         # shadcn/ui 基础组件
│   │   └── FileUpload.tsx # 文件上传组件
│   ├── contexts/       # React Context (例如 AuthContext)
│   ├── pages/          # 页面级组件 (LoginPage, MainPage, TerminalPage)
│   ├── services/       # API 服务封装 (api.ts)
│   ├── App.tsx         # 应用主组件，处理路由
│   ├── index.css       # 全局样式 (Tailwind CSS 基础样式)
│   └── main.tsx        # 应用入口点
├── index.html          # HTML 入口文件
├── package.json        # 项目依赖和脚本
├── pnpm-lock.yaml      # 依赖锁定文件
├── tsconfig.json       # TypeScript 配置
├── tsconfig.node.json  # TypeScript Node 配置
└── vite.config.ts      # Vite 配置文件
```


