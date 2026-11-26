import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { connectMongo, isMongoConnected } from './db.js';
import { uploadToCloudinary } from './cloudinary.js';
import { chatWithAssistant } from './assistant.js';
import {
  Product,
  Order,
  User,
  Navigation,
  Setting,
  Slide,
  Banner,
  Collection,
  NewArrival,
  Feature,
  Section,
  Footer,
  Subscriber
} from './models.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Cloudinary Image Processor Helper
async function processUploadedImage(reqFile, folder = 'limelight') {
  if (!reqFile) return null;
  try {
    const result = await uploadToCloudinary(reqFile.path, folder);
    if (result && result.url) {
      console.log(`☁️ Cloudinary Upload Success [${folder}]:`, result.url);
      return result.url;
    }
  } catch (err) {
    console.warn(`Cloudinary upload warning for ${reqFile.filename}:`, err.message);
  }
  return `/uploads/${reqFile.filename}`;
}

// Background & Awaited MongoDB Helpers
function buildIdFilter(targetId, extraFields = []) {
  const clauses = [{ id: targetId }, ...extraFields.map(f => ({ [f]: targetId }))];
  if (mongoose.Types.ObjectId.isValid(targetId)) {
    clauses.push({ _id: targetId });
  }
  return { $or: clauses };
}

function stripMongoMeta(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}

async function syncCollectionToMongo(Model, data, isArray = true) {
  if (!isMongoConnected()) return;
  try {
    if (isArray && Array.isArray(data)) {
      const ops = data.map(item => {
        const clean = stripMongoMeta(item);
        return {
          updateOne: {
            filter: { id: clean.id },
            update: { $set: clean },
            upsert: true
          }
        };
      });
      if (ops.length > 0) {
        await Model.bulkWrite(ops, { ordered: false });
      }
    } else if (data) {
      await Model.updateOne({ key: 'site_settings' }, { $set: stripMongoMeta(data) }, { upsert: true });
    }
  } catch (err) {
    console.warn(`MongoDB sync error (${Model.modelName}):`, err.message);
  }
}

async function readCollectionWithMongoFallback(Model, readLocalFn, sortObj = null) {
  if (isMongoConnected()) {
    try {
      const query = Model.find({}).lean();
      const docs = sortObj ? await query.sort(sortObj) : await query;
      if (Array.isArray(docs)) {
        return docs;
      }
    } catch (err) {
      console.warn(`MongoDB read error (${Model.modelName}):`, err.message);
    }
  }
  return readLocalFn();
}

// Directories
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SLIDES_FILE = path.join(DATA_DIR, 'slides.json');
const FEATURES_FILE = path.join(DATA_DIR, 'features.json');
const BANNERS_FILE = path.join(DATA_DIR, 'banners.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
const NEW_ARRIVALS_FILE = path.join(DATA_DIR, 'new-arrivals.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NAVIGATION_FILE = path.join(DATA_DIR, 'navigation.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SECTIONS_FILE = path.join(DATA_DIR, 'sections.json');
const FOOTER_FILE = path.join(DATA_DIR, 'footer.json');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper: Activity Log
function logActivity(action, details) {
  try {
    let activities = [];
    if (fs.existsSync(ACTIVITY_FILE)) {
      activities = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf-8'));
    }
    activities.unshift({
      id: `act-${Date.now()}`,
      action,
      details,
      timestamp: new Date().toISOString()
    });
    // keep latest 50
    if (activities.length > 50) activities = activities.slice(0, 50);
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(activities, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}

function getActivities() {
  try {
    if (fs.existsSync(ACTIVITY_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return [
    {
      id: 'act-init-1',
      action: 'System Initialized',
      details: 'Zimal Collection Backend online and ready',
      timestamp: new Date().toISOString()
    },
    {
      id: 'act-init-2',
      action: 'Campaign Loaded',
      details: 'Loaded 4 Winter Volume 2026 default sliders',
      timestamp: new Date().toISOString()
    }
  ];
}

// Multer Storage Configuration for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `slide-${sanitizedName}-${uniqueSuffix}${ext || '.jpg'}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF) are allowed.'));
    }
  }
});

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auto-connect to MongoDB if disconnected
app.use(async (req, res, next) => {
  if (!isMongoConnected()) {
    try {
      await connectMongo();
    } catch (err) {}
  }
  next();
});

// Serve uploaded static files
app.use('/uploads', express.static(UPLOADS_DIR));

// Default Slides Seed (Dynamic from slides.json)
let DEFAULT_SLIDES = [];
try {
  if (fs.existsSync(SLIDES_FILE)) {
    DEFAULT_SLIDES = JSON.parse(fs.readFileSync(SLIDES_FILE, 'utf-8')).map(({ _id, __v, ...rest }) => rest);
  }
} catch (e) {
  DEFAULT_SLIDES = [];
}

// Helper: Read Slides
function readSlides() {
  try {
    if (!fs.existsSync(SLIDES_FILE)) {
      writeSlides(DEFAULT_SLIDES);
      return DEFAULT_SLIDES;
    }
    const data = fs.readFileSync(SLIDES_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeSlides(DEFAULT_SLIDES);
      return DEFAULT_SLIDES;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading slides file:', err);
    return DEFAULT_SLIDES;
  }
}

// Helper: Write Slides
function writeSlides(slides) {
  try {
    fs.writeFileSync(SLIDES_FILE, JSON.stringify(slides, null, 2), 'utf-8');
    syncCollectionToMongo(Slide, slides);
  } catch (err) {
    console.error('Error writing slides file:', err);
  }
}

// Default Features Seed (Feature highlights bar below slider)
const DEFAULT_FEATURES = [
  {
    id: "feat-1",
    title: "FREE NATIONWIDE SHIPPING",
    subtitle: "On orders above Rs. 2,490",
    order: 1,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "feat-2",
    title: "100% GENUINE FABRIC",
    subtitle: "Pure Cottons, Velvets & Karandi",
    order: 2,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "feat-3",
    title: "CASH ON DELIVERY",
    subtitle: "Available all across Pakistan",
    order: 3,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "feat-4",
    title: "EASY EXCHANGE",
    subtitle: "30-Day Hassle Free Returns",
    order: 4,
    isActive: true,
    createdAt: new Date().toISOString()
  }
];

// Helper: Read Features
function readFeatures() {
  try {
    if (!fs.existsSync(FEATURES_FILE)) {
      writeFeatures(DEFAULT_FEATURES);
      return DEFAULT_FEATURES;
    }
    const data = fs.readFileSync(FEATURES_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeFeatures(DEFAULT_FEATURES);
      return DEFAULT_FEATURES;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading features file:', err);
    return DEFAULT_FEATURES;
  }
}

// Helper: Write Features
function writeFeatures(features) {
  try {
    fs.writeFileSync(FEATURES_FILE, JSON.stringify(features, null, 2), 'utf-8');
    syncCollectionToMongo(Feature, features);
  } catch (err) {
    console.error('Error writing features file:', err);
  }
}

// Default Section Editorial Banners (Dynamic from banners.json)
let DEFAULT_BANNERS = [];
try {
  if (fs.existsSync(BANNERS_FILE)) {
    DEFAULT_BANNERS = JSON.parse(fs.readFileSync(BANNERS_FILE, 'utf-8')).map(({ _id, __v, ...rest }) => rest);
  }
} catch (e) {
  DEFAULT_BANNERS = [];
}

// Helper: Read Banners
function readBanners() {
  try {
    if (!fs.existsSync(BANNERS_FILE)) {
      writeBanners(DEFAULT_BANNERS);
      return DEFAULT_BANNERS;
    }
    const data = fs.readFileSync(BANNERS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeBanners(DEFAULT_BANNERS);
      return DEFAULT_BANNERS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading banners file:', err);
    return DEFAULT_BANNERS;
  }
}

// Helper: Write Banners
function writeBanners(banners) {
  try {
    fs.writeFileSync(BANNERS_FILE, JSON.stringify(banners, null, 2), 'utf-8');
    syncCollectionToMongo(Banner, banners);
  } catch (err) {
    console.error('Error writing banners file:', err);
  }
}

// Default Catalog Products Seed (Dynamic from catalog JSON)
let DEFAULT_PRODUCTS = [];
try {
  if (fs.existsSync(PRODUCTS_FILE)) {
    DEFAULT_PRODUCTS = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  }
} catch (e) {
  DEFAULT_PRODUCTS = [];
}

// Helper: Read Products
function readProducts() {
  try {
    if (!fs.existsSync(PRODUCTS_FILE)) {
      writeProducts(DEFAULT_PRODUCTS);
      return DEFAULT_PRODUCTS;
    }
    const data = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeProducts(DEFAULT_PRODUCTS);
      return DEFAULT_PRODUCTS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading products file:', err);
    return DEFAULT_PRODUCTS;
  }
}

// Helper: Write Products
function writeProducts(products) {
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
    syncCollectionToMongo(Product, products);
  } catch (err) {
    console.error('Error writing products file:', err);
  }
}

// Default Seed Curated Collections (Dynamic from collections.json)
let DEFAULT_COLLECTIONS = [];
try {
  if (fs.existsSync(COLLECTIONS_FILE)) {
    DEFAULT_COLLECTIONS = JSON.parse(fs.readFileSync(COLLECTIONS_FILE, 'utf-8')).map(({ _id, __v, ...rest }) => rest);
  }
} catch (e) {
  DEFAULT_COLLECTIONS = [];
}

// Helper: Read Collections
function readCollections() {
  try {
    if (!fs.existsSync(COLLECTIONS_FILE)) {
      writeCollections(DEFAULT_COLLECTIONS);
      return DEFAULT_COLLECTIONS;
    }
    const data = fs.readFileSync(COLLECTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeCollections(DEFAULT_COLLECTIONS);
      return DEFAULT_COLLECTIONS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading collections file:', err);
    return DEFAULT_COLLECTIONS;
  }
}

// Helper: Write Collections
function writeCollections(collections) {
  try {
    fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(collections, null, 2), 'utf-8');
    syncCollectionToMongo(Collection, collections);
  } catch (err) {
    console.error('Error writing collections file:', err);
  }
}

// Default Seed New Arrivals (Dynamic from new-arrivals.json)
let DEFAULT_NEW_ARRIVALS = [];
try {
  if (fs.existsSync(NEW_ARRIVALS_FILE)) {
    DEFAULT_NEW_ARRIVALS = JSON.parse(fs.readFileSync(NEW_ARRIVALS_FILE, 'utf-8')).map(({ _id, __v, ...rest }) => rest);
  }
} catch (e) {
  DEFAULT_NEW_ARRIVALS = [];
}

// Helper: Read New Arrivals
function readNewArrivals() {
  try {
    if (!fs.existsSync(NEW_ARRIVALS_FILE)) {
      writeNewArrivals(DEFAULT_NEW_ARRIVALS);
      return DEFAULT_NEW_ARRIVALS;
    }
    const data = fs.readFileSync(NEW_ARRIVALS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeNewArrivals(DEFAULT_NEW_ARRIVALS);
      return DEFAULT_NEW_ARRIVALS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading new arrivals file:', err);
    return DEFAULT_NEW_ARRIVALS;
  }
}

// Helper: Write New Arrivals
function writeNewArrivals(items) {
  try {
    fs.writeFileSync(NEW_ARRIVALS_FILE, JSON.stringify(items, null, 2), 'utf-8');
    syncCollectionToMongo(NewArrival, items);
  } catch (err) {
    console.error('Error writing new arrivals file:', err);
  }
}

// Default Sample Orders
const DEFAULT_ORDERS = [];

// Helper: Read Orders
function readOrders() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) {
      writeOrders(DEFAULT_ORDERS);
      return DEFAULT_ORDERS;
    }
    const data = fs.readFileSync(ORDERS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      writeOrders(DEFAULT_ORDERS);
      return DEFAULT_ORDERS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading orders file:', err);
    return DEFAULT_ORDERS;
  }
}

// Helper: Write Orders
function writeOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
    syncCollectionToMongo(Order, orders);
  } catch (err) {
    console.error('Error writing orders file:', err);
  }
}

// Default Seed Users (Registered Customers)
const DEFAULT_USERS = [
  {
    id: "usr-1",
    name: "Ali Zohaib",
    email: "ali.zohaib@example.com",
    phone: "0300-1234567",
    password: "password123",
    city: "Lahore",
    address: "House 12, Main Boulevard, Gulberg III",
    province: "Punjab",
    status: "Active",
    role: "customer",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z"
  },
  {
    id: "usr-2",
    name: "Ayesha Khan",
    email: "ayesha.khan@example.com",
    phone: "0300-8472910",
    password: "password123",
    city: "Lahore",
    address: "House 42, Block C, Phase 5, DHA",
    province: "Punjab",
    status: "Active",
    role: "customer",
    createdAt: "2026-11-15T11:00:00.000Z",
    updatedAt: "2026-11-15T11:00:00.000Z"
  },
  {
    id: "usr-3",
    name: "Fatima Zahra",
    email: "fatima@example.com",
    phone: "0321-4567890",
    password: "password123",
    city: "Islamabad",
    address: "House # 18, Street 4, Sector F-7/2",
    province: "Islamabad Capital Territory",
    status: "Active",
    role: "customer",
    createdAt: "2026-11-15T12:00:00.000Z",
    updatedAt: "2026-11-15T12:00:00.000Z"
  }
];

// Helper: Read Users
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      writeUsers(DEFAULT_USERS);
      return DEFAULT_USERS;
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeUsers(DEFAULT_USERS);
      return DEFAULT_USERS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading users file:', err);
    return DEFAULT_USERS;
  }
}

// Helper: Write Users
function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    syncCollectionToMongo(User, users);
  } catch (err) {
    console.error('Error writing users file:', err);
  }
}

// Default Seed Navigation Routes
const DEFAULT_NAVIGATION = [
  {
    id: "nav-1",
    name: "NEW IN",
    slug: "new-in",
    href: "#new-arrivals",
    isSale: false,
    order: 1,
    isActive: true,
    description: "Just dropped in stores & online"
  },
  {
    id: "nav-2",
    name: "WOMEN",
    slug: "women",
    href: "#unstitched",
    isSale: false,
    order: 2,
    isActive: true,
    description: "Unstitched, Ready to Wear & Special Editions"
  },
  {
    id: "nav-3",
    name: "MEN",
    slug: "men",
    href: "#men",
    isSale: false,
    order: 3,
    isActive: true,
    description: "Classic Kurtas & Men Ethnic Wear"
  },
  {
    id: "nav-4",
    name: "GIRLS",
    slug: "girls",
    href: "#ready-to-wear",
    isSale: false,
    order: 4,
    isActive: true,
    description: "Teen & Girls Pret Collection"
  },
  {
    id: "nav-5",
    name: "SALE",
    slug: "sale",
    href: "#new-arrivals",
    isSale: true,
    order: 5,
    isActive: true,
    description: "Seasonal Clearance Up to 50% Off"
  }
];

// Default Settings (Logo Branding & WhatsApp)
const DEFAULT_SETTINGS = {
  logoType: "text",
  textLogo: {
    part1: "ZIMAL ",
    part2: "COLLECTION",
    part1Color: "#23ac95",
    part2Color: "#cec72e",
    singleText: "www.zimalcollection.com",
    letterSpacing: "0.22em",
    fontSize: "22px"
  },
  headerBg: "#000000",
  subnavBg: "#000000",
  imageLogo: {
    url: "",
    alt: "Zimal Collection Official (www.zimalcollection.com)",
    height: 34
  },
  whatsappNumber: "+92 345 7867016",
  updatedAt: new Date().toISOString()
};

// Helper: Read Navigation
function readNavigation() {
  try {
    if (!fs.existsSync(NAVIGATION_FILE)) {
      writeNavigation(DEFAULT_NAVIGATION);
      return DEFAULT_NAVIGATION;
    }
    const data = fs.readFileSync(NAVIGATION_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeNavigation(DEFAULT_NAVIGATION);
      return DEFAULT_NAVIGATION;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading navigation file:', err);
    return DEFAULT_NAVIGATION;
  }
}

// Helper: Write Navigation
function writeNavigation(nav) {
  try {
    fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(nav, null, 2), 'utf-8');
    syncCollectionToMongo(Navigation, nav);
  } catch (err) {
    console.error('Error writing navigation file:', err);
  }
}

// Helper: Read Settings
function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      writeSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading settings file:', err);
    return DEFAULT_SETTINGS;
  }
}

// Helper: Write Settings
function writeSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    syncCollectionToMongo(Setting, settings, false);
  } catch (err) {
    console.error('Error writing settings file:', err);
  }
}

// Default Homepage Sections Order
const DEFAULT_SECTIONS = [
  {
    id: "hero",
    name: "Hero Banner Slider",
    description: "Large rotating hero campaign banners at top of store",
    order: 1,
    enabled: true
  },
  {
    id: "features",
    name: "Feature Highlights (USP Bar)",
    description: "4-point customer value propositions (Free Shipping, COD, etc.)",
    order: 2,
    enabled: true
  },
  {
    id: "unstitched",
    name: "Unstitched Fabrics Section",
    description: "Luxury unstitched velvets, karandi, and khaddar suits with editorial banner",
    order: 3,
    enabled: true
  },
  {
    id: "rtw",
    name: "Ready To Wear & Co-Ords",
    description: "Pret casual kurtis, 2-piece co-ord sets with split campaign banners",
    order: 4,
    enabled: true
  },
  {
    id: "collections",
    name: "Shop By Collection (Curated Editions)",
    description: "4-tile curated edition grid (Winter Velvet, Co-Ords, Organza, Khaddar)",
    order: 5,
    enabled: true
  },
  {
    id: "men",
    name: "Men Ethnic Collection",
    description: "Men latha, embroidered kurta pajama, and waistcoats",
    order: 6,
    enabled: true
  },
  {
    id: "new-arrivals",
    name: "New Arrivals Showcase",
    description: "Latest season drops with tab filters and product cards",
    order: 7,
    enabled: true
  }
];

// Helper: Read Sections
function readSections() {
  try {
    if (!fs.existsSync(SECTIONS_FILE)) {
      writeSections(DEFAULT_SECTIONS);
      return DEFAULT_SECTIONS;
    }
    const data = fs.readFileSync(SECTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeSections(DEFAULT_SECTIONS);
      return DEFAULT_SECTIONS;
    }
    parsed.sort((a, b) => (a.order || 0) - (b.order || 0));
    return parsed;
  } catch (err) {
    console.error('Error reading sections file:', err);
    return DEFAULT_SECTIONS;
  }
}

// Helper: Write Sections
function writeSections(sections) {
  try {
    fs.writeFileSync(SECTIONS_FILE, JSON.stringify(sections, null, 2), 'utf-8');
    syncCollectionToMongo(Section, sections);
  } catch (err) {
    console.error('Error writing sections file:', err);
  }
}

// Default Seed Footer Configuration
const DEFAULT_FOOTER = {
  newsletter: {
    eyebrow: "STAY CONNECTED WITH WWW.ZIMALCOLLECTION.COM",
    title: "SUBSCRIBE TO OUR NEWSLETTER",
    description: "Subscribe to be the first to receive updates on new seasonal collections, limited pret drops, and exclusive seasonal promotions from www.zimalcollection.com.",
    placeholder: "Enter your email address",
    buttonText: "SUBSCRIBE",
    successMessage: "Thank you for subscribing to Zimal Collection updates! Check your inbox for your welcome voucher."
  },
  customerCare: {
    title: "CUSTOMER CARE",
    links: [
      { label: "Contact Us", url: "#customer-care" },
      { label: "Shipping & Handling", url: "/category/new-in" },
      { label: "Exchange & Returns Policy", url: "/category/women" },
      { label: "Frequently Asked Questions", url: "#customer-care" },
      { label: "Track Your Order", url: "#track-order" },
      { label: "Store Locator", url: "#store-locator" }
    ]
  },
  information: {
    title: "INFORMATION",
    links: [
      { label: "About Zimal Collection", url: "/category/women" },
      { label: "Our Craft & Heritage", url: "/category/unstitched" },
      { label: "Careers & Job Openings", url: "#careers" },
      { label: "Privacy Policy", url: "#privacy" },
      { label: "Terms & Conditions", url: "#terms" },
      { label: "Fabric Care Instructions", url: "#fabric-care" }
    ]
  },
  contact: {
    title: "CONTACT US",
    uan: "+92 345 7867016",
    timings: "Monday - Saturday: 9:00 AM - 6:00 PM",
    whatsapp: "+92 345 7867016",
    email: "online@zimalcollection.com",
    address: "Zimal Collection Flagship Store, Pakistan"
  },
  connect: {
    title: "CONNECT & PAYMENTS",
    description: "Follow our official social accounts for style inspirations and daily looks:",
    socialLinks: {
      instagram: "https://instagram.com/zimalcollection",
      facebook: "https://facebook.com/zimalcollection",
      youtube: "https://youtube.com/@zimalcollection"
    },
    paymentMethods: [
      "VISA",
      "Mastercard",
      "PayPak",
      "UnionPay",
      "COD (Cash on Delivery)"
    ]
  },
  bottomBar: {
    copyright: "© 2026 www.zimalcollection.com. All rights reserved. Registered Trademark.",
    links: [
      { label: "Privacy Policy", url: "#privacy" },
      { label: "Terms of Service", url: "#terms" },
      { label: "Sitemap", url: "#sitemap" }
    ]
  }
};

// Helper: Read Footer
function readFooter() {
  try {
    if (!fs.existsSync(FOOTER_FILE)) {
      writeFooter(DEFAULT_FOOTER);
      return DEFAULT_FOOTER;
    }
    const data = fs.readFileSync(FOOTER_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_FOOTER;
  } catch (err) {
    console.error('Error reading footer file:', err);
    return DEFAULT_FOOTER;
  }
}

// Helper: Write Footer
function writeFooter(footerData) {
  try {
    fs.writeFileSync(FOOTER_FILE, JSON.stringify(footerData, null, 2), 'utf-8');
    syncCollectionToMongo(Footer, footerData, false);
  } catch (err) {
    console.error('Error writing footer file:', err);
  }
}

// Helper: Read Subscribers
function readSubscribers() {
  try {
    if (!fs.existsSync(SUBSCRIBERS_FILE)) {
      writeSubscribers([]);
      return [];
    }
    const data = fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading subscribers file:', err);
    return [];
  }
}

// Helper: Write Subscribers
function writeSubscribers(subscribers) {
  try {
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2), 'utf-8');
    syncCollectionToMongo(Subscriber, subscribers, true);
  } catch (err) {
    console.error('Error writing subscribers file:', err);
  }
}

// Initialize seed data if needed
readSlides();
readFeatures();
readBanners();
readProducts();
readCollections();
readNewArrivals();
readOrders();
readUsers();
readNavigation();
readSettings();
readSections();
readFooter();
readSubscribers();

// Copy user's uploaded banner to uploads folder if exists
const uploadedBannerSrc = '/home/ali-zohaib/.gemini/antigravity/brain/059c8a30-7dc8-4769-96e8-c22e8c0cdbec/.user_uploaded/media_1794770709329_49e4ea5c.jpg';
if (fs.existsSync(uploadedBannerSrc)) {
  const destPath = path.join(UPLOADS_DIR, 'user-limelight-banner.jpg');
  if (!fs.existsSync(destPath)) {
    try {
      fs.copyFileSync(uploadedBannerSrc, destPath);
    } catch (e) {
      console.warn('Could not copy user image:', e.message);
    }
  }
}

// ================= API ROUTES =================

// Health check & System Stats
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), totalSlides: readSlides().length });
});

// GET /api/stats - Dashboard analytics & overview
app.get('/api/stats', async (req, res) => {
  const [slides, features, banners, products, collections, newArrivals, orders, users, navigation, subscribers, settingsDoc] = await Promise.all([
    readCollectionWithMongoFallback(Slide, readSlides),
    readCollectionWithMongoFallback(Feature, readFeatures),
    readCollectionWithMongoFallback(Banner, readBanners),
    readCollectionWithMongoFallback(Product, readProducts),
    readCollectionWithMongoFallback(Collection, readCollections),
    readCollectionWithMongoFallback(NewArrival, readNewArrivals),
    readCollectionWithMongoFallback(Order, readOrders),
    readCollectionWithMongoFallback(User, readUsers),
    readCollectionWithMongoFallback(Navigation, readNavigation),
    readCollectionWithMongoFallback(Subscriber, readSubscribers),
    isMongoConnected()
      ? Setting.findOne({ key: 'site_settings' }).lean().catch(() => readSettings())
      : Promise.resolve(readSettings())
  ]);

  const activeSlides = slides.filter(s => s.isActive !== false);
  const activeFeatures = features.filter(f => f.isActive !== false);
  const activeBanners = banners.filter(b => b.isActive !== false);
  const activeProducts = products.filter(p => p.isActive !== false);
  const activeCollections = collections.filter(c => c.isActive !== false);
  const activeNewArrivals = newArrivals.filter(n => n.isActive !== false);
  const pendingOrders = orders.filter(o => o.status === 'Pending').length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const activeUsers = users.filter(u => u.status === 'Active').length;
  const settings = settingsDoc || readSettings();

  res.json({
    totalSlides: slides.length,
    activeSlides: activeSlides.length,
    hiddenSlides: slides.length - activeSlides.length,
    totalFeatures: features.length,
    activeFeatures: activeFeatures.length,
    totalBanners: banners.length,
    activeBanners: activeBanners.length,
    totalProducts: products.length,
    activeProducts: activeProducts.length,
    unstitchedCount: products.filter(p => p.category?.toLowerCase() === 'unstitched').length,
    rtwCount: products.filter(p => p.category?.toLowerCase() === 'ready to wear').length,
    menCount: products.filter(p => p.category?.toLowerCase() === 'men').length,
    totalCollections: collections.length,
    activeCollections: activeCollections.length,
    totalNewArrivals: newArrivals.length,
    activeNewArrivals: activeNewArrivals.length,
    totalOrders: orders.length,
    pendingOrders,
    totalRevenue,
    totalUsers: users.length,
    activeUsers,
    totalRoutes: navigation.length,
    totalSubscribers: subscribers.length,
    whatsappNumber: settings.whatsappNumber || "+92 345 7867016",
    categoriesCount: 6,
    freeShippingThreshold: 2490,
    serverUptime: Math.round(process.uptime()),
    nodeVersion: process.version,
    storageEngine: isMongoConnected() ? 'MongoDB Atlas + Cloudinary CDN' : 'Local Persistent JSON + Multer',
    uploadsCount: fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR).length : 0
  });
});

// ================= FEATURES API ROUTES =================

// GET /api/features - Return all features sorted by order
app.get('/api/features', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const features = await readCollectionWithMongoFallback(Feature, readFeatures, { order: 1 });
  const filtered = includeInactive ? features : features.filter(f => f.isActive !== false);
  filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(filtered);
});

// GET /api/features/:id - Single feature
app.get('/api/features/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const item = await Feature.findOne(buildIdFilter(targetId)).lean();
      if (item) return res.json(item);
      return res.status(404).json({ error: 'Feature not found' });
    } catch (err) {}
  }
  const features = readFeatures();
  const item = features.find(f => f.id === targetId);
  if (!item) return res.status(404).json({ error: 'Feature not found' });
  res.json(item);
});

// POST /api/features - Add new feature highlight
app.post('/api/features', async (req, res) => {
  try {
    const { title, subtitle, isActive } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Feature title is required' });
    }

    const features = await readCollectionWithMongoFallback(Feature, readFeatures);
    const newFeature = {
      id: `feat-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title: title.trim(),
      subtitle: subtitle ? subtitle.trim() : '',
      order: features.length > 0 ? Math.max(...features.map(f => f.order || 0)) + 1 : 1,
      isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : true,
      createdAt: new Date().toISOString()
    };

    await upsertMongoDoc(Feature, { id: newFeature.id }, newFeature);
    features.push(newFeature);
    try { fs.writeFileSync(FEATURES_FILE, JSON.stringify(features.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Feature Created', `Added feature highlight "${newFeature.title}"`);

    res.status(201).json({ success: true, message: 'Feature created successfully', feature: newFeature });
  } catch (error) {
    console.error('Error creating feature:', error);
    res.status(500).json({ error: error.message || 'Failed to create feature' });
  }
});

// PUT /api/features/:id - Update existing feature highlight
app.put('/api/features/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    const features = await readCollectionWithMongoFallback(Feature, readFeatures);
    const index = features.findIndex(f => f.id === targetId || String(f._id) === targetId);
    if (index === -1) return res.status(404).json({ error: 'Feature not found' });

    const existing = stripMongoMeta(features[index]);
    const updated = {
      ...existing,
      title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
      subtitle: req.body.subtitle !== undefined ? req.body.subtitle.trim() : existing.subtitle,
      order: req.body.order !== undefined ? parseInt(req.body.order, 10) : existing.order,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Feature, buildIdFilter(targetId), updated);
    features[index] = updated;
    try { fs.writeFileSync(FEATURES_FILE, JSON.stringify(features.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Feature Updated', `Updated feature highlight "${updated.title}"`);

    res.json({ success: true, message: 'Feature updated successfully', feature: updated });
  } catch (error) {
    console.error('Error updating feature:', error);
    res.status(500).json({ error: error.message || 'Failed to update feature' });
  }
});

// DELETE /api/features/:id - Delete a feature highlight
app.delete('/api/features/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;
    if (isMongoConnected()) {
      const delRes = await Feature.deleteMany(buildIdFilter(targetId));
      if (delRes.deletedCount > 0) found = true;
    }

    const features = readFeatures();
    const index = features.findIndex(f => f.id === targetId || f._id === targetId);
    if (index !== -1) {
      found = true;
      features.splice(index, 1);
      try { fs.writeFileSync(FEATURES_FILE, JSON.stringify(features, null, 2), 'utf-8'); } catch (e) {}
    }

    if (!found) return res.status(404).json({ error: 'Feature not found' });

    logActivity('Feature Deleted', `Deleted feature (ID: ${targetId})`);
    res.json({ success: true, message: 'Feature deleted successfully', id: targetId });
  } catch (error) {
    console.error('Error deleting feature:', error);
    res.status(500).json({ error: error.message || 'Failed to delete feature' });
  }
});

// POST /api/features/reorder - Reorder feature highlights
app.post('/api/features/reorder', async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array of feature IDs' });

    const features = (await readCollectionWithMongoFallback(Feature, readFeatures)).map(stripMongoMeta);
    features.forEach(feat => {
      const newOrder = orderIds.indexOf(feat.id);
      if (newOrder !== -1) feat.order = newOrder + 1;
    });

    await syncCollectionToMongo(Feature, features);
    try { fs.writeFileSync(FEATURES_FILE, JSON.stringify(features, null, 2), 'utf-8'); } catch (e) {}
    logActivity('Features Reordered', `Reordered ${orderIds.length} feature highlights`);
    res.json({ success: true, message: 'Features reordered successfully', features });
  } catch (error) {
    console.error('Error reordering features:', error);
    res.status(500).json({ error: error.message || 'Failed to reorder features' });
  }
});

// POST /api/features/reset - Reset features to default
app.post('/api/features/reset', async (req, res) => {
  if (isMongoConnected()) {
    await Feature.deleteMany({});
    if (DEFAULT_FEATURES.length > 0) await Feature.insertMany(DEFAULT_FEATURES);
  }
  writeFeatures(DEFAULT_FEATURES);
  logActivity('Features Reset', 'Reset features bar to default values');
  res.json({ success: true, message: 'Features reset to defaults', features: DEFAULT_FEATURES });
});

// ================= BANNERS API ROUTES =================

// GET /api/banners - Return all section editorial banners
app.get('/api/banners', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const banners = await readCollectionWithMongoFallback(Banner, readBanners);
  const filtered = includeInactive ? banners : banners.filter(b => b.isActive !== false);
  res.json(filtered);
});

// GET /api/banners/:id - Single section banner by id or section name
app.get('/api/banners/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const b = await Banner.findOne(buildIdFilter(targetId, ['section'])).lean();
      if (b) return res.json(b);
      return res.status(404).json({ error: 'Banner not found' });
    } catch (err) {
      console.warn('MongoDB banner error:', err.message);
    }
  }
  const banners = readBanners();
  const banner = banners.find(b => b.id === targetId || b.section === targetId);
  if (!banner) {
    return res.status(404).json({ error: 'Banner not found' });
  }
  res.json(banner);
});

// POST /api/banners - Create or update banner with image upload or URL
app.post('/api/banners', upload.single('image'), async (req, res) => {
  try {
    const banners = await readCollectionWithMongoFallback(Banner, readBanners);
    let imageUrl = req.body.imageUrl || '';

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/banners');
    }

    const id = req.body.id || req.body.section || `banner-${Date.now()}`;
    const section = req.body.section || id;

    const existingIndex = banners.findIndex(b => b.id === id || b.section === section);
    if (existingIndex !== -1) {
      const existing = stripMongoMeta(banners[existingIndex]);
      const updated = {
        ...existing,
        sectionName: req.body.sectionName !== undefined ? req.body.sectionName : existing.sectionName,
        badge: req.body.badge !== undefined ? req.body.badge : existing.badge,
        watermark: req.body.watermark !== undefined ? req.body.watermark : existing.watermark,
        title: req.body.title !== undefined ? req.body.title : existing.title,
        subtitle: req.body.subtitle !== undefined ? req.body.subtitle : existing.subtitle,
        scriptText: req.body.scriptText !== undefined ? req.body.scriptText : existing.scriptText,
        buttonText: req.body.buttonText !== undefined ? req.body.buttonText : existing.buttonText,
        buttonLink: req.body.buttonLink !== undefined ? req.body.buttonLink : existing.buttonLink,
        secondaryBtnText: req.body.secondaryBtnText !== undefined ? req.body.secondaryBtnText : existing.secondaryBtnText,
        secondaryBtnLink: req.body.secondaryBtnLink !== undefined ? req.body.secondaryBtnLink : existing.secondaryBtnLink,
        imageUrl: imageUrl || existing.imageUrl,
        isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
        updatedAt: new Date().toISOString()
      };
      await upsertMongoDoc(Banner, buildIdFilter(updated.id, ['section']), updated);
      banners[existingIndex] = updated;
      try { fs.writeFileSync(BANNERS_FILE, JSON.stringify(banners.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
      logActivity('Banner Updated', `Updated editorial banner "${updated.title}"`);
      return res.json({ success: true, message: 'Banner updated successfully', banner: updated });
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'An image file or imageUrl is required.' });
    }

    const newBanner = {
      id,
      section,
      sectionName: req.body.sectionName || 'Section Banner',
      badge: req.body.badge || 'LUXURY WINTER EDIT',
      watermark: req.body.watermark || 'UNSTITCHED',
      title: req.body.title || 'UNSTITCHED FABRICS',
      subtitle: req.body.subtitle || '',
      scriptText: req.body.scriptText || '',
      buttonText: req.body.buttonText || 'EXPLORE DESIGNS',
      buttonLink: req.body.buttonLink || '#unstitched-grid',
      secondaryBtnText: req.body.secondaryBtnText || 'SHOP NOW',
      secondaryBtnLink: req.body.secondaryBtnLink || '#unstitched',
      imageUrl,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Banner, { id: newBanner.id }, newBanner);
    banners.push(newBanner);
    try { fs.writeFileSync(BANNERS_FILE, JSON.stringify(banners.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Banner Created', `Created editorial banner "${newBanner.title}"`);
    res.status(201).json({ success: true, message: 'Banner created successfully', banner: newBanner });
  } catch (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({ error: error.message || 'Failed to create banner' });
  }
});

// PUT /api/banners/:id - Update existing banner
app.put('/api/banners/:id', upload.single('image'), async (req, res) => {
  try {
    const targetId = req.params.id;
    const banners = await readCollectionWithMongoFallback(Banner, readBanners);
    const index = banners.findIndex(b => b.id === targetId || b.section === targetId || String(b._id) === targetId);
    if (index === -1) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    const existing = stripMongoMeta(banners[index]);
    let imageUrl = existing.imageUrl;

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/banners');
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    const updated = {
      ...existing,
      sectionName: req.body.sectionName !== undefined ? req.body.sectionName : existing.sectionName,
      badge: req.body.badge !== undefined ? req.body.badge : existing.badge,
      watermark: req.body.watermark !== undefined ? req.body.watermark : existing.watermark,
      title: req.body.title !== undefined ? req.body.title : existing.title,
      subtitle: req.body.subtitle !== undefined ? req.body.subtitle : existing.subtitle,
      scriptText: req.body.scriptText !== undefined ? req.body.scriptText : existing.scriptText,
      buttonText: req.body.buttonText !== undefined ? req.body.buttonText : existing.buttonText,
      buttonLink: req.body.buttonLink !== undefined ? req.body.buttonLink : existing.buttonLink,
      secondaryBtnText: req.body.secondaryBtnText !== undefined ? req.body.secondaryBtnText : existing.secondaryBtnText,
      secondaryBtnLink: req.body.secondaryBtnLink !== undefined ? req.body.secondaryBtnLink : existing.secondaryBtnLink,
      imageUrl,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Banner, buildIdFilter(targetId, ['section']), updated);
    banners[index] = updated;
    try { fs.writeFileSync(BANNERS_FILE, JSON.stringify(banners.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Banner Updated', `Updated editorial banner "${updated.title}"`);

    res.json({ success: true, message: 'Banner updated successfully', banner: updated });
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({ error: error.message || 'Failed to update banner' });
  }
});

// DELETE /api/banners/:id - Delete a banner
app.delete('/api/banners/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;
    if (isMongoConnected()) {
      const delRes = await Banner.deleteMany(buildIdFilter(targetId, ['section']));
      if (delRes.deletedCount > 0) found = true;
    }

    const banners = readBanners();
    const index = banners.findIndex(b => b.id === targetId || b.section === targetId);
    if (index !== -1) {
      found = true;
      banners.splice(index, 1);
      try { fs.writeFileSync(BANNERS_FILE, JSON.stringify(banners, null, 2), 'utf-8'); } catch (e) {}
    }

    if (!found) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    logActivity('Banner Deleted', `Deleted banner (ID: ${targetId})`);
    res.json({ success: true, message: 'Banner deleted successfully', id: targetId });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({ error: error.message || 'Failed to delete banner' });
  }
});

// POST /api/banners/reset - Reset banners to default
app.post('/api/banners/reset', async (req, res) => {
  if (isMongoConnected()) {
    await Banner.deleteMany({});
    if (DEFAULT_BANNERS.length > 0) await Banner.insertMany(DEFAULT_BANNERS);
  }
  writeBanners(DEFAULT_BANNERS);
  logActivity('Banners Reset', 'Reset section banners to default editorial values');
  res.json({ success: true, message: 'Banners reset to defaults', banners: DEFAULT_BANNERS });
});

// ================= PRODUCTS API ROUTES =================

// GET /api/products - Get all products with optional category & active filters
app.get('/api/products', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const categoryFilter = req.query.category;

  if (isMongoConnected()) {
    try {
      const query = {};
      if (!includeInactive) {
        query.isActive = { $ne: false };
      }
      if (categoryFilter && categoryFilter.toLowerCase() !== 'all') {
        query.category = new RegExp(`^${categoryFilter}$`, 'i');
      }
      const mongoProducts = await Product.find(query).sort({ createdAt: -1 }).lean();
      return res.json(mongoProducts || []);
    } catch (err) {
      console.warn('MongoDB query error, falling back to JSON:', err.message);
    }
  }

  let products = readProducts();

  if (!includeInactive) {
    products = products.filter(p => p.isActive !== false);
  }

  if (categoryFilter && categoryFilter.toLowerCase() !== 'all') {
    products = products.filter(p =>
      p.category && p.category.toLowerCase() === categoryFilter.toLowerCase()
    );
  }

  res.json(products);
});

// GET /api/products/:id - Single product by ID
app.get('/api/products/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const mongoFilter = {
        $or: [
          { id: targetId },
          ...(mongoose.Types.ObjectId.isValid(targetId) ? [{ _id: targetId }] : [])
        ]
      };
      const p = await Product.findOne(mongoFilter);
      if (p) return res.json(p);
    } catch (err) {
      console.warn('MongoDB single product error:', err.message);
    }
  }

  const products = readProducts();
  const product = products.find(p => p.id === targetId || p._id === targetId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

// POST /api/products - Create/Upload new product
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const products = readProducts();
    let imageUrl = req.body.image || req.body.imageUrl || '';

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/products');
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'Product photography (image file or URL) is required.' });
    }

    if (!req.body.title || !req.body.title.trim()) {
      return res.status(400).json({ error: 'Product title is required.' });
    }

    const price = parseInt(req.body.price, 10) || 0;
    const originalPrice = req.body.originalPrice ? parseInt(req.body.originalPrice, 10) : null;
    let discount = req.body.discount ? req.body.discount.trim() : '';

    if (!discount && originalPrice && originalPrice > price) {
      const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
      discount = `${pct}% OFF`;
    }

    const category = req.body.category || 'Unstitched';
    const subCategory = req.body.subCategory || '3 Piece';

    let sizes = null;
    if (req.body.sizes) {
      try {
        sizes = typeof req.body.sizes === 'string' ? JSON.parse(req.body.sizes) : req.body.sizes;
      } catch (e) {
        sizes = req.body.sizes.split(',').map(s => s.trim()).filter(Boolean);
      }
    } else if (category.toLowerCase().includes('ready')) {
      sizes = ['XS', 'S', 'M', 'L', 'XL'];
    }

    const fit = req.body.fit || (category.toLowerCase().includes('ready') ? 'Standard Fit' : '');

    const newProduct = {
      id: `prod-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title: req.body.title.trim(),
      category: category.trim(),
      subCategory: subCategory.trim(),
      price: price,
      originalPrice: originalPrice,
      discount: discount,
      image: imageUrl,
      fabric: req.body.fabric || 'Luxury Fabric',
      fit: fit,
      sizes: sizes,
      pieces: req.body.pieces || subCategory,
      color: req.body.color || 'Standard',
      sku: req.body.sku || `LM-${category.slice(0, 2).toUpperCase()}-${Date.now().toString().slice(-4)}`,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : true,
      inStock: req.body.inStock !== undefined ? (req.body.inStock === 'true' || req.body.inStock === true) : true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (isMongoConnected()) {
      try {
        await Product.create(newProduct);
      } catch (mongoErr) {
        console.warn("MongoDB product create error:", mongoErr.message);
      }
    }

    products.unshift(newProduct);
    writeProducts(products);
    logActivity('Product Created', `Added product "${newProduct.title}" (Rs. ${newProduct.price.toLocaleString()})`);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: newProduct
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: error.message || 'Failed to create product' });
  }
});

// PUT /api/products/:id - Update existing product
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const targetId = req.params.id;
    const products = readProducts();
    const index = products.findIndex(p => p.id === targetId || p._id === targetId);

    let existing = index !== -1 ? products[index] : null;

    if (!existing && isMongoConnected()) {
      try {
        const doc = await Product.findOne(buildIdFilter(targetId)).lean();
        if (doc) existing = doc;
      } catch (err) {
        console.warn('MongoDB find error in PUT:', err.message);
      }
    }

    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let imageUrl = existing.image;

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/products');
    } else if (req.body.image || req.body.imageUrl) {
      imageUrl = req.body.image || req.body.imageUrl;
    }

    const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : existing.price;
    const originalPrice = req.body.originalPrice !== undefined ? (req.body.originalPrice ? parseInt(req.body.originalPrice, 10) : null) : existing.originalPrice;
    let discount = req.body.discount !== undefined ? req.body.discount : existing.discount;

    if (discount === '' && originalPrice && originalPrice > price) {
      const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
      discount = `${pct}% OFF`;
    }

    let sizes = existing.sizes;
    if (req.body.sizes !== undefined) {
      if (!req.body.sizes) {
        sizes = null;
      } else {
        try {
          sizes = typeof req.body.sizes === 'string' ? JSON.parse(req.body.sizes) : req.body.sizes;
        } catch (e) {
          sizes = req.body.sizes ? req.body.sizes.split(',').map(s => s.trim()).filter(Boolean) : null;
        }
      }
    }

    const updated = stripMongoMeta({
      ...existing,
      title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
      category: req.body.category !== undefined ? req.body.category.trim() : existing.category,
      subCategory: req.body.subCategory !== undefined ? req.body.subCategory.trim() : existing.subCategory,
      price: price,
      originalPrice: originalPrice,
      discount: discount,
      image: imageUrl,
      fabric: req.body.fabric !== undefined ? req.body.fabric : existing.fabric,
      fit: req.body.fit !== undefined ? req.body.fit : existing.fit,
      sizes: sizes,
      pieces: req.body.pieces !== undefined ? req.body.pieces : existing.pieces,
      color: req.body.color !== undefined ? req.body.color : existing.color,
      sku: req.body.sku !== undefined ? req.body.sku : existing.sku,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      inStock: req.body.inStock !== undefined ? (req.body.inStock === 'true' || req.body.inStock === true) : existing.inStock,
      updatedAt: new Date().toISOString()
    });

    await upsertMongoDoc(Product, buildIdFilter(targetId), updated);

    if (index !== -1) {
      products[index] = updated;
    } else {
      products.unshift(updated);
    }
    try { fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}

    logActivity('Product Updated', `Updated product "${updated.title}"`);

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updated
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: error.message || 'Failed to update product' });
  }
});

// DELETE /api/products/:id - Delete a product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;
    let deletedTitle = '';

    // 1. Delete from MongoDB Atlas
    if (isMongoConnected()) {
      try {
        const mongoFilter = {
          $or: [
            { id: targetId },
            ...(mongoose.Types.ObjectId.isValid(targetId) ? [{ _id: targetId }] : [])
          ]
        };
        const existingInMongo = await Product.findOne(mongoFilter);
        if (existingInMongo) {
          found = true;
          deletedTitle = existingInMongo.title || '';
          await Product.deleteMany(mongoFilter);
          console.log(`[MongoDB] Deleted product "${deletedTitle}" (ID: ${targetId})`);
        }
      } catch (mongoErr) {
        console.error('Error deleting product from MongoDB:', mongoErr);
      }
    }

    // 2. Delete from local JSON / in-memory
    const products = readProducts();
    const index = products.findIndex(p => p.id === targetId || p._id === targetId);
    if (index !== -1) {
      found = true;
      const deleted = products[index];
      if (!deletedTitle) deletedTitle = deleted.title;

      if (deleted.image && deleted.image.startsWith('/uploads/')) {
        const filename = path.basename(deleted.image);
        if (filename !== 'user-limelight-banner.jpg') {
          const filePath = path.join(UPLOADS_DIR, filename);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          }
        }
      }

      products.splice(index, 1);
      try {
        fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
      } catch (err) {
        console.error('Error writing products file on delete:', err);
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Product not found' });
    }

    logActivity('Product Deleted', `Removed product "${deletedTitle || targetId}" (ID: ${targetId})`);

    res.json({
      success: true,
      message: 'Product deleted successfully',
      id: targetId
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: error.message || 'Failed to delete product' });
  }
});

// POST /api/products/reset - Reset products to default
app.post('/api/products/reset', async (req, res) => {
  try {
    if (isMongoConnected()) {
      await Product.deleteMany({});
      if (DEFAULT_PRODUCTS.length > 0) {
        await Product.insertMany(DEFAULT_PRODUCTS);
      }
    }
    writeProducts(DEFAULT_PRODUCTS);
    logActivity('Products Reset', 'Reset product catalog to default Limelight items');
    res.json({ success: true, message: 'Product catalog reset to defaults', products: DEFAULT_PRODUCTS });
  } catch (err) {
    console.error('Error resetting products:', err);
    res.status(500).json({ error: err.message || 'Failed to reset products' });
  }
});

// ================= CURATED COLLECTIONS API ROUTES =================

// GET /api/collections - Return all collections
app.get('/api/collections', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const collections = await readCollectionWithMongoFallback(Collection, readCollections, { order: 1 });
  const filtered = includeInactive ? collections : collections.filter(c => c.isActive !== false);
  filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(filtered);
});

// GET /api/collections/:id - Single collection
app.get('/api/collections/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const item = await Collection.findOne(buildIdFilter(targetId)).lean();
      if (item) return res.json(item);
      return res.status(404).json({ error: 'Collection not found' });
    } catch (err) {
      console.warn('MongoDB collection error:', err.message);
    }
  }
  const collections = readCollections();
  const item = collections.find(c => c.id === targetId);
  if (!item) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  res.json(item);
});

// POST /api/collections - Create a new collection
app.post('/api/collections', upload.single('image'), async (req, res) => {
  try {
    const collections = await readCollectionWithMongoFallback(Collection, readCollections);
    let imageUrl = req.body.image || req.body.imageUrl || '';

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/collections');
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'Collection photography (image file or URL) is required.' });
    }

    if (!req.body.title || !req.body.title.trim()) {
      return res.status(400).json({ error: 'Collection title is required.' });
    }

    const maxOrder = collections.reduce((max, c) => Math.max(max, c.order || 0), 0);

    const newCollection = {
      id: `col-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title: req.body.title.trim().toUpperCase(),
      tagline: req.body.tagline ? req.body.tagline.trim() : 'Curated seasonal edit',
      count: req.body.count ? req.body.count.trim() : '30+ Designs',
      linkText: req.body.linkText ? req.body.linkText.trim().toUpperCase() : 'EXPLORE NOW',
      linkUrl: req.body.linkUrl ? req.body.linkUrl.trim() : '#collections',
      image: imageUrl,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : true,
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Collection, { id: newCollection.id }, newCollection);
    collections.push(newCollection);
    try { fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(collections.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Collection Created', `Added curated collection "${newCollection.title}"`);

    res.status(201).json({
      success: true,
      message: 'Curated collection created successfully',
      collection: newCollection
    });
  } catch (error) {
    console.error('Error creating collection:', error);
    res.status(500).json({ error: error.message || 'Failed to create collection' });
  }
});

// PUT /api/collections/:id - Update existing collection
app.put('/api/collections/:id', upload.single('image'), async (req, res) => {
  try {
    const targetId = req.params.id;
    const collections = await readCollectionWithMongoFallback(Collection, readCollections);
    const index = collections.findIndex(c => c.id === targetId || String(c._id) === targetId);
    if (index === -1) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const existing = stripMongoMeta(collections[index]);
    let imageUrl = existing.image;

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/collections');
    } else if (req.body.image || req.body.imageUrl) {
      imageUrl = req.body.image || req.body.imageUrl;
    }

    const updated = {
      ...existing,
      title: req.body.title !== undefined ? req.body.title.trim().toUpperCase() : existing.title,
      tagline: req.body.tagline !== undefined ? req.body.tagline.trim() : existing.tagline,
      count: req.body.count !== undefined ? req.body.count.trim() : existing.count,
      linkText: req.body.linkText !== undefined ? req.body.linkText.trim().toUpperCase() : existing.linkText,
      linkUrl: req.body.linkUrl !== undefined ? req.body.linkUrl.trim() : existing.linkUrl,
      image: imageUrl,
      order: req.body.order !== undefined ? parseInt(req.body.order, 10) : existing.order,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Collection, buildIdFilter(targetId), updated);
    collections[index] = updated;
    try { fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(collections.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Collection Updated', `Updated collection "${updated.title}"`);

    res.json({
      success: true,
      message: 'Collection updated successfully',
      collection: updated
    });
  } catch (error) {
    console.error('Error updating collection:', error);
    res.status(500).json({ error: error.message || 'Failed to update collection' });
  }
});

// DELETE /api/collections/:id - Delete collection
app.delete('/api/collections/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;

    if (isMongoConnected()) {
      const delRes = await Collection.deleteMany(buildIdFilter(targetId));
      if (delRes.deletedCount > 0) found = true;
    }

    const collections = readCollections();
    const index = collections.findIndex(c => c.id === targetId || c._id === targetId);
    if (index !== -1) {
      found = true;
      const deleted = collections[index];
      collections.splice(index, 1);
      try {
        fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(collections, null, 2), 'utf-8');
      } catch (err) {
        console.error('Error writing collections file:', err);
      }
      logActivity('Collection Deleted', `Deleted collection "${deleted.title}"`);
    }

    if (!found) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    res.json({ success: true, message: 'Collection deleted successfully', id: targetId });
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({ error: error.message || 'Failed to delete collection' });
  }
});

app.post('/api/collections/reset', async (req, res) => {
  if (isMongoConnected()) {
    await Collection.deleteMany({});
    if (DEFAULT_COLLECTIONS.length > 0) await Collection.insertMany(DEFAULT_COLLECTIONS);
  }
  writeCollections(DEFAULT_COLLECTIONS);
  logActivity('Collections Reset', 'Reset curated collections to default items');
  res.json({ success: true, message: 'Curated collections reset to defaults', collections: DEFAULT_COLLECTIONS });
});

// POST /api/collections/reorder - Reorder collections
app.post('/api/collections/reorder', async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) {
      return res.status(400).json({ error: 'orderIds array is required' });
    }
    const collections = await readCollectionWithMongoFallback(Collection, readCollections);
    const map = new Map(collections.map(c => [c.id, stripMongoMeta(c)]));
    const reordered = [];
    orderIds.forEach((id, idx) => {
      const item = map.get(id);
      if (item) {
        item.order = idx + 1;
        item.updatedAt = new Date().toISOString();
        reordered.push(item);
        map.delete(id);
      }
    });
    map.forEach(item => reordered.push(item));
    await syncCollectionToMongo(Collection, reordered);
    try { fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(reordered, null, 2), 'utf-8'); } catch (e) {}
    logActivity('Collections Reordered', `Reordered ${reordered.length} collections`);
    res.json({ success: true, collections: reordered });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to reorder collections' });
  }
});

// ================= NEW ARRIVALS API ROUTES =================

// GET /api/new-arrivals - Return all new arrivals
app.get('/api/new-arrivals', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const category = req.query.category;

  if (isMongoConnected()) {
    try {
      const query = {};
      if (!includeInactive) {
        query.isActive = { $ne: false };
      }
      if (category && category.toUpperCase() !== 'ALL') {
        query.category = new RegExp(category, 'i');
      }
      const mongoItems = await NewArrival.find(query).sort({ order: 1, createdAt: -1 }).lean();
      return res.json(mongoItems || []);
    } catch (err) {
      console.warn('MongoDB new-arrivals query error:', err.message);
    }
  }

  const items = readNewArrivals();
  let filtered = includeInactive ? items : items.filter(i => i.isActive !== false);

  if (category && category.toUpperCase() !== 'ALL') {
    filtered = filtered.filter(i => i.category.toUpperCase().includes(category.toUpperCase()));
  }

  res.json(filtered);
});

// GET /api/new-arrivals/:id - Single new arrival
app.get('/api/new-arrivals/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const item = await NewArrival.findOne(buildIdFilter(targetId)).lean();
      if (item) return res.json(item);
      return res.status(404).json({ error: 'New arrival item not found' });
    } catch (err) {}
  }
  const items = readNewArrivals();
  const item = items.find(i => i.id === targetId);
  if (!item) {
    return res.status(404).json({ error: 'New arrival item not found' });
  }
  res.json(item);
});

// POST /api/new-arrivals - Create new arrival
app.post('/api/new-arrivals', upload.single('image'), async (req, res) => {
  try {
    const items = await readCollectionWithMongoFallback(NewArrival, readNewArrivals);
    let imageUrl = req.body.image || req.body.imageUrl || '';

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/new-arrivals');
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'Product photography is required.' });
    }

    if (!req.body.title || !req.body.title.trim()) {
      return res.status(400).json({ error: 'Product title is required.' });
    }

    const price = parseInt(req.body.price, 10) || 0;
    const originalPrice = req.body.originalPrice ? parseInt(req.body.originalPrice, 10) : null;
    let discount = req.body.discount ? req.body.discount.trim() : '';

    if (!discount && originalPrice && originalPrice > price) {
      const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
      discount = `${pct}% OFF`;
    }

    const category = req.body.category || 'Unstitched';

    const newItem = {
      id: `na-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title: req.body.title.trim(),
      category: category.trim(),
      price: price,
      originalPrice: originalPrice,
      discount: discount,
      badge: req.body.badge ? req.body.badge.trim().toUpperCase() : 'NEW IN',
      image: imageUrl,
      fabric: req.body.fabric || 'Luxury Material',
      sku: req.body.sku || `NA-${category.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : true,
      inStock: req.body.inStock !== undefined ? (req.body.inStock === 'true' || req.body.inStock === true) : true,
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (isMongoConnected()) {
      await NewArrival.create(newItem);
    }

    items.unshift(newItem);
    try { fs.writeFileSync(NEW_ARRIVALS_FILE, JSON.stringify(items.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('New Arrival Created', `Added "${newItem.title}" (${newItem.badge})`);

    res.status(201).json({
      success: true,
      message: 'New Arrival created successfully',
      item: newItem
    });
  } catch (error) {
    console.error('Error creating new arrival:', error);
    res.status(500).json({ error: error.message || 'Failed to create new arrival' });
  }
});

// PUT /api/new-arrivals/:id - Update existing new arrival
app.put('/api/new-arrivals/:id', upload.single('image'), async (req, res) => {
  try {
    const targetId = req.params.id;
    const items = await readCollectionWithMongoFallback(NewArrival, readNewArrivals);
    const index = items.findIndex(i => i.id === targetId || String(i._id) === targetId);
    if (index === -1) {
      return res.status(404).json({ error: 'New arrival item not found' });
    }

    const existing = stripMongoMeta(items[index]);
    let imageUrl = existing.image;

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/new-arrivals');
    } else if (req.body.image || req.body.imageUrl) {
      imageUrl = req.body.image || req.body.imageUrl;
    }

    const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : existing.price;
    const originalPrice = req.body.originalPrice !== undefined ? (req.body.originalPrice ? parseInt(req.body.originalPrice, 10) : null) : existing.originalPrice;
    let discount = req.body.discount !== undefined ? req.body.discount : existing.discount;

    if (discount === '' && originalPrice && originalPrice > price) {
      const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
      discount = `${pct}% OFF`;
    }

    const updated = {
      ...existing,
      title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
      category: req.body.category !== undefined ? req.body.category.trim() : existing.category,
      price: price,
      originalPrice: originalPrice,
      discount: discount,
      badge: req.body.badge !== undefined ? req.body.badge.trim().toUpperCase() : existing.badge,
      image: imageUrl,
      fabric: req.body.fabric !== undefined ? req.body.fabric : existing.fabric,
      sku: req.body.sku !== undefined ? req.body.sku : existing.sku,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      inStock: req.body.inStock !== undefined ? (req.body.inStock === 'true' || req.body.inStock === true) : existing.inStock,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(NewArrival, buildIdFilter(targetId), updated);
    items[index] = updated;
    try { fs.writeFileSync(NEW_ARRIVALS_FILE, JSON.stringify(items.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('New Arrival Updated', `Updated "${updated.title}"`);

    res.json({
      success: true,
      message: 'New arrival updated successfully',
      item: updated
    });
  } catch (error) {
    console.error('Error updating new arrival:', error);
    res.status(500).json({ error: error.message || 'Failed to update new arrival' });
  }
});

// DELETE /api/new-arrivals/:id - Delete new arrival
app.delete('/api/new-arrivals/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;

    if (isMongoConnected()) {
      const delRes = await NewArrival.deleteMany(buildIdFilter(targetId));
      if (delRes.deletedCount > 0) found = true;
    }

    const items = readNewArrivals();
    const index = items.findIndex(i => i.id === targetId || i._id === targetId);
    if (index !== -1) {
      found = true;
      const deleted = items[index];
      items.splice(index, 1);
      try { fs.writeFileSync(NEW_ARRIVALS_FILE, JSON.stringify(items, null, 2), 'utf-8'); } catch (e) {}
      logActivity('New Arrival Deleted', `Deleted "${deleted.title}"`);
    }

    if (!found) {
      return res.status(404).json({ error: 'New arrival not found' });
    }

    res.json({ success: true, message: 'New arrival deleted successfully', id: targetId });
  } catch (error) {
    console.error('Error deleting new arrival:', error);
    res.status(500).json({ error: error.message || 'Failed to delete new arrival' });
  }
});

// POST /api/new-arrivals/reset - Reset to defaults
app.post('/api/new-arrivals/reset', async (req, res) => {
  if (isMongoConnected()) {
    await NewArrival.deleteMany({});
    if (DEFAULT_NEW_ARRIVALS.length > 0) await NewArrival.insertMany(DEFAULT_NEW_ARRIVALS);
  }
  writeNewArrivals(DEFAULT_NEW_ARRIVALS);
  logActivity('New Arrivals Reset', 'Reset new arrivals to default items');
  res.json({ success: true, message: 'New arrivals reset to defaults', items: DEFAULT_NEW_ARRIVALS });
});

// ================= ORDERS API ROUTES =================

// GET /api/orders - Return all orders
app.get('/api/orders', async (req, res) => {
  const orders = await readCollectionWithMongoFallback(Order, readOrders);
  const status = req.query.status;
  let filtered = orders;
  if (status && status.toUpperCase() !== 'ALL') {
    filtered = filtered.filter(o => o.status?.toLowerCase() === status.toLowerCase());
  }
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(filtered);
});

// GET /api/orders/:id - Single order
app.get('/api/orders/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const order = await Order.findOne(buildIdFilter(targetId)).lean();
      if (order) return res.json(order);
      return res.status(404).json({ error: 'Order not found' });
    } catch (err) {}
  }
  const orders = readOrders();
  const order = orders.find(o => o.id === targetId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// POST /api/orders - Create new order from Storefront checkout
app.post('/api/orders', async (req, res) => {
  try {
    const orders = await readCollectionWithMongoFallback(Order, readOrders);
    const { customer, items, subtotal, shipping, total, paymentMethod, source } = req.body;

    if (!customer || !customer.name || !customer.phone || !customer.address || !customer.city) {
      return res.status(400).json({ error: 'Customer name, phone, address, and city are required.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required in the order.' });
    }

    const orderId = req.body.id || `LM-${Math.floor(100000 + Math.random() * 900000)}`;

    const newOrder = {
      id: orderId,
      createdAt: new Date().toISOString(),
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: customer.email ? customer.email.trim() : '',
        address: customer.address.trim(),
        city: customer.city.trim(),
        province: customer.province || 'Pakistan',
        notes: customer.notes ? customer.notes.trim() : ''
      },
      items: items.map(it => ({
        id: it.id,
        title: it.title,
        category: it.category || 'Product',
        price: it.price,
        quantity: it.quantity || 1,
        selectedSize: it.selectedSize || null,
        fabric: it.fabric || '',
        image: it.image || ''
      })),
      subtotal: subtotal !== undefined ? subtotal : items.reduce((sum, it) => sum + (it.price * (it.quantity || 1)), 0),
      shipping: shipping !== undefined ? shipping : (subtotal >= 2490 ? 0 : 250),
      total: total !== undefined ? total : (subtotal + (subtotal >= 2490 ? 0 : 250)),
      paymentMethod: paymentMethod || 'Cash on Delivery',
      status: 'Pending',
      source: source || 'Storefront Direct Order',
      userId: req.body.userId || null,
      userEmail: req.body.userEmail || (customer && customer.email) || null,
      isRegisteredUser: Boolean(req.body.isRegisteredUser || req.body.userId)
    };

    await upsertMongoDoc(Order, { id: newOrder.id }, newOrder);
    orders.unshift(newOrder);
    try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Order Placed', `Order #${newOrder.id} placed by ${newOrder.customer.name} (Rs. ${newOrder.total.toLocaleString()})`);

    res.status(201).json({ success: true, message: 'Order placed successfully', order: newOrder });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message || 'Failed to place order' });
  }
});

// PUT /api/orders/:id - Update order status
app.put('/api/orders/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    const orders = await readCollectionWithMongoFallback(Order, readOrders);
    const index = orders.findIndex(o => o.id === targetId || String(o._id) === targetId);
    if (index === -1) return res.status(404).json({ error: 'Order not found' });

    const existing = stripMongoMeta(orders[index]);
    const updated = {
      ...existing,
      status: req.body.status || existing.status,
      customer: req.body.customer ? { ...existing.customer, ...req.body.customer } : existing.customer,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Order, buildIdFilter(targetId), updated);
    orders[index] = updated;
    try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Order Updated', `Order #${updated.id} status changed to ${updated.status}`);

    res.json({ success: true, message: 'Order updated successfully', order: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update order' });
  }
});

// DELETE /api/orders/:id - Delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;
    if (isMongoConnected()) {
      const delRes = await Order.deleteMany(buildIdFilter(targetId));
      if (delRes.deletedCount > 0) found = true;
    }

    const orders = readOrders();
    const index = orders.findIndex(o => o.id === targetId || o._id === targetId);
    if (index !== -1) {
      found = true;
      orders.splice(index, 1);
      try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8'); } catch (e) {}
    }

    if (!found) return res.status(404).json({ error: 'Order not found' });

    logActivity('Order Deleted', `Order #${targetId} deleted`);
    res.json({ success: true, message: 'Order deleted successfully', id: targetId });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete order' });
  }
});

// POST /api/orders/reset - Reset orders to default sample
app.post('/api/orders/reset', async (req, res) => {
  if (isMongoConnected()) {
    await Order.deleteMany({});
  }
  writeOrders(DEFAULT_ORDERS);
  logActivity('Orders Reset', 'Reset orders to default empty list');
  res.json({ success: true, message: 'Orders reset to defaults', orders: DEFAULT_ORDERS });
});

// ================= CUSTOMER AUTH & USER MANAGEMENT ROUTES =================

// GET /api/users - Return all registered customers enriched with orders and lifetime spend
app.get('/api/users', (req, res) => {
  try {
    const users = readUsers();
    const orders = readOrders();

    const enriched = users.map(user => {
      const userOrders = orders.filter(o =>
        o.userId === user.id ||
        (o.customer?.email && user.email && o.customer.email.toLowerCase() === user.email.toLowerCase()) ||
        (o.customer?.phone && user.phone && o.customer.phone.replace(/[^0-9]/g, '') === user.phone.replace(/[^0-9]/g, ''))
      );

      const totalSpent = userOrders
        .filter(o => o.status !== 'Cancelled')
        .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

      const { password, ...safeUser } = user;
      return {
        ...safeUser,
        orderCount: userOrders.length,
        totalSpent,
        lastOrder: userOrders[0] || null
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/:id - Single customer with order history
app.get('/api/users/:id', (req, res) => {
  try {
    const users = readUsers();
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Customer not found' });

    const orders = readOrders();
    const userOrders = orders.filter(o =>
      o.userId === user.id ||
      (o.customer?.email && user.email && o.customer.email.toLowerCase() === user.email.toLowerCase()) ||
      (o.customer?.phone && user.phone && o.customer.phone.replace(/[^0-9]/g, '') === user.phone.replace(/[^0-9]/g, ''))
    );

    const { password, ...safeUser } = user;
    res.json({
      ...safeUser,
      orders: userOrders,
      totalSpent: userOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total) || 0), 0)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer profile' });
  }
});

// POST /api/auth/register - Register a new customer
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, phone, password, city, address, province } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const users = readUsers();
    const existing = users.find(u =>
      u.email.toLowerCase() === email.trim().toLowerCase() ||
      (phone && u.phone && u.phone.replace(/[^0-9]/g, '') === phone.replace(/[^0-9]/g, ''))
    );

    if (existing) {
      return res.status(400).json({ error: 'An account with this email or mobile number already exists' });
    }

    const newUser = {
      id: `usr-${Date.now().toString().slice(-6)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      password: password.trim(),
      city: city || 'Lahore',
      address: address ? address.trim() : '',
      province: province || 'Punjab',
      status: 'Active',
      role: 'customer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    users.unshift(newUser);
    writeUsers(users);
    logActivity('User Registered', `New customer account: ${newUser.name} (${newUser.email})`);

    const { password: _, ...safeUser } = newUser;
    res.status(201).json({ success: true, message: 'Account registered successfully', user: safeUser });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// POST /api/auth/login - Customer sign in
app.post('/api/auth/login', (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Please enter your email or mobile number' });
    }

    const users = readUsers();
    const cleanId = identifier.trim().toLowerCase();
    const cleanDigits = identifier.replace(/[^0-9]/g, '');

    const user = users.find(u =>
      u.email.toLowerCase() === cleanId ||
      (cleanDigits.length >= 7 && u.phone.replace(/[^0-9]/g, '').includes(cleanDigits))
    );

    if (!user) {
      return res.status(401).json({ error: 'No customer account found with this email or mobile number' });
    }

    if (password && user.password && user.password !== password) {
      return res.status(401).json({ error: 'Invalid password. Please check and try again.' });
    }

    logActivity('User Login', `Customer logged in: ${user.name} (${user.id})`);
    const { password: _, ...safeUser } = user;
    res.json({ success: true, message: 'Welcome back!', user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// PUT /api/users/:id - Update customer profile / status
app.put('/api/users/:id', (req, res) => {
  try {
    const users = readUsers();
    const index = users.findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Customer not found' });

    const existing = users[index];
    const updated = {
      ...existing,
      ...req.body,
      id: existing.id,
      updatedAt: new Date().toISOString()
    };

    users[index] = updated;
    writeUsers(users);
    logActivity('User Updated', `Customer profile updated: ${updated.name}`);

    const { password, ...safeUser } = updated;
    res.json({ success: true, message: 'Customer updated', user: safeUser });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// DELETE /api/users/:id - Delete customer
app.delete('/api/users/:id', (req, res) => {
  try {
    const users = readUsers();
    const index = users.findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Customer not found' });

    const deleted = users.splice(index, 1)[0];
    writeUsers(users);
    logActivity('User Deleted', `Customer account deleted: ${deleted.name} (${deleted.id})`);

    res.json({ success: true, message: 'Customer deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// GET /api/orders/track/:query - Track order by Order ID, Phone or Email
app.get('/api/orders/track/:query', (req, res) => {
  try {
    const rawQuery = req.params.query.trim();
    const query = rawQuery.toLowerCase();
    const orders = readOrders();
    const cleanDigits = rawQuery.replace(/[^0-9]/g, '');

    const matches = orders.filter(o =>
      o.id.toLowerCase() === query ||
      o.id.toLowerCase() === `lm-${query}` ||
      o.id.toLowerCase().replace(/[^a-z0-9]/g, '') === query.replace(/[^a-z0-9]/g, '') ||
      (o.customer?.email && o.customer.email.toLowerCase() === query) ||
      (cleanDigits.length >= 7 && o.customer?.phone && o.customer.phone.replace(/[^0-9]/g, '').includes(cleanDigits))
    );

    if (matches.length === 0) {
      return res.status(404).json({ error: `No active order found for "${rawQuery}"` });
    }

    const enriched = matches.map(order => {
      const status = order.status || 'Pending';
      const isConfirmed = ['Confirmed', 'Shipped', 'Delivered'].includes(status);
      const isShipped = ['Shipped', 'Delivered'].includes(status);
      const isDelivered = status === 'Delivered';
      const isCancelled = status === 'Cancelled';

      const timeline = [
        {
          id: 'step-1',
          title: 'Order Placed & Received',
          desc: 'Your order was successfully recorded in the Zimal Collection (www.zimalcollection.com) system.',
          completed: true,
          date: order.createdAt || order.date
        },
        {
          id: 'step-2',
          title: 'Confirmed & Warehouse Quality Check',
          desc: 'Our dispatch team confirmed your items and passed quality inspection.',
          completed: isConfirmed && !isCancelled,
          active: status === 'Pending' && !isCancelled,
          date: isConfirmed ? (order.updatedAt || order.createdAt) : null
        },
        {
          id: 'step-3',
          title: 'Dispatched via Trax Express Courier',
          desc: 'Parcel handed over to courier. Trax Tracking Slip attached.',
          completed: isShipped && !isCancelled,
          active: status === 'Confirmed' && !isCancelled,
          trackingNumber: `TRX-${order.id}-PK`
        },
        {
          id: 'step-4',
          title: 'Out for Doorstep Delivery',
          desc: 'Courier rider is on the way to your delivery address.',
          completed: isDelivered && !isCancelled,
          active: status === 'Shipped' && !isCancelled
        },
        {
          id: 'step-5',
          title: isCancelled ? 'Order Cancelled' : 'Delivered & Payment Collected',
          desc: isCancelled
            ? 'This order has been cancelled by store administration.'
            : 'Package delivered and Cash on Delivery collected.',
          completed: isDelivered,
          cancelled: isCancelled,
          active: status === 'Delivered'
        }
      ];

      return {
        ...order,
        timeline
      };
    });

    res.json({ success: true, count: enriched.length, orders: enriched });
  } catch (error) {
    console.error('Tracking error:', error);
    res.status(500).json({ error: 'Failed to retrieve tracking information' });
  }
});

// ================= NAVIGATION ROUTES API =================

// GET /api/navigation - Return all routes (with mapped product counts)
app.get('/api/navigation', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const [nav, products] = await Promise.all([
    readCollectionWithMongoFallback(Navigation, readNavigation, { order: 1 }),
    readCollectionWithMongoFallback(Product, readProducts)
  ]);

  let list = includeInactive ? nav : nav.filter(n => n.isActive !== false);
  list.sort((a, b) => (a.order || 0) - (b.order || 0));

  const enriched = list.map(item => {
    const matchingProducts = products.filter(p =>
      (p.category && p.category.toLowerCase() === item.name.toLowerCase()) ||
      (p.subCategory && p.subCategory.toLowerCase() === item.name.toLowerCase()) ||
      (item.slug && p.category && p.category.toLowerCase().includes(item.slug.toLowerCase()))
    );
    return {
      ...item,
      productCount: matchingProducts.length
    };
  });

  res.json(enriched);
});

// GET /api/navigation/:id - Single route
app.get('/api/navigation/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const item = await Navigation.findOne(buildIdFilter(targetId)).lean();
      if (item) return res.json(item);
      return res.status(404).json({ error: 'Route not found' });
    } catch (err) {}
  }
  const nav = readNavigation();
  const item = nav.find(n => n.id === targetId);
  if (!item) return res.status(404).json({ error: 'Route not found' });
  res.json(item);
});

// POST /api/navigation - Add new route
app.post('/api/navigation', async (req, res) => {
  try {
    const { name, href, slug, isSale, description, isActive } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Route name is required' });
    }

    const nav = await readCollectionWithMongoFallback(Navigation, readNavigation);
    const cleanName = name.trim().toUpperCase();
    const cleanSlug = slug ? slug.trim().toLowerCase().replace(/\s+/g, '-') : cleanName.toLowerCase().replace(/\s+/g, '-');

    const newRoute = {
      id: `nav-${Date.now().toString().slice(-6)}`,
      name: cleanName,
      slug: cleanSlug,
      href: href && href.trim() ? href.trim() : `#${cleanSlug}`,
      isSale: Boolean(isSale),
      order: nav.length + 1,
      isActive: isActive !== false,
      description: description ? description.trim() : '',
      createdAt: new Date().toISOString()
    };

    await upsertMongoDoc(Navigation, { id: newRoute.id }, newRoute);
    nav.push(newRoute);
    try { fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(nav.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Route Added', `Added new navigation route: ${newRoute.name} (${newRoute.href})`);

    res.status(201).json({ success: true, message: 'Route added successfully', route: newRoute });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to add route' });
  }
});

// PUT /api/navigation/:id - Update route
app.put('/api/navigation/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    const nav = await readCollectionWithMongoFallback(Navigation, readNavigation);
    const index = nav.findIndex(n => n.id === targetId || String(n._id) === targetId);
    if (index === -1) return res.status(404).json({ error: 'Route not found' });

    const existing = stripMongoMeta(nav[index]);
    const updated = {
      ...existing,
      ...stripMongoMeta(req.body),
      id: existing.id,
      name: req.body.name ? req.body.name.trim().toUpperCase() : existing.name,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Navigation, buildIdFilter(targetId), updated);
    nav[index] = updated;
    try { fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(nav.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Route Updated', `Updated navigation route: ${updated.name}`);

    res.json({ success: true, message: 'Route updated successfully', route: updated });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update route' });
  }
});

// DELETE /api/navigation/:id - Delete route
app.delete('/api/navigation/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;
    if (isMongoConnected()) {
      const delRes = await Navigation.deleteMany(buildIdFilter(targetId));
      if (delRes.deletedCount > 0) found = true;
    }

    const nav = readNavigation();
    const index = nav.findIndex(n => n.id === targetId || n._id === targetId);
    if (index !== -1) {
      found = true;
      nav.splice(index, 1);
      try { fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(nav, null, 2), 'utf-8'); } catch (e) {}
    }

    if (!found) return res.status(404).json({ error: 'Route not found' });

    logActivity('Route Deleted', `Deleted navigation route (ID: ${targetId})`);
    res.json({ success: true, message: 'Route deleted successfully', id: targetId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete route' });
  }
});

// POST /api/navigation/reorder - Reorder routes
app.post('/api/navigation/reorder', async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    const nav = (await readCollectionWithMongoFallback(Navigation, readNavigation)).map(stripMongoMeta);
    nav.forEach(item => {
      const idx = orderIds.indexOf(item.id);
      if (idx !== -1) item.order = idx + 1;
    });

    await syncCollectionToMongo(Navigation, nav);
    try { fs.writeFileSync(NAVIGATION_FILE, JSON.stringify(nav, null, 2), 'utf-8'); } catch (e) {}
    res.json({ success: true, message: 'Routes reordered', navigation: nav });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder routes' });
  }
});

// ================= BRANDING & SETTINGS API =================

// GET /api/settings - Return site settings & branding
app.get('/api/settings', async (req, res) => {
  if (isMongoConnected()) {
    try {
      const mongoSetting = await Setting.findOne({ key: 'site_settings' }).lean();
      if (mongoSetting) {
        const { _id, __v, key, ...rest } = mongoSetting;
        return res.json(rest);
      }
    } catch (err) {}
  }
  res.json(readSettings());
});

// PUT /api/settings - Update site settings & branding
app.put('/api/settings', async (req, res) => {
  try {
    let current = readSettings();
    if (isMongoConnected()) {
      const mongoSetting = await Setting.findOne({ key: 'site_settings' }).lean();
      if (mongoSetting) current = stripMongoMeta(mongoSetting);
    }
    const updated = stripMongoMeta({
      ...current,
      ...stripMongoMeta(req.body),
      updatedAt: new Date().toISOString()
    });
    if (isMongoConnected()) {
      await Setting.updateOne({ key: 'site_settings' }, { $set: { key: 'site_settings', ...updated } }, { upsert: true });
    }
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8'); } catch (e) {}
    logActivity('Settings Updated', 'Brand settings and logo configuration updated');
    res.json({ success: true, message: 'Settings saved successfully', settings: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST /api/settings/logo-upload - Upload custom image logo
app.post('/api/settings/logo-upload', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No logo file provided' });
    const logoUrl = await processUploadedImage(req.file, 'limelight/logos');

    let current = readSettings();
    if (isMongoConnected()) {
      const mongoSetting = await Setting.findOne({ key: 'site_settings' }).lean();
      if (mongoSetting) current = stripMongoMeta(mongoSetting);
    }
    current.logoType = 'image';
    current.imageLogo = {
      ...current.imageLogo,
      url: logoUrl
    };
    current.updatedAt = new Date().toISOString();
    if (isMongoConnected()) {
      await Setting.updateOne({ key: 'site_settings' }, { $set: { key: 'site_settings', ...stripMongoMeta(current) } }, { upsert: true });
    }
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2), 'utf-8'); } catch (e) {}

    logActivity('Logo Uploaded', `Uploaded custom logo to Cloudinary: ${logoUrl}`);
    res.json({ success: true, message: 'Logo uploaded successfully', logoUrl, settings: current });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Logo upload failed' });
  }
});

// ================= HOMEPAGE SECTIONS ORGANIZER API =================

// GET /api/sections - Return homepage sections list in order
app.get('/api/sections', async (req, res) => {
  const sections = await readCollectionWithMongoFallback(Section, readSections, { order: 1 });
  sections.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(sections);
});

// POST /api/sections/reorder - Reorder homepage sections
app.post('/api/sections/reorder', async (req, res) => {
  try {
    const { sectionIds, sections } = req.body;
    let current = await readCollectionWithMongoFallback(Section, readSections, { order: 1 });

    if (Array.isArray(sections)) {
      current = sections.map((sec, idx) => ({
        ...stripMongoMeta(sec),
        order: idx + 1
      }));
    } else if (Array.isArray(sectionIds)) {
      current = current.map(stripMongoMeta);
      current.forEach(sec => {
        const idx = sectionIds.indexOf(sec.id);
        if (idx !== -1) sec.order = idx + 1;
      });
      current.sort((a, b) => (a.order || 0) - (b.order || 0));
    } else {
      return res.status(400).json({ error: 'sectionIds or sections array is required' });
    }

    await syncCollectionToMongo(Section, current);
    try { fs.writeFileSync(SECTIONS_FILE, JSON.stringify(current, null, 2), 'utf-8'); } catch (e) {}
    logActivity('Sections Reordered', 'Homepage sections display order updated');
    res.json({ success: true, message: 'Sections order saved successfully', sections: current });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reorder sections' });
  }
});

// PUT /api/sections/:id - Toggle enable / update section
app.put('/api/sections/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    const sections = await readCollectionWithMongoFallback(Section, readSections, { order: 1 });
    const index = sections.findIndex(s => s.id === targetId);
    if (index === -1) return res.status(404).json({ error: 'Section not found' });

    const existing = stripMongoMeta(sections[index]);
    const updated = {
      ...existing,
      ...stripMongoMeta(req.body),
      id: existing.id
    };

    await upsertMongoDoc(Section, { id: existing.id }, updated);
    sections[index] = updated;
    try { fs.writeFileSync(SECTIONS_FILE, JSON.stringify(sections.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Section Updated', `Updated section "${updated.name}"`);
    res.json({ success: true, message: 'Section updated', section: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// POST /api/sections/reset - Reset sections to default order
app.post('/api/sections/reset', async (req, res) => {
  if (isMongoConnected()) {
    await Section.deleteMany({});
    await Section.insertMany(DEFAULT_SECTIONS);
  }
  writeSections(DEFAULT_SECTIONS);
  logActivity('Sections Reset', 'Reset homepage sections to default order');
  res.json({ success: true, message: 'Sections reset to default order', sections: DEFAULT_SECTIONS });
});

// ================= FOOTER & NEWSLETTER SUBSCRIBERS API =================

// GET /api/footer - Return complete footer & newsletter configuration
app.get('/api/footer', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const mongoFooter = await Footer.findOne({ key: 'site_footer' }).lean();
      if (mongoFooter) {
        const { _id, __v, key, ...rest } = mongoFooter;
        return res.json(rest);
      }
    }
    res.json(readFooter());
  } catch (err) {
    console.warn('Footer fetch fallback:', err.message);
    res.json(readFooter());
  }
});

// PUT /api/footer - Update footer content, contact info and newsletter texts
app.put('/api/footer', async (req, res) => {
  try {
    const updatedFooter = req.body;
    writeFooter(updatedFooter);

    if (isMongoConnected()) {
      await Footer.findOneAndUpdate(
        { key: 'site_footer' },
        { $set: { ...updatedFooter, key: 'site_footer' } },
        { upsert: true, new: true }
      );
    }

    logActivity('Footer Updated', 'Updated footer content, contact hotline and newsletter settings');
    res.json({ success: true, message: 'Footer content updated successfully', footer: updatedFooter });
  } catch (err) {
    console.error('Error updating footer:', err);
    res.status(500).json({ error: 'Failed to update footer' });
  }
});

// POST /api/footer/reset - Reset footer to default configuration
app.post('/api/footer/reset', async (req, res) => {
  try {
    writeFooter(DEFAULT_FOOTER);
    if (isMongoConnected()) {
      await Footer.findOneAndUpdate(
        { key: 'site_footer' },
        { $set: { ...DEFAULT_FOOTER, key: 'site_footer' } },
        { upsert: true, new: true }
      );
    }
    logActivity('Footer Reset', 'Reset footer to original default layout');
    res.json({ success: true, message: 'Footer reset to default layout', footer: DEFAULT_FOOTER });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset footer' });
  }
});

// GET /api/newsletter/subscribers - List all subscribers
app.get('/api/newsletter/subscribers', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const mongoSubs = await Subscriber.find().sort({ subscribedAt: -1 }).lean();
      if (mongoSubs && mongoSubs.length > 0) {
        return res.json(mongoSubs.map(s => ({
          id: s.id,
          email: s.email,
          status: s.status || 'active',
          source: s.source || 'Storefront Newsletter',
          subscribedAt: s.subscribedAt || s.createdAt
        })));
      }
    }
    res.json(readSubscribers());
  } catch (err) {
    res.json(readSubscribers());
  }
});

// POST /api/newsletter/subscribe - Public customer subscription
app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email, source } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const subscribers = readSubscribers();

    // Check if duplicate
    const existing = subscribers.find(s => s.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.json({
        success: true,
        alreadySubscribed: true,
        message: 'You are already subscribed to www.zimalcollection.com newsletter!'
      });
    }

    const newSub = {
      id: `sub-${Date.now()}`,
      email: cleanEmail,
      status: 'active',
      source: source || 'Storefront Footer',
      subscribedAt: new Date().toISOString()
    };

    subscribers.unshift(newSub);
    writeSubscribers(subscribers);

    if (isMongoConnected()) {
      await Subscriber.findOneAndUpdate(
        { email: cleanEmail },
        { $set: newSub },
        { upsert: true, new: true }
      );
    }

    logActivity('New Subscriber', `New newsletter subscriber: ${cleanEmail}`);
    res.status(201).json({
      success: true,
      message: 'Thank you for subscribing to Zimal Collection updates! Check your inbox for your welcome voucher.',
      subscriber: newSub
    });
  } catch (err) {
    console.error('Newsletter subscription error:', err);
    res.status(500).json({ error: 'Failed to subscribe to newsletter' });
  }
});

// POST /api/newsletter/subscribers - Admin manual subscriber add
app.post('/api/newsletter/subscribers', async (req, res) => {
  try {
    const { email, source, status } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const subscribers = readSubscribers();

    const existing = subscribers.find(s => s.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'This email is already registered as a subscriber' });
    }

    const newSub = {
      id: `sub-${Date.now()}`,
      email: cleanEmail,
      status: status || 'active',
      source: source || 'Admin Manual Entry',
      subscribedAt: new Date().toISOString()
    };

    subscribers.unshift(newSub);
    writeSubscribers(subscribers);

    if (isMongoConnected()) {
      await Subscriber.findOneAndUpdate(
        { email: cleanEmail },
        { $set: newSub },
        { upsert: true, new: true }
      );
    }

    logActivity('Subscriber Added', `Admin added subscriber: ${cleanEmail}`);
    res.status(201).json({ success: true, message: 'Subscriber added successfully', subscriber: newSub });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to add subscriber' });
  }
});

// DELETE /api/newsletter/subscribers/:id - Remove subscriber
app.delete('/api/newsletter/subscribers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const subscribers = readSubscribers();
    const filtered = subscribers.filter(s => s.id !== id && s.email !== id);

    if (subscribers.length === filtered.length) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    writeSubscribers(filtered);

    if (isMongoConnected()) {
      await Subscriber.deleteOne({ $or: [{ id }, { email: id }] });
    }

    logActivity('Subscriber Removed', `Removed subscriber ${id}`);
    res.json({ success: true, message: 'Subscriber removed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove subscriber' });
  }
});

// GET /api/activities - Recent admin activity logs
app.get('/api/activities', (req, res) => {
  res.json(getActivities());
});

// GET /api/slides - Return all slides sorted by order
app.get('/api/slides', async (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const slides = await readCollectionWithMongoFallback(Slide, readSlides, { order: 1 });
  const filtered = includeInactive ? slides : slides.filter(s => s.isActive !== false);
  filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(filtered);
});

// GET /api/slides/:id - Single slide
app.get('/api/slides/:id', async (req, res) => {
  const targetId = req.params.id;
  if (isMongoConnected()) {
    try {
      const slide = await Slide.findOne(buildIdFilter(targetId)).lean();
      if (slide) return res.json(slide);
      return res.status(404).json({ error: 'Slide not found' });
    } catch (err) {}
  }
  const slides = readSlides();
  const slide = slides.find(s => s.id === targetId);
  if (!slide) {
    return res.status(404).json({ error: 'Slide not found' });
  }
  res.json(slide);
});

// POST /api/slides - Upload and create a new slide
app.post('/api/slides', upload.single('image'), async (req, res) => {
  try {
    const slides = await readCollectionWithMongoFallback(Slide, readSlides);
    let imageUrl = req.body.imageUrl || '';

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/slides');
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'An image file or imageUrl is required.' });
    }

    const newSlide = {
      id: `slide-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      badge: req.body.badge || 'NEW ARRIVAL',
      scriptText: req.body.scriptText || 'Signature',
      title: req.body.title || 'NEW COLLECTION',
      subtitle: req.body.subtitle || '',
      primaryBtnText: req.body.primaryBtnText || 'SHOP NOW',
      primaryBtnLink: req.body.primaryBtnLink || '#unstitched',
      secondaryBtnText: req.body.secondaryBtnText || 'EXPLORE',
      secondaryBtnLink: req.body.secondaryBtnLink || '#ready-to-wear',
      imageUrl: imageUrl,
      order: slides.length > 0 ? Math.max(...slides.map(s => s.order || 0)) + 1 : 1,
      isActive: req.body.isActive !== undefined ? req.body.isActive === 'true' || req.body.isActive === true : true,
      createdAt: new Date().toISOString()
    };

    await upsertMongoDoc(Slide, { id: newSlide.id }, newSlide);
    slides.push(newSlide);
    try { fs.writeFileSync(SLIDES_FILE, JSON.stringify(slides.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Slide Published', `Uploaded new slide "${newSlide.title}"`);

    res.status(201).json({
      success: true,
      message: 'Slide created successfully',
      slide: newSlide
    });
  } catch (error) {
    console.error('Error creating slide:', error);
    res.status(500).json({ error: error.message || 'Failed to create slide' });
  }
});

// PUT /api/slides/:id - Update an existing slide
app.put('/api/slides/:id', upload.single('image'), async (req, res) => {
  try {
    const targetId = req.params.id;
    const slides = await readCollectionWithMongoFallback(Slide, readSlides);
    const index = slides.findIndex(s => s.id === targetId || String(s._id) === targetId);
    if (index === -1) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    const existing = stripMongoMeta(slides[index]);
    let imageUrl = existing.imageUrl;

    if (req.file) {
      imageUrl = await processUploadedImage(req.file, 'limelight/slides');
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    const updatedSlide = {
      ...existing,
      badge: req.body.badge !== undefined ? req.body.badge : existing.badge,
      scriptText: req.body.scriptText !== undefined ? req.body.scriptText : existing.scriptText,
      title: req.body.title !== undefined ? req.body.title : existing.title,
      subtitle: req.body.subtitle !== undefined ? req.body.subtitle : existing.subtitle,
      primaryBtnText: req.body.primaryBtnText !== undefined ? req.body.primaryBtnText : existing.primaryBtnText,
      primaryBtnLink: req.body.primaryBtnLink !== undefined ? req.body.primaryBtnLink : existing.primaryBtnLink,
      secondaryBtnText: req.body.secondaryBtnText !== undefined ? req.body.secondaryBtnText : existing.secondaryBtnText,
      secondaryBtnLink: req.body.secondaryBtnLink !== undefined ? req.body.secondaryBtnLink : existing.secondaryBtnLink,
      imageUrl: imageUrl,
      order: req.body.order !== undefined ? parseInt(req.body.order, 10) : existing.order,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      updatedAt: new Date().toISOString()
    };

    await upsertMongoDoc(Slide, buildIdFilter(targetId), updatedSlide);
    slides[index] = updatedSlide;
    try { fs.writeFileSync(SLIDES_FILE, JSON.stringify(slides.map(stripMongoMeta), null, 2), 'utf-8'); } catch (e) {}
    logActivity('Slide Updated', `Modified details for "${updatedSlide.title}"`);

    res.json({
      success: true,
      message: 'Slide updated successfully',
      slide: updatedSlide
    });
  } catch (error) {
    console.error('Error updating slide:', error);
    res.status(500).json({ error: error.message || 'Failed to update slide' });
  }
});

// DELETE /api/slides/:id - Delete a slide
app.delete('/api/slides/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let found = false;

    if (isMongoConnected()) {
      const delRes = await Slide.deleteMany(buildIdFilter(targetId));
      if (delRes.deletedCount > 0) found = true;
    }

    const slides = readSlides();
    const index = slides.findIndex(s => s.id === targetId || s._id === targetId);
    if (index !== -1) {
      found = true;
      const deleted = slides[index];
      slides.splice(index, 1);
      try {
        fs.writeFileSync(SLIDES_FILE, JSON.stringify(slides, null, 2), 'utf-8');
      } catch (err) {
        console.error('Error writing slides file:', err);
      }
      logActivity('Slide Deleted', `Removed hero carousel slide "${deleted.title}"`);
    }

    if (!found) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    res.json({ success: true, message: 'Slide deleted successfully', id: targetId });
  } catch (error) {
    console.error('Error deleting slide:', error);
    res.status(500).json({ error: error.message || 'Failed to delete slide' });
  }
});

app.post('/api/slides/reorder', async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) {
      return res.status(400).json({ error: 'orderIds must be an array of slide IDs' });
    }

    const slides = (await readCollectionWithMongoFallback(Slide, readSlides)).map(stripMongoMeta);
    slides.forEach(slide => {
      const newOrder = orderIds.indexOf(slide.id);
      if (newOrder !== -1) {
        slide.order = newOrder + 1;
      }
    });

    await syncCollectionToMongo(Slide, slides);
    try { fs.writeFileSync(SLIDES_FILE, JSON.stringify(slides, null, 2), 'utf-8'); } catch (e) {}
    res.json({ success: true, message: 'Slides reordered successfully', slides });
  } catch (error) {
    console.error('Error reordering slides:', error);
    res.status(500).json({ error: error.message || 'Failed to reorder slides' });
  }
});

// POST /api/slides/reset - Reset to default seed
app.post('/api/slides/reset', async (req, res) => {
  if (isMongoConnected()) {
    await Slide.deleteMany({});
    if (DEFAULT_SLIDES.length > 0) await Slide.insertMany(DEFAULT_SLIDES);
  }
  writeSlides(DEFAULT_SLIDES);
  res.json({ success: true, message: 'Slides reset to default configuration', slides: DEFAULT_SLIDES });
});

// POST /api/assistant/chat - Groq AI Personal Shopping Assistant
app.post('/api/assistant/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const [products, routes, settingsDoc] = await Promise.all([
      readCollectionWithMongoFallback(Product, readProducts),
      readCollectionWithMongoFallback(Navigation, readNavigation),
      isMongoConnected() ? Setting.findOne({ key: 'site_settings' }).lean().catch(() => readSettings()) : Promise.resolve(readSettings())
    ]);
    const settings = settingsDoc || readSettings();

    const result = await chatWithAssistant(message, history, { products, routes, settings });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Assistant endpoint error:', err);
    res.status(500).json({ error: err.message || 'AI Assistant service error' });
  }
});

// GET /api/system/status - Live Backend, MongoDB Atlas & Cloudinary Health
app.get('/api/system/status', (req, res) => {
  res.json({
    status: 'healthy',
    mongo: {
      connected: isMongoConnected(),
      cluster: 'cluster0.hgi0zh6.mongodb.net',
      database: 'limelight'
    },
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'qzkctjzg',
      configured: true
    },
    assistant: {
      provider: 'Groq',
      model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      active: true
    }
  });
});

// Start Server and Connect to MongoDB Atlas
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Zimal Collection Backend Server (www.zimalcollection.com) running on http://localhost:${PORT}`);
  console.log(`📁 Uploads available at http://localhost:${PORT}/uploads`);
  console.log(`📡 Slides API at http://localhost:${PORT}/api/slides`);
  console.log(`🤖 AI Shopping Assistant online (Groq ${process.env.GROQ_MODEL || 'qwen/qwen3.8-27b'})`);

  try {
    await connectMongo();
  } catch (err) {
    console.error('Initial MongoDB connection error:', err.message);
  }
});

export default app;

