# ⚡ CLDX AI — Autonomous Multi-Agent Workspace & Studio

> **An enterprise-grade, privacy-first AI platform that unites autonomous code generation, multi-step document synthesis (PDF/PPT), visual generation, RAG, tool calling via Model Context Protocol (MCP), and air-gapped sovereign execution.**

---

## 📖 Introduction: What is CLDX AI?

Most AI platforms today are simple single-model chatbots or shallow wrappers around API endpoints. When users need to build a full-stack web application, generate publication-ready reports, analyze GitHub repositories, or execute sensitive enterprise workloads without cloud data leakage, traditional chat UIs fall short.

**CLDX AI** is an end-to-end **Agentic AI Workspace & Operating System** built from the ground up to handle high-complexity tasks autonomously:

1. **Autonomous Creation, Not Just Text Generation:**
   Instead of just answering questions, CLDX deploys purpose-built agents. The **Coding Agent** drafts, validates, and renders runnable web applications with an interactive sandbox preview. The **DocGen Agents** autonomously plan outlines, write sections, and format publication-ready **PDFs and presentations (PPT)**.
   
2. **Extensible with External Tools (MCP):**
   Through the **Model Context Protocol (MCP)**, CLDX connects directly to live external tools, APIs, and enterprise services (such as Slack, GitHub, internal databases, and local scripts) with custom OAuth authorization and token budgets.

3. **Privacy & Sovereign / Air-Gapped Mode:**
   For regulated industries, confidential data, or government requirements, CLDX offers a **Sovereign Mode**. Requests tagged as sovereign bypass cloud LLM APIs entirely, routing directly to local models (e.g. Ollama/Qwen) and strictly contained local vector stores—guaranteeing zero data egress.

4. **Production Architecture & Cost Efficiency:**
   * **Semantic Prompt Caching:** Caches expensive code generations in Redis via deterministic prompt hashing to slash token costs and latency to 0 for repeated requests.
   * **BYOK (Bring Your Own Key):** Users can bring their own encrypted API keys (Groq, OpenAI, Anthropic, etc.), prioritizing personal quotas before consuming platform credits.
   * **Atomic Quota & Rate Limiting:** Enforces fine-grained token budgeting, Redis-backed sliding-window rate limiting, and Razorpay-powered credit billing.

---

## 🌟 Key Features

* **🤖 Specialized Agent Fleet:**
  * **Coding Agent:** Generates full-stack applications with preview sandboxes, intelligent file manipulation, and Redis prompt caching.
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
