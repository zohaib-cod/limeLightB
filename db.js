import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
const DATA_DIR = path.join(__dirname, 'data');

let isConnected = false;

// Connect to MongoDB Atlas
export async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('⚠️ MONGODB_URI not set. Running in local JSON storage mode.');
    return false;
  }

  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000
    });
    isConnected = true;
    console.log('✅ Connected to MongoDB Atlas successfully! (Database: limelight)');

    // Seed data from JSON if collections are empty
    await seedInitialData();

    return true;
  } catch (err) {
    console.error('❌ MongoDB Atlas connection error:', err.message);
    isConnected = false;
    return false;
  }
}

export function isMongoConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

// Helper to safely read JSON file
function readJson(fileName) {
  try {
    const filePath = path.join(DATA_DIR, fileName);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.warn(`Error reading ${fileName}:`, err.message);
  }
  return null;
}

// Seed initial data from JSON into MongoDB if collections are empty
async function seedInitialData() {
  if (!isMongoConnected()) return;

  try {
    // 1. Navigation
    const navCount = await Navigation.countDocuments();
    if (navCount === 0) {
      const initialNav = readJson('navigation.json');
      if (Array.isArray(initialNav) && initialNav.length > 0) {
        await Navigation.insertMany(initialNav);
        console.log(`📦 Seeded ${initialNav.length} navigation routes to MongoDB`);
      }
    }

    // 2. Settings
    const settingCount = await Setting.countDocuments();
    if (settingCount === 0) {
      const initialSettings = readJson('settings.json');
      if (initialSettings) {
        await Setting.create({ key: 'site_settings', ...initialSettings });
        console.log('📦 Seeded site settings & logo to MongoDB');
      }
    }

    // 3. Products
    const prodCount = await Product.countDocuments();
    if (prodCount === 0) {
      const initialProds = readJson('products.json');
      if (Array.isArray(initialProds) && initialProds.length > 0) {
        await Product.insertMany(initialProds);
        console.log(`📦 Seeded ${initialProds.length} products to MongoDB`);
      }
    }

    // 4. Sliders
    const slideCount = await Slide.countDocuments();
    if (slideCount === 0) {
      const initialSlides = readJson('slides.json');
      if (Array.isArray(initialSlides) && initialSlides.length > 0) {
        await Slide.insertMany(initialSlides);
        console.log(`📦 Seeded ${initialSlides.length} hero slides to MongoDB`);
      }
    }

    // 5. Banners
    const bannerCount = await Banner.countDocuments();
    if (bannerCount === 0) {
      const initialBanners = readJson('banners.json');
      if (Array.isArray(initialBanners) && initialBanners.length > 0) {
        await Banner.insertMany(initialBanners);
        console.log(`📦 Seeded ${initialBanners.length} section banners to MongoDB`);
      }
    }

    // 6. Users
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const initialUsers = readJson('users.json');
      if (Array.isArray(initialUsers) && initialUsers.length > 0) {
        await User.insertMany(initialUsers);
        console.log(`📦 Seeded ${initialUsers.length} users to MongoDB`);
      }
    }

    // 7. Orders
    const orderCount = await Order.countDocuments();
    if (orderCount === 0) {
      const initialOrders = readJson('orders.json');
      if (Array.isArray(initialOrders) && initialOrders.length > 0) {
        await Order.insertMany(initialOrders);
        console.log(`📦 Seeded ${initialOrders.length} orders to MongoDB`);
      }
    }

    // 8. Collections
    const colCount = await Collection.countDocuments();
    if (colCount === 0) {
      const initialCols = readJson('collections.json');
      if (Array.isArray(initialCols) && initialCols.length > 0) {
        await Collection.insertMany(initialCols);
        console.log(`📦 Seeded ${initialCols.length} collections to MongoDB`);
      }
    }

    // 9. New Arrivals
    const naCount = await NewArrival.countDocuments();
    if (naCount === 0) {
      const initialNA = readJson('new-arrivals.json');
      if (Array.isArray(initialNA) && initialNA.length > 0) {
        await NewArrival.insertMany(initialNA);
        console.log(`📦 Seeded ${initialNA.length} new arrivals to MongoDB`);
      }
    }

    // 10. Features
    const featCount = await Feature.countDocuments();
    if (featCount === 0) {
      const initialFeat = readJson('features.json');
      if (Array.isArray(initialFeat) && initialFeat.length > 0) {
        await Feature.insertMany(initialFeat);
        console.log(`📦 Seeded ${initialFeat.length} features to MongoDB`);
      }
    }

    // 11. Homepage Sections
    const sectionCount = await Section.countDocuments();
    if (sectionCount === 0) {
      const initialSections = readJson('sections.json');
      if (Array.isArray(initialSections) && initialSections.length > 0) {
        await Section.insertMany(initialSections);
        console.log(`📦 Seeded ${initialSections.length} homepage sections to MongoDB`);
      }
    }

    // 12. Footer & Newsletter Content
    const footerCount = await Footer.countDocuments();
    if (footerCount === 0) {
      const initialFooter = readJson('footer.json');
      if (initialFooter) {
        await Footer.create({ key: 'site_footer', ...initialFooter });
        console.log('📦 Seeded footer & newsletter content to MongoDB');
      }
    }

    // 13. Newsletter Subscribers
    const subCount = await Subscriber.countDocuments();
    if (subCount === 0) {
      const initialSubs = readJson('subscribers.json');
      if (Array.isArray(initialSubs) && initialSubs.length > 0) {
        await Subscriber.insertMany(initialSubs);
        console.log(`📦 Seeded ${initialSubs.length} subscribers to MongoDB`);
      }
    }
  } catch (err) {
    console.error('Error during initial MongoDB data seeding:', err.message);
  }
}

