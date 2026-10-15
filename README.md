# ⚡ CLDX AI — Autonomous Multi-Agent Workspace & Studio

An enterprise-grade, privacy-first AI platform featuring specialized agents for autonomous coding, intelligent document generation (PDF/PPT), visual generation, RAG, tool calling via Model Context Protocol (MCP), and air-gapped sovereign deployment.

---

## 🌟 Key Features

* **🤖 Specialized Agent Fleet:**
  * **Coding Agent:** Generates full-stack applications with preview sandboxes and intelligent semantic prompt caching.
  * **Document Generation Agent (PDF / PPT):** Multi-step planning, copywriting, and styling with downloadable exports.
  * **Vision & Multimodal:** Visual reasoning, image generation via ComfyUI pipelines, and document OCR.
  * **Research & Web Search:** Real-time web browsing and information retrieval.
  * **GitHub RAG:** Deep codebase exploration and code intelligence directly from GitHub repositories.
* **🔌 Model Context Protocol (MCP):** Connect external tools, databases, and OAuth services (Slack, GitHub, custom APIs).
* **🛡️ Sovereign / Air-Gapped Mode:** Zero-leakage local execution option with strictly contained LLM inference and local vector storage.
* **🔑 BYOK (Bring Your Own Key):** Secure user-level AES-encrypted key storage prioritizing personal LLM quotas over platform credits.
* **💳 Token & Cost Optimization:** Redis-backed semantic prompt caching and atomic credit management.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   React + Vite UI                      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              Node.js / Express API Gateway             │
│        (Auth, Billing, BYOK, Quotas & Rate Limits)     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  Agent Runtime Engine                  │
│   (LangGraph State Machine, Model Routing & Fallbacks) │
└──────────┬───────────────────┬───────────────────┬─────┘
           │                   │                   │
    ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
    │ Cloud LLMs  │     │  Local /    │     │   Redis &   │
    │ (Groq/OpenAI│     │  Sovereign  │     │   MongoDB   │
    │ /DeepSeek)  │     │  (Ollama)   │     │  (Storage)  │
    └─────────────┘     └─────────────┘     └─────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites
* Node.js v18+
* MongoDB & Redis instances running locally or via cloud
* (Optional) Ollama for local sovereign mode

### 2. Backend Setup
```bash
# Main API Server
cd backend/app
cp .env.example .env
npm install
npm run dev

# Agent Service
cd ../services/agent
cp .env.example .env
npm install
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

---

## 📄 License
MIT © [Gyan Ranjan Panda](https://github.com/gyanranjanpanda)
