# LOADSETU — Login & Signup Starter

A responsive React + Vite frontend and Express + MongoDB Atlas backend for LOADSETU authentication.

## Features
- Two switchable themes inspired by the supplied references:
  - **Sandstone Light**: warm ivory, sand, sage and terracotta.
  - **Midnight Logistics**: deep navy/charcoal, teal and amber.
- English, Marathi and Hindi language selector.
- Animated logistics background: moving trucks, glowing route lines, route nodes and ambient lights.
- Login and signup forms connected to the Express API.
- Password hashing with bcrypt, JWT authentication, validation and MongoDB Atlas.
- Mobile-friendly layout and reduced-motion support.

## 1. Requirements
- Node.js 20+
- MongoDB Atlas account and a database user
- Git (optional)

## 2. Configure backend
```bash
cd backend
npm install
```
Copy `.env.example` to `.env` and fill in your Atlas connection string and a long random JWT secret.

```bash
npm run dev
```
Backend runs at `http://localhost:5000`.

In MongoDB Atlas, add your current IP under **Network Access** and create a database user under **Database Access**. Use the connection string from **Connect → Drivers**. Do not commit `.env`.

## 3. Configure frontend
Open another terminal:
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL shown in the terminal (usually `http://localhost:5173`).
Use this frontend URL for the whole local project; requests to `/api` are proxied to the backend.

## 4. API endpoints
- `GET /api/health` — health check
- `POST /api/auth/signup` — `{ name, email, phone?, password }`
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/auth/me` — current user (requires `Authorization: Bearer <token>`)

The frontend stores the JWT in `localStorage` for this starter. For a production deployment, consider secure, HttpOnly cookies, rate limiting, email verification, password reset, HTTPS, and a privacy policy.

## Structure
```text
loadsetu-auth/
├── frontend/
│   ├── src/
│   │   ├── components/AnimatedLogistics.jsx
│   │   ├── i18n/translations.js
│   │   ├── services/api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── backend/
    ├── src/
    │   ├── config/db.js
    │   ├── controllers/authController.js
    │   ├── middleware/auth.js
    │   ├── models/User.js
    │   ├── routes/authRoutes.js
    │   └── server.js
    ├── .env.example
    └── package.json
```
