# Rigways Rebuild

This repository now includes a React + Node.js + MySQL rebuild of the existing Rigways ACM app, packaged to run well in Docker and Coolify.

## Stack

- React 18 + Vite
- Express + TypeScript
- MySQL 8
- JWT authentication
- Single deployable app image that serves both API and frontend

## Local development

```bash
npm install
npm run dev
```

The API runs on `http://localhost:8080` and Vite runs on `http://localhost:5173`.

## Docker / Coolify

```bash
docker compose up --build
```

Coolify can use the root `docker-compose.yml` directly. The app service waits for MySQL, initializes the schema from `docker/mysql/init.sql`, then seeds demo data on first boot.

## Seed login

- Username: `admin`
- Password: `admin123`