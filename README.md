# limeLightB - Backend REST API & Services

Comprehensive Node.js / Express REST API backend for the **Limelight Online Clothing Brand Platform**.

---

## ⚡ Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**: MongoDB Atlas with Mongoose ODM (dual-mode: Atlas cloud sync + JSON fallback)
- **Media Storage**: Cloudinary Media API + Multer (local & cloud dual upload)
- **AI Engine**: Groq API (`qwen/qwen3.8-27b`) powering the Interactive Shopping Stylist
- **Middleware**: CORS, Dotenv, File System persistence

---

## 📂 Project Structure

```
backend/
├── index.js        # Express API Server & all REST endpoints
├── db.js           # MongoDB Atlas connection & database seeders
├── models.js       # Mongoose Schemas (Sliders, Products, Orders, Users, Navigation, Footer, etc.)
├── assistant.js    # Groq AI Fashion Stylist engine
├── cloudinary.js   # Cloudinary image processor helper
├── data/           # Fallback JSON storage & initial seeders
├── uploads/        # Local uploaded media storage
├── .env.example    # Environment variables template
└── package.json    # Backend dependencies & npm scripts
```

---

## 📡 API Endpoints

### 1. Hero Sliders (`/api/slides`)
- `GET /api/slides` — Fetch all active hero banners
- `GET /api/slides?all=true` — Fetch all banners (including hidden) for admin
- `POST /api/slides` — Upload a new slider banner (file or URL)
- `PUT /api/slides/:id` — Update slide title, image, or link
- `DELETE /api/slides/:id` — Delete slide and clean up storage
- `POST /api/slides/reorder` — Reorder slides array

### 2. Feature Highlights Bar (`/api/features`)
- `GET /api/features` — Fetch active USP highlights
- `POST /api/features` — Add a new feature highlight
- `PUT /api/features/:id` — Update highlight details or status
- `DELETE /api/features/:id` — Delete a feature highlight
- `POST /api/features/reorder` — Reorder highlights array
- `POST /api/features/reset` — Reset to default Limelight highlights

### 3. Header Navigation & Branding (`/api/navigation`, `/api/settings`)
- `GET /api/navigation` — Fetch active header routes
- `POST /api/navigation` — Create a new route
- `PUT /api/navigation/:id` — Edit route name, link, or activate/deactivate
- `DELETE /api/navigation/:id` — Delete route
- `GET /api/settings` — Get brand settings (logo type, text/image logo, WhatsApp number)
- `PUT /api/settings` — Update logo styling and store settings

### 4. Products & Categories (`/api/products`, `/api/sections`)
- `GET /api/products` — Fetch catalog products
- `POST /api/products` — Create new product
- `PUT /api/products/:id` — Update product details
- `DELETE /api/products/:id` — Delete product
- `GET /api/sections` — Fetch homepage sections and display ordering

### 5. Orders & Customers (`/api/orders`, `/api/users`)
- `GET /api/orders` — List customer orders
- `POST /api/orders` — Place a new order
- `PUT /api/orders/:id` — Update order status (Pending, Confirmed, Shipped, Delivered)
- `POST /api/users/login` — User authentication
- `POST /api/users/register` — User signup

### 6. Footer & Newsletter (`/api/footer`, `/api/newsletter`)
- `GET /api/footer` — Fetch footer contact, policy, and column links
- `PUT /api/footer` — Update footer content & newsletter texts
- `GET /api/newsletter/subscribers` — View newsletter subscriber emails
- `POST /api/newsletter/subscribe` — Subscribe an email address

### 7. AI Shopping Stylist (`/api/assistant/chat`)
- `POST /api/assistant/chat` — Conversational AI stylist powered by Groq LLM with live catalog context

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
Create a `.env` file in the `backend/` directory:
```bash
cp .env.example .env
```
Fill in your MongoDB Atlas URI, Cloudinary credentials, and Groq API key.

### 3. Run Development Server
```bash
npm run dev
# or
npm start
```
Server runs on `http://localhost:5000`.

