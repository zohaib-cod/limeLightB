import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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

// Background MongoDB Dual-Write Helper
async function syncCollectionToMongo(Model, data, isArray = true) {
  if (!isMongoConnected()) return;
  try {
    if (isArray && Array.isArray(data)) {
      const ops = data.map(item => ({
        updateOne: {
          filter: { id: item.id },
          update: { $set: item },
          upsert: true
        }
      }));
      if (ops.length > 0) {
        await Model.bulkWrite(ops, { ordered: false });
      }
    } else if (data) {
      await Model.updateOne({ key: 'site_settings' }, { $set: data }, { upsert: true });
    }
  } catch (err) {
    console.warn(`MongoDB sync error (${Model.modelName}):`, err.message);
  }
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

// Serve uploaded static files
app.use('/uploads', express.static(UPLOADS_DIR));

// Default Slides Seed
const DEFAULT_SLIDES = [
  {
    id: "slide-1",
    badge: "WINTER VOLUME 2026",
    scriptText: "Signature",
    title: "UNSTITCHED & READY TO WEAR",
    subtitle: "Discover rich textures, intricate embroideries, and statement silhouettes tailored for the contemporary winter wardrobe. STYLE FOR EVERY OCCASION.",
    primaryBtnText: "SHOP UNSTITCHED",
    primaryBtnLink: "#unstitched",
    secondaryBtnText: "VIEW READY TO WEAR",
    secondaryBtnLink: "#ready-to-wear",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/BANNERS_FOR_WEB_jpg_ff_jpg.jpg?v=1789713515&width=1920",
    order: 1,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "slide-2",
    badge: "LUXURY UNSTITCHED",
    scriptText: "Elegance",
    title: "EMBROIDERED WINTER VELVET",
    subtitle: "Exquisite zari and threadwork on micro velvet paired with printed pashmina and karandi shawls.",
    primaryBtnText: "EXPLORE VELVET",
    primaryBtnLink: "#unstitched",
    secondaryBtnText: "SHOP 3-PIECE SUITS",
    secondaryBtnLink: "#unstitched",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/unstitched_jpg.jpg?v=1789646203&width=1920",
    order: 2,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "slide-3",
    badge: "WESTERN & PRET",
    scriptText: "Chic",
    title: "CO-ORD SETS & CASUALS",
    subtitle: "Effortless day-to-evening style crafted in premium linen blends and structured slub fabrics.",
    primaryBtnText: "SHOP CO-ORDS",
    primaryBtnLink: "#ready-to-wear",
    secondaryBtnText: "VIEW PRET LOOKS",
    secondaryBtnLink: "#ready-to-wear",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/coords_jpg.jpg?v=1789646276&width=1920",
    order: 3,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "slide-4",
    badge: "SIGNATURE COUTURE",
    scriptText: "Festive",
    title: "READY TO WEAR LUXE PRET",
    subtitle: "Intricate metallic embroideries and royal cuts designed for winter weddings and evening festivities.",
    primaryBtnText: "SHOP FESTIVE",
    primaryBtnLink: "#ready-to-wear",
    secondaryBtnText: "DISCOVER MORE",
    secondaryBtnLink: "#collections",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/Web_RTW_Main.jpg?v=1778494519",
    order: 4,
    isActive: true,
    createdAt: new Date().toISOString()
  }
];

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

// Default Section Editorial Banners
const DEFAULT_BANNERS = [
  {
    id: "unstitched",
    section: "unstitched",
    sectionName: "Unstitched Fabrics Section",
    badge: "LUXURY WINTER EDIT",
    watermark: "UNSTITCHED",
    title: "UNSTITCHED FABRICS",
    subtitle: "Tailor your distinctive look with our finest unstitched velvets, warm karandi, and embroidered khaddar fabrics.",
    scriptText: "Style it your way.",
    buttonText: "EXPLORE DESIGNS",
    buttonLink: "#unstitched-grid",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/unstitched_jpg.jpg?v=1789646203&width=1920",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "unstitched-wide",
    section: "unstitched-wide",
    sectionName: "Unstitched Embroidered Shawls & Suits (Wide Banner)",
    badge: "EMBROIDERED EMBELLISHMENTS",
    watermark: "UNSTITCHED EMBROIDERED",
    title: "SIGNATURE WINTER SHAWLS & SUITS",
    subtitle: "",
    scriptText: "",
    buttonText: "VIEW FULL COLLECTION",
    buttonLink: "#unstitched",
    secondaryBtnText: "SHOP NOW",
    secondaryBtnLink: "#unstitched",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/Unstitched_Embroidered_1425_x_445.jpg?v=1778751852",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "rtw-pret",
    section: "rtw-pret",
    sectionName: "RTW: Daily Chic & Kurtis",
    badge: "PRET CASUALS",
    watermark: "Ready to",
    title: "DAILY CHIC & KURTIS",
    subtitle: "",
    scriptText: "",
    buttonText: "SHOP PRET CASUALS →",
    buttonLink: "#rtw-grid",
    secondaryBtnText: "SHOP NOW",
    secondaryBtnLink: "#rtw-grid",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/Web_RTW_Main.jpg?v=1778494519",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "rtw-coords",
    section: "rtw-coords",
    sectionName: "RTW: Western Co-Ords",
    badge: "MODERN SILHOUETTES",
    watermark: "CO-ORDS",
    title: "WESTERN CO-ORDS",
    subtitle: "MADE TO MATCH",
    scriptText: "",
    buttonText: "DISCOVER CO-ORDS →",
    buttonLink: "#rtw-grid",
    secondaryBtnText: "",
    secondaryBtnLink: "",
    imageUrl: "https://www.limelight.pk/cdn/shop/files/coords_jpg.jpg?v=1789646276&width=1920",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

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

// Default Catalog Products Seed (including all 4 Unstitched winter collection items from screenshot)
const DEFAULT_PRODUCTS = [
  {
    id: "un-1",
    title: "3 Piece Embroidered Velvet Suit",
    category: "Unstitched",
    subCategory: "3 Piece",
    price: 8990,
    originalPrice: 11990,
    discount: "25% OFF",
    image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80",
    fabric: "Velvet & Chiffon",
    pieces: "Shirt + Trouser + Embroidered Dupatta",
    color: "Deep Emerald",
    sku: "U3P-24-EMB-01",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "un-2",
    title: "2 Piece Printed Khaddar Suit",
    category: "Unstitched",
    subCategory: "2 Piece",
    price: 3490,
    originalPrice: 4290,
    discount: "18% OFF",
    image: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80",
    fabric: "Warm Khaddar",
    pieces: "Shirt + Woolen Shawl",
    color: "Mustard Gold",
    sku: "U2P-24-KHD-09",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "un-3",
    title: "2 Piece Embroidered Karandi Suit",
    category: "Unstitched",
    subCategory: "2 Piece",
    price: 4990,
    originalPrice: 5990,
    discount: "16% OFF",
    image: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80",
    fabric: "Karandi",
    pieces: "Shirt + Trouser",
    color: "Ruby Red",
    sku: "U2P-24-KRN-14",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "un-4",
    title: "1 Piece Printed Cambric Shirt",
    category: "Unstitched",
    subCategory: "1 Piece",
    price: 1890,
    originalPrice: 2290,
    discount: "17% OFF",
    image: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=800&q=80",
    fabric: "Cambric Cotton",
    pieces: "Unstitched Shirt Piece 3m",
    color: "Powder Blue & White",
    sku: "U1P-24-CAM-05",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "rtw-1",
    title: "2 Piece Printed Co-Ord Set",
    category: "Ready To Wear",
    subCategory: "Co-Ords",
    price: 5490,
    originalPrice: 6490,
    discount: "15% OFF",
    image: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80",
    fabric: "Linen Viscose Blend",
    fit: "Relaxed Boxy Fit",
    sizes: ["XS", "S", "M", "L", "XL"],
    pieces: "Top + Bottom",
    color: "Terracotta & Yellow",
    sku: "RTW-24-CRD-01",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "rtw-2",
    title: "Embroidered Jacquard Kurti",
    category: "Ready To Wear",
    subCategory: "Pret Kurti",
    price: 4290,
    originalPrice: 4990,
    discount: "14% OFF",
    image: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80",
    fabric: "Woven Jacquard",
    fit: "Straight Cut with Slits",
    sizes: ["S", "M", "L"],
    pieces: "Single Kurti",
    color: "Sky Blue & Pastel",
    sku: "RTW-24-JKR-02",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "rtw-3",
    title: "Solid Everyday Casual Kurta",
    category: "Ready To Wear",
    subCategory: "Pret Kurti",
    price: 2990,
    originalPrice: 3490,
    discount: "14% OFF",
    image: "https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=80",
    fabric: "Slub Cotton",
    fit: "A-Line Flare",
    sizes: ["XS", "S", "M", "L"],
    pieces: "Everyday Kurti",
    color: "Sage Green",
    sku: "RTW-24-CSL-03",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "rtw-4",
    title: "3 Piece Festive Silk Ensemble",
    category: "Ready To Wear",
    subCategory: "3 Piece Pret",
    price: 12990,
    originalPrice: 15990,
    discount: "18% OFF",
    image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=800&q=80",
    fabric: "Raw Silk & Organza",
    fit: "Royal Anarkali Cut",
    sizes: ["S", "M", "L"],
    pieces: "Frock + Churidar + Organza Dupatta",
    color: "Midnight Teal & Gold",
    sku: "RTW-24-SLK-04",
    isActive: true,
    inStock: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

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

// Default Seed Curated Collections
const DEFAULT_COLLECTIONS = [
  {
    id: "col-1",
    title: "WINTER VELVET",
    tagline: "Regal textures & opulent hues",
    image: "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=800&q=80",
    count: "48 Designs",
    linkText: "EXPLORE VELVET",
    linkUrl: "#unstitched",
    isActive: true,
    order: 1,
    createdAt: "2026-11-15T20:40:00.000Z",
    updatedAt: "2026-11-15T20:40:00.000Z"
  },
  {
    id: "col-2",
    title: "CO-ORD SETS",
    tagline: "Effortless modern silhouettes",
    image: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80",
    count: "32 Sets",
    linkText: "SHOP CO-ORDS",
    linkUrl: "#ready-to-wear",
    isActive: true,
    order: 2,
    createdAt: "2026-11-15T20:40:00.000Z",
    updatedAt: "2026-11-15T20:40:00.000Z"
  },
  {
    id: "col-3",
    title: "EMBROIDERED ORGANZA",
    tagline: "Intricate metallic thread embroidery",
    image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=800&q=80",
    count: "24 Luxury Suits",
    linkText: "VIEW FESTIVE",
    linkUrl: "#unstitched",
    isActive: true,
    order: 3,
    createdAt: "2026-11-15T20:40:00.000Z",
    updatedAt: "2026-11-15T20:40:00.000Z"
  },
  {
    id: "col-4",
    title: "WARM KHADDAR & KARANDI",
    tagline: "Timeless warmth for winter days",
    image: "https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80",
    count: "65 Articles",
    linkText: "SHOP KHADDAR",
    linkUrl: "#unstitched",
    isActive: true,
    order: 4,
    createdAt: "2026-11-15T20:40:00.000Z",
    updatedAt: "2026-11-15T20:40:00.000Z"
  }
];

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

// Default Seed New Arrivals
const DEFAULT_NEW_ARRIVALS = [
  {
    id: "na-1",
    title: "Embroidered Velvet Shawl 3 Piece Suit",
    category: "Unstitched",
    price: 9990,
    originalPrice: 12990,
    discount: "23% OFF",
    badge: "JUST ARRIVED",
    image: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80",
    fabric: "Premium Micro Velvet with Golden Zari Work",
    sku: "NA-VLV-301",
    isActive: true,
    inStock: true,
    createdAt: "2026-11-15T20:50:00.000Z",
    updatedAt: "2026-11-15T20:50:00.000Z"
  },
  {
    id: "na-2",
    title: "Contemporary Minimalist Co-Ord Set",
    category: "Ready To Wear",
    price: 5990,
    originalPrice: 6990,
    discount: "14% OFF",
    badge: "TRENDING",
    image: "https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=80",
    fabric: "Super Fine Slub Twill",
    sku: "NA-CRD-104",
    isActive: true,
    inStock: true,
    createdAt: "2026-11-15T20:50:00.000Z",
    updatedAt: "2026-11-15T20:50:00.000Z"
  },
  {
    id: "na-3",
    title: "Festive Raw Silk Jacquard Kurti",
    category: "Ready To Wear",
    price: 4690,
    originalPrice: 5490,
    discount: "15% OFF",
    badge: "NEW IN",
    image: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80",
    fabric: "Self Weave Jacquard",
    sku: "NA-JAC-202",
    isActive: true,
    inStock: true,
    createdAt: "2026-11-15T20:50:00.000Z",
    updatedAt: "2026-11-15T20:50:00.000Z"
  },
  {
    id: "na-4",
    title: "Laser-Cut Festive Evening Clutch",
    category: "Accessories",
    price: 3290,
    originalPrice: 3890,
    discount: "15% OFF",
    badge: "SELLING FAST",
    image: "https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?auto=format&fit=crop&w=800&q=80",
    fabric: "Faux Suede with Metal Clasp",
    sku: "NA-BAG-508",
    isActive: true,
    inStock: true,
    createdAt: "2026-11-15T20:50:00.000Z",
    updatedAt: "2026-11-15T20:50:00.000Z"
  }
];

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
const DEFAULT_ORDERS = [
  {
    id: "LM-849201",
    createdAt: "2026-11-15T21:00:00.000Z",
    customer: {
      name: "Ayesha Khan",
      phone: "0300-8472910",
      email: "ayesha.khan@example.com",
      address: "House 42, Block C, Phase 5, DHA",
      city: "Lahore",
      province: "Punjab",
      notes: "Please call before delivery"
    },
    items: [
      {
        id: "un-1",
        title: "3 Piece Embroidered Velvet Suit",
        category: "Unstitched",
        price: 8990,
        quantity: 1,
        selectedSize: null,
        fabric: "Velvet & Chiffon",
        image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80"
      }
    ],
    subtotal: 8990,
    shipping: 0,
    total: 8990,
    paymentMethod: "Cash on Delivery",
    status: "Pending",
    source: "Storefront Direct Order"
  }
];

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
app.get('/api/stats', (req, res) => {
  const slides = readSlides();
  const activeSlides = slides.filter(s => s.isActive !== false);
  const features = readFeatures();
  const activeFeatures = features.filter(f => f.isActive !== false);
  const banners = readBanners();
  const activeBanners = banners.filter(b => b.isActive !== false);
  const products = readProducts();
  const activeProducts = products.filter(p => p.isActive !== false);
  const collections = readCollections();
  const activeCollections = collections.filter(c => c.isActive !== false);
  const newArrivals = readNewArrivals();
  const activeNewArrivals = newArrivals.filter(n => n.isActive !== false);
  const orders = readOrders();
  const pendingOrders = orders.filter(o => o.status === 'Pending').length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const users = readUsers();
  const activeUsers = users.filter(u => u.status === 'Active').length;
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
    totalCollections: collections.length,
    activeCollections: activeCollections.length,
    totalNewArrivals: newArrivals.length,
    activeNewArrivals: activeNewArrivals.length,
    totalOrders: orders.length,
    pendingOrders,
    totalRevenue,
    totalUsers: users.length,
    activeUsers,
    totalRoutes: readNavigation().length,
    totalSubscribers: readSubscribers().length,
    whatsappNumber: readSettings().whatsappNumber || "+92 345 7867016",
    categoriesCount: 6,
    freeShippingThreshold: 2490,
    serverUptime: Math.round(process.uptime()),
    nodeVersion: process.version,
    storageEngine: 'Local Persistent JSON + Multer Media Engine',
    uploadsCount: fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR).length : 0
  });
});

// ================= FEATURES API ROUTES =================

// GET /api/features - Return all features sorted by order
app.get('/api/features', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const features = readFeatures();
  const filtered = includeInactive ? features : features.filter(f => f.isActive !== false);
  filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(filtered);
});

// GET /api/features/:id - Single feature
app.get('/api/features/:id', (req, res) => {
  const features = readFeatures();
  const item = features.find(f => f.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Feature not found' });
  }
  res.json(item);
});

// POST /api/features - Add new feature highlight
app.post('/api/features', (req, res) => {
  try {
    const { title, subtitle, isActive } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Feature title is required' });
    }

    const features = readFeatures();
    const newFeature = {
      id: `feat-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      title: title.trim(),
      subtitle: subtitle ? subtitle.trim() : '',
      order: features.length > 0 ? Math.max(...features.map(f => f.order || 0)) + 1 : 1,
      isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : true,
      createdAt: new Date().toISOString()
    };

    features.push(newFeature);
    writeFeatures(features);
    logActivity('Feature Created', `Added feature highlight "${newFeature.title}"`);

    res.status(201).json({
      success: true,
      message: 'Feature created successfully',
      feature: newFeature
    });
  } catch (error) {
    console.error('Error creating feature:', error);
    res.status(500).json({ error: error.message || 'Failed to create feature' });
  }
});

// PUT /api/features/:id - Update existing feature highlight
app.put('/api/features/:id', (req, res) => {
  try {
    const features = readFeatures();
    const index = features.findIndex(f => f.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    const existing = features[index];
    const updated = {
      ...existing,
      title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
      subtitle: req.body.subtitle !== undefined ? req.body.subtitle.trim() : existing.subtitle,
      order: req.body.order !== undefined ? parseInt(req.body.order, 10) : existing.order,
      isActive: req.body.isActive !== undefined ? (req.body.isActive === 'true' || req.body.isActive === true) : existing.isActive,
      updatedAt: new Date().toISOString()
    };

    features[index] = updated;
    writeFeatures(features);
    logActivity('Feature Updated', `Updated feature highlight "${updated.title}"`);

    res.json({
      success: true,
      message: 'Feature updated successfully',
      feature: updated
    });
  } catch (error) {
    console.error('Error updating feature:', error);
    res.status(500).json({ error: error.message || 'Failed to update feature' });
  }
});

// DELETE /api/features/:id - Delete a feature highlight
app.delete('/api/features/:id', (req, res) => {
  try {
    const features = readFeatures();
    const index = features.findIndex(f => f.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    const deleted = features[index];
    features.splice(index, 1);
    writeFeatures(features);
    logActivity('Feature Deleted', `Deleted feature "${deleted.title}" (ID: ${req.params.id})`);

    res.json({
      success: true,
      message: 'Feature deleted successfully',
      id: req.params.id
    });
  } catch (error) {
    console.error('Error deleting feature:', error);
    res.status(500).json({ error: error.message || 'Failed to delete feature' });
  }
});

// POST /api/features/reorder - Reorder feature highlights
app.post('/api/features/reorder', (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) {
      return res.status(400).json({ error: 'orderIds must be an array of feature IDs' });
    }

    const features = readFeatures();
    features.forEach(feat => {
      const newOrder = orderIds.indexOf(feat.id);
      if (newOrder !== -1) {
        feat.order = newOrder + 1;
      }
    });

    writeFeatures(features);
    logActivity('Features Reordered', `Reordered ${orderIds.length} feature highlights`);
    res.json({ success: true, message: 'Features reordered successfully', features });
  } catch (error) {
    console.error('Error reordering features:', error);
    res.status(500).json({ error: error.message || 'Failed to reorder features' });
  }
});

// POST /api/features/reset - Reset features to default
app.post('/api/features/reset', (req, res) => {
  writeFeatures(DEFAULT_FEATURES);
  logActivity('Features Reset', 'Reset features bar to default Limelight values');
  res.json({ success: true, message: 'Features reset to defaults', features: DEFAULT_FEATURES });
});

// ================= BANNERS API ROUTES =================

// GET /api/banners - Return all section editorial banners
app.get('/api/banners', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const banners = readBanners();
  const filtered = includeInactive ? banners : banners.filter(b => b.isActive !== false);
  res.json(filtered);
});

// GET /api/banners/:id - Single section banner by id or section name
app.get('/api/banners/:id', (req, res) => {
  const banners = readBanners();
  const banner = banners.find(b => b.id === req.params.id || b.section === req.params.id);
  if (!banner) {
    return res.status(404).json({ error: 'Banner not found' });
  }
  res.json(banner);
});

// POST /api/banners - Create or update banner with image upload or URL
app.post('/api/banners', upload.single('image'), (req, res) => {
  try {
    const banners = readBanners();
    let imageUrl = req.body.imageUrl || '';

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const id = req.body.id || req.body.section || `banner-${Date.now()}`;
    const section = req.body.section || id;

    const existingIndex = banners.findIndex(b => b.id === id || b.section === section);
    if (existingIndex !== -1) {
      const existing = banners[existingIndex];
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
      banners[existingIndex] = updated;
      writeBanners(banners);
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

    banners.push(newBanner);
    writeBanners(banners);
    logActivity('Banner Created', `Created editorial banner "${newBanner.title}"`);
    res.status(201).json({ success: true, message: 'Banner created successfully', banner: newBanner });
  } catch (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({ error: error.message || 'Failed to create banner' });
  }
});

// PUT /api/banners/:id - Update existing banner
app.put('/api/banners/:id', upload.single('image'), (req, res) => {
  try {
    const banners = readBanners();
    const index = banners.findIndex(b => b.id === req.params.id || b.section === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    const existing = banners[index];
    let imageUrl = existing.imageUrl;

    if (req.file) {
      const oldFilename = existing.imageUrl?.startsWith('/uploads/') ? path.basename(existing.imageUrl) : null;
      if (oldFilename && oldFilename !== 'user-limelight-banner.jpg') {
        const oldPath = path.join(UPLOADS_DIR, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
        }
      }
      imageUrl = `/uploads/${req.file.filename}`;
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

    banners[index] = updated;
    writeBanners(banners);
    logActivity('Banner Updated', `Updated editorial banner "${updated.title}"`);

    res.json({ success: true, message: 'Banner updated successfully', banner: updated });
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({ error: error.message || 'Failed to update banner' });
  }
});

// DELETE /api/banners/:id - Delete a banner
app.delete('/api/banners/:id', (req, res) => {
  try {
    const banners = readBanners();
    const index = banners.findIndex(b => b.id === req.params.id || b.section === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    const deleted = banners[index];
    if (deleted.imageUrl && deleted.imageUrl.startsWith('/uploads/')) {
      const filename = path.basename(deleted.imageUrl);
      if (filename !== 'user-limelight-banner.jpg') {
        const filePath = path.join(UPLOADS_DIR, filename);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        }
      }
    }

    banners.splice(index, 1);
    writeBanners(banners);
    logActivity('Banner Deleted', `Deleted banner "${deleted.title}" (ID: ${req.params.id})`);

    res.json({ success: true, message: 'Banner deleted successfully', id: req.params.id });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({ error: error.message || 'Failed to delete banner' });
  }
});

// POST /api/banners/reset - Reset banners to default
app.post('/api/banners/reset', (req, res) => {
  writeBanners(DEFAULT_BANNERS);
  logActivity('Banners Reset', 'Reset section banners to default Limelight editorial values');
  res.json({ success: true, message: 'Banners reset to defaults', banners: DEFAULT_BANNERS });
});

// ================= PRODUCTS API ROUTES =================

// GET /api/products - Get all products with optional category & active filters
app.get('/api/products', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const categoryFilter = req.query.category;
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
app.get('/api/products/:id', (req, res) => {
  const products = readProducts();
  const product = products.find(p => p.id === req.params.id);
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
    const products = readProducts();
    const index = products.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const existing = products[index];
    let imageUrl = existing.image;

    if (req.file) {
      const oldFilename = existing.image?.startsWith('/uploads/') ? path.basename(existing.image) : null;
      if (oldFilename && oldFilename !== 'user-limelight-banner.jpg') {
        const oldPath = path.join(UPLOADS_DIR, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
        }
      }
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

    const updated = {
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
    };

    products[index] = updated;
    writeProducts(products);
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
app.delete('/api/products/:id', (req, res) => {
  try {
    const products = readProducts();
    const index = products.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const deleted = products[index];
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
    writeProducts(products);
    logActivity('Product Deleted', `Removed product "${deleted.title}" (ID: ${req.params.id})`);

    res.json({
      success: true,
      message: 'Product deleted successfully',
      id: req.params.id
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: error.message || 'Failed to delete product' });
  }
});

// POST /api/products/reset - Reset products to default
app.post('/api/products/reset', (req, res) => {
  writeProducts(DEFAULT_PRODUCTS);
  logActivity('Products Reset', 'Reset product catalog to default Limelight items');
  res.json({ success: true, message: 'Product catalog reset to defaults', products: DEFAULT_PRODUCTS });
});

// ================= CURATED COLLECTIONS API ROUTES =================

// GET /api/collections - Return all collections
app.get('/api/collections', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const collections = readCollections();
  const filtered = includeInactive ? collections : collections.filter(c => c.isActive !== false);
  filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(filtered);
});

// GET /api/collections/:id - Single collection
app.get('/api/collections/:id', (req, res) => {
  const collections = readCollections();
  const item = collections.find(c => c.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  res.json(item);
});

// POST /api/collections - Create a new collection
app.post('/api/collections', upload.single('image'), (req, res) => {
  try {
    const collections = readCollections();
    let imageUrl = req.body.image || req.body.imageUrl || '';

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
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

    collections.push(newCollection);
    writeCollections(collections);
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
app.put('/api/collections/:id', upload.single('image'), (req, res) => {
  try {
    const collections = readCollections();
    const index = collections.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const existing = collections[index];
    let imageUrl = existing.image;

    if (req.file) {
      const oldFilename = existing.image?.startsWith('/uploads/') ? path.basename(existing.image) : null;
      if (oldFilename && oldFilename !== 'user-limelight-banner.jpg') {
        const oldPath = path.join(UPLOADS_DIR, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
        }
      }
      imageUrl = `/uploads/${req.file.filename}`;
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

    collections[index] = updated;
    writeCollections(collections);
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
app.delete('/api/collections/:id', (req, res) => {
  try {
    const collections = readCollections();
    const index = collections.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const deleted = collections[index];
    if (deleted.image && deleted.image.startsWith('/uploads/')) {
      const filename = path.basename(deleted.image);
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }

    collections.splice(index, 1);
    writeCollections(collections);
    logActivity('Collection Deleted', `Deleted collection "${deleted.title}"`);

    res.json({ success: true, message: 'Collection deleted successfully', id: req.params.id });
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({ error: error.message || 'Failed to delete collection' });
  }
});

// POST /api/collections/reset - Reset collections to defaults
app.post('/api/collections/reset', (req, res) => {
  writeCollections(DEFAULT_COLLECTIONS);
  logActivity('Collections Reset', 'Reset curated collections to default Limelight items');
  res.json({ success: true, message: 'Curated collections reset to defaults', collections: DEFAULT_COLLECTIONS });
});

// POST /api/collections/reorder - Reorder collections
app.post('/api/collections/reorder', (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) {
      return res.status(400).json({ error: 'orderIds array is required' });
    }
    const collections = readCollections();
    const map = new Map(collections.map(c => [c.id, c]));
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
    writeCollections(reordered);
    logActivity('Collections Reordered', `Reordered ${reordered.length} collections`);
    res.json({ success: true, collections: reordered });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to reorder collections' });
  }
});

// ================= NEW ARRIVALS API ROUTES =================

// GET /api/new-arrivals - Return all new arrivals
app.get('/api/new-arrivals', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const category = req.query.category;
  const items = readNewArrivals();
  let filtered = includeInactive ? items : items.filter(i => i.isActive !== false);

  if (category && category.toUpperCase() !== 'ALL') {
    filtered = filtered.filter(i => i.category.toUpperCase().includes(category.toUpperCase()));
  }

  res.json(filtered);
});

// GET /api/new-arrivals/:id - Single new arrival
app.get('/api/new-arrivals/:id', (req, res) => {
  const items = readNewArrivals();
  const item = items.find(i => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'New arrival item not found' });
  }
  res.json(item);
});

// POST /api/new-arrivals - Create new arrival
app.post('/api/new-arrivals', upload.single('image'), (req, res) => {
  try {
    const items = readNewArrivals();
    let imageUrl = req.body.image || req.body.imageUrl || '';

    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    items.unshift(newItem);
    writeNewArrivals(items);
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
app.put('/api/new-arrivals/:id', upload.single('image'), (req, res) => {
  try {
    const items = readNewArrivals();
    const index = items.findIndex(i => i.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'New arrival item not found' });
    }

    const existing = items[index];
    let imageUrl = existing.image;

    if (req.file) {
      const oldFilename = existing.image?.startsWith('/uploads/') ? path.basename(existing.image) : null;
      if (oldFilename && oldFilename !== 'user-limelight-banner.jpg') {
        const oldPath = path.join(UPLOADS_DIR, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
        }
      }
      imageUrl = `/uploads/${req.file.filename}`;
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

    items[index] = updated;
    writeNewArrivals(items);
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
app.delete('/api/new-arrivals/:id', (req, res) => {
  try {
    const items = readNewArrivals();
    const index = items.findIndex(i => i.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'New arrival not found' });
    }

    const deleted = items[index];
    if (deleted.image && deleted.image.startsWith('/uploads/')) {
      const filename = path.basename(deleted.image);
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }

    items.splice(index, 1);
    writeNewArrivals(items);
    logActivity('New Arrival Deleted', `Deleted "${deleted.title}"`);

    res.json({ success: true, message: 'New arrival deleted successfully', id: req.params.id });
  } catch (error) {
    console.error('Error deleting new arrival:', error);
    res.status(500).json({ error: error.message || 'Failed to delete new arrival' });
  }
});

// POST /api/new-arrivals/reset - Reset to defaults
app.post('/api/new-arrivals/reset', (req, res) => {
  writeNewArrivals(DEFAULT_NEW_ARRIVALS);
  logActivity('New Arrivals Reset', 'Reset new arrivals to default Limelight items');
  res.json({ success: true, message: 'New arrivals reset to defaults', items: DEFAULT_NEW_ARRIVALS });
});

// ================= ORDERS API ROUTES =================

// GET /api/orders - Return all orders
app.get('/api/orders', (req, res) => {
  const orders = readOrders();
  const status = req.query.status;
  let filtered = orders;
  if (status && status.toUpperCase() !== 'ALL') {
    filtered = filtered.filter(o => o.status?.toLowerCase() === status.toLowerCase());
  }
  // Sort by createdAt descending (newest first)
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(filtered);
});

// GET /api/orders/:id - Single order
app.get('/api/orders/:id', (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(order);
});

// POST /api/orders - Create new order from Storefront checkout
app.post('/api/orders', (req, res) => {
  try {
    const orders = readOrders();
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

    orders.unshift(newOrder);
    writeOrders(orders);
    logActivity('Order Placed', `Order #${newOrder.id} placed by ${newOrder.customer.name} (Rs. ${newOrder.total.toLocaleString()})`);

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: newOrder
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message || 'Failed to place order' });
  }
});

// PUT /api/orders/:id - Update order status (Pending, Confirmed, Shipped, Delivered, Cancelled)
app.put('/api/orders/:id', (req, res) => {
  try {
    const orders = readOrders();
    const index = orders.findIndex(o => o.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const existing = orders[index];
    const updated = {
      ...existing,
      status: req.body.status || existing.status,
      customer: req.body.customer ? { ...existing.customer, ...req.body.customer } : existing.customer,
      updatedAt: new Date().toISOString()
    };

    orders[index] = updated;
    writeOrders(orders);
    logActivity('Order Updated', `Order #${updated.id} status changed to ${updated.status}`);

    res.json({
      success: true,
      message: 'Order updated successfully',
      order: updated
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update order' });
  }
});

// DELETE /api/orders/:id - Delete order
app.delete('/api/orders/:id', (req, res) => {
  try {
    const orders = readOrders();
    const index = orders.findIndex(o => o.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const deleted = orders.splice(index, 1)[0];
    writeOrders(orders);
    logActivity('Order Deleted', `Order #${deleted.id} deleted`);

    res.json({ success: true, message: 'Order deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete order' });
  }
});

// POST /api/orders/reset - Reset orders to default sample
app.post('/api/orders/reset', (req, res) => {
  writeOrders(DEFAULT_ORDERS);
  logActivity('Orders Reset', 'Reset orders to default sample');
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
app.get('/api/navigation', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const nav = readNavigation();
  const products = readProducts();

  let list = includeInactive ? nav : nav.filter(n => n.isActive !== false);
  list.sort((a, b) => (a.order || 0) - (b.order || 0));

  // Enrich with count of products mapped to this route/category
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
app.get('/api/navigation/:id', (req, res) => {
  const nav = readNavigation();
  const item = nav.find(n => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Route not found' });
  res.json(item);
});

// POST /api/navigation - Add new route
app.post('/api/navigation', (req, res) => {
  try {
    const { name, href, slug, isSale, description, isActive } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Route name is required' });
    }

    const nav = readNavigation();
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

    nav.push(newRoute);
    writeNavigation(nav);
    logActivity('Route Added', `Added new navigation route: ${newRoute.name} (${newRoute.href})`);

    res.status(201).json({ success: true, message: 'Route added successfully', route: newRoute });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to add route' });
  }
});

// PUT /api/navigation/:id - Update route
app.put('/api/navigation/:id', (req, res) => {
  try {
    const nav = readNavigation();
    const index = nav.findIndex(n => n.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Route not found' });

    const existing = nav[index];
    const updated = {
      ...existing,
      ...req.body,
      id: existing.id,
      name: req.body.name ? req.body.name.trim().toUpperCase() : existing.name,
      updatedAt: new Date().toISOString()
    };

    nav[index] = updated;
    writeNavigation(nav);
    logActivity('Route Updated', `Updated navigation route: ${updated.name}`);

    res.json({ success: true, message: 'Route updated successfully', route: updated });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update route' });
  }
});

// DELETE /api/navigation/:id - Delete route
app.delete('/api/navigation/:id', (req, res) => {
  try {
    const nav = readNavigation();
    const index = nav.findIndex(n => n.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Route not found' });

    const deleted = nav.splice(index, 1)[0];
    writeNavigation(nav);
    logActivity('Route Deleted', `Deleted navigation route: ${deleted.name}`);

    res.json({ success: true, message: 'Route deleted successfully', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete route' });
  }
});

// POST /api/navigation/reorder - Reorder routes
app.post('/api/navigation/reorder', (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    const nav = readNavigation();
    nav.forEach(item => {
      const idx = orderIds.indexOf(item.id);
      if (idx !== -1) item.order = idx + 1;
    });

    writeNavigation(nav);
    res.json({ success: true, message: 'Routes reordered', navigation: nav });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder routes' });
  }
});

// ================= BRANDING & SETTINGS API =================

// GET /api/settings - Return site settings & branding
app.get('/api/settings', (req, res) => {
  res.json(readSettings());
});

// PUT /api/settings - Update site settings & branding
app.put('/api/settings', (req, res) => {
  try {
    const current = readSettings();
    const updated = {
      ...current,
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    writeSettings(updated);
    logActivity('Settings Updated', `Brand settings and logo configuration updated`);
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

    const current = readSettings();
    current.logoType = 'image';
    current.imageLogo = {
      ...current.imageLogo,
      url: logoUrl
    };
    current.updatedAt = new Date().toISOString();
    writeSettings(current);

    logActivity('Logo Uploaded', `Uploaded custom logo to Cloudinary: ${logoUrl}`);
    res.json({ success: true, message: 'Logo uploaded successfully', logoUrl, settings: current });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Logo upload failed' });
  }
});

// ================= HOMEPAGE SECTIONS ORGANIZER API =================

// GET /api/sections - Return homepage sections list in order
app.get('/api/sections', (req, res) => {
  const sections = readSections();
  res.json(sections);
});

// POST /api/sections/reorder - Reorder homepage sections (Drag and Drop / Up-Down)
app.post('/api/sections/reorder', (req, res) => {
  try {
    const { sectionIds, sections } = req.body;
    let current = readSections();

    if (Array.isArray(sections)) {
      current = sections.map((sec, idx) => ({
        ...sec,
        order: idx + 1
      }));
    } else if (Array.isArray(sectionIds)) {
      current.forEach(sec => {
        const idx = sectionIds.indexOf(sec.id);
        if (idx !== -1) sec.order = idx + 1;
      });
      current.sort((a, b) => (a.order || 0) - (b.order || 0));
    } else {
      return res.status(400).json({ error: 'sectionIds or sections array is required' });
    }

    writeSections(current);
    logActivity('Sections Reordered', 'Homepage sections display order updated');
    res.json({ success: true, message: 'Sections order saved successfully', sections: current });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reorder sections' });
  }
});

// PUT /api/sections/:id - Toggle enable / update section
app.put('/api/sections/:id', (req, res) => {
  try {
    const sections = readSections();
    const index = sections.findIndex(s => s.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Section not found' });

    sections[index] = {
      ...sections[index],
      ...req.body,
      id: sections[index].id
    };

    writeSections(sections);
    logActivity('Section Updated', `Updated section "${sections[index].name}"`);
    res.json({ success: true, message: 'Section updated', section: sections[index] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// POST /api/sections/reset - Reset sections to default order
app.post('/api/sections/reset', (req, res) => {
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
app.get('/api/slides', (req, res) => {
  const includeInactive = req.query.all === 'true' || req.query.admin === 'true';
  const slides = readSlides();
  const filtered = includeInactive ? slides : slides.filter(s => s.isActive !== false);
  filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(filtered);
});

// GET /api/slides/:id - Single slide
app.get('/api/slides/:id', (req, res) => {
  const slides = readSlides();
  const slide = slides.find(s => s.id === req.params.id);
  if (!slide) {
    return res.status(404).json({ error: 'Slide not found' });
  }
  res.json(slide);
});

// POST /api/slides - Upload and create a new slide
app.post('/api/slides', upload.single('image'), (req, res) => {
  try {
    const slides = readSlides();
    let imageUrl = req.body.imageUrl || '';

    // If a file was uploaded via multer, use the local uploads URL
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
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

    slides.push(newSlide);
    writeSlides(slides);
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
app.put('/api/slides/:id', upload.single('image'), (req, res) => {
  try {
    const slides = readSlides();
    const index = slides.findIndex(s => s.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    const existing = slides[index];
    let imageUrl = existing.imageUrl;

    // If new file uploaded, update image and clean up old local image if any
    if (req.file) {
      const oldFilename = existing.imageUrl?.startsWith('/uploads/')
        ? path.basename(existing.imageUrl)
        : null;
      if (oldFilename && oldFilename !== 'user-limelight-banner.jpg') {
        const oldPath = path.join(UPLOADS_DIR, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
        }
      }
      imageUrl = `/uploads/${req.file.filename}`;
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

    slides[index] = updatedSlide;
    writeSlides(slides);
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
app.delete('/api/slides/:id', (req, res) => {
  try {
    const slides = readSlides();
    const index = slides.findIndex(s => s.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    const deleted = slides[index];

    // Remove local file if stored in /uploads/
    if (deleted.imageUrl && deleted.imageUrl.startsWith('/uploads/')) {
      const filename = path.basename(deleted.imageUrl);
      if (filename !== 'user-limelight-banner.jpg') {
        const filePath = path.join(UPLOADS_DIR, filename);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        }
      }
    }

    slides.splice(index, 1);
    writeSlides(slides);
    logActivity('Slide Deleted', `Removed slide "${deleted.title}" (ID: ${req.params.id})`);

    res.json({
      success: true,
      message: 'Slide deleted successfully',
      id: req.params.id
    });
  } catch (error) {
    console.error('Error deleting slide:', error);
    res.status(500).json({ error: error.message || 'Failed to delete slide' });
  }
});

// POST /api/slides/reorder - Reorder slides
app.post('/api/slides/reorder', (req, res) => {
  try {
    const { orderIds } = req.body; // array of slide IDs in desired order
    if (!Array.isArray(orderIds)) {
      return res.status(400).json({ error: 'orderIds must be an array of slide IDs' });
    }

    const slides = readSlides();
    slides.forEach(slide => {
      const newOrder = orderIds.indexOf(slide.id);
      if (newOrder !== -1) {
        slide.order = newOrder + 1;
      }
    });

    writeSlides(slides);
    res.json({ success: true, message: 'Slides reordered successfully', slides });
  } catch (error) {
    console.error('Error reordering slides:', error);
    res.status(500).json({ error: error.message || 'Failed to reorder slides' });
  }
});

// POST /api/slides/reset - Reset to default seed
app.post('/api/slides/reset', (req, res) => {
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
    const products = readProducts();
    const routes = readNavigation();
    const settings = readSettings();

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

